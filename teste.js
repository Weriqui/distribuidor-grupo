
let leads_para_distribuir;

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

async function leadsParaDistribuir(filter_id,token){
    const leads_brutos = await buscaLeadsPaginados(filter_id, token)
    const resultado = dados_leads(leads_brutos)
    leads_para_distribuir = resultado
    console.log(resultado)

}

leadsParaDistribuir(5911,'6c7d502747be67acc199b483803a28a0c9b95c09')