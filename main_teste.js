document.addEventListener('DOMContentLoaded', async function() {
  const blocoAssessores = document.querySelector(".bloco_assessor");
  const selectFiltro = document.querySelector("#filtro_pipe");
  
  // Carrega os filtros do Pipedrive
  try {
    await retorna_filtro();
  } catch (error) {
    showError("Não foi possível carregar os filtros. Verifique sua conexão ou tente novamente mais tarde.");
  }

  // Quando o usuário selecionar um filtro, habilita criar blocos de assessores
  selectFiltro.addEventListener('change', () => {
    hideError();
    const valor = selectFiltro.value;
    if (valor) {
      // Exemplo: ao trocar de filtro, podemos criar um novo bloco de assessor
      add_blocoAssessor();
    }
  });
});
const ordemPreferida = [
    { name: 'Oportunidade', order_nr: 1 },
    { name: 'Tentativa', order_nr: 2 },
    { name: 'Contato efetivo', order_nr: 3 },
    { name: 'Qualificado', order_nr: 4 },
    { name: 'Agendado', order_nr: 5 },
    { name: 'Apresentar Plano', order_nr: 6 },
    { name: 'Enviar Proposta', order_nr: 7 },
    { name: 'Negociando', order_nr: 8 },
    { name: 'Assinatura', order_nr: 9 },
    { name: 'Onboarding', order_nr: 10 },
    { name: 'Execução/Aprovar', order_nr: 11 },
    { name: 'Entregar/Cobrar', order_nr: 12 },
    { name: '1a parcela paga', order_nr: 13 },
    { name: 'Contrato quitado', order_nr: 14 }
  ];
  
// ======= LOADING OVERLAY =======
function showLoadingOverlay(message) {
  // Ajusta o texto
  const msgEl = document.getElementById("loading-message");
  if (msgEl) {
    msgEl.textContent = message;
  }

  // Desabilita todos os inputs e botões
  document.querySelectorAll('input, select, button').forEach(el => {
    el.disabled = true;
  });

  // Mostra overlay
  const overlay = document.getElementById("loading-overlay");
  overlay.classList.remove("hidden");
}

/**
 * Esconde o overlay e reabilita os inputs/botões.
 */
function hideLoadingOverlay() {
  // Reabilita todos os inputs e botões
  document.querySelectorAll('input, select, button').forEach(el => {
    el.disabled = false;
  });

  // Esconde overlay
  const overlay = document.getElementById("loading-overlay");
  overlay.classList.add("hidden");
}

/**
 * Cria e insere um novo bloco de assessor (select + input + infos).
 */
async function add_blocoAssessor() {
  const blocoAssessores = document.querySelector(".bloco_assessor");
  const blocos = blocoAssessores.querySelectorAll(".inputs_assessor");
  
  // Cria o novo bloco (HTML) de exemplo
  let novoBloco;
  try {
    novoBloco = await retorna_bloco_exemplo();
  } catch (error) {
    showError("Não foi possível carregar os usuários. Verifique sua conexão ou tente novamente mais tarde.");
    return;
  }

  if (!novoBloco) {
    console.error("Erro: retorna_bloco_exemplo() não retornou um elemento válido.");
    return;
  }

  // Se já existir algum bloco, insere depois do último. Caso contrário, insere e cria botão de adicionar.
  if (blocos.length > 0) {
    const ultimoBloco = blocos[blocos.length - 1];
    ultimoBloco.insertAdjacentElement('afterend', novoBloco);
  } else {
    // Cria botão de adicionar mais assessores
    const botaoAdd = document.createElement("button");
    botaoAdd.innerHTML = '+ Adicionar outro assessor';
    blocoAssessores.appendChild(novoBloco);
    blocoAssessores.appendChild(botaoAdd);
    botaoAdd.addEventListener('click', add_blocoAssessor);
  }

  // Captura o select e o input number dentro do novo bloco
  const selectAssessor = novoBloco.querySelector(".assessor_select");
  const inputNumber = novoBloco.querySelector("input[type='number']");

  // Ao trocar o assessor no select, buscamos e exibimos os dados
  selectAssessor.addEventListener('change', async (event) => {
    const userId = event.target.value;
    if (!userId) return;
    showLoadingOverlay();
    try {
      const dadosDoAssessor = await dados_assessor(userId);
      atualizaInfoAssessor(novoBloco, dadosDoAssessor);
    } catch (error) {
      showError("Erro ao buscar dados do assessor. Tente novamente mais tarde.");
      console.error("Erro ao buscar dados do assessor:", error);
    } finally {
      hideLoadingOverlay();
    }
  });

  // Se o select já vier selecionado por algum motivo, faz a busca inicial
  if (selectAssessor.value) {
    showLoadingOverlay();
    try {
      const dadosDoAssessor = await dados_assessor(selectAssessor.value);
      atualizaInfoAssessor(novoBloco, dadosDoAssessor);
    } catch (error) {
      showError("Erro ao buscar dados do assessor. Tente novamente mais tarde.");
      console.error("Erro ao buscar dados do assessor:", error);
    } finally {
      hideLoadingOverlay();
    }
  }
}

