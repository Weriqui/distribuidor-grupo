# Distribuidor de Leads — Grupo Villela

App de distribuição de leads do Pipedrive com **backend Flask** (proxy seguro) e
**frontend React via CDN** (sem etapa de build).

## Arquitetura

```
Navegador (index.html, React via esm.sh + Tailwind CDN + Babel Standalone)
        │
        ▼
Flask (app.py) ── valida inputs, mantém token, aplica rate-limit, CORS
        │
        ▼
Pipedrive API (v1 + v2)
```

- **Token nunca sai do servidor.** Em produção, lido de Secret Manager. Localmente, lido de `.env`.
- **Sem banco e sem chamadas a shell** → zero superfície para SQL/command injection.
- **Validação estrita** de IDs (regex), datas (`YYYY-MM-DD`), tamanhos máximos.
- **Rate limit** padrão 240 req/min e 30 req/min na rota de distribuição.
- **CORS** restrito a origens em `ALLOWED_ORIGINS`.
- **Headers de segurança**: `X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`.
- **API key opcional** (`APP_API_KEY`) para travar o app contra acesso externo.

## Rodando localmente

### Modo Python

1. Crie o arquivo `.env` com seu `PIPEDRIVE_API_TOKEN`. Se quiser, use
   `APP_API_KEY` (string longa) — o frontend pede e guarda em `localStorage`.

2. Virtualenv + dependências:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate          # Windows
   # source .venv/bin/activate     # Linux/Mac
   pip install -r requirements.txt
   ```

3. Suba:

   ```bash
   python app.py
   ```

   Abra `http://localhost:5000`.

### Modo Docker

```bash
docker build -t distribuidor-grupo .
docker run --rm -p 8080:8080 --env-file .env distribuidor-grupo
```

Abra `http://localhost:8080`.

## Endpoints

| Método | Rota                                  | Descrição                                                  |
|--------|---------------------------------------|------------------------------------------------------------|
| GET    | `/api/health`                         | Healthcheck (informa se exige API key)                     |
| GET    | `/api/diag`                           | Validação profunda — chama `users/me` no Pipedrive         |
| GET    | `/api/filters`                        | Lista filtros de leads autorizados                         |
| GET    | `/api/users`                          | Lista assessores ativos                                    |
| GET    | `/api/stages?pipeline_id=2`           | Etapas do pipeline (ordenadas por `order_nr`)              |
| GET    | `/api/leads?filter_id=X`              | Leads do filtro, agrupados por título                      |
| GET    | `/api/insights-snapshot`              | Snapshot global da sessão (deals abertos, perdidos hoje, novos hoje, atividades, orgs) |
| POST   | `/api/assessor/<id>/perdidos`         | Perdidos por período customizado `{start, end}`            |
| POST   | `/api/distribute`                     | Distribui leads `{owner_id, lead_ids[]}`                   |

## Variáveis de ambiente

| Var                              | Obrigatória | Descrição                                                                |
|----------------------------------|-------------|--------------------------------------------------------------------------|
| `PIPEDRIVE_API_TOKEN`            | sim         | Token do Pipedrive                                                       |
| `APP_API_KEY`                    | não         | Shared secret. Se setada, todo `/api/*` exige header `X-API-Key`         |
| `ALLOWED_ORIGINS`                | não         | Origens permitidas no CORS, vírgula-separadas. Padrão `*` em CR          |
| `PIPEDRIVE_FILTER_OWNER_IDS`     | não         | IDs (vírgula-separados) cujos filtros aparecem no select                 |
| `PIPEDRIVE_FILTER_NAME_SUFFIX`   | não         | Apenas filtros que contenham este sufixo no nome aparecem (ex. `(FILTRO)`) |
| `PIPEDRIVE_ORG_FETCH_WORKERS`    | não         | Concorrência ao buscar orgs por ID. Padrão `12`                          |
| `PORT`                           | não         | Porta de escuta. Cloud Run injeta automaticamente                        |

