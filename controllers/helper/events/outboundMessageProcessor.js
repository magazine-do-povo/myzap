const ChatHistoryHelper = require('./chatHistory.js');
const { isIAResponse, isSystemMedia } = require('../ia/iaResponseCache');
const customLogger = require('../../../util/customLogger.js');
const { LOG_PREFIX } = require('../ia/iaConfig.js');

/**
 * Helper para processar mensagens enviadas pelo próprio bot
 * Detecta ecos, registra mensagens de agentes humanos
 */
class OutboundMessageProcessor {
  
  static async processFromMe({ message, session, sessionkey, numero, socketManager, empresa = null, client = null }) {
    const outboundText = typeof message.body === 'string' ? message.body.trim() : '';

    // Mensagem ANTIGA da loja que uma sessão recém-conectada sincroniza não é o
    // atendente digitando agora. Sonhare, 26/09 09:19: reconectaram o WhatsApp pelo
    // QR, o histórico veio como "fromMe" e a conversa do Junior virou "equipe
    // atendendo" — 30 min sem IA. Atendente de verdade gera mensagem com a hora de
    // agora; 2 min de folga cobrem o relógio do WhatsApp.
    const idadeSeg = Number(message.timestamp) > 0 ? Math.floor(Date.now() / 1000) - Number(message.timestamp) : 0;
    if (idadeSeg > 120) {
      return { processed: true, humano: false };
    }

    const TIPOS_MIDIA = ['ptt', 'audio', 'image', 'video', 'document', 'sticker'];
    const temMidia = Boolean(message.hasMedia) || TIPOS_MIDIA.includes(String(message.type || ''));

    // Mídia que o SISTEMA acabou de mandar a este cliente (voz do bot, anexo, a foto
    // da peça que o agente mostra) não é o atendente — COM ou sem legenda. Com legenda,
    // o texto do eco é a legenda, que ninguém registrou como resposta da IA: caía no
    // caminho do texto e virava "atendente digitou" — as fotos do agente pausavam a IA
    // (Sonhare, 25/09/2026: "Guard bloqueou! Motivo: agente_recente").
    if (temMidia && isSystemMedia(session, numero)) {
      return { processed: true, humano: false };
    }

    if (!outboundText) {
      // Áudio/foto/figurinha sem texto: se o SISTEMA não mandou mídia para
      // este cliente há pouco (voz do bot, anexo, PDF pela API), foi o
      // atendente pelo celular — caso real: o Vaqueiro respondeu por áudio e
      // o bot seguiu falando por cima (Leticia, 06/09/2026).
      if (!temMidia || isSystemMedia(session, numero)) {
        return { processed: true, humano: false };
      }
      const rotulo = `[${String(message.type || 'mídia')} do atendente]`;
      await ChatHistoryHelper.registerAgentMessage({ session, sessionkey, numero, text: rotulo });
      customLogger.info(`${LOG_PREFIX} Agent media detected`, { session, numero, tipo: message.type });
      if (globalThis.process.env.IA_PROVIDER === 'agente') {
        const AgenteClient = require('../ia/agenteClient');
        AgenteClient.atender({ sessionkey, numero, texto: rotulo, origem: 'humano', apiUrlEmpresa: empresa?.api_url || null })
          .catch((err) => customLogger.warning(`${LOG_PREFIX} contexto humano não chegou ao agente: ${err.message}`));
      }
      return { processed: true, humano: true };
    }

    // Eco do bot (mesmo número + mesmo texto) ou texto que saiu pelo sistema
    // (resposta da IA, mensagem padrão, confirmação de pedido/NF-e enviada
    // pela API do ClickExpress): não é o atendente digitando.
    const isEcho = await ChatHistoryHelper.isRecentAssistantEcho({
      session,
      sessionkey,
      numero,
      text: outboundText,
    });
    if (isEcho || isIAResponse(outboundText)) {
      return { processed: true, humano: false };
    }

    // Com agente: ANTES de pausar, ele diz se foi a equipe ou outro sistema
    // no mesmo número (a cobrança automática que sai pelo computador da loja).
    // A mesma chamada entrega o texto ao agente como contexto — ele não
    // responde, só guarda, para retomar a conversa sabendo o que foi dito.
    if (globalThis.process.env.IA_PROVIDER === 'agente') {
      const AgenteClient = require('../ia/agenteClient');
      const { celularDoLid } = require('../ia/celularDoLid');
      const sistema = await AgenteClient.ehMensagemDoSistema({
        sessionkey,
        numero,
        // O agente acha a cobrança pelo TELEFONE; sem este, todo cliente @lid
        // cobrado virava "equipe atendendo" e a IA calava 30 min (Sonhare, 28/09).
        celular: await celularDoLid(client, numero),
        texto: outboundText,
        apiUrlEmpresa: empresa?.api_url || null,
      });
      if (sistema) {
        customLogger.info(`${LOG_PREFIX} fromMe de outro sistema (cobrança) — IA segue ativa`, { session, numero });
        return { processed: true, humano: false };
      }
    }

    // Atendente humano digitou: registra (pausa a IA por HUMAN_PAUSE_MINUTES
    // para este cliente).
    await ChatHistoryHelper.registerAgentMessage({
      session,
      sessionkey,
      numero,
      text: outboundText
    });
    customLogger.info(`${LOG_PREFIX} Agent reply detected`, { session, numero });

    return { processed: true, humano: true };
  }
}

module.exports = OutboundMessageProcessor;