async function buscaNegociosPerdidosPaginados(user_id, apiToken) {
  // Objeto acumulador que irá conter os dados finais
  let finalResponse = {
    success: true,
    data: [],
    related_objects: {}
  };

  let start = 0;
  const limit = 500;
  let hasMore = true;

  while (hasMore) {
    const url = `https://api.pipedrive.com/v1/deals?user_id=${user_id}&status=lost&start=${start}&limit=${limit}&api_token=${apiToken}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Erro ao buscar negócios perdidos. Status: ${response.status}`);
    }
    
    const jsonResponse = await response.json();

    // Acumula os itens de "data"
    if (jsonResponse && jsonResponse.data) {
      finalResponse.data.push(...jsonResponse.data);
    }

    // Mescla os objetos de "related_objects"
    if (jsonResponse && jsonResponse.related_objects) {
      for (const key in jsonResponse.related_objects) {
        if (finalResponse.related_objects.hasOwnProperty(key)) {
          // Se for um array, concatena
          if (Array.isArray(finalResponse.related_objects[key]) && Array.isArray(jsonResponse.related_objects[key])) {
            finalResponse.related_objects[key] = finalResponse.related_objects[key].concat(jsonResponse.related_objects[key]);
          } 
          // Se for um objeto, faz uma mesclagem superficial (chaves novas são adicionadas)
          else if (typeof finalResponse.related_objects[key] === 'object' && typeof jsonResponse.related_objects[key] === 'object') {
            finalResponse.related_objects[key] = {
              ...finalResponse.related_objects[key],
              ...jsonResponse.related_objects[key]
            };
          } else {
            // Caso contrário, substitui o valor (ou você pode manter o original)
            finalResponse.related_objects[key] = jsonResponse.related_objects[key];
          }
        } else {
          finalResponse.related_objects[key] = jsonResponse.related_objects[key];
        }
      }
    }

    // Verifica se há mais itens para buscar com base na paginação
    const pagination = jsonResponse?.additional_data?.pagination;
    if (pagination && pagination.more_items_in_collection) {
      start = pagination.next_start;
    } else {
      hasMore = false;
    }
  }

  return finalResponse;
}
function gerarChipsPerdas(negociosPerdidos) {
  if (!negociosPerdidos || Object.keys(negociosPerdidos).length === 0) {
    return { chipsEtapasPerdidas: "", chipsMotivosPerda: "" };
  }

  const etapasConhecidas = [
    "Oportunidade",
    "Tentativa",
    "Contato efetivo",
    "Qualificado",
    "Agendado",
    "Apresentar Plano",
    "Enviar Proposta",
    "Negociando",
    "Assinatura",
    "Onboarding",
    "Execução/Aprovar",
    "Entregar/Cobrar",
    "1a parcela paga",
    "Contrato quitado"
  ];

  let chipsEtapasPerdidas = "";
  let chipsMotivosPerda = "";

  for (let [key, count] of Object.entries(negociosPerdidos)) {
    if (key === "total") continue; // ignora "total"

    if (etapasConhecidas.includes(key)) {
      // É uma etapa
      chipsEtapasPerdidas += `
        <div class="stage-chip stage-chip-lost">
          <strong>${count}</strong>
          <span>${key}</span>
        </div>
      `;
    } else {
      // Consideramos que seja motivo
      chipsMotivosPerda += `
        <div class="stage-chip stage-chip-reason">
          <strong>${count}</strong>
          <span>${key}</span>
        </div>
      `;
    }
  }

  return { chipsEtapasPerdidas, chipsMotivosPerda };
}

