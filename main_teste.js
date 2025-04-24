document.addEventListener('DOMContentLoaded', async function() {
    const blocoAssessores = document.querySelector(".bloco_assessor");
    const selectFiltro = document.querySelector("#filtro_pipe");
    const btnDistribuir = document.querySelector("#distribuir");   // é o único <button> fora dos blocos

    
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
            leadsParaDistribuir(valor,'049fc9691e98bcb47e9815bc5c54be0486c289de')
        }
    });

    btnDistribuir.addEventListener("click", () => {
        const revisao = calcularDistribuicao();
        if (!revisao.length) {
          alert("Nenhum assessor selecionado ou leads ainda não carregados.");
          return;
        }
      
        // monta a lista visual
        const ul = document.getElementById("lista-revisao");
        ul.innerHTML = "";                       // limpa
        revisao.forEach(r => {
          const li = document.createElement("li");
          li.textContent = `${r.nome}: ${r.qtd} lead(s)`;
          ul.appendChild(li);
        });
      
        // guarda no elemento para usar no confirmar
        ul.dataset.json = JSON.stringify(revisao);
      
        showModal();
    });

    document.getElementById("btn-cancelar").onclick = hideModal;

    document.getElementById("btn-confirmar").onclick = async () => {
        const revisao = JSON.parse(document.getElementById("lista-revisao").dataset.json);
        hideModal();
      
        for (const r of revisao){
            await distribuirLeadsSequencial(r.ids,r.assessorId,);
        }
        location.reload();
    };
      

      
});
const ordemPreferida = [{
        name: 'Oportunidade',
        order_nr: 1
    },
    {
        name: 'Tentativa',
        order_nr: 2
    },
    {
        name: 'Contato efetivo',
        order_nr: 3
    },
    {
        name: 'Qualificado',
        order_nr: 4
    },
    {
        name: 'Agendado',
        order_nr: 5
    },
    {
        name: 'Apresentar Plano',
        order_nr: 6
    },
    {
        name: 'Enviar Proposta',
        order_nr: 7
    },
    {
        name: 'Negociando',
        order_nr: 8
    },
    {
        name: 'Assinatura',
        order_nr: 9
    },
    {
        name: 'Onboarding',
        order_nr: 10
    },
    {
        name: 'Execução/Aprovar',
        order_nr: 11
    },
    {
        name: 'Entregar/Cobrar',
        order_nr: 12
    },
    {
        name: '1a parcela paga',
        order_nr: 13
    },
    {
        name: 'Contrato quitado',
        order_nr: 14
    }
];

