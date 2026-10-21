const express = require("express");
const Router = express.Router();
const Sessions = require('../controllers/SessionsController.js');
const Mensagens = require("../functions/WhatsappWebJS/mensagens");
const Auth = require("../functions/WhatsappWebJS/auth.js");
const { checkParams } = require("../middlewares/validations");
const { checkNumber } = require("../middlewares/checkNumber");
const { checkAPITokenMiddleware } = require('../middlewares/checkAPITokenMiddleware');

// Texto/caption que sai pela API (confirmação de pedido, NF-e, teste do painel)
// é do SISTEMA: marca antes de enviar para o fromMe não virar "atendente
// humano falou" e pausar a IA daquele cliente.
const { registerIAResponse } = require('../controllers/helper/ia/iaResponseCache');
const marcarSaidaDoSistema = (req, _res, next) => {
  try {
    if (/^\/send/i.test(req.path)) {
      for (const campo of ['text', 'caption', 'message']) {
        if (typeof req.body?.[campo] === 'string' && req.body[campo].trim()) registerIAResponse(req.body[campo]);
      }
    }
  } catch (_) { /* nunca segura o envio */ }
  next();
};
Router.use(marcarSaidaDoSistema);

Router.post('/start', checkParams, Mensagens.startSession);
Router.post('/instances', checkAPITokenMiddleware, Sessions.instances);

// Sessões 
// #swagger.tags = ['Sessions']
Router.get('/getQrCode', Auth.getQrCode);
Router.get('/getQrCode/:session', Auth.getQrCode); // ADICIONADO - Aceita session como parâmetro da URL

Router.post('/getAllSessions', Sessions.getAllSessions);
Router.post('/getConnectionStatus', checkParams, Sessions.getConnectionStatus);
Router.post('/forceReconnect', checkParams, Sessions.forceReconnect);
// ADICIONADO - Endpoint para reparar sessões com problemas
Router.post('/repairSession', checkParams, Sessions.repairSession);
Router.post('/reconnect', checkParams, Sessions.forceReconnect);
Router.post('/deleteSession', Sessions.deleteSession);
// ADICIONADO - Verificar status REAL da sessão no Puppeteer/Chrome
Router.post('/verifyRealStatus', checkParams, Sessions.verifyRealStatus);

// Mensagens
// #swagger.tags = ['Messages']
Router.post('/sendText', checkParams, checkNumber, Mensagens.sendText);
Router.post('/sendImage', checkParams, checkNumber, Mensagens.sendImage);
Router.post('/sendVideo', checkParams, checkNumber, Mensagens.sendVideo);
Router.post('/sendFile64', checkParams, checkNumber, Mensagens.sendFile64);
Router.post('/sendMultipleFile64', checkParams, checkNumber, Mensagens.sendMultipleFile64);
Router.post('/sendFile', checkParams, checkNumber, Mensagens.sendFile);
Router.post('/sendMultipleFiles', checkParams, checkNumber, Mensagens.sendMultipleFiles);
Router.post('/sendAudio', checkParams, checkNumber, Mensagens.sendAudio);
Router.post('/sendSticker', checkParams, checkNumber, Mensagens.sendSticker);
Router.post('/sendLocation', checkParams, checkNumber, Mensagens.sendLocation);
Router.post('/sendContact', checkParams, checkNumber, Mensagens.sendContact);
Router.post('/sendList', checkParams, checkNumber, Mensagens.sendListMessage);
Router.post('/sendOrder', checkParams, checkNumber, Mensagens.sendOrderMessage);
Router.post('/sendPoll', checkParams, checkNumber, Mensagens.sendPollMessage);
Router.post('/sendLink', checkParams, checkNumber, Mensagens.sendLink);
Router.post('/reply', checkParams, checkNumber, Mensagens.reply);
Router.post('/forward', checkParams, checkNumber, Mensagens.forwardMessages);
Router.post('/downloadMedia', checkParams, Mensagens.downloadMediaByMessage);
Router.post('/reaction', checkParams, Mensagens.sendReactionToMessage);

module.exports = Router;