function gerarChipsDeEstagios(negociosData) {
  // Se não houver dados ou for vazio, retorna texto padrão
  if (!negociosData || Object.keys(negociosData).length === 0) {
    return "Nenhum negócio em prospecção";
  }

  // Monta cada chip, ignorando chaves específicas
  let stageChips = "";
  for (let [stageName, count] of Object.entries(negociosData)) {
    if (["total", "criado_hoje", "negocios_sem_atividade"].includes(stageName)) {
      continue; // pula essas chaves
    }
    stageChips += `
      <div class="stage-chip">
        <strong>${count}</strong>
        <span>${stageName}</span>
      </div>
    `;
  }

  // Caso não tenha sobrado nenhum estágio, retorna texto padrão
  return stageChips || "Nenhum negócio em prospecção";
}
/**
 * Insere no bloco as informações consolidadas do assessor
 */
function atualizaInfoAssessor(bloco, dadosDoAssessor) {
  let infoContainer = bloco.querySelector(".info_assessor");
  if (!infoContainer) {
    infoContainer = document.createElement("div");
    infoContainer.classList.add("info_assessor");
    bloco.appendChild(infoContainer);
  }

  // Montando a string dos negócios (ordem preferida)
  const ordemPreferida = [
    { name: 'Oportunidade', order_nr: 1 },
    { name: 'Tentativa', order_nr: 2 },
    { name: 'Contato efetivo', order_nr: 3 },
    { name: 'Qualificado', order_nr: 4 },
    { name: 'Agendado', order_nr: 5 },
    { name: 'Apresentar Plano', order_nr: 6 },
    { name: 'Enviar Proposta', order_nr: 7 },
    { name: 'Negociando', order_nr: 8 },
    { name: 'Assinatura', order_nr: 9 },
    { name: 'Onboarding', order_nr: 10 },
    { name: 'Execução/Aprovar', order_nr: 11 },
    { name: 'Entregar/Cobrar', order_nr: 12 },
    { name: '1a parcela paga', order_nr: 13 },
    { name: 'Contrato quitado', order_nr: 14 }
  ];

  // Pegando o nome do assessor para destaque
  const selectAssessor = bloco.querySelector(".assessor_select");
  const assessorName = selectAssessor.options[selectAssessor.selectedIndex].text;

  // Pegando valores
  const atvAtrasadas = dadosDoAssessor.atividades.atrasada || 0;
  const atvHoje = dadosDoAssessor.atividades.fazer || 0;
  const negociosData = dadosDoAssessor.negocios;
  const perdidosData = dadosDoAssessor.negocios_perdidos;
  const agendasHoje = dadosDoAssessor.agendas_diarias || 0;
  const sem_atividade = dadosDoAssessor.negocios.negocios_sem_atividade || 0;
  console.log(dadosDoAssessor)

  // Gera chips de negócios abertos em ordem
  const chipsAbertos = gerarChipsEmOrdem(negociosData, ordemPreferida);
  
  // Gera chips de negócios perdidos em ordem (etapas) e motivos de perda
  const { chipsEtapasPerdidas, chipsMotivosPerda } = gerarChipsPerdasEmOrdem(perdidosData, ordemPreferida);

  infoContainer.innerHTML = `
    <!-- Cabeçalho com nome do assessor e input de leads -->
    <div class="assessor-header">
      <h2>${assessorName}</h2>
    </div>

    <!-- Cards das métricas principais -->
    <div class="info-cards">
      <div class="info-card">
        <span class="info-label">Atividades atrasadas</span>
        <span class="info-value ${atvAtrasadas > 0 ? 'value-red' : 'value-gray'}">${atvAtrasadas}</span>
      </div>

      <div class="info-card">
        <span class="info-label">Atividades que vencem hoje</span>
        <span class="info-value value-yellow">${atvHoje}</span>
      </div>

      <div class="info-card">
        <span class="info-label">Negócios em prospecção</span>
        <span class="info-value value-blue">${negociosData.total || 0}</span>
      </div>

      <div class="info-card">
        <span class="info-label">Negócios perdidos hoje</span>
        <span class="info-value ${perdidosData.total > 0 ? 'value-red' : 'value-gray'}">${perdidosData.total || 0}</span>
      </div>

      <div class="info-card">
        <span class="info-label">Reuniões criadas hoje</span>
        <span class="info-value value-green">${agendasHoje}</span>
      </div>

      <div class="info-card">
        <span class="info-label">Negócios sem ativade</span>
        <span class="info-value value-red">${sem_atividade}</span>
      </div>
    </div>

    <h4>Negócios abertos por etapa</h4>
    <div class="distribution-chips">
      ${chipsAbertos || "Nenhum negócio em prospecção"}
    </div>

    <h4>Negócios perdidos hoje por etapa</h4>
    <div class="lost-distribution-chips">
      ${chipsEtapasPerdidas || "Nenhum negócio perdido hoje"}
    </div>

    <h4>Motivos de perda</h4>
    <div class="lost-reasons-chips">
      ${chipsMotivosPerda || "Nenhum motivo de perda registrado"}
    </div>
  `;
}

