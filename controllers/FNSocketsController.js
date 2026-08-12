// Emissor de eventos para a interface web (Socket.IO).
//
// ATENÇÃO: `io` PODE VIR undefined, e isso é normal.
// Quem instancia esta classe passa `req.io`, que só existe quando a chamada
// entrou por HTTP (o middleware do Express injeta o Socket.IO no request).
// No boot, o START_ALL_SESSIONS (startup.js) fabrica um `req` de mentira para
// reabrir as sessões salvas — e esse req NÃO tem `io`, porque não há navegador
// nenhum escutando ainda.
//
// Sem o `?.` abaixo, o primeiro `this.io.emit(...)` estourava
// "Cannot read properties of undefined (reading 'emit')" e derrubava a
// reabertura de TODAS as sessões: o pod voltava com todos os números em QRCODE,
// exigindo re-parear o chip na mão. Ou seja: reiniciar o MyZap (por deploy, por
// OOMKill ou pelo restart diário que a própria documentação dele recomenda)
// custava as sessões. O socket é enfeite de tela; a sessão é o que importa.
module.exports = class Sockets {
  constructor(io) {
    this.io = io;
  }

  //consumeSession
  consumeSession(session, data) {
    this.io?.emit("consume", data);
    return true;
  }

  //emitindo mensagem que qrcode mudou
  qrCode(session, data) {
    this.io?.emit("qrcode", data);
    return true;
  }

  //mudando statusFind
  statusFind(session, data) {
    this.io?.emit("statusFind", data);
    return true;
  }

  //detectando start do servidor
  start(session, data) {
    this.io?.emit("start", data);
    return true;
  }

  //enviando mensagem como emissor
  messagesent(session, data) {
    this.io?.emit("send-message", data);
    return true;
  }

  //interfaces
  interface(session, data) {
    this.io?.emit("interface", data);
    return true;
  }

  //recebendo mensagens
  message(session, data) {
    //console.log(data); receberdor de msg
    this.io?.emit("message", data);
    return true;
  }
  //mudando status
  stateChange(session, data) {
    this.io?.emit("stateChange", data);
    return true;
  }

  //webhook para detecção de alteracoes de status nas mensagens
  ack(session, data) {
    this.io?.emit("ack", data);
    return true;
  }

  //Função para emitir mensagens de status
  events(session, data) {
    this.io?.emit("events", data);
  }

  //Função para emitir um alerta
  alert(session, data) {
    this.io?.emit("alert", data);
    return true;
  }
};
