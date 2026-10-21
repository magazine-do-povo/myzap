const ChatHistoryHelper = require('../events/chatHistory');
const HumanDetector = require('./humanDetector');
const AgenteClient = require('./agenteClient');
const { HUMAN_PAUSE_MINUTES } = require('./iaConfig');

/**
 * Guards/validações para decidir se deve processar IA ou enviar mensagem padrão.
 * Cada função retorna { shouldBlock: boolean, reason?: string }
 */

async function checkGroupMessage({ message }) {
  // Verifica se é grupo por múltiplos métodos:
  // 1. Propriedade isGroupMsg (WPPConnect/Venom)
  // 2. Sufixo @g.us no campo 'from' (whatsapp-web.js)
  const isGroup = message.isGroupMsg || (message.from && message.from.endsWith('@g.us'));
  
  console.log('[GUARD] checkGroupMessage - isGroupMsg:', message.isGroupMsg, 'from:', message.from, 'isGroup:', isGroup);
  
  if (isGroup) {
    console.log('🚫 [GUARD] Bloqueando mensagem de grupo!');
    return { shouldBlock: true, reason: 'grupo' };
  }
  return { shouldBlock: false };
}

/**
 * Mensagem que chega ATRASADA (mais de 10 min) não vai para a IA. Depois de uma
 * queda, a sessão recebe de uma vez tudo o que ficou represado, e muito era
 * conversa com a EQUIPE ("Maria deu certo", "Maria o Nicao passou aí" — Sonhare,
 * 26/09): a IA respondia, uma hora depois, mensagens que não eram para ela.
 */
const ATRASO_MAXIMO_SEG = 10 * 60;
async function checkMensagemAtrasada({ message }) {
  const ts = Number(message && message.timestamp) || 0;
  if (ts > 0 && Math.floor(Date.now() / 1000) - ts > ATRASO_MAXIMO_SEG) {
    return { shouldBlock: true, reason: 'mensagem_atrasada' };
  }
  return { shouldBlock: false };
}

async function checkCompanyEnabled({ empresa }) {
  if (!empresa) {
    return { shouldBlock: true, reason: 'empresa_nao_encontrada' };
  }
  return { shouldBlock: false };
}

async function checkIaEnabled({ empresa, sessionkey }) {
  // Fonte da verdade = toggle do painel do ClickExpress. No modo local a
  // config remota espelha o toggle (cache <=10min no agenteClient) — assim
  // ativar pela web liga o worker da maquina sem mexer no banco local.
  // null (env AGENT_URL setada, API fora, campo ausente) = cai no banco local.
  if ((process.env.IA_PROVIDER || '').toLowerCase() === 'agente') {
    const painel = await AgenteClient
      .iaAtivaRemota(sessionkey, empresa?.api_url || null)
      .catch(() => null);
    if (painel === true) return { shouldBlock: false };
    if (painel === false) return { shouldBlock: true, reason: 'ia_desligada' };
  }

  const iaAtiva = empresa.ia_ativa !== false;
  if (!iaAtiva) {
    return { shouldBlock: true, reason: 'ia_desligada' };
  }
  return { shouldBlock: false };
}

async function checkHumanRequest({ msgBody, session, sessionkey, numero }) {
  if (msgBody && HumanDetector.detectarPedidoHumano(msgBody)) {
    // Marcar pedido de humano no histórico
    await ChatHistoryHelper.marcarPedidoHumano({ session, sessionkey, numero });
    return { 
      shouldBlock: true, 
      reason: 'pedido_humano',
      transferMessage: HumanDetector.getMensagemTransferencia()
    };
  }
  return { shouldBlock: false };
}

async function checkRecentHuman({ session, sessionkey, numero }) {
  // Se ALLOW_SELF_TEST está ativo, ignorar verificação de agente recente
  // Isso permite testar a IA enviando mensagem para o próprio número
  if (process.env.ALLOW_SELF_TEST === 'true') {
    return { shouldBlock: false };
  }
  
  const humanoFalou = await ChatHistoryHelper.humanoFalouRecentemente({
    session,
    sessionkey,
    numero,
    minutos: HUMAN_PAUSE_MINUTES,
  });
  
  if (humanoFalou) {
    return { shouldBlock: true, reason: 'agente_recente' };
  }
  return { shouldBlock: false };
}

async function checkClientRequestedHuman({ session, sessionkey, numero }) {
  const clientePediuHumano = await ChatHistoryHelper.clientePediuHumano({
    session,
    sessionkey,
    numero,
    minutos: 60
  });
  
  if (clientePediuHumano) {
    return { shouldBlock: true, reason: 'aguardando_humano' };
  }
  return { shouldBlock: false };
}

/**
 * Verifica se é o primeiro contato do dia com este número.
 * Se for, bloqueia para enviar mensagem padrão antes da IA.
 * @param {Object} params
 * @param {string} params.session - ID da sessão
 * @param {string} params.sessionkey - Chave da sessão  
 * @param {string} params.numero - Número do cliente
 * @returns {Promise<{shouldBlock: boolean, reason?: string}>}
 */
async function checkFirstContactToday({ session, sessionkey, numero }) {
  const jaInteragiuHoje = await ChatHistoryHelper.jaInteragiuHoje({
    session,
    sessionkey,
    numero,
  });
  
  if (!jaInteragiuHoje) {
    return { shouldBlock: true, reason: 'primeiro_contato' };
  }
  return { shouldBlock: false };
}

module.exports = {
  checkGroupMessage,
  checkMensagemAtrasada,
  checkCompanyEnabled,
  checkIaEnabled,
  checkHumanRequest,
  checkRecentHuman,
  checkClientRequestedHuman,
  checkFirstContactToday,
};