/**
 * Retorna o HTML básico de um novo bloco (select assessor + input número).
 */
async function retorna_bloco_exemplo(){
  const options = await busca_usuarios();
  let novoBloco = document.createElement("div");
  const blocoExemplo = `
    <select class="assessor_select">
      ${options}
    </select>
    <!-- Input para definir quantidade de leads a distribuir, por exemplo -->
    <input type="number" step="10" min="20" max="100" value="20" />
  `;
  novoBloco.innerHTML = blocoExemplo;
  novoBloco.classList.add("inputs_assessor");
  return novoBloco;
}

/**
 * Busca usuários (assessores) na API do Pipedrive e monta as <options>.
 */
async function busca_usuarios(){
  let myHeaders = new Headers();
  myHeaders.append("Accept", "application/json");
  myHeaders.append("Cookie", "__cf_bm=..."); // Se necessário

  let requestOptions = {
    method: 'GET',
    headers: myHeaders,
    redirect: 'follow'
  };

  const response = await fetch("https://api.pipedrive.com/v1/users?api_token=6c7d502747be67acc199b483803a28a0c9b95c09", requestOptions);
  if (!response.ok) {
    throw new Error("Erro ao buscar usuários");
  }
  const result = await response.json();
  const data = result.data;
  let option = '<option value="">Selecione o Assessor</option>\n';
  for (const usuario of data) {
    if (usuario.active_flag) {
      option += `<option value="${usuario.id}">${usuario.name}</option>\n`;
    }
  }
  return option;
}

/**
 * Busca os filtros de leads e preenche o select principal (#filtro_pipe).
 */
async function retorna_filtro(){
  const filtroPipe = document.querySelector("#filtro_pipe");
  let myHeaders = new Headers();
  myHeaders.append("Accept", "application/json");
  myHeaders.append("Cookie", "__cf_bm=..."); // Se necessário

  let requestOptions = {
    method: 'GET',
    headers: myHeaders,
    redirect: 'follow'
  };

  const response = await fetch("https://api.pipedrive.com/v1/filters?type=leads&api_token=6c7d502747be67acc199b483803a28a0c9b95c09", requestOptions);
  if (!response.ok) {
    throw new Error("Erro ao buscar filtros");
  }
  const result = await response.json();
  const data = result.data;
  let option = '<option value="">Selecione o Filtro</option>\n';
  for (const filtro of data) {
    // Exemplo de filtragem por user_id específico
    if (filtro.active_flag && filtro.user_id == 14284568 && filtro.name.includes(" (FILTRO)")) {
      option += `<option value="${filtro.id}">${filtro.name}</option>\n`;
    }
  }
  filtroPipe.innerHTML = option;
}

/**
 * Consolida as informações de negócios abertos (prospecção).
 */
function dados_negocios(dados, user_id){
  const hoje = new Date();
  const stages_map = dados.related_objects;
  const negocios = dados.data;
  const totalPorNegocio = {};

  if (negocios) {
    negocios.forEach(negocio => {
      if (negocio.user_id.id === Number(user_id) && negocio.pipeline_id == 11) {
        const dataAdicionada = new Date(negocio.add_time.replace(" ","T"));
        const criadoHoje = dataAdicionada.toDateString() === hoje.toDateString() ? "criado_hoje" : false;
        const etapaNegocio = stages_map.stage[`${negocio.stage_id}`].name;
        const semAtividade = negocio.next_activity_date ? "com_atividade" : "negocios_sem_atividade";

        // Conta a etapa
        totalPorNegocio[etapaNegocio] = (totalPorNegocio[etapaNegocio] || 0) + 1;
        // Conta total
        totalPorNegocio["total"] = (totalPorNegocio["total"] || 0) + 1;

        if (criadoHoje) {
          totalPorNegocio[criadoHoje] = (totalPorNegocio[criadoHoje] || 0) + 1;
        }
        if (semAtividade) {
          console.log("opa")
          totalPorNegocio[semAtividade] = (totalPorNegocio[semAtividade] || 0) + 1;
        }
      }
    });
    return totalPorNegocio;
  } else {
    totalPorNegocio["total"] = 0;
    return totalPorNegocio;
  }
}

