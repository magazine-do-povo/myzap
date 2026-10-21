/**
 * Anexos (foto/PDF) da mensagem padrão.
 *
 * O lojista pendura os arquivos no painel do ClickExpress; aqui só se busca
 * a lista na hora de mandar (GET /myzap/anexos-padrao/{sessionkey}) — a API
 * decide se a loja está aberta AGORA (chave + expediente), fonte única da
 * regra. Cache curto por sessionkey: o primeiro contato de cada cliente do
 * dia não pode virar uma chamada por mensagem, mas "fechou a chave" tem de
 * valer em um minuto.
 */
const customLogger = require('../../../util/customLogger');

const API_CLICKEXPRESS =
  (process.env.API_CLICKEXPRESS_URL || 'https://api-clickexpress.jztech.com.br/public').replace(/\/+$/, '');
const TTL_MS = 60 * 1000;
const cache = new Map(); // sessionkey -> { dados, ate }

/**
 * DeviceCompany.api_url guarda a URL do pedido-venda-ia da empresa
 * (…/public/api/pedido-venda-ia/{id}); a base da API é o que vem antes.
 */
function baseDaApi(apiUrlEmpresa) {
  const base = String(apiUrlEmpresa || '')
    .replace(/\/api\/pedido-venda-ia\/.*$/, '')
    .replace(/\/+$/, '');
  return base || API_CLICKEXPRESS;
}

async function buscarAnexosPadrao({ sessionkey, apiUrlEmpresa }) {
  const agora = Date.now();
  const emCache = cache.get(sessionkey);
  if (emCache && emCache.ate > agora) return emCache.dados;

  try {
    const resp = await fetch(`${baseDaApi(apiUrlEmpresa)}/myzap/anexos-padrao/${encodeURIComponent(sessionkey)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const corpo = await resp.json();
    const r = corpo.result || corpo;
    const dados = {
      aberto: r.aberto === true,
      anexos: Array.isArray(r.anexos) ? r.anexos.filter((a) => a && typeof a.url === 'string' && a.url) : [],
    };
    cache.set(sessionkey, { dados, ate: agora + TTL_MS });
    return dados;
  } catch (err) {
    customLogger.warning(`[ANEXOS] falha ao buscar anexos da mensagem padrão: ${err.message}`);
    // aberto: null = não deu para saber; a padrão de sempre sai (sem anexos), nunca o aviso de fechada
    return { aberto: null, anexos: [] };
  }
}

/** mime pelo tipo/nome quando a API não mandar (o download ainda confirma) */
function mimeDoAnexo(anexo) {
  if (anexo.tipo === 'pdf' || /\.pdf$/i.test(anexo.nome || '') || /\.pdf$/i.test(anexo.url)) return 'application/pdf';
  if (/\.png$/i.test(anexo.url)) return 'image/png';
  if (/\.webp$/i.test(anexo.url)) return 'image/webp';
  return 'image/jpeg';
}

function limparCache() {
  cache.clear();
}

module.exports = { buscarAnexosPadrao, mimeDoAnexo, baseDaApi, limparCache };