function getToday() {
	return new Date().toISOString().split('T')[0];
}

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
    inputNumber.addEventListener("blur", () => {
        /* no blur não fazemos nada além de garantir que seja inteiro positivo
           — a contagem real é feita quando o usuário clica em “Distribuir”   */
        if (inputNumber.value < 0) inputNumber.value = 0;
    });
      


    // Ao trocar o assessor no select, buscamos e exibimos os dados
    selectAssessor.addEventListener('change', async () => {
        const userId = selectAssessor.value;
        if (!userId) return;
		const nome = selectAssessor.selectedOptions[0].text
		const email = selectAssessor.selectedOptions[0].getAttribute('email')
        // Substitua a chamada a carregaDadosDoAssessor por:
		showLoadingOverlay(`Carregando dados de ${nome}`)
		try{
			const dados = await dados_assessor(userId,email);
			atualizaInfoAssessor(novoBloco, dados);
			const startDateInput = novoBloco.querySelector(".start-date-perdidos");
			const endDateInput = novoBloco.querySelector(".end-date-perdidos");
			const btnAtualiza = novoBloco.querySelector(".btn-atualiza-perdidos");
	
			// Define datas padrão = hoje
			const hoje = getToday();
			startDateInput.value = hoje;
			endDateInput.value = hoje;
	
			btnAtualiza.addEventListener('click', async () => {
				const userId = selectAssessor.value;
				if (!userId) {
					alert("Selecione um assessor antes de filtrar por datas.");
					return;
				}
				const startDate = startDateInput.value;
				const endDate = endDateInput.value;
				if (!startDate || !endDate) {
					alert("Selecione as datas de início e fim.");
					return;
				}
				if (startDate > endDate) {
					alert("Data inicial não pode ser maior que a final.");
					return;
				}
		
				await carregaNegociosPerdidosBloco(novoBloco, userId, startDate, endDate);
			});
			
		} catch (error) {
			console.error(error);
			alert("Erro ao criar o bloco.");
		} finally {
			hideLoadingOverlay();
		}
    });

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
async function buscaLeadsPaginados(filter_id, apiToken) {
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
        const url = `https://api.pipedrive.com/v1/leads?archived_status=not_archived&filter_id=${filter_id}&start=${start}&limit=${limit}&api_token=${apiToken}`;
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
        return {
            chipsEtapasPerdidas: "",
            chipsMotivosPerda: ""
        };
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

    return {
        chipsEtapasPerdidas,
        chipsMotivosPerda
    };
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
    const ordemPreferida = [{
            name: 'Oportunidade',
            order_nr: 1
        },
        {
            name: 'Tentativa',
            order_nr: 2
        },
        {
            name: 'Contato efetivo',
            order_nr: 3
        },
        {
            name: 'Qualificado',
            order_nr: 4
        },
        {
            name: 'Agendado',
            order_nr: 5
        },
        {
            name: 'Apresentar Plano',
            order_nr: 6
        },
        {
            name: 'Enviar Proposta',
            order_nr: 7
        },
        {
            name: 'Negociando',
            order_nr: 8
        },
        {
            name: 'Assinatura',
            order_nr: 9
        },
        {
            name: 'Onboarding',
            order_nr: 10
        },
        {
            name: 'Execução/Aprovar',
            order_nr: 11
        },
        {
            name: 'Entregar/Cobrar',
            order_nr: 12
        },
        {
            name: '1a parcela paga',
            order_nr: 13
        },
        {
            name: 'Contrato quitado',
            order_nr: 14
        }
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
	const NegociosNovos = dadosDoAssessor.negocios_novos_hoje
    console.log(dadosDoAssessor)

    // Gera chips de negócios abertos em ordem
    const chipsAbertos = gerarChipsEmOrdem(negociosData, ordemPreferida);

    // Gera chips de negócios perdidos em ordem (etapas) e motivos de perda
    const {
        chipsEtapasPerdidas,
        chipsMotivosPerda
    } = gerarChipsPerdasEmOrdem(perdidosData, ordemPreferida);

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

      <div class="info-card">
        <span class="info-label">Negócios recebidos hoje</span>
        <span class="info-value value-lightgreen">${NegociosNovos}</span>
      </div>
    </div>

    <h4>Negócios abertos por etapa</h4>
    <div class="distribution-chips">
      ${chipsAbertos || "Nenhum negócio em prospecção"}
    </div>

    <h4 class="titulo-perdidos">Negócios perdidos hoje por etapa</h4>
	<div class="date-range-container" style="
		text-align: center;
		padding-bottom: 2rem;
	">
      <label>Início:</label>
      <input type="date" class="start-date-perdidos">
      <label>Fim:</label>
      <input type="date" class="end-date-perdidos">
      <button class="btn-atualiza-perdidos">Aplicar</button>
    </div>
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
async function retorna_bloco_exemplo() {
  // Carrega as <option> de usuários
  const options = await busca_usuarios();

  // Cria a div principal do bloco
  let novoBloco = document.createElement("div");
  novoBloco.classList.add("inputs_assessor");

  // HTML do bloco
  const blocoExemplo = `
    <!-- Cabeçalho: seletor de assessor e input de leads -->
    <div class="assessor-header">
      <select class="assessor_select">
        ${options}
      </select>
      <div class="leads-input-container">
        <label>Quantos leads?</label>
        <input type="number" step="10" min="20" max="100" value="20" />
      </div>
    </div>

    <!-- Aqui serão inseridas as informações gerais do assessor (cards, etc.) -->
    <div class="info_assessor"></div>

    <!-- Containers para chips de negócios perdidos -->
    <div class="lost-distribution-chips"></div>
    <div class="lost-reasons-chips"></div>
  `;

  // Insere esse HTML no bloco
  novoBloco.innerHTML = blocoExemplo;
  return novoBloco;
}

/**
 * Busca usuários (assessores) na API do Pipedrive e monta as <options>.
 */
async function busca_usuarios() {
    let myHeaders = new Headers();
    myHeaders.append("Accept", "application/json");
    myHeaders.append("Cookie", "__cf_bm=..."); // Se necessário

    let requestOptions = {
        method: 'GET',
        headers: myHeaders,
        redirect: 'follow'
    };

    const response = await fetch("https://api.pipedrive.com/v1/users?api_token=049fc9691e98bcb47e9815bc5c54be0486c289de", requestOptions);
    if (!response.ok) {
        throw new Error("Erro ao buscar usuários");
    }
    const result = await response.json();
    const data = result.data;
    let option = '<option value="">Selecione o Assessor</option>\n';
    for (const usuario of data) {
        if (usuario.active_flag) {
            option += `<option value="${usuario.id}" email="${usuario.email}">${usuario.name}</option>\n`;
        }
    }
    return option;
}

/**
 * Busca os filtros de leads e preenche o select principal (#filtro_pipe).
 */
async function retorna_filtro() {
    const filtroPipe = document.querySelector("#filtro_pipe");
    let myHeaders = new Headers();
    myHeaders.append("Accept", "application/json");
    myHeaders.append("Cookie", "__cf_bm=..."); // Se necessário

    let requestOptions = {
        method: 'GET',
        headers: myHeaders,
        redirect: 'follow'
    };

    const response = await fetch("https://api.pipedrive.com/v1/filters?type=leads&api_token=049fc9691e98bcb47e9815bc5c54be0486c289de", requestOptions);
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
let leads_para_distribuir;
/**
 * Consolida as informações de negócios abertos (prospecção).
 */
function dados_negocios(dados, user_id) {
    const hoje = new Date();
    const stages_map = dados.related_objects;
    const negocios = dados.data;
    const totalPorNegocio = {};

    if (negocios) {
        negocios.forEach(negocio => {
            if (negocio.user_id.id === Number(user_id) && negocio.pipeline_id == 11) {
                const dataAdicionada = new Date(negocio.add_time.replace(" ", "T"));
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
function dados_leads (dados) {
    const leads = dados.data;
    const totalPorLeads = {};

    if (leads) {
        leads.forEach(lead => {

            const lead_nome = lead.title;
            const lead_id = lead.id;

            // Conta a etapa
            
            // Conta total
            totalPorLeads["total"] = (totalPorLeads["total"] || 0) + 1;

            if (totalPorLeads[lead_nome]) {
                totalPorLeads[lead_nome]["ids"].push(lead_id);
                totalPorLeads[lead_nome]["total"]++;
            } else {
                totalPorLeads[lead_nome] = {
                    total: 1,
                    ids: [lead_id]
                };
                if(totalPorLeads["total_leads_unicos"]){
                    totalPorLeads["total_leads_unicos"]++;
                } else{
                    totalPorLeads["total_leads_unicos"] = 1;
                }
            }

        });
        return totalPorLeads;
    } else {
        totalPorNegocio["total"] = 0;
        return totalPorNegocio;
    }
}
async function leadsParaDistribuir(filter_id,token){
    const leads_brutos = await buscaLeadsPaginados(filter_id, token)
    const resultado = dados_leads(leads_brutos)
    leads_para_distribuir = resultado
    totaisFiltro(resultado.total,resultado.total_leads_unicos)
    console.log(resultado)

}
/**
 * Consolida informações de negócios perdidos hoje.
 */
function dados_negocios_perdidos(dados, user_id) {
    const hoje = new Date();
    const stages_map = dados.related_objects;
    const negocios = dados.data;
    const totalPorNegocio = {};

    if (negocios) {
        negocios.forEach(negocio => {
            // Só faz sentido se houve lost_time
            if (negocio.lost_time) {
                const dataPerda = new Date(negocio.local_lost_date + "T00:00:00");
                const perdidoHoje = dataPerda.toDateString() === hoje.toDateString() ? true : false;
                if (negocio.user_id.id === Number(user_id) && negocio.pipeline_id == 11 && perdidoHoje) {
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
            const dataVencimento = new Date(atividade.due_date + "T00:00:01");
            const statusAtv = (hoje.toDateString() === dataVencimento.toDateString()) ? "fazer" : "atrasada";

            if (!totalPorTipo[tipo]) {
                totalPorTipo[tipo] = {
                    qnt: 0,
                    fazer: 0,
                    atrasada: 0
                };
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
async function dados_assessor(id_assessor, email_assessor) {
    const url1 = `https://api.pipedrive.com/v1/activities?user_id=${id_assessor}&filter_id=1339&api_token=049fc9691e98bcb47e9815bc5c54be0486c289de`;
    const url2 = `https://api.pipedrive.com/v1/deals?user_id=${id_assessor}&status=open&limit=1000&api_token=049fc9691e98bcb47e9815bc5c54be0486c289de`;
    const url3 = `https://api.pipedrive.com/v1/activities?user_id=${id_assessor}&filter_id=1343&api_token=049fc9691e98bcb47e9815bc5c54be0486c289de`;
    const apiToken = "049fc9691e98bcb47e9815bc5c54be0486c289de";
    const hoje = getToday();

    try {
        // Realiza todas as requisições em paralelo
        const [resp1, resp2, resp3, allLostDeals, negociosCriadosHoje] = await Promise.all([
            fetch(url1), 
            fetch(url2), 
            fetch(url3),
            obterNegociosPerdidosNoPeriodo(id_assessor, hoje, hoje, apiToken),
            negociosRecebidosHoje(id_assessor, apiToken),
        ]);

        // Verifica se houve erro nas requisições do Pipedrive
        if (!resp1.ok || !resp2.ok || !resp3.ok) {
            throw new Error("Erro em uma das requisições de dados do assessor");
        }

        // Converte as respostas para JSON
        const [atvsVencidas, negociosProspeccao, agendadasHoje, allLostDealsData, negociosCriadosHojeData] = await Promise.all([
            resp1.json(),
            resp2.json(),
            resp3.json(),
            allLostDeals,
            negociosCriadosHoje,
        ]);

        // Verifica se a requisição da API Flask foi bem-sucedida

        // Consolida os dados
        const dadosConsolidados = {
            atividades: dados_atividades(atvsVencidas),
            negocios: dados_negocios(negociosProspeccao, id_assessor),
            agendas_diarias: total_agendas(agendadasHoje),
            negocios_perdidos: dados_negocios_perdidos(allLostDealsData, id_assessor),
            negocios_novos_hoje: negociosCriadosHojeData,
        };

        return dadosConsolidados;
    } catch (error) {
        console.error("Erro ao buscar dados do assessor:", error);
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
        return {
            chipsEtapasPerdidas: "",
            chipsMotivosPerda: ""
        };
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

async function negociosRecebidosHoje(user_id, apiToken) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");
	myHeaders.append("Accept", "application/json");
    const raw = JSON.stringify({
        conditions: {
            glue: "and",
            conditions: [{
                    glue: "and",
                    conditions: [{
                        object: "deal",
                        field_id: "13", // Data de criação?
                        operator: "=",
                        value: "today",
                        extra_value: null
                    }]
                },
                {
                    glue: "or",
                    conditions: [{
                            object: "deal",
                            field_id: "3", // Owner ID?
                            operator: "=",
                            value: String(user_id),
                            extra_value: null
                        },
                        {
                            object: "deal",
                            field_id: "48", // Campo custom?
                            operator: "=",
                            value: String(user_id),
                            extra_value: null
                        }
                    ]
                }
            ]
        }
    });

    const requestOptions = {
        method: "PUT",
		headers: myHeaders,
        body: raw,
        redirect: "follow"
    };
    const url = `https://api.pipedrive.com/v1/filters/1341?api_token=${apiToken}`;

    try {
        // 1) Atualiza o filtro
        const response = await fetch(url, requestOptions);
        if (!response.ok) {
            throw new Error("Erro ao atualizar o filtro 1341");
        }

        // 2) Agora busca os negócios desse filtro
        const negociosRecebidosHojePorUsuario = await buscaNegociosRecebidosHoje(apiToken);
        // Retorna a quantidade de negócios
        return negociosRecebidosHojePorUsuario.data?.length || 0;

    } catch (error) {
        throw new Error(error.message);
    }
}

/**
 * Busca os negócios no filtro 1341, acumulando todas as páginas.
 * (Não precisa do parâmetro user_id aqui, pois o filtro já foi atualizado)
 */
async function buscaNegociosRecebidosHoje(apiToken) {
    let finalData = [];
    let finalRelatedObjects = {};

    let start = 0;
    const limit = 500;
    let hasMore = true;

    while (hasMore) {
        const url = `https://api.pipedrive.com/v1/deals?filter_id=1341&start=${start}&limit=${limit}&api_token=${apiToken}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Erro ao buscar negócios do filtro 1341. Status: ${response.status}`);
        }

        const jsonResponse = await response.json();

        // Acumula data
        if (jsonResponse.data) {
            finalData.push(...jsonResponse.data);
        }

        // Mescla related_objects se necessário
        if (jsonResponse.related_objects) {
            for (const key in jsonResponse.related_objects) {
                if (Object.prototype.hasOwnProperty.call(finalRelatedObjects, key)) {
                    // Se for array, concatena
                    if (Array.isArray(finalRelatedObjects[key]) && Array.isArray(jsonResponse.related_objects[key])) {
                        finalRelatedObjects[key] = finalRelatedObjects[key].concat(jsonResponse.related_objects[key]);
                    }
                    // Se for objeto, faz merge superficial
                    else if (
                        typeof finalRelatedObjects[key] === 'object' &&
                        typeof jsonResponse.related_objects[key] === 'object'
                    ) {
                        finalRelatedObjects[key] = {
                            ...finalRelatedObjects[key],
                            ...jsonResponse.related_objects[key]
                        };
                    } else {
                        // Substitui o valor
                        finalRelatedObjects[key] = jsonResponse.related_objects[key];
                    }
                } else {
                    finalRelatedObjects[key] = jsonResponse.related_objects[key];
                }
            }
        }

        // Verifica paginação
        const pagination = jsonResponse?.additional_data?.pagination;
        if (pagination?.more_items_in_collection) {
            start = pagination.next_start;
        } else {
            hasMore = false;
        }
    }

    return {
        data: finalData,
        related_objects: finalRelatedObjects
    };
}


async function atualizaFiltroNegociosPerdidos(user_id, startDate, endDate, apiToken) {
	const myHeaders = new Headers();
	myHeaders.append("Content-Type", "application/json");
	myHeaders.append("Accept", "application/json");
    const rawBody = JSON.stringify({
        conditions: {
            glue: "and",
            conditions: [{
                    glue: "and",
                    conditions: [{
                            object: "deal",
                            field_id: "12", // status
                            operator: "=",
                            value: "lost"
                        },
                        {
                            object: "deal",
                            field_id: "3", // owner_id
                            operator: "=",
                            value: String(user_id)
                        },
                        {
                            object: "deal",
                            field_id: "21", // lost_time >= startDate
                            operator: ">=",
                            value: startDate
                        },
                        {
                            object: "deal",
                            field_id: "21", // lost_time <= endDate
                            operator: "<=",
                            value: endDate
                        }
                    ]
                },
                {
                    glue: "or",
                    conditions: []
                }
            ]
        }
    });

    const url = `https://api.pipedrive.com/v1/filters/1342?api_token=${apiToken}`;
    const requestOptions = {
        method: "PUT",
		headers: myHeaders,
        body: rawBody,
        redirect: "follow"
    };

    const response = await fetch(url, requestOptions);
    if (!response.ok) {
        throw new Error("Erro ao atualizar o filtro 1342 (negócios perdidos).");
    }
}

async function buscaNegociosPerdidosNoPeriodo(apiToken) {
    let finalData = [];
    let finalRelatedObjects = {};

    let start = 0;
    const limit = 500;
    let hasMore = true;

    while (hasMore) {
        const url = `https://api.pipedrive.com/v1/deals?filter_id=1342&start=${start}&limit=${limit}&api_token=${apiToken}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Erro ao buscar negócios do filtro 1342. Status: ${response.status}`);
        }

        const jsonResponse = await response.json();

        // Acumula data
        if (jsonResponse.data) {
            finalData.push(...jsonResponse.data);
        }

        // Mescla related_objects se precisar
        if (jsonResponse.related_objects) {
            for (const key in jsonResponse.related_objects) {
                if (Object.prototype.hasOwnProperty.call(finalRelatedObjects, key)) {
                    // Se for array, concatena
                    if (Array.isArray(finalRelatedObjects[key]) && Array.isArray(jsonResponse.related_objects[key])) {
                        finalRelatedObjects[key] = finalRelatedObjects[key].concat(jsonResponse.related_objects[key]);
                    }
                    // Se for objeto, faz merge superficial
                    else if (
                        typeof finalRelatedObjects[key] === 'object' &&
                        typeof jsonResponse.related_objects[key] === 'object'
                    ) {
                        finalRelatedObjects[key] = {
                            ...finalRelatedObjects[key],
                            ...jsonResponse.related_objects[key]
                        };
                    } else {
                        // Substitui
                        finalRelatedObjects[key] = jsonResponse.related_objects[key];
                    }
                } else {
                    finalRelatedObjects[key] = jsonResponse.related_objects[key];
                }
            }
        }

        // Verifica paginação
        const pagination = jsonResponse?.additional_data?.pagination;
        if (pagination?.more_items_in_collection) {
            start = pagination.next_start;
        } else {
            hasMore = false;
        }
    }

    return {
        data: finalData,
        related_objects: finalRelatedObjects
    };
}

async function obterNegociosPerdidosNoPeriodo(user_id, startDate, endDate, apiToken) {
    // 1) Atualiza o filtro
    await atualizaFiltroNegociosPerdidos(user_id, startDate, endDate, apiToken);

    // 2) Busca todos os negócios do filtro
    const result = await buscaNegociosPerdidosNoPeriodo(apiToken);
    return result;
}

async function carregaNegociosPerdidosBloco(bloco, userId, startDate, endDate) {
    // Exibe overlay (e desabilita inputs) para esse bloco
    showLoadingOverlay("Carregando negócios perdidos...");

    try {
        // 1) Atualiza o filtro 1342 para esse userId e intervalo
        await atualizaFiltroNegociosPerdidos(userId, startDate, endDate, '049fc9691e98bcb47e9815bc5c54be0486c289de');
        // 2) Busca os negócios do filtro
        const result = await buscaNegociosPerdidosNoPeriodo('049fc9691e98bcb47e9815bc5c54be0486c289de');

        // Processa e exibe no bloco
        atualizaUINegociosPerdidos(bloco, result, startDate, endDate);

    } catch (error) {
        console.error(error);
        alert("Erro ao buscar negócios perdidos do assessor.");
    } finally {
        hideLoadingOverlay();
    }
}

/**
 * Atualiza a UI do bloco com as informações de negócios perdidos
 * e muda o título "Negócios perdidos hoje" para "Negócios perdidos de X a Y" etc.
 */
function atualizaUINegociosPerdidos(bloco, deals, startDate, endDate) {
    const tituloPerdidos = bloco.querySelector(".titulo-perdidos");
    const hoje = getToday(); // Assume "YYYY-MM-DD"

    if (startDate === endDate) {
        if (startDate === hoje) {
            tituloPerdidos.textContent = "Negócios perdidos hoje por etapa";
        } else {
            tituloPerdidos.textContent = `Negócios perdidos em ${formatarData(startDate)} por etapa`;
        }
    } else {
        if (endDate === hoje) {
            tituloPerdidos.textContent = `Negócios perdidos de ${formatarData(startDate)} até hoje por etapa`;
        } else {
            tituloPerdidos.textContent = `Negócios perdidos de ${formatarData(startDate)} até ${formatarData(endDate)} por etapa`;
        }
    }

    // Processa os deals para obter os dados separados por etapa e por motivo
    const {
        porEtapa,
        porMotivo
    } = processaDealsPerdidos(deals);
    // Combina os dois objetos (supondo que as chaves sejam distintas)
    const perdidosCombinado = {
        ...porEtapa,
        ...porMotivo
    };

    // Gera os chips únicos usando a função unificada
    const {
        chipsEtapasPerdidas,
        chipsMotivosPerda
    } = gerarChipsPerdasEmOrdem(perdidosCombinado, ordemPreferida);

    // Atualiza os containers de chips na UI
    const lostDistributionChips = bloco.querySelector(".lost-distribution-chips");
    const lostReasonsChips = bloco.querySelector(".lost-reasons-chips");

    lostDistributionChips.innerHTML = chipsEtapasPerdidas;
    lostReasonsChips.innerHTML = chipsMotivosPerda;
}

function processaDealsPerdidos(deals) {
    const porEtapa = {};
    const porMotivo = {};
	const dados = deals.data
	const stages_map = deals.related_objects;

    dados.forEach(deal => {
        // Pega a etapa
		const etapaNegocio = stages_map.stage[`${deal.stage_id}`].name;
        porEtapa[etapaNegocio] = (porEtapa[etapaNegocio] || 0) + 1;

        // Pega o motivo de perda
        const lostReason = deal.lost_reason || 'Sem motivo';
        porMotivo[lostReason] = (porMotivo[lostReason] || 0) + 1;
    });

    return {
        porEtapa,
        porMotivo
    };
}


function formatarData(dataStr) {
    if (!dataStr) return "";
    const parts = dataStr.split("-");
    if (parts.length !== 3) return dataStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function totaisFiltro(total,total_unico){
    const totais = document.querySelector("#totais-leads-filtro")
    totais.innerHTML = `<p><span class="value-green">${total}</span> Leads disponiveis</p>
    <p><span class="value-green">${total_unico}</span> Leads unicos</p>`
}

/* ---------- helpers ---------- */
function showModal()  { document.getElementById("modal-revisao").classList.remove("hidden"); }
function hideModal()  { document.getElementById("modal-revisao").classList.add("hidden"); }
function getBlocos()  { return [...document.querySelectorAll(".inputs_assessor")]; }

/* Constrói um array com os blocos na ordem de criação
   e devolve [{nome, qtdInput, idsSelecionados}]*/
function calcularDistribuicao () {
  if (!leads_para_distribuir) return [];

  const blocos = getBlocos();

  /* títulos em ordem alfabética (A‑Z) */
  const titulosOrdenados = Object.keys(leads_para_distribuir)
        .filter(k => k !== "total" && k !== "total_leads_unicos")
        .sort((a,b)=> a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

  let cursor = 0;
  const revisao = [];

  for (const bloco of blocos){
    const sel        = bloco.querySelector(".assessor_select");
    const assessorId = Number(sel.value);                       // << NOVO
    const nome       = sel.selectedOptions[0]?.text || "(sem)";
    const qtdDesejada= Number(bloco.querySelector("input[type='number']").value)||0;

    let idsSelecionados   = [];
    let titulosConsumidos = [];

    while (idsSelecionados.length < qtdDesejada &&
           cursor < titulosOrdenados.length){

      const tituloAtual = titulosOrdenados[cursor];
      const obj         = leads_para_distribuir[tituloAtual];   // {total, ids:[…]}

      idsSelecionados.push(...obj.ids);                         // leva TODOS os ids
      titulosConsumidos.push(...Array(obj.ids.length).fill(tituloAtual));

      cursor++;   // próximo título
    }

    revisao.push({
      assessorId,                // << NOVO
      nome,
      qtd    : idsSelecionados.length,
      ids    : idsSelecionados,
      titulos: titulosConsumidos
    });
  }
  return revisao;
}



/**
 * Distribui leads um‑a‑um, com retentativas progressivas.
 * @param {number[]} leadIds   - array de ids dos leads
 * @param {number}   ownerId   - id do assessor
 * @param {number}   campoId   - id do campo personalizado
 */
async function distribuirLeadsSequencial(leadIds, ownerId){
  if(!leadIds?.length){ alert("Nenhum lead para distribuir."); return; }

  /* ---- prepara barra de progresso ---- */
  const wrap   = document.getElementById("progress-wrapper");
  const fill   = document.getElementById("progress-fill");
  const count  = document.getElementById("progress-count");
  const msg    = document.getElementById("progress-msg");
  wrap.classList.remove("hidden");
  msg.textContent = "Distribuindo leads… não feche a aba.";
  count.textContent = `0 / ${leadIds.length}`;

  let concluido = 0;

  for (const leadId of leadIds){
    const ok = await patchLeadComRetry(leadId, ownerId);
    concluido++;
    /* atualiza UI */
    fill.style.width = `${(concluido/leadIds.length)*100}%`;
    count.textContent = `${concluido} / ${leadIds.length}`;
  }

  msg.textContent = "Processo finalizado!";
  setTimeout(()=> wrap.classList.add("hidden"), 4000);   // esconde após 4 s
}

/* ---------- PATCH + retentativa progressiva ---------- */
async function patchLeadComRetry(leadId, ownerId){
  const delays = [0, 10_000, 30_000, 60_000, 120_000];   // em ms
  for (let tent=0; tent<delays.length; tent++){
    if (tent>0) await wait(delays[tent]);                // espera antes da 2ª,3ª…

    try{
      const success = await patchLead(leadId, ownerId);
      if(success) return true;          // deu certo, sai da função
    }catch(e){
      console.warn(`Lead ${leadId} falhou (tentativa ${tent+1}):`, e);
    }
  }
  console.error(`Lead ${leadId} - todas as tentativas falharam.`);
  return false;                         // segue p/ próximo lead
}

/* ---------- faz a requisição PATCH ---------- */
async function patchLead(leadId, ownerId){
  const url = `https://api.pipedrive.com/v1/leads/${leadId}?api_token=049fc9691e98bcb47e9815bc5c54be0486c289de`;

  const body = {
    owner_id: ownerId,
    "e76364fa33cbe6838731ebeb22e66d66ce78b6e8": ownerId
  };

  const resp = await fetch(url, {
    method : "PATCH",
    headers: { "Content-Type":"application/json", "Accept":"application/json" },
    body   : JSON.stringify(body)
  });

  if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  return json?.success === true;
}

/* ---------- helper de espera ---------- */
const wait = ms => new Promise(r => setTimeout(r, ms));
