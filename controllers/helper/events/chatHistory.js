const moment = require('moment');
const { Op } = require('sequelize');

const config = require('../../../config.js');
const ChatHistoryModel = require('../../../Models/chatHistory.js');

const ChatHistory = ChatHistoryModel(config.sequelize);

const assistantEchoCache = new Map();
const lastAgentMessages = new Map();
const lastIaResponses = new Map();
const lastMensagemPadrao = new Map();

const ECHO_CACHE_TTL_MS = 90 * 1000;

function buildKey(session, sessionkey, numero) {
  return `${session || ''}::${sessionkey || ''}::${numero || ''}`;
}

function remember(map, key, payload = {}) {
  const value = { ...payload };
  value.at = payload.at || Date.now();
  map.set(key, value);
  return value;
}

function recall(map, key, ttlMs) {
  const value = map.get(key);
  if (!value) return null;
  if (ttlMs && Date.now() - value.at > ttlMs) {
    map.delete(key);
    return null;
  }
  return value;
}

async function appendEntry({
  session,
  sessionkey,
  numero,
  role,
  msg,
  messageType = null,
  createdAt = new Date(),
}) {
  if (msg === undefined || msg === null) {
    return null;
  }

  const record = await ChatHistory.create({
    session,
    sessionkey,
    numero_cliente: numero,
    role,
    msg,
    message_type: messageType,
    created_at: createdAt,
  });

  afterPersist({ session, sessionkey, numero, role, messageType, msg, createdAt });
  return record;
}

function afterPersist({ session, sessionkey, numero, role, messageType, msg, createdAt }) {
  const key = buildKey(session, sessionkey, numero);
  const at = new Date(createdAt).getTime();

  if (role === 'agent') {
    remember(lastAgentMessages, key, { at });
    return;
  }

  if (role !== 'assistant') {
    return;
  }

  if (messageType === 'ia') {
    remember(lastIaResponses, key, { at });
    markAssistantEcho(key, msg);
    return;
  }

  if (messageType === 'mensagem_padrao') {
    remember(lastMensagemPadrao, key, { at });
    markAssistantEcho(key, msg);
    return;
  }

  if (messageType) {
    markAssistantEcho(key, msg);
  }
}

function markAssistantEcho(key, text) {
  if (!text) return;
  const cacheKey = `${key}::${text}`;
  assistantEchoCache.set(cacheKey, Date.now() + ECHO_CACHE_TTL_MS);
}

function isRecentAssistantEcho({ session, sessionkey, numero, text }) {
  if (!text) return false;
  const key = buildKey(session, sessionkey, numero);
  const cacheKey = `${key}::${text}`;
  const expiresAt = assistantEchoCache.get(cacheKey);
  if (!expiresAt) {
    return false;
  }
  if (Date.now() > expiresAt) {
    assistantEchoCache.delete(cacheKey);
    return false;
  }
  assistantEchoCache.delete(cacheKey);
  return true;
}