## Deploy no Cloud Run (Cloud Build)

`cloudbuild.yaml` cuida de tudo (Artifact Registry → build → push → deploy).
`gcloud run deploy` é idempotente — **cria o serviço na primeira vez e atualiza
nas seguintes**, sem comandos diferentes.

### Setup uma única vez (em Cloud Shell ou WSL)

```bash
# 1) Selecione o projeto
gcloud config set project SEU_PROJETO_ID

# 2) Habilite APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

# 3) Crie os secrets no Secret Manager
echo -n "SEU_TOKEN_PIPEDRIVE" | gcloud secrets create pipedrive-api-token --data-file=-

# Se quiser API key (recomendado em produção pública):
echo -n "string-longa-aleatória" | gcloud secrets create app-api-key --data-file=-
# Se NÃO quiser API key, crie o secret vazio (auth fica desligada):
# printf "" | gcloud secrets create app-api-key --data-file=-

# 4) Permissões para o Cloud Build deployar Cloud Run e mexer no Artifact Registry
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

for ROLE in roles/run.admin roles/iam.serviceAccountUser roles/artifactregistry.admin; do
  gcloud projects add-iam-policy-binding "$(gcloud config get-value project)" \
    --member="serviceAccount:${CB_SA}" --role="${ROLE}"
done

# 5) Permissão para a runtime SA do Cloud Run ler os secrets
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for SECRET in pipedrive-api-token app-api-key; do
  gcloud secrets add-iam-policy-binding "${SECRET}" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

### Primeira deploy e atualizações

```bash
gcloud builds submit --config=cloudbuild.yaml
```

O mesmo comando vale para criar e atualizar o serviço. A URL final aparece no fim do build:

```
Service URL: https://distribuidor-grupo-XXXXX-rj.a.run.app
```

### Trocar configurações sem rebuild

Para alterar memória, CPU, concurrency, owner IDs etc. sem rebuildar a imagem,
passe `--substitutions` ao build:

```bash
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_MEMORY=1Gi,_MAX_INSTANCES=2,_REGION=us-central1
```

Substituições disponíveis em `cloudbuild.yaml`:

| Sub                          | Padrão               |
|------------------------------|----------------------|
| `_SERVICE`                   | `distribuidor-grupo` |
| `_REGION`                    | `southamerica-east1` |
| `_AR_REPO`                   | `distribuidor-grupo` |
| `_MEMORY`                    | `512Mi`              |
| `_CPU`                       | `1`                  |
| `_MAX_INSTANCES`             | `1`                  |
| `_MIN_INSTANCES`             | `0`                  |
| `_CONCURRENCY`               | `20`                 |
| `_TIMEOUT`                   | `300`                |
| `_ALLOWED_ORIGINS`           | `*`                  |
| `_FILTER_OWNER_IDS`          | `14284568,23639057`  |
| `_FILTER_NAME_SUFFIX`        | ` (FILTRO)`          |
| `_ORG_FETCH_WORKERS`         | `12`                 |

> ⚠️ **Max instances = 1 é intencional**: o app reconfigura filtros 1341/1342 do
> Pipedrive (estado compartilhado) durante a busca do snapshot. Múltiplas
> instâncias poderiam ter race conditions sobrescrevendo as condições do filtro
> uma da outra. Em pico, suba `_CONCURRENCY` antes de subir `_MAX_INSTANCES`.

### Trigger automático (opcional)

Para deployar automaticamente em cada push para `main`:

```bash
gcloud builds triggers create github \
  --name=distribuidor-grupo-main \
  --repo-name=SEU_REPO --repo-owner=SEU_USER \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml
```

## Arquivos legados

`main_teste.js`, `teste.js` e `style_teste.css` permanecem no repo apenas
como referência da versão anterior. O novo `index.html` não os carrega e o
`.dockerignore` os exclui da imagem.
