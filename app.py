"""Flask backend para o app de distribuição de leads.

Encapsula todas as chamadas ao Pipedrive, mantendo o token apenas no servidor.
Sem banco de dados (zero superfície para SQL injection) e sem chamadas a
shell/subprocess (zero superfície para command injection). Inputs vindos do
cliente passam por validação estrita (tipo, formato, comprimento) antes de
serem repassados ao Pipedrive.
"""

from __future__ import annotations

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from functools import wraps
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("distribuidor")

# ---------------------------------------------------------------------------
# Configuração via variáveis de ambiente
# ---------------------------------------------------------------------------
PIPEDRIVE_TOKEN = os.environ.get("PIPEDRIVE_API_TOKEN", "").strip()
APP_API_KEY = os.environ.get("APP_API_KEY", "").strip()
print(PIPEDRIVE_TOKEN)
print("PIPEDRIVE_TOKEN")
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5000").split(",")
    if o.strip()
]
FILTER_OWNER_IDS = [
    int(x)
    for x in os.environ.get("PIPEDRIVE_FILTER_OWNER_IDS", "").split(",")
    if x.strip().isdigit()
]
FILTER_NAME_SUFFIX = os.environ.get("PIPEDRIVE_FILTER_NAME_SUFFIX", "")

# Origens autorizadas a embedar o app em iframe via CSP `frame-ancestors`.
# Vazio (padrão) = mantém X-Frame-Options: DENY (bloqueia qualquer embed).
# Use `*` para liberar geral, ou `'self' https://app.exemplo.com` para travar.
FRAME_ANCESTORS = os.environ.get("FRAME_ANCESTORS", "").strip()

PIPEDRIVE_BASE_V1 = "https://api.pipedrive.com/v1"
PIPEDRIVE_BASE_V2 = "https://api.pipedrive.com/api/v2"
REQUEST_TIMEOUT = 30

PIPELINE_ID = 2
FILTER_ATIVIDADES_ATRASADAS = 1339
FILTER_ATIVIDADES_AGENDAS = 1343
FILTER_NEGOCIOS_NOVOS_HOJE = 1341
FILTER_NEGOCIOS_PERDIDOS = 1342
DEAL_CONVERT_STAGE_ID = 6
LEAD_OWNER_CUSTOM_FIELD = "e76364fa33cbe6838731ebeb22e66d66ce78b6e8"

# Mapeamento de etiquetas de organização (label_ids → texto exibido).
# Mantido fora do código que processa para facilitar manutenção.
ORG_LABEL_MAP: dict[int, str] = {
    1404: "JUNIOR",
    1405: "PLENO",
    1253: "PRIME",
    1545: "PRIME GP",
}

# Custom-field keys da organização no Pipedrive.
ORG_CF_CNAE = "cc34813b388f5663ef1dd3249fdb74d8a514179a"
ORG_CF_PORTE = "866c63e93c1121fdae1356e992b58a38e186443b"

# Concorrência para enriquecer organizações (busca por ID em paralelo).
ORG_FETCH_WORKERS = int(os.environ.get("PIPEDRIVE_ORG_FETCH_WORKERS", "12"))

if not PIPEDRIVE_TOKEN:
    log.warning(
        "PIPEDRIVE_API_TOKEN não configurado. As chamadas ao Pipedrive falharão."
    )

# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder=".", static_url_path="")
app.url_map.strict_slashes = False

CORS(
    app,
    resources={r"/api/*": {"origins": ALLOWED_ORIGINS or "*"}},
    supports_credentials=False,
    allow_headers=["Content-Type", "X-API-Key"],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["240 per minute", "20 per second"],
    storage_uri="memory://",
    headers_enabled=True,
)


# ---------------------------------------------------------------------------
# Auth (chave compartilhada opcional)
# ---------------------------------------------------------------------------
def require_api_key(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if APP_API_KEY:
            sent = request.headers.get("X-API-Key", "")
            if sent != APP_API_KEY:
                return jsonify({"error": "unauthorized"}), 401
        return view(*args, **kwargs)

    return wrapped


# ---------------------------------------------------------------------------
# Validadores
# ---------------------------------------------------------------------------
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LEAD_ID_RE = re.compile(r"^[A-Za-z0-9\-]{1,64}$")  # Pipedrive lead IDs são UUIDs


def _positive_int(value: Any, name: str) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError) as e:
        raise ValueError(f"{name} deve ser inteiro") from e
    if v <= 0:
        raise ValueError(f"{name} deve ser positivo")
    return v