module.exports = {
  async getRecent({ session, sessionkey, numero, minutos = 60 }) {
    const since = moment().subtract(minutos, 'minutes').toDate();

    return ChatHistory.findAll({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        created_at: { [Op.gte]: since },
      },
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    });
  },

  async hasRecent({ session, sessionkey, numero, minutos = 30 }) {
    const since = moment().subtract(minutos, 'minutes').toDate();
    const count = await ChatHistory.count({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        created_at: { [Op.gte]: since },
      },
    });
    return count > 0;
  },

  async hasBotRecent({ session, sessionkey, numero, minutos = 30 }) {
    const since = moment().subtract(minutos, 'minutes').toDate();
    const count = await ChatHistory.count({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        role: 'assistant',
        created_at: { [Op.gte]: since },
      },
    });
    return count > 0;
  },

  async savePair({ session, sessionkey, numero, userText, assistantText, assistantType = 'ia', userType = 'user' }) {
    const ops = [];
    if (userText) {
      ops.push(appendEntry({ session, sessionkey, numero, role: 'user', msg: userText, messageType: userType }));
    }
    if (assistantText) {
      ops.push(appendEntry({ session, sessionkey, numero, role: 'assistant', msg: assistantText, messageType: assistantType }));
    }
    if (ops.length) {
      await Promise.all(ops);
    }
  },

  async registerUserMessage({ session, sessionkey, numero, text }) {
    return appendEntry({ session, sessionkey, numero, role: 'user', msg: text, messageType: 'user' });
  },

  async registerAgentMessage({ session, sessionkey, numero, text }) {
    return appendEntry({ session, sessionkey, numero, role: 'agent', msg: text, messageType: 'human' });
  },

  async registerAssistantMessage({ session, sessionkey, numero, text, messageType = 'ia' }) {
    return appendEntry({ session, sessionkey, numero, role: 'assistant', msg: text, messageType });
  },

  async getLastRoles({ session, sessionkey, numero, limit = 10 }) {
    return ChatHistory.findAll({
      where: { session, sessionkey, numero_cliente: numero },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
    });
  },

  async humanoFalouRecentemente({ session, sessionkey, numero, minutos = 10 }) {
    const key = buildKey(session, sessionkey, numero);
    const cached = recall(lastAgentMessages, key, minutos * 60 * 1000);
    if (cached) {
      return true;
    }

    const since = moment().subtract(minutos, 'minutes').toDate();
    const record = await ChatHistory.findOne({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        role: 'agent',
        message_type: 'human',
        created_at: { [Op.gte]: since },
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    });

    if (!record) {
      return false;
    }

    remember(lastAgentMessages, key, { at: new Date(record.created_at).getTime() });
    return true;
  },

  async emCooldownDeIA({ session, sessionkey, numero, segundos = 45 }) {
    const key = buildKey(session, sessionkey, numero);
    const cached = recall(lastIaResponses, key, segundos * 1000);
    if (cached) {
      return true;
    }

    const record = await ChatHistory.findOne({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        role: 'assistant',
        message_type: 'ia',
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    });

    if (!record) {
      return false;
    }

    const createdAt = new Date(record.created_at).getTime();
    remember(lastIaResponses, key, { at: createdAt });
    return Date.now() - createdAt < segundos * 1000;
  },

  /**
   * Verifica se já enviou mensagem padrão HOJE para este número
   * @param {Object} params
   * @param {string} params.session - ID da sessão
   * @param {string} params.sessionkey - Chave da sessão
   * @param {string} params.numero - Número do cliente
   * @param {string} [params.tipo] - 'aviso_fechada' para o aviso que sai no lugar dela com a loja fechada
   * @returns {Promise<boolean>} true se já enviou hoje
   */
  async jaEnvieiMensagemPadraoHoje({ session, sessionkey, numero, tipo = 'mensagem_padrao' }) {
    const since = moment().startOf('day').toDate();
    const record = await ChatHistory.findOne({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        role: 'assistant',
        message_type: tipo,
        created_at: { [Op.gte]: since },
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    });

    return !!record;
  },

  /**
   * Verifica se A LOJA já falou HOJE com este número (mensagem padrão, IA ou atendente).
   * Usado para determinar se é o primeiro contato do dia.
   *
   * A fala do cliente não conta: o EventsController grava a mensagem dele ANTES dos guards,
   * e contar tudo fazia o próprio "oi" parecer interação anterior — o primeiro contato nunca
   * disparava para texto e a IA respondia no lugar da mensagem padrão. Só "funcionava"
   * quando chegava antes um aviso do sistema sem texto (Capucho, 24/09/2026).
   * O aviso de loja fechada também não conta: a padrão tem de sair quando a loja abrir.
   * @param {Object} params
   * @param {string} params.session - ID da sessão
   * @param {string} params.sessionkey - Chave da sessão
   * @param {string} params.numero - Número do cliente
   * @returns {Promise<boolean>} true se já houve interação hoje
   */
  async jaInteragiuHoje({ session, sessionkey, numero }) {
    const since = moment().startOf('day').toDate();
    const count = await ChatHistory.count({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        role: { [Op.ne]: 'user' },
        [Op.or]: [{ message_type: null }, { message_type: { [Op.ne]: 'aviso_fechada' } }],
        created_at: { [Op.gte]: since },
      },
    });
    return count > 0;
  },

  async dentroDoCooldownPadrao({ session, sessionkey, numero, minutos = 0 }) {
    if (!minutos) {
      return false;
    }
    const key = buildKey(session, sessionkey, numero);
    const cached = recall(lastMensagemPadrao, key, minutos * 60 * 1000);
    if (cached) {
      return true;
    }

    const record = await ChatHistory.findOne({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        role: 'assistant',
        message_type: 'mensagem_padrao',
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    });

    if (!record) {
      return false;
    }

    const createdAt = new Date(record.created_at).getTime();
    remember(lastMensagemPadrao, key, { at: createdAt });
    return Date.now() - createdAt < minutos * 60 * 1000;
  },

  isRecentAssistantEcho,

  async purgeOld(days = 1) {
    const limit = moment().subtract(days, 'days').toDate();
    await ChatHistory.destroy({ where: { created_at: { [Op.lt]: limit } } });
  },

  async clearHistory({ session, sessionkey, numero }) {
    await ChatHistory.destroy({
      where: { session, sessionkey, numero_cliente: numero },
    });
    const key = buildKey(session, sessionkey, numero);
    lastAgentMessages.delete(key);
    lastIaResponses.delete(key);
    lastMensagemPadrao.delete(key);
    const prefix = `${key}::`;
    for (const cacheKey of Array.from(assistantEchoCache.keys())) {
      if (cacheKey.startsWith(prefix)) {
        assistantEchoCache.delete(cacheKey);
      }
    }
  },

  /**
   * Marca que cliente solicitou atendimento humano
   * Funciona como humanoFalouRecentemente, mas para pedidos de humano
   */
  async marcarPedidoHumano({ session, sessionkey, numero }) {
    const key = buildKey(session, sessionkey, numero);
    remember(lastAgentMessages, key, { pedidoHumano: true });
    
    // Registra no banco também para persistência
    return appendEntry({ 
      session, 
      sessionkey, 
      numero, 
      role: 'agent', 
      msg: '[PEDIDO_ATENDIMENTO_HUMANO]', 
      messageType: 'pedido_humano' 
    });
  },

  /**
   * Verifica se cliente pediu atendimento humano recentemente
   */
  async clientePediuHumano({ session, sessionkey, numero, minutos = 60 }) {
    const key = buildKey(session, sessionkey, numero);
    const cached = recall(lastAgentMessages, key, minutos * 60 * 1000);
    if (cached && cached.pedidoHumano) {
      return true;
    }

    const since = moment().subtract(minutos, 'minutes').toDate();
    const record = await ChatHistory.findOne({
      where: {
        session,
        sessionkey,
        numero_cliente: numero,
        message_type: 'pedido_humano',
        created_at: { [Op.gte]: since },
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    });

    if (record) {
      remember(lastAgentMessages, key, { pedidoHumano: true, at: new Date(record.created_at).getTime() });
      return true;
    }

    return false;
  },

  // 🚀 OTIMIZAÇÃO - Método para limpar mensagens antigas automaticamente
  async cleanupOldMessages({ diasRetencao = 30 }) {
    const moment = require('moment');
    const cutoffDate = moment().subtract(diasRetencao, 'days').toDate();
    
    const deleted = await ChatHistory.destroy({
      where: {
        created_at: { [Op.lt]: cutoffDate }
      }
    });
    
    const customLogger = require('../../../util/customLogger');
    customLogger.info(`[CHAT HISTORY] ${deleted} mensagens antigas removidas (>${diasRetencao} dias)`);
    return deleted;
  },

  /**
   * 🧹 Limpar TODOS os caches em memória
   * Use após limpar dados do banco para sincronizar
   */
  clearMemoryCaches() {
    assistantEchoCache.clear();
    lastAgentMessages.clear();
    lastIaResponses.clear();
    lastMensagemPadrao.clear();
    console.log('[CHAT HISTORY] Caches em memória limpos');
    return true;
  },

  /**
   * 🧹 Limpar cache de mensagem padrão para um número específico
   */
  clearMensagemPadraoCache({ session, sessionkey, numero }) {
    const key = buildKey(session, sessionkey, numero);
    lastMensagemPadrao.delete(key);
    console.log(`[CHAT HISTORY] Cache mensagem_padrao limpo para: ${key}`);
    return true;
  }
};