/**
 * Consolida informações de negócios perdidos hoje.
 */
function dados_negocios_perdidos(dados, user_id){
  const hoje = new Date();
  const stages_map = dados.related_objects;
  const negocios = dados.data;
  const totalPorNegocio = {};

  if (negocios) {
    negocios.forEach(negocio => {
      // Só faz sentido se houve lost_time
      if (negocio.lost_time) {
        const dataPerda = new Date(negocio.local_lost_date+"T00:00:00");
        const perdidoHoje = dataPerda.toDateString() === hoje.toDateString()? true:false;
        if (negocio.user_id.id === Number(user_id) && negocio.pipeline_id == 11 && perdidoHoje) {
          console.log(negocio)
          const etapaNegocio = stages_map.stage[`${negocio.stage_id}`].name;
          const motivoPerda = negocio.lost_reason || 'Sem motivo';

          totalPorNegocio[etapaNegocio] = (totalPorNegocio[etapaNegocio] || 0) + 1;
          totalPorNegocio["total"] = (totalPorNegocio["total"] || 0) + 1;
          totalPorNegocio[motivoPerda] = (totalPorNegocio[motivoPerda] || 0) + 1;
        }
      }
    });
    return totalPorNegocio;
  } else {
    totalPorNegocio["total"] = 0;
    return totalPorNegocio;
  }
}

/**
 * Consolida informações das atividades (atrasadas e que vencem hoje).
 */
function dados_atividades(dados) {
  const atividades = dados.data;
  const totalPorTipo = {};
  const hoje = new Date();

  if (atividades) {
    atividades.forEach(atividade => {
      const tipo = atividade.type_name;
      const dataVencimento = new Date(atividade.due_date+"T00:00:01");
      const statusAtv = (hoje.toDateString() === dataVencimento.toDateString()) ? "fazer" : "atrasada";

      if (!totalPorTipo[tipo]) {
        totalPorTipo[tipo] = { qnt: 0, fazer: 0, atrasada: 0 };
      }
      totalPorTipo[tipo].qnt++;
      totalPorTipo[tipo][statusAtv]++;

      // Contadores gerais
      if (!totalPorTipo[statusAtv]) {
        totalPorTipo[statusAtv] = 0;
      }
      totalPorTipo[statusAtv]++;
    });
    return totalPorTipo;
  } else {
    totalPorTipo["fazer"] = 0;
    totalPorTipo["atrasada"] = 0;
    return totalPorTipo;
  }
}

/**
 * Retorna o total de agendas diárias.
 */
function total_agendas(dados) {
  return dados.data ? dados.data.length : 0;
}

/**
 * Faz as requisições em paralelo e retorna um objeto consolidado
 * com as atividades, negócios abertos, negócios perdidos e agendas.
 */
async function dados_assessor(id_assessor){
  const url1 = `https://api.pipedrive.com/v1/activities?user_id=${id_assessor}&filter_id=5790&api_token=6c7d502747be67acc199b483803a28a0c9b95c09`;
  const url2 = `https://api.pipedrive.com/v1/deals?user_id=${id_assessor}&status=open&limit=1000&api_token=6c7d502747be67acc199b483803a28a0c9b95c09`;
  const url3 = `https://api.pipedrive.com/v1/activities?user_id=${id_assessor}&filter_id=5793&api_token=6c7d502747be67acc199b483803a28a0c9b95c09`;
  const apiToken = "6c7d502747be67acc199b483803a28a0c9b95c09"
  try {
    const [resp1, resp2, resp3] = await Promise.all([
      fetch(url1), fetch(url2), fetch(url3)
    ]);

    // Verificação de falha em alguma das requisições
    if (!resp1.ok || !resp2.ok || !resp3.ok) {
      throw new Error("Erro em uma das requisições de dados do assessor");
    }

    // Converte cada resposta
    const atvsVencidas = await resp1.json();
    const negociosProspeccao = await resp2.json();
    const agendadasHoje = await resp3.json();
    const allLostDeals = await buscaNegociosPerdidosPaginados(id_assessor, apiToken);

    // Consolida tudo
    const dadosConsolidados = {
      atividades: dados_atividades(atvsVencidas),
      negocios: dados_negocios(negociosProspeccao, id_assessor),
      agendas_diarias: total_agendas(agendadasHoje),
      negocios_perdidos: dados_negocios_perdidos(allLostDeals, id_assessor),
    };

    return dadosConsolidados;
  } catch (error) {
    throw new Error(error.message);
  }
}