def _validate_date(value: Any, name: str) -> str:
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValueError(f"{name} deve estar no formato YYYY-MM-DD")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as e:
        raise ValueError(f"{name} é uma data inválida") from e
    return value


def _validate_lead_id(value: Any) -> str:
    if not isinstance(value, (str, int)):
        raise ValueError("lead_id deve ser string ou inteiro")
    s = str(value).strip()
    if not _LEAD_ID_RE.match(s):
        raise ValueError(f"lead_id inválido: {value!r}")
    return s


# ---------------------------------------------------------------------------
# Helpers Pipedrive
# ---------------------------------------------------------------------------
def _pipedrive_get(path: str, params: dict | None = None) -> dict:
    p = dict(params or {})
    p["api_token"] = PIPEDRIVE_TOKEN
    r = requests.get(f"{PIPEDRIVE_BASE_V1}{path}", params=p, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    return r.json()


def _pipedrive_v2_get(path: str, params: dict | None = None) -> dict:
    r = requests.get(
        f"{PIPEDRIVE_BASE_V2}{path}",
        headers={"x-api-token": PIPEDRIVE_TOKEN, "Accept": "application/json"},
        params=params or {},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def _pipedrive_put(path: str, body: dict) -> dict:
    r = requests.put(
        f"{PIPEDRIVE_BASE_V1}{path}",
        params={"api_token": PIPEDRIVE_TOKEN},
        json=body,
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def _pipedrive_v2_paginate(
    path: str, base_params: dict | None = None, limit: int = 500
) -> list[dict]:
    """Itera em endpoints v2 que usam paginação por cursor.

    O parâmetro `cursor` na próxima requisição é o `next_cursor` retornado em
    `additional_data` da requisição atual. Quando `next_cursor` vem nulo, fim.
    """
    out: list[dict] = []
    cursor: str | None = None
    while True:
        params = dict(base_params or {})
        params["limit"] = limit
        if cursor:
            params["cursor"] = cursor
        page = _pipedrive_v2_get(path, params)
        data = page.get("data") or []
        if data:
            out.extend(data)
        cursor = (page.get("additional_data") or {}).get("next_cursor")
        if not cursor:
            return out


def _get_stages_map(pipeline_id: int = PIPELINE_ID) -> dict[int, str]:
    """Retorna {stage_id: stage_name} para um pipeline. Sempre busca ao vivo."""
    payload = _pipedrive_v2_get(
        "/stages",
        {
            "pipeline_id": pipeline_id,
            "sort_by": "order_nr",
            "sort_direction": "asc",
        },
    )
    raw = payload.get("data") or []
    return {
        s["id"]: s.get("name", f"Etapa {s.get('id')}")
        for s in raw
        if s.get("id") is not None and not s.get("is_deleted")
    }


def _fetch_organization(org_id: int) -> dict | None:
    """Busca uma organização individual por ID. Retorna None em 404 ou erro de
    rede — distribuição de leads não deve quebrar por causa de uma org sumida."""
    try:
        r = requests.get(
            f"{PIPEDRIVE_BASE_V2}/organizations/{org_id}",
            headers={"x-api-token": PIPEDRIVE_TOKEN, "Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return (r.json() or {}).get("data")
    except requests.RequestException as e:
        log.warning("Falha ao buscar org %s: %s", org_id, e)
        return None


def _extract_org_meta(o: dict) -> dict:
    """Extrai {name, label, cnae, porte} de uma org v2."""
    cf = o.get("custom_fields") or {}
    label: str | None = None
    for lid in (o.get("label_ids") or []):
        mapped = ORG_LABEL_MAP.get(lid)
        if mapped:
            label = mapped
            break
    cnae = cf.get(ORG_CF_CNAE)
    porte = cf.get(ORG_CF_PORTE)
    return {
        "name": o.get("name") or "",
        "label": label,
        "cnae": cnae if isinstance(cnae, str) and cnae.strip() else None,
        "porte": porte if isinstance(porte, str) and porte.strip() else None,
    }


def _pipedrive_paginate(path: str, base_params: dict, limit: int = 500) -> dict:
    """Itera em endpoints v1 que usam start/limit + additional_data.pagination."""
    final = {"data": [], "related_objects": {}}
    start = 0
    while True:
        params = dict(base_params)
        params.update({"start": start, "limit": limit})
        page = _pipedrive_get(path, params)
        if page.get("data"):
            final["data"].extend(page["data"])
        rel = page.get("related_objects") or {}
        for key, value in rel.items():
            existing = final["related_objects"].get(key)
            if existing is None:
                final["related_objects"][key] = value
            elif isinstance(existing, list) and isinstance(value, list):
                existing.extend(value)
            elif isinstance(existing, dict) and isinstance(value, dict):
                existing.update(value)
            else:
                final["related_objects"][key] = value
        pagination = (page.get("additional_data") or {}).get("pagination") or {}
        if pagination.get("more_items_in_collection"):
            start = pagination["next_start"]
        else:
            return final


def _set_filter_perdidos_global(start: str, end: str) -> None:
    """Configura o filtro 1342 SEM filtro por usuário — apenas (lost AND data
    no intervalo). O filtro por owner é feito em Python depois, evitando que
    o filtro Pipedrive se torne estado por-usuário (e race conditions)."""
    body = {
        "conditions": {
            "glue": "and",
            "conditions": [
                {
                    "glue": "and",
                    "conditions": [
                        {"object": "deal", "field_id": "12", "operator": "=", "value": "lost"},
                        {"object": "deal", "field_id": "21", "operator": ">=", "value": start},
                        {"object": "deal", "field_id": "21", "operator": "<=", "value": end},
                    ],
                },
                {"glue": "or", "conditions": []},
            ],
        }
    }
    _pipedrive_put(f"/filters/{FILTER_NEGOCIOS_PERDIDOS}", body)


def _set_filter_novos_hoje_global() -> None:
    """Configura o filtro 1341 para retornar todos os deals criados hoje
    (sem filtro por usuário). O filtro por owner é feito em Python depois.

    Pipedrive exige que cada filho de `conditions` seja um GRUPO (com `glue`
    e seu próprio `conditions`), nunca um leaf direto. Por isso o leaf está
    embrulhado em um grupo "and".
    """
    body = {
        "conditions": {
            "glue": "and",
            "conditions": [
                {
                    "glue": "and",
                    "conditions": [
                        {
                            "object": "deal", "field_id": "13", "operator": "=",
                            "value": "today", "extra_value": None,
                        },
                    ],
                },
            ],
        }
    }
    _pipedrive_put(f"/filters/{FILTER_NEGOCIOS_NOVOS_HOJE}", body)


# ---------------------------------------------------------------------------
# Processadores (transformam respostas do Pipedrive em estruturas leves)
# ---------------------------------------------------------------------------
def _proc_atividades(payload: dict) -> dict:
    atividades = payload.get("data") or []
    today = datetime.now().date().isoformat()
    fazer = atrasada = 0
    for atv in atividades:
        if (atv.get("due_date") or "") == today:
            fazer += 1
        else:
            atrasada += 1
    return {"fazer": fazer, "atrasada": atrasada}


def _proc_perdidos_v2(
    deals: list[dict],
    user_id: int,
    stages_map: dict[int, str],
    today_str: str | None = None,
) -> dict:
    """Consolida negócios perdidos vindos da API v2.

    Se `today_str` for fornecido, filtra apenas perdidos cujo local_lost_date
    coincida com a data passada (caso "hoje"). Caso contrário considera todos
    os deals retornados (já filtrados pelo filter_id no Pipedrive).
    """
    por_etapa: dict[str, int] = {}
    por_motivo: dict[str, int] = {}
    total = 0
    for d in deals:
        if d.get("pipeline_id") != PIPELINE_ID:
            continue
        if d.get("status") != "lost":
            continue
        if int(d.get("owner_id") or 0) != int(user_id):
            continue
        if today_str and d.get("local_lost_date") != today_str:
            continue
        stage_name = stages_map.get(d.get("stage_id"), f"Etapa {d.get('stage_id')}")
        reason = d.get("lost_reason") or "Sem motivo"
        por_etapa[stage_name] = por_etapa.get(stage_name, 0) + 1
        por_motivo[reason] = por_motivo.get(reason, 0) + 1
        total += 1
    return {"total": total, "por_etapa": por_etapa, "por_motivo": por_motivo}


# ---------------------------------------------------------------------------
# Rotas
# ---------------------------------------------------------------------------
@app.route("/")
def root():
    return send_from_directory(".", "index.html")


@app.get("/api/health")
def health():
    return {"ok": True, "auth_required": bool(APP_API_KEY)}


@app.get("/api/diag")
@require_api_key
def diag():
    """Healthcheck profundo: tenta uma chamada real ao Pipedrive."""
    if not PIPEDRIVE_TOKEN:
        return (
            jsonify(
                {
                    "ok": False,
                    "step": "config",
                    "message": "PIPEDRIVE_API_TOKEN não configurado no .env.",
                }
            ),
            500,
        )
    try:
        r = requests.get(
            f"{PIPEDRIVE_BASE_V1}/users/me",
            params={"api_token": PIPEDRIVE_TOKEN},
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        return (
            jsonify({"ok": False, "step": "request", "message": str(e)}),
            502,
        )
    if not r.ok:
        return (
            jsonify(
                {
                    "ok": False,
                    "step": "auth",
                    "upstream_status": r.status_code,
                    "message": "Pipedrive recusou a chamada — token provavelmente inválido.",
                }
            ),
            502,
        )
    data = (r.json() or {}).get("data") or {}
    return jsonify(
        {
            "ok": True,
            "user": {
                "id": data.get("id"),
                "name": data.get("name"),
                "email": data.get("email"),
            },
        }
    )


@app.get("/api/filters")
@require_api_key
def list_filters():
    """Lista filtros de leads expostos. Apenas filtros pertencentes aos owners
    autorizados em PIPEDRIVE_FILTER_OWNER_IDS e cujo nome contém o sufixo
    configurado são retornados."""
    payload = _pipedrive_get("/filters", {"type": "leads"})
    raw = payload.get("data") or []
    out = [
        {"id": f["id"], "name": f["name"]}
        for f in raw
        if f.get("active_flag")
        and (not FILTER_OWNER_IDS or f.get("user_id") in FILTER_OWNER_IDS)
        and (not FILTER_NAME_SUFFIX or FILTER_NAME_SUFFIX in (f.get("name") or ""))
    ]
    out.sort(key=lambda x: x["name"].lower())
    return jsonify(out)


@app.get("/api/stages")
@require_api_key
def list_stages():
    """Lista as etapas (stages) de um pipeline, ordenadas por order_nr asc.
    Retorna [{id, name, order_nr}, …] sempre fresco (sem cache)."""
    try:
        pipeline_id = _positive_int(
            request.args.get("pipeline_id", PIPELINE_ID), "pipeline_id"
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    payload = _pipedrive_v2_get(
        "/stages",
        params={
            "pipeline_id": pipeline_id,
            "sort_by": "order_nr",
            "sort_direction": "asc",
        },
    )
    raw = payload.get("data") or []
    stages = [
        {
            "id": s["id"],
            "name": s.get("name", ""),
            "order_nr": s.get("order_nr", 0),
        }
        for s in raw
        if s.get("id") is not None and not s.get("is_deleted")
    ]
    stages.sort(key=lambda s: s["order_nr"])
    return jsonify(stages)


@app.get("/api/users")
@require_api_key
def list_users():
    payload = _pipedrive_get("/users")
    raw = payload.get("data") or []
    out = [
        {"id": u["id"], "name": u["name"], "email": u.get("email", "")}
        for u in raw
        if u.get("active_flag")
        and u.get("id") is not None
        and u.get("name")
    ]
    out.sort(key=lambda x: x["name"].lower())
    return jsonify(out)


@app.get("/api/leads")
@require_api_key
def list_leads():
    try:
        filter_id = _positive_int(request.args.get("filter_id"), "filter_id")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    result = _pipedrive_paginate(
        "/leads",
        {"archived_status": "not_archived", "filter_id": filter_id},
    )
    leads = result.get("data") or []
    grouped: dict[str, dict] = {}
    for lead in leads:
        title = (lead.get("title") or "(sem título)").strip() or "(sem título)"
        lid = lead.get("id")
        if not lid:
            continue
        bucket = grouped.setdefault(title, {"total": 0, "ids": []})
        bucket["ids"].append(lid)
        bucket["total"] += 1
    return jsonify(
        {
            "total": sum(b["total"] for b in grouped.values()),
            "total_unicos": len(grouped),
            "grouped": grouped,
        }
    )


def _slim_deal(d: dict) -> dict:
    """Reduz um deal v2 ao mínimo necessário para o cálculo de insights local."""
    return {
        "id": d.get("id"),
        "stage_id": d.get("stage_id"),
        "owner_id": d.get("owner_id"),
        "org_id": d.get("org_id"),
        "status": d.get("status"),
        "add_time": d.get("add_time"),
        "lost_reason": d.get("lost_reason"),
        "local_lost_date": d.get("local_lost_date"),
        "next_activity_id": d.get("next_activity_id"),
    }


def _slim_activity(a: dict) -> dict:
    """Reduz uma activity v1 ao essencial: usuário e data de vencimento."""
    user_id = a.get("user_id")
    if isinstance(user_id, dict):
        user_id = user_id.get("id")
    return {"user_id": user_id, "due_date": a.get("due_date")}


def _build_org_index_from_ids(org_ids: set[int]) -> dict[int, dict]:
    """Versão de _build_org_index_for_deals que aceita um conjunto de IDs."""
    ids = sorted({int(x) for x in org_ids if x is not None})
    if not ids:
        return {}
    index: dict[int, dict] = {}
    workers = max(1, min(ORG_FETCH_WORKERS, len(ids)))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_fetch_organization, oid): oid for oid in ids}
        for fut in as_completed(futures):
            oid = futures[fut]
            o = fut.result()
            if not o or o.get("is_deleted"):
                continue
            index[oid] = _extract_org_meta(o)
    return index


@app.get("/api/insights-snapshot")
@require_api_key
def insights_snapshot():
    """Retorna um snapshot com TODOS os dados necessários para calcular
    insights de qualquer assessor.

    Pensado para ser chamado **uma vez por sessão de distribuição**: o
    frontend cacheia em memória até o reload da página. Cada card de assessor
    apenas filtra o snapshot localmente — sem novas requisições.

    Os filtros do Pipedrive (1341 e 1342) são reconfigurados sem critério de
    usuário; o filtro por owner é aplicado em Python pelo consumidor.
    """
    today = datetime.now().date().isoformat()

    # Reconfigura filtros para ficarem globais (sem usuário) nesta janela.
    _set_filter_perdidos_global(today, today)
    _set_filter_novos_hoje_global()

    def _open_deals():
        return _pipedrive_v2_paginate(
            "/deals",
            {
                "pipeline_id": PIPELINE_ID,
                "status": "open",
                "include_fields": "next_activity_id",
            },
        )

    def _lost_today():
        return _pipedrive_v2_paginate(
            "/deals", {"filter_id": FILTER_NEGOCIOS_PERDIDOS}
        )

    def _new_today():
        return _pipedrive_v2_paginate(
            "/deals", {"filter_id": FILTER_NEGOCIOS_NOVOS_HOJE}
        )

    def _activities_overdue():
        # user_id=0 = todas as atividades (de todos os usuários) que casam o
        # filtro. Sem esse param, v1 devolve só as do dono do token.
        return _pipedrive_paginate(
            "/activities",
            {"filter_id": FILTER_ATIVIDADES_ATRASADAS, "user_id": 0},
        )

    def _activities_today():
        return _pipedrive_paginate(
            "/activities",
            {"filter_id": FILTER_ATIVIDADES_AGENDAS, "user_id": 0},
        )

    # Busca tudo em paralelo.
    with ThreadPoolExecutor(max_workers=6) as ex:
        f_stages = ex.submit(_get_stages_map)
        f_open = ex.submit(_open_deals)
        f_lost = ex.submit(_lost_today)
        f_novos = ex.submit(_new_today)
        f_act_atr = ex.submit(_activities_overdue)
        f_act_today = ex.submit(_activities_today)

        stages_map = f_stages.result()
        open_deals = f_open.result()
        lost_deals = f_lost.result()
        new_today_deals = f_novos.result()
        atvs_atrasadas_payload = f_act_atr.result()
        atvs_today_payload = f_act_today.result()

    # Coleta IDs de orgs referenciados em qualquer deal e busca em paralelo.
    org_ids: set[int] = set()
    for src in (open_deals, lost_deals, new_today_deals):
        for d in src:
            if d.get("org_id") is not None:
                org_ids.add(int(d["org_id"]))
    orgs_index = _build_org_index_from_ids(org_ids)

    # Lista ordenada de stages (para chips na ordem correta no frontend).
    stages_list = sorted(
        [{"id": sid, "name": name} for sid, name in stages_map.items()],
        key=lambda s: s["id"],  # ordem por id como fallback
    )

    return jsonify(
        {
            "snapshot_at": datetime.utcnow().isoformat() + "Z",
            "today": today,
            "stages": stages_list,
            "open_deals": [_slim_deal(d) for d in open_deals],
            "lost_today_deals": [_slim_deal(d) for d in lost_deals],
            "new_today_deals": [_slim_deal(d) for d in new_today_deals],
            "activities_overdue": [
                _slim_activity(a) for a in (atvs_atrasadas_payload.get("data") or [])
            ],
            "activities_today": [
                _slim_activity(a) for a in (atvs_today_payload.get("data") or [])
            ],
            "orgs": orgs_index,
        }
    )


@app.post("/api/assessor/<int:user_id>/perdidos")
@require_api_key
def assessor_perdidos(user_id):
    """Perdidos por intervalo customizado para um assessor específico.

    Diferente do snapshot (que cobre apenas hoje), este endpoint roda sob
    demanda quando o usuário ajusta o range de datas no card. Ele
    reconfigura o filtro globalmente para o período e filtra por owner em
    Python, mantendo o filtro Pipedrive sem estado por-usuário.
    """
    body = request.get_json(silent=True) or {}
    try:
        start = _validate_date(body.get("start"), "start")
        end = _validate_date(body.get("end"), "end")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if start > end:
        return jsonify({"error": "start deve ser <= end"}), 400

    _set_filter_perdidos_global(start, end)
    deals = _pipedrive_v2_paginate(
        "/deals", {"filter_id": FILTER_NEGOCIOS_PERDIDOS}
    )
    stages_map = _get_stages_map()
    result = _proc_perdidos_v2(deals, user_id, stages_map, today_str=None)
    return jsonify({"por_etapa": result["por_etapa"], "por_motivo": result["por_motivo"]})


@app.post("/api/distribute")
@require_api_key
@limiter.limit("30 per minute")
def distribute():
    body = request.get_json(silent=True) or {}
    try:
        owner_id = _positive_int(body.get("owner_id"), "owner_id")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    raw_ids = body.get("lead_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({"error": "lead_ids deve ser uma lista não-vazia"}), 400
    if len(raw_ids) > 1000:
        return jsonify({"error": "lead_ids excede o limite de 1000"}), 400
    try:
        lead_ids = [_validate_lead_id(x) for x in raw_ids]
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    results = []
    for lid in lead_ids:
        ok_patch = _patch_lead(lid, owner_id)
        ok_convert = _convert_lead(lid) if ok_patch else False
        results.append({"lead_id": lid, "patched": ok_patch, "converted": ok_convert})

    summary = {
        "total": len(results),
        "patched": sum(1 for r in results if r["patched"]),
        "converted": sum(1 for r in results if r["converted"]),
    }
    return jsonify({"summary": summary, "results": results})


def _retry_call(fn, *args, attempts=(0, 5, 15, 30, 60), **kwargs) -> bool:
    """Executa fn com backoff progressivo entre tentativas (em segundos)."""
    import time

    for i, delay in enumerate(attempts):
        if delay:
            time.sleep(delay)
        try:
            if fn(*args, **kwargs):
                return True
        except requests.RequestException as e:
            log.warning("tentativa %d falhou: %s", i + 1, e)
    return False


def _patch_lead(lead_id: str, owner_id: int) -> bool:
    def _do() -> bool:
        url = f"{PIPEDRIVE_BASE_V1}/leads/{lead_id}"
        r = requests.patch(
            url,
            params={"api_token": PIPEDRIVE_TOKEN},
            json={"owner_id": owner_id, LEAD_OWNER_CUSTOM_FIELD: owner_id},
            timeout=REQUEST_TIMEOUT,
        )
        if not r.ok:
            return False
        return r.json().get("success") is True

    return _retry_call(_do)


def _convert_lead(lead_id: str) -> bool:
    def _do() -> bool:
        url = f"{PIPEDRIVE_BASE_V2}/leads/{lead_id}/convert/deal"
        r = requests.post(
            url,
            headers={
                "x-api-token": PIPEDRIVE_TOKEN,
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"pipeline_id": PIPELINE_ID, "stage_id": DEAL_CONVERT_STAGE_ID},
            timeout=REQUEST_TIMEOUT,
        )
        if not r.ok:
            return False
        return r.json().get("success") is True

    return _retry_call(_do)


# ---------------------------------------------------------------------------
# Headers de segurança e error handlers
# ---------------------------------------------------------------------------
@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
    )
    if FRAME_ANCESTORS:
        # CSP frame-ancestors substitui X-Frame-Options nos navegadores
        # modernos e suporta múltiplas origens explícitas.
        response.headers["Content-Security-Policy"] = (
            f"frame-ancestors {FRAME_ANCESTORS};"
        )
    else:
        response.headers.setdefault("X-Frame-Options", "DENY")
    return response


@app.errorhandler(requests.HTTPError)
def _h_http(e):
    resp = getattr(e, "response", None)
    upstream = getattr(resp, "status_code", None)
    detail = ""
    try:
        body = resp.json() if resp is not None else None
        if isinstance(body, dict):
            detail = (
                body.get("error")
                or body.get("error_info")
                or body.get("message")
                or ""
            )
    except Exception:
        detail = (resp.text[:300] if resp is not None else "") or ""
    log.error("Upstream Pipedrive %s: %s", upstream, detail)

    if upstream == 401:
        msg = "Token Pipedrive inválido ou expirado."
        hint = "Verifique PIPEDRIVE_API_TOKEN no .env e reinicie o servidor."
    elif upstream == 403:
        msg = "Token Pipedrive sem permissão para esta operação."
        hint = "Confira se o usuário do token enxerga os filtros e leads."
    elif upstream == 429:
        msg = "Pipedrive aplicou rate limit."
        hint = "Aguarde alguns segundos e tente novamente."
    elif upstream == 404:
        msg = "Recurso não encontrado no Pipedrive."
        hint = "Pode ser um filtro removido ou ID incorreto."
    elif upstream and 500 <= upstream < 600:
        msg = "Pipedrive está instável no momento."
        hint = "Tente novamente em alguns segundos."
    else:
        msg = "Falha na chamada ao Pipedrive."
        hint = detail or "Sem detalhes adicionais."

    return (
        jsonify(
            {
                "error": "upstream_http_error",
                "upstream_status": upstream,
                "message": msg,
                "hint": hint,
            }
        ),
        502,
    )


@app.errorhandler(requests.RequestException)
def _h_req(e):
    log.exception("Upstream connection error")
    return jsonify({"error": "upstream_connection_error"}), 502


@app.errorhandler(404)
def _h_404(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "not_found"}), 404
    return send_from_directory(".", "index.html")


@app.errorhandler(429)
def _h_429(e):
    return jsonify({"error": "rate_limited", "detail": str(e.description)}), 429


@app.errorhandler(Exception)
def _h_unexpected(e):
    log.exception("Unhandled exception")
    return jsonify({"error": "internal_error"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="127.0.0.1", port=port, debug=debug)
