const eventsHelper = require('../events/events');
const { verifyCompany } = require('./companyLookup');

const { textoDaMensagem } = require('./textoMensagem');

async function build({ message, session, client, req }) {
  const sessionkey = req.headers?.sessionkey;
  // Mensagem enviada pela LOJA (fromMe): o "numero" da conversa é o destinatário.
  // Com message.from, tudo que a loja mandava (bot, confirmação de pedido e o
  // atendente digitando) ia parar no histórico do número da própria loja — e
  // a pausa "humano falou" nunca disparava para o cliente (06/09/2026, zero
  // bloqueios agente_recente em 24 h com 900+ mensagens de saída).
  const numero = message.fromMe ? (message.to || message.from) : message.from;
  const msgBody = textoDaMensagem(message);
  const payload = await eventsHelper.montarPayload(message, session, client);
  const empresa = await verifyCompany(session, sessionkey);
  return { session, sessionkey, numero, msgBody, payload, empresa };
}

module.exports = { build, textoDaMensagem };
