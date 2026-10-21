"use strict";

const eventsHelper = require("./helper/events/events.js");
const ChatHistoryHelper = require("./helper/events/chatHistory.js");
const ContextBuilder = require("./helper/ia/contextBuilder.js");
const AudioProcessor = require("./helper/ia/audioProcessor.js");
const MidiaProcessor = require("./helper/ia/midiaProcessor.js");
const DecisionEngine = require("./helper/ia/decisionEngine.js");
const SocketWebhookManager = require("./helper/events/socketWebhookManager.js");
const OutboundMessageProcessor = require("./helper/events/outboundMessageProcessor.js");
const ComandoDono = require("./helper/ia/comandoDono.js");
const StatusAckManager = require("./helper/events/statusAckManager.js");
const ConnectionStateManager = require("./helper/events/connectionStateManager.js");
const customLogger = require("../util/customLogger.js");
const {
  registerIAResponse,
  isIAResponse,
} = require("./helper/ia/iaResponseCache.js");

/**
 * Controlador de eventos do WhatsApp.
 * Gerencia recebimento, processamento e envio de mensagens.
 */
module.exports = class Events {
  static registerIAResponse = registerIAResponse;

  /**
   * Configura listeners de mensagens baseado na engine.
   * @param {string} session - ID da sessão
   * @param {Object} client - Cliente WhatsApp (whatsapp-web.js, WPPConnect ou Venom)
   * @param {Object} req - Request do Express
   */
  static async receiveMessage(session, client, req) {
    if (typeof client?.onAnyMessage === "function") {
      // WPPConnect & Venom
      client.onAnyMessage(async (message) => {
        await this.processMessage(message, session, client, req);
      });
    } else if (typeof client?.on === "function") {
      // WhatsApp Web.js - usando APENAS message_create (captura todas as mensagens)
      client.on("message_create", (message) => this.aoCriar(message, session, client, req));
    }
  }

  /** Uma mensagem do whatsapp-web.js (message_create ou filha de álbum), com o dedupe. */
  static async aoCriar(message, session, client, req) {
    // Dedupe: evitar processar mesma mensagem 2x. O `id.id` primeiro: desde 17/09/2026 o
    // `_serialized` pode faltar (o WhatsApp Web passou a serializar em `$1`), e a mesma
    // mensagem viria com duas chaves — a do evento e a buscada no chat (álbum).
    const msgId = message.id?.id || message.id?._serialized;
    if (!this._processedMessages) this._processedMessages = new Set();
    if (this._processedMessages.has(msgId)) {
      return;
    }
    this._processedMessages.add(msgId);
    if (this._processedMessages.size > 100) {
      const arr = Array.from(this._processedMessages);
      this._processedMessages = new Set(arr.slice(-50));
    }

    if (message.type === "album") this.buscarFilhasDoAlbum(message, session, client, req);

    const allowSelfTest = process.env.ALLOW_SELF_TEST === "true";

    // Se for mensagem própria
    if (message.fromMe) {
      // Em modo self-test, verificar se é resposta da IA (evitar loop)
      if (allowSelfTest && isIAResponse(message.body)) {
        return;
      }
      // Fora do self-test, ignorar mensagens próprias
      if (!allowSelfTest) {
        await this.processMessage(message, session, client, req);
        return;
      }
    }

    await this.processMessage(message, session, client, req);
  }

  /** Quando olhar o chat atrás das filhas do álbum: a segunda pode demorar a descer. */
  static ESPERAS_ALBUM_MS = [5000, 20000];

  /**
   * Álbum (duas ou mais fotos mandadas juntas): o whatsapp-web.js 1.34.7 só emite a PRIMEIRA
   * filha no message_create — a segunda nunca passava por aqui. 24/09/2026, Castanheira: os
   * dois álbuns do dia chegaram com 1 foto de 2, e frente e verso do documento viravam só a
   * frente. Depois do álbum, procura as filhas no chat (parentMsgKey = o álbum) e passa todas
   * pelo aoCriar: o dedupe barra a que já veio.
   */
  static buscarFilhasDoAlbum(album, session, client, req) {
    const idAlbum = album.id?.id;
    if (!idAlbum || typeof album.getChat !== "function") return;
    for (const espera of this.ESPERAS_ALBUM_MS) {
      setTimeout(async () => {
        try {
          const chat = await album.getChat();
          const recentes = await chat.fetchMessages({ limit: 30 });
          for (const m of recentes) {
            if (m?._data?.parentMsgKey?.id === idAlbum) await this.aoCriar(m, session, client, req);
          }
        } catch (e) {
          console.error(`[album] filhas do álbum ${idAlbum} não buscadas:`, e?.message || e);
        }
      }, espera);
    }
  }

  /**
   * Pipeline principal de processamento de mensagens.
   * @param {Object} message - Objeto da mensagem recebida
   * @param {string} session - ID da sessão
   * @param {Object} client - Cliente WhatsApp
   * @param {Object} req - Request do Express
   */
  static async processMessage(message, session, client, req) {
    const socketManager = new SocketWebhookManager(req, session);

    // Construir contexto da mensagem
    const ctx = await ContextBuilder.build({ message, session, client, req });
    const { sessionkey, numero, empresa } = ctx;
    let payload = ctx.payload;

    // 1. Filtrar tipos não permitidos
    if (!eventsHelper.isPermitido(message)) {
      return socketManager.responseDefault(payload);
    }

    // 2. Processar mensagens enviadas pelo próprio bot
    const allowSelfTest = process.env.ALLOW_SELF_TEST === "true";
    if (message.fromMe) {
      await socketManager.notifyMessageSent(payload);
      // Chat "Você" da própria loja: comando do dono (abrir/fechar o site).
      // No autoteste esse chat faz papel de cliente, então fica como estava.
      if (!allowSelfTest && ComandoDono.ehChatDoDono(message, client, empresa)) {
        await ComandoDono.processar({ message, client, session, sessionkey, empresa });
        return;
      }
      await OutboundMessageProcessor.processFromMe({
        message,
        session,
        sessionkey,
        numero,
        socketManager,
        empresa,
        client,
      });

      if (!allowSelfTest) {
        return;
      }
    }

    // 3. Notificar recebimento de mensagem
    await socketManager.notifyMessageReceived(payload);

    // Aviso do sistema vai para o painel, mas não é conversa: sem mensagem padrão, sem IA.
    if (eventsHelper.ehAvisoDoSistema(message)) {
      return socketManager.responseDefault(payload);
    }

    // 4. Processar áudio se necessário
    const audioResult = await AudioProcessor.processAudio({
      message,
      client,
      numero,
      payload,
      session,
      sessionkey,
      empresa,
    });
    if (!audioResult.success) {
      await socketManager.responseDefault(payload);
      return;
    }

    if (audioResult.message) message = audioResult.message;
    if (audioResult.payload) payload = audioResult.payload;

    // 4b. Foto/figurinha/PDF: o agente VÊ o arquivo (o marcador continua no texto)
    await MidiaProcessor.processMidia({ message, client, numero, empresa });

    // 5. Registrar mensagem do usuário
    // O texto que segue para a IA é o LEGÍVEL (textoMensagem): imagem/vídeo/
    // figurinha viram "[imagem]"/"[vídeo]"/"[figurinha]" e a legenda entra
    // junto. Usar message.body cru aqui anulava o marcador desde 09/09/2026 —
    // foto sem legenda chegava vazia e o agente devolvia "mensagem_vazia" sem
    // responder nada (WG lenha, Capucho 17/09 19:58: dois comprovantes em foto,
    // zero resposta, pedido de R$ 45 digitado à mão), e foto COM thumbnail
    // chegava como 3,4 KB de base64 no lugar do texto do cliente.
    // Recalculado aqui (e não reaproveitado do contextBuilder) porque o passo
    // 4 pode trocar `message` pela versão com áudio transcrito/anexado.
    const plainBody = ContextBuilder.textoDaMensagem(message).trim();
    if (plainBody) {
      await ChatHistoryHelper.registerUserMessage({
        session,
        sessionkey,
        numero,
        text: plainBody,
      });
    }

    // 6. Engine de decisão IA
    await DecisionEngine.process({
      message,
      client,
      session,
      sessionkey,
      numero,
      msgBody: plainBody,
      empresa,
      payload,
      responseDefault: (p) => socketManager.responseDefault(p),
    });
  }

  /**
   * Configura listeners de status de mensagens (ACK).
   * @param {string} session - ID da sessão
   * @param {Object} client - Cliente WhatsApp
   * @param {Object} req - Request do Express
   */
  static statusMessage(session, client, req) {
    const socketManager = new SocketWebhookManager(req, session);
    StatusAckManager.setupMessageStatus(session, client, req, socketManager);
  }

  /**
   * Emite status simples via Socket.IO.
   * @param {Object} req - Request do Express
   * @param {string} status - Status a emitir
   * @param {string} session - ID da sessão
   */
  static StatusMessage(req, status, session) {
    StatusAckManager.emitStatus(req, status, session);
  }

  /**
   * Configura listeners de mudança de estado de conexão.
   * @param {string} session - ID da sessão
   * @param {Object} client - Cliente WhatsApp
   * @param {Object} req - Request do Express
   */
  static async statusConnection(session, client, req) {
    ConnectionStateManager.setupStateChange(session, client, req);
  }
};