/**
 * Exibe mensagem de erro em um elemento fixo na tela.
 */
function showError(message) {
  const errorMessage = document.getElementById("error-message");
  errorMessage.textContent = message;
  errorMessage.classList.remove("hidden");
}

/**
 * Oculta a mensagem de erro.
 */
function hideError() {
  const errorMessage = document.getElementById("error-message");
  errorMessage.textContent = "";
  errorMessage.classList.add("hidden");
}

function colorirCards(infoContainer) {
  // Seleciona todos os .info-card
  const cards = infoContainer.querySelectorAll(".info-card");
  cards.forEach(card => {
    const valor = Number(card.getAttribute("data-value")) || 0;
    if (card.classList.contains("card-atividades-atrasadas")) {
      if (valor > 0) {
        card.style.backgroundColor = "#f8c9c9"; // vermelho claro
      } else {
        card.style.backgroundColor = "#f0f0f0"; // cinza claro
      }
    }
    if (card.classList.contains("card-negocios-perdidos")) {
      if (valor > 0) {
        card.style.backgroundColor = "#f8c9c9";
      } else {
        card.style.backgroundColor = "#f0f0f0";
      }
    }
    if (card.classList.contains("card-reunioes-hoje")) {
      if (valor > 0) {
        card.style.backgroundColor = "#c9f8c9"; // verde claro
      } else {
        card.style.backgroundColor = "#f0f0f0";
      }
    }
    // etc. para outros cards
  });
}


function gerarChipsEmOrdem(negociosData, ordem) {
  if (!negociosData || !ordem) return "";
  // Filtra apenas as etapas que existem em negociosData
  // e as exibe na ordem preferida
  const resultado = ordem
    .filter(etapa => negociosData[etapa.name]) // só etapas presentes no objeto
    .map(etapa => {
      const count = negociosData[etapa.name];
      return `
        <div class="stage-chip">
          <strong>${count}</strong>
          <span class="value-white">${etapa.name}</span>
        </div>
      `;
    });
  return resultado.join("");
}

/**
 * Gera chips de negócios perdidos (por etapa) na ordem preferida
 * e chips de motivos de perda (fora da ordem).
 */
function gerarChipsPerdasEmOrdem(perdidosData, ordem) {
  if (!perdidosData || !ordem) {
    return { chipsEtapasPerdidas: "", chipsMotivosPerda: "" };
  }

  let chipsEtapasPerdidas = "";
  let chipsMotivosPerda = "";

  // 1) Monta um array para etapas e um para motivos
  // Se a chave estiver em ordemPreferida, é etapa; senão, é motivo (exceto "total")
  const etapasSet = new Set(ordem.map(o => o.name));

  // Passa por cada chave de perdidosData
  for (let [key, count] of Object.entries(perdidosData)) {
    if (key === "total") continue;
    if (etapasSet.has(key)) {
      // É uma etapa
      chipsEtapasPerdidas += `
        <div class="stage-chip">
          <strong class="value-veryred">${count}</strong>
          <span class="value-semired">${key}</span>
        </div>
      `;
    } else {
      // É um motivo de perda
      chipsMotivosPerda += `
        <div class="stage-chip">
          <strong class="value-veryred">${count}</strong>
          <span class="value-semired">${key}</span>
        </div>
      `;
    }
  }

  // Agora, queremos garantir que as etapas apareçam na ordem preferida,
  // então reconstruímos "chipsEtapasPerdidas" usando a ordem.
  let orderedChips = "";
  ordem.forEach(etapa => {
    const key = etapa.name;
    if (perdidosData[key]) {
      orderedChips += `
        <div class="stage-chip">
          <strong class="value-veryred">${perdidosData[key]}</strong>
          <span class="value-semired">${key}</span>
        </div>
      `;
    }
  });

  return {
    chipsEtapasPerdidas: orderedChips,
    chipsMotivosPerda
  };
}