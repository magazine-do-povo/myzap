const Sessions = require("../../../controllers/SessionsController");
const get = require("async-get-file");
const fs = require("fs");
const whatsappweb = require("whatsapp-web.js");
const util = require("util");
const urlExistsImport = require("url-exists");
const engine = require("../../../engines/WhatsappWebJS");
const Cache = require("../../../util/cache"); // ADICIONADO - Para usar números processados
const customLogger = require('../../../util/customLogger.js'); // Logger padronizado

// 🆕 Importar funções de health check para rastrear envios
const { registerSendSuccess, registerSendFailure, isClientHealthy } = require('../../../jobs/sessionHealthCheck.js');

const urlExists = util.promisify(urlExistsImport);
const { MessageMedia, Location, Poll } = whatsappweb;

// CORRIGIDO - Usar Cache.get() igual WPPConnect
async function buildNumber(req) {
  const number = req.body.number;
  
  if (req.body.isGroup) {
    // Para grupos, usar o número diretamente com @g.us
    return number + "@g.us";
  } else {
    // Para contatos, usar o número processado do Cache (igual WPPConnect)
    const processedNumber = await Cache.get(number);
    if (processedNumber) {
      customLogger.info(`[BUILD NUMBER] ${number} → ${processedNumber} (do cache)`);
      return processedNumber;
    } else {
      // Fallback se não estiver no cache
      customLogger.info(`[BUILD NUMBER] ${number} → ${number}@c.us (fallback)`);
      return number + "@c.us";
    }
  }
}

// NOVO - Formatar qualquer número sem precisar de req
async function formatNumber(rawNumber) {
  if (!rawNumber) return null;
  
  // Limpar número (remover tudo exceto dígitos)
  let cleaned = rawNumber.toString().replace(/[^0-9]/g, "");
  
  // Adicionar código BR (55) se necessário
  if (cleaned.length === 10 || cleaned.length === 11) {
    cleaned = '55' + cleaned;
  }
  
  return cleaned + "@c.us";
}

// ---------------------------------------------------------------------------
// Leitura DEFENSIVA do retorno do sendMessage.
//
// O `sendMessage` do whatsapp-web.js ENTREGA a mensagem e, dependendo da versão
// do WhatsApp Web, ainda assim devolve `undefined`. Ler `response.id._serialized`
// direto lança TypeError DENTRO do try — e o catch converte um envio que deu
// certo em HTTP 500. Foi exatamente assim que uma cobrança entregue virou 9
// reenvios para a mesma cliente: quem chama a API via 500, achava que tinha
// falhado, e mandava de novo a cada rodada.
//
// Sem o id não há como rastrear o ACK, mas a mensagem SAIU. Estes helpers
// devolvem null em vez de explodir, e o envio continua valendo 200.
// ---------------------------------------------------------------------------
function messageId(response) {
  return response?.id?._serialized ?? null;
}

function messagePhone(response, fallback = null) {
  const to = response?.to;
  return (
    response?.id?.remote?._serialized ??
    (typeof to === "string" ? to : to?.user) ??
    fallback
  );
}

