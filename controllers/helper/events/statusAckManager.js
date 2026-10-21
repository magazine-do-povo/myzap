const eventsHelper = require('./events.js');
const customLogger = require('../../../util/customLogger.js');

/**
 * Helper para gerenciar eventos de status e ACK de mensagens
 * Centraliza lógica de detecção de engine e processamento de eventos
 */
class StatusAckManager {
  
  /**
   * Configura listeners de status de mensagens (entregue, lido, etc)
   */
  static setupMessageStatus(session, client, req, socketManager) {
    // Detectar engine e configurar eventos apropriados
    if (typeof client?.onAck === 'function') {
      // WPPConnect & Venom - usam método onAck
      client.onAck(async ack => {
        const response = this.buildStatusResponse(ack, session, 'wpp_venom');
        await socketManager.notifyMessageAck(response);
      });
    } else if (typeof client?.on === 'function') {
      // WhatsApp Web.js - usa eventos
      client.on('message_ack', async (msg, ack) => {
        try {
          if (!msg) {
            customLogger.info(`⚠️ [${session}] message_ack: msg é undefined`);
            return;
          }

          const response = this.buildStatusResponse({ msg, ack }, session, 'webjs');
          await socketManager.notifyMessageAck(response);
        } catch (error) {
          customLogger.info(`❌ [${session}] Erro no message_ack: ${error.message}`);
        }
      });
    }
  }

  /**
   * Constrói objeto de resposta padronizado para status de mensagem
   */
  static buildStatusResponse(data, session, engine) {
    if (engine === 'webjs') {
      const { msg, ack } = data;
      const type = eventsHelper.normalizarTipo(msg);
      const status = eventsHelper.tipoAckToStatus(ack);

      return {
        wook: 'MESSAGE_STATUS',
        status,
        type,
        id: msg?.id?._serialized || msg?.id?.$1 || msg?.id, // `$1`: o id no WhatsApp Web de set/2026
        from: msg?.from?.split('@')[0] || 'unknown',
        to: msg?.to?.split('@')[0] || 'unknown',
        session,
        dateTime: eventsHelper.formatarData(msg?.timestamp),
        data: { msg, ack }
      };
    } else {
      // WPPConnect/Venom
      const type = eventsHelper.normalizarTipo(data);
      const status = eventsHelper.tipoAckToStatus(data?.ack);

      return {
        wook: 'MESSAGE_STATUS',
        status,
        type,
        id: data?.id?._serialized,
        from: data?.from?.split('@')[0],
        to: data?.to?.split('@')[0],
        session,
        dateTime: eventsHelper.formatarData(data?.t),
        data
      };
    }
  }

  /**
   * Emite status simples via Socket.IO
   */
  static emitStatus(req, status, session) {
    customLogger.info(`[STATUS MESSAGE] ${session}: ${status}`);
    if (req?.io?.emit) {
      req.io.emit('whatsapp-status', { session, status });
    }
  }
}

module.exports = StatusAckManager;