module.exports = {
  async sendText(req, res) {
    const session = req.body.session;
    const data = Sessions.getSession(session);
    const number = await buildNumber(req); // AWAIT adicionado
    const text = req.body.text;

    if (!text) {
      return res
        .status(400)
        .json({ status: 400, error: "Text não foi informado" });
    }

    // 🛡️ VALIDAÇÃO 1: Client existe na memória?
    if (!data || !data.client) {
      customLogger.error(`[SEND TEXT] ❌ Client não encontrado: ${session}`);
      registerSendFailure(session, 'Client não encontrado na memória');
      return res.status(503).json({ 
        status: "FAIL", 
        error: { name: "ClientNotFound", message: "Sessão não está conectada. Por favor, reconecte." },
        needsReconnect: true
      });
    }

    // 🛡️ VALIDAÇÃO 2: Client está saudável? (verifica estado real)
    const healthResult = await isClientHealthy(session, data.client);
    if (!healthResult.healthy) {
      customLogger.error(`[SEND TEXT] ❌ Client não saudável: ${session} - ${healthResult.reason}`);
      
      // 🔴 Só registrar falha se NÃO for bloqueio por muitas falhas (evita loop infinito)
      if (!healthResult.skipFailureCount) {
        registerSendFailure(session, healthResult.reason);
      }
      
      return res.status(503).json({ 
        status: "FAIL", 
        error: { name: "ClientUnhealthy", message: `Sessão com problema: ${healthResult.reason}` },
        needsReconnect: true,
        healthCheck: healthResult
      });
    }

    // Só o ENVIO fica dentro do try. Montar a resposta é passo de leitura: se
    // estourar aqui dentro, o catch marca falha numa mensagem que já chegou no
    // celular do cliente — e quem chamou reenvia.
    let response;
    try {
      // Fix para erro markedUnread: usar sendSeen: false
      response = await data.client.sendMessage(number, text, { sendSeen: false });
    } catch (error) {
      // ❌ Registrar falha de envio
      registerSendFailure(session, error.message);
      customLogger.error(`[SEND TEXT] ❌ Erro ao enviar: ${session} → ${number}: ${error.message}`);
      
      // Verificar se é erro que indica sessão morta
      const isSessionDead = ['getChat', 'sendMessage', 'detached Frame', 
        'Execution context', 'Target closed', 'Protocol error'].some(k => error.message.includes(k));
      
      return res.status(500).json({
        status: "FAIL",
        error: { name: error.name, message: error.message },
        needsReconnect: isSessionDead
      });
    }

    // Daqui para baixo a mensagem JÁ FOI ENTREGUE — nada pode mais virar erro.
    registerSendSuccess(session);
    customLogger.info(`[SEND TEXT] ✅ Mensagem enviada: ${session} → ${number}`);

    const id = messageId(response);
    if (!id) {
      // Entregue, mas sem id: some o rastreio de ACK, não o envio.
      customLogger.warning(`[SEND TEXT] ⚠️ ${session} → ${number}: WhatsApp Web não devolveu o id da mensagem`);
    }

    return res.status(200).json({
      result: 200,
      type: "text",
      id,
      phone: messagePhone(response, number),
      content: response?.body ?? text,
    });
  },

  async addStatusText(req, res) {
    const data = Sessions.getSession(req.body.session);
    await data.client.sendMessage("status@broadcast", req.body.text, { sendSeen: false });
    return res.status(200).json({ result: "success" });
  },

  async sendImage(req, res) {
    return module.exports.sendMedia(req, res, "image");
  },

  async sendVideo(req, res) {
    return module.exports.sendMedia(req, res, "video");
  },

  async sendSticker(req, res) {
    return module.exports.sendMedia(req, res, "sticker");
  },

  async sendFile(req, res) {
    return module.exports.sendMedia(req, res, "file");
  },

  async sendAudio(req, res) {
    return module.exports.sendMedia(req, res, "audio");
  },

  async sendLocation(req, res) {
    const data = Sessions.getSession(req.body.session);
    const number = await buildNumber(req); // CORRIGIDO - Usar buildNumber()
    const { lat, log, title, description } = req.body;

    if (!lat || !log || !title || !description) {
      return res
        .status(400)
        .json({ status: 400, error: "Dados de localização incompletos" });
    }

    try {
      const loc = new Location(lat, log, `${title}\n${description}`);
      const response = await data.client.sendMessage(number, loc, { sendSeen: false });
      return res.status(200).json({
        result: 200,
        type: "locate",
        id: messageId(response),
        session: req.body.session,
        phone: messagePhone(response, number),
        mimetype: response?.type ?? null,
      });
    } catch (error) {
      return res.status(400).json({ result: 400, status: "FAIL", log: error });
    }
  },

  async sendContact(req, res) {
    const data = Sessions.getSession(req.body.session);
    const number = await buildNumber(req); // CORRIGIDO - Usar buildNumber()

    if (!req.body.contact || !req.body.name) {
      return res
        .status(400)
        .json({ status: 400, error: "Dados do contato incompletos" });
    }

    try {
      const contactNumber = await formatNumber(req.body.contact); // CORRIGIDO
      const response = await data.client.sendMessage(
        number,
        contactNumber,
        { parseVCards: true, sendSeen: false }
      );
      return res.status(200).json({
        result: 200,
        type: "contact",
        messageId: response?.id ?? null,
        session: req.body.session,
        phone: messagePhone(response, number),
        content: response?.content ?? null,
      });
    } catch (error) {
      return res.status(400).json({ result: 400, status: "FAIL", log: error });
    }
  },

  async sendLink(req, res) {
    const data = Sessions.getSession(req.body.session);
    const number = await buildNumber(req); // AWAIT adicionado

    if (!req.body.url) {
      return res
        .status(400)
        .json({ status: 400, error: "URL não foi informada" });
    }

    try {
      const response = await data.client.sendMessage(
        number,
        req.body.url,
        req.body.text,
        { linkPreview: true, sendSeen: false }
      );
      return res.status(200).json({
        result: 200,
        type: "link",
        messageId: response?.id ?? null,
        session: req.body.session,
        phone: messagePhone(response, number),
        content: response?.content ?? null,
      });
    } catch (error) {
      return res.status(400).json({ result: 400, status: "FAIL", log: error });
    }
  },

  async sendMedia(req, res, type) {
    const data = Sessions.getSession(req.body.session);
    const number = await buildNumber(req); // CORRIGIDO - Usar buildNumber()
    const filePath = req.body.path;
    const isURL = await urlExists(filePath);
    const name = filePath?.split(/[\/]/).pop();
    const dir = "files-received/";
    const fullPath = isURL ? dir + name : filePath;

    if (!filePath) {
      return res.status(400).send({ status: 400, error: "Path não informado" });
    }

    try {
      if (isURL) await get(filePath, { directory: dir });

      const media = MessageMedia.fromFilePath(fullPath);
      const sendOptions =
        type === "sticker"
          ? { sendMediaAsSticker: true, sendSeen: false }
          : type === "audio"
          ? { sendAudioAsVoice: true, sendSeen: false }
          : { caption: req.body.caption || "", sendSeen: false };
      const response = await data.client.sendMessage(
        number,
        media,
        sendOptions
      );

      if (isURL) fs.unlinkSync(fullPath);

      return res.status(200).json({
        result: 200,
        type,
        id: messageId(response),
        session: req.body.session,
        phone: messagePhone(response, number),
        file: filePath,
        content: response?.body ?? null,
        mimetype: response?.type ?? null,
      });
    } catch (error) {
      return res.status(500).json({ status: "error", message: error });
    }
  },

  async startSession(req, res) {
    const session = req.body.session;
    const data = await Sessions.getClient(session); // Busca device no banco + client na memória (igual WPPConnect)

    customLogger.info('[DEBUG] startSession WhatsApp WebJS', session);
    
    try {
      // CORREÇÃO PRINCIPAL - Verificar se pasta da sessão existe
      const fs = require('fs');
      const path = require('path');
      const sessionPath = path.join('./instances', session);
      const sessionExists = fs.existsSync(sessionPath);
      
      customLogger.info(`[SESSION CHECK] ${session} - Pasta exists: ${sessionExists}`);
      
      if (data) {
        // REMOVIDO: O incremento de attempts_start agora é feito APENAS no engine (WhatsappWebJS.js)
        // Isso evita incremento duplo que fazia atingir o limite de 3 muito rápido
        
        const status = data.status;
        const state = data.state;

        const resposta = {
          result: 'success',
          session,
          state: state || 'STARTING',
          status: status || 'INITIALIZING'
        };

        const sessionHelper = require('../../../controllers/helper/core/sessions.js');
        const injectedClient = sessionHelper.getInjectedClient(session);

        // Se tem QR Code no banco E o client que o renova está vivo na memória,
        // devolver o QR atual. Pós-restart não há client: o QR salvo é um cadáver
        // (o WhatsApp expira QR em ~1 min) e devolvê-lo prendia a sessão num
        // código morto para sempre — sem client, o fluxo segue até o
        // [QR EXPIRED]/[START NEW] logo abaixo, que regenera.
        if (data.qrCode && data.status === 'qrCode' && injectedClient) {
          resposta.qrCode = data.qrCode;  // Base64 da imagem do QR Code
          resposta.urlCode = data.urlCode; // Como estava antes
          resposta.state = 'QRCODE';
          resposta.status = 'qrCode';
          resposta.message = 'QR Code disponível para escaneamento';

          customLogger.info(`[START WITH QR] ${session} - Retornando QR Code existente`);
          const http = require('../../../controllers/helper/core/http.js');
          return http.json(res, 200, resposta);
        }

        // RECONEXÃO CORRIGIDA - Verificar se client está REALMENTE ativo
        const currentSession = Sessions.getClient(session); // CORRIGIDO: getClient em vez de getSession
        const isClientActive = injectedClient && injectedClient.info;
        
        customLogger.info(`[RECONNECT CHECK] ${session} - Pasta: ${sessionExists} - Status: ${status} - Client ativo: ${!!isClientActive}`);
        
        // CRÍTICO - SE JÁ ESTÁ INICIALIZANDO, NÃO INICIAR NOVAMENTE (evita conflito)
        // 🔴 ADICIONADO: LOADING também é estado de inicialização!
        if (['INITIALIZING', 'STARTING', 'RECONNECTING', 'LOADING'].includes(status) || ['STARTING', 'INITIALIZING', 'LOADING'].includes(state)) {
          // Verificar quanto tempo está inicializando
          const lastStart = data.last_start ? new Date(data.last_start) : null;
          const now = new Date();
          const minutesSinceStart = lastStart ? (now - lastStart) / (1000 * 60) : 999;
          
          // Só permitir nova tentativa se passou mais de 10 minutos (timeout)
          if (minutesSinceStart < 10) {
            customLogger.info(`[SKIP INIT] ${session} - Já inicializando há ${minutesSinceStart.toFixed(1)} min, aguardando...`);
            resposta.state = state || 'STARTING';
            resposta.status = status || 'INITIALIZING';
            const http = require('../../../controllers/helper/core/http.js');
            return http.json(res, 200, resposta);
          }
          customLogger.warning(`${session} - Inicialização travada há ${minutesSinceStart.toFixed(1)} min, reiniciando...`);
        }
        
        // SÓ RETORNAR CONECTADO SE: pasta existe + status conectado + CLIENT ATIVO
        if (sessionExists && ['CONNECTED', 'inChat', 'isLogged', 'isConnected'].includes(status) && isClientActive) {
          customLogger.info(`[ALREADY CONNECTED] ${session} - Sessão já ativa`);
          resposta.state = 'CONNECTED';
          resposta.status = status;
        } 
        // SE TEM PASTA MAS CLIENT NÃO ESTÁ ATIVO = RECONECTAR
        else if (sessionExists && ['CONNECTED', 'inChat', 'isLogged', 'isConnected'].includes(status) && !isClientActive) {
          customLogger.info(`[RECONNECT] ${session} - Pasta existe mas client inativo, reconectando...`);
          const engine = require('../../../engines/WhatsappWebJS.js');
          engine.start(req, res, session); // 🔄 RECONECTAR sem QR Code
          resposta.state = 'STARTING';
          resposta.status = 'RECONNECTING';
        }
        // SE TEM QR CODE NO BANCO = GERAR NOVO (igual WPPConnect)
        else if (state === 'QRCODE') {
          customLogger.info(`[QR EXPIRED] ${session} - QR Code no banco expirado, gerando novo`);
          const engine = require('../../../engines/WhatsappWebJS.js');
          engine.start(req, res, session); // SEMPRE gera novo QR
          resposta.state = 'STARTING';
          resposta.status = 'INITIALIZING';
        } 
        // OUTROS CASOS - GERAR NOVO
        else {
          customLogger.info(`[START NEW] ${session} - Status: ${status} - Iniciando engine`);
          const engine = require('../../../engines/WhatsappWebJS.js');
          engine.start(req, res, session); // Não bloquear com await
          resposta.state = 'STARTING';
          resposta.status = 'INITIALIZING';
        }

        const http = require('../../../controllers/helper/core/http.js');
        return http.json(res, 200, resposta);
      }

      // IGUAL WPPConnect - Se não tem data, iniciar engine
      customLogger.info(`[START FRESH] ${session} - Nenhum dado encontrado, iniciando engine`);
      const engine = require('../../../engines/WhatsappWebJS.js');
      engine.start(req, res, session); // Não bloquear com await
      
      const http = require('../../../controllers/helper/core/http.js');
      return http.json(res, 200, {
        result: 'success',
        session,
        state: 'STARTING',
        status: 'INITIALIZING'
      });

    } catch (err) {
      customLogger.info('error', err);
      const http = require('../../../controllers/helper/core/http.js');
      return http.fail(res, err, 500, 'Erro ao iniciar sessão');
    }
  },

  // Funções adicionais para padronização com WPPConnect
  async sendFile64(req, res) {
    const { path: base64Data, caption, filename, mimetype } = req.body;
    
    if (!base64Data) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "Base64 data não informado"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      const number = await buildNumber(req); // AWAIT adicionado
      
      // LIMPAR E VALIDAR BASE64
      let cleanBase64 = base64Data;
      
      // Remover data URI prefix se existir (data:image/png;base64,)
      if (cleanBase64.includes(',')) {
        cleanBase64 = cleanBase64.split(',')[1];
      }
      
      // Remover espaços e quebras de linha
      cleanBase64 = cleanBase64.replace(/\s/g, '');
      
      // Validar se é base64 válido
      try {
        atob(cleanBase64);
      } catch (e) {
        return res.status(400).json({
          result: 400,
          status: "FAIL", 
          message: "Base64 inválido ou malformado"
        });
      }
      
      // DETECTAR MIMETYPE AUTOMATICAMENTE SE NÃO FORNECIDO
      let detectedMimetype = mimetype || 'application/octet-stream';
      
      if (!mimetype && base64Data.includes('data:')) {
        const mimeMatch = base64Data.match(/data:([^;]+)/);
        if (mimeMatch) {
          detectedMimetype = mimeMatch[1];
        }
      }
      
      // Criar MessageMedia a partir do base64 limpo
      const media = new MessageMedia(
        detectedMimetype, 
        cleanBase64, 
        filename || 'file'
      );
      
      const response = await data.client.sendMessage(number, media, {
        caption: caption || "",
        sendSeen: false
      });

      return res.status(200).json({
        result: 200,
        type: "file",
        id: messageId(response),
        session: req.body.session,
        phone: messagePhone(response, number),
        content: response?.body ?? null,
        mimetype: response?.type ?? null,
        filename: filename || 'file'
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async sendMultipleFile64(req, res) {
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "Array de arquivos base64 não informado ou vazio"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      const number = await buildNumber(req); // AWAIT adicionado
      const results = [];

      for (const file of files) {
        const { data: base64Data, filename, mimetype, caption } = file;
        
        if (!base64Data) continue;

        const media = new MessageMedia(
          mimetype || 'application/octet-stream', 
          base64Data, 
          filename || 'file'
        );
        
        const response = await data.client.sendMessage(number, media, {
          caption: caption || "",
          sendSeen: false
        });

        results.push({
          id: messageId(response),
          filename: filename || 'file',
          status: "sent"
        });
      }

      return res.status(200).json({
        result: 200,
        type: "multiple_files_base64",
        session: req.body.session,
        phone: number,
        files: results,
        total: results.length
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async sendMultipleFiles(req, res) {
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "Array de arquivos não informado ou vazio"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      const number = await buildNumber(req);
      const results = [];

      for (const file of files) {
        const { path: filePath, caption } = file;
        
        if (!filePath) continue;

        const isURL = await urlExists(filePath);
        const name = filePath.split(/[\/]/).pop();
        const dir = "files-received/";
        const fullPath = isURL ? dir + name : filePath;

        if (isURL) await get(filePath, { directory: dir });

        const media = MessageMedia.fromFilePath(fullPath);
        const response = await data.client.sendMessage(number, media, {
          caption: caption || "",
          sendSeen: false
        });

        if (isURL) fs.unlinkSync(fullPath);

        results.push({
          id: messageId(response),
          file: filePath,
          status: "sent"
        });
      }

      return res.status(200).json({
        result: 200,
        type: "multiple_files",
        session: req.body.session,
        phone: number,
        files: results,
        total: results.length
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async sendListMessage(req, res) {
    // Listas foram depreciadas no WhatsApp WebJS conforme documentação oficial
    return res.status(410).json({
      result: 410,
      status: "DEPRECATED",
      message: "sendListMessage foi descontinuado pelo WhatsApp. Use sendPollMessage como alternativa."
    });
  },

  async sendOrderMessage(req, res) {
    const { products, total, currency } = req.body;
    
    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "Array de produtos é obrigatório"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      const number = await buildNumber(req);
      
      // Criar mensagem de pedido formatada
      let orderText = "🛒 *PEDIDO*\n\n";
      
      products.forEach((product, index) => {
        orderText += `${index + 1}. *${product.name}*\n`;
        orderText += `   Quantidade: ${product.quantity || 1}\n`;
        orderText += `   Preço: ${currency || 'R$'} ${product.price}\n\n`;
      });
      
      if (total) {
        orderText += `*Total: ${currency || 'R$'} ${total}*`;
      }
      
      const response = await data.client.sendMessage(number, orderText, { sendSeen: false });
      
      return res.status(200).json({
        result: 200,
        type: "order",
        id: messageId(response),
        session: req.body.session,
        phone: messagePhone(response, number),
        products: products,
        total: total
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async sendPollMessage(req, res) {
    const { question, options } = req.body;
    
    if (!question || !options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "Pergunta e pelo menos 2 opções são obrigatórias"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      const number = await buildNumber(req);
      
      const poll = new Poll(question, options);
      
      const response = await data.client.sendMessage(number, poll, { sendSeen: false });
      
      return res.status(200).json({
        result: 200,
        type: "poll",
        id: messageId(response),
        session: req.body.session,
        phone: messagePhone(response, number),
        question: question,
        options: options
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async reply(req, res) {
    const { text, messageid } = req.body;
    
    if (!text || !messageid) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "Text e MessageID são obrigatórios"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      
      // Buscar a mensagem original
      const chat = await data.client.getChatById(messageid.split('_')[0] + '@c.us');
      const messages = await chat.fetchMessages({ limit: 50 });
      const originalMessage = messages.find(msg => msg.id._serialized === messageid);
      
      if (!originalMessage) {
        return res.status(404).json({
          result: 404,
          status: "FAIL",
          message: "Mensagem original não encontrada"
        });
      }

      const response = await originalMessage.reply(text);
      
      return res.status(200).json({
        result: 200,
        type: "text",
        id: messageId(response),
        session: req.body.session,
        phone: messagePhone(response),
        content: response?.body ?? text
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async forwardMessages(req, res) {
    const { messageid } = req.body;
    
    if (!messageid) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "MessageID é obrigatório"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      const number = await buildNumber(req);
      
      // Buscar a mensagem para encaminhar
      const chat = await data.client.getChatById(messageid.split('_')[0] + '@c.us');
      const messages = await chat.fetchMessages({ limit: 50 });
      const messageToForward = messages.find(msg => msg.id._serialized === messageid);
      
      if (!messageToForward) {
        return res.status(404).json({
          result: 404,
          status: "FAIL",
          message: "Mensagem não encontrada"
        });
      }

      const targetChat = await data.client.getChatById(number);
      const response = await messageToForward.forward(targetChat);
      
      return res.status(200).json({
        result: 200,
        type: "forward",
        id: messageId(response),
        session: req.body.session,
        phone: messagePhone(response, number),
        originalMessageId: messageid
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async downloadMediaByMessage(req, res) {
    const { messageid } = req.body;
    
    if (!messageid) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "MessageID é obrigatório"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      
      // Buscar a mensagem com mídia
      const chat = await data.client.getChatById(messageid.split('_')[0] + '@c.us');
      const messages = await chat.fetchMessages({ limit: 50 });
      const mediaMessage = messages.find(msg => msg.id._serialized === messageid);
      
      if (!mediaMessage) {
        return res.status(404).json({
          result: 404,
          status: "FAIL",
          message: "Mensagem não encontrada"
        });
      }

      if (!mediaMessage.hasMedia) {
        return res.status(400).json({
          result: 400,
          status: "FAIL",
          message: "Mensagem não contém mídia"
        });
      }

      const media = await mediaMessage.downloadMedia();
      
      return res.status(200).json({
        result: 200,
        type: "media",
        messageId: messageid,
        session: req.body.session,
        mimetype: media.mimetype,
        filename: media.filename,
        data: media.data, // Base64 data
        size: media.filesize
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  },

  async sendReactionToMessage(req, res) {
    const { messageid, reaction } = req.body;
    
    if (!messageid || !reaction) {
      return res.status(400).json({
        result: 400,
        status: "FAIL",
        message: "MessageID e reaction são obrigatórios"
      });
    }

    try {
      const data = Sessions.getSession(req.body.session);
      
      // Buscar a mensagem para reagir
      const chat = await data.client.getChatById(messageid.split('_')[0] + '@c.us');
      const messages = await chat.fetchMessages({ limit: 50 });
      const targetMessage = messages.find(msg => msg.id._serialized === messageid);
      
      if (!targetMessage) {
        return res.status(404).json({
          result: 404,
          status: "FAIL",
          message: "Mensagem não encontrada"
        });
      }

      await targetMessage.react(reaction);
      
      return res.status(200).json({
        result: 200,
        type: "reaction",
        messageId: messageid,
        reaction: reaction,
        session: req.body.session
      });
    } catch (error) {
      return res.status(500).json({
        result: 500,
        status: "FAIL",
        message: error.message
      });
    }
  }
};
