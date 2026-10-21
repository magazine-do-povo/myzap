const customLogger = require('../../../util/customLogger');
const { LOG_PREFIX } = require('./iaConfig');

/**
 * Telefone REAL de um contato @lid — o WhatsApp novo esconde o número atrás do
 * LID. Sem ele o pedido era gravado com o ID interno (#73067) e o agente não
 * reconhecia a cobrança que a própria loja mandou: cada uma virava "equipe
 * atendendo" e pausava a IA 30 min para o cliente cobrado (Sonhare, 28/09).
 *
 * Aceita só um telefone DIFERENTE do lid: getContactById devolvia o próprio lid
 * como "number" (pedido #73072 saiu com o ID de novo). Nunca lança: sem telefone, null.
 */
async function celularDoLid(client, numero) {
  if (!String(numero).endsWith('@lid')) return null;
  const validar = (bruto) => {
    const n = String(bruto || '').replace(/@.*$/, '').replace(/\D/g, '');
    return n.length >= 10 && !String(numero).includes(n) ? n : null;
  };
  try {
    if (typeof client?.getContactLidAndPhone === 'function') {
      const [r] = (await client.getContactLidAndPhone([numero])) || [];
      const n = validar(r?.pn);
      if (n) return n;
    }
    if (typeof client?.getContactById === 'function') {
      const n = validar((await client.getContactById(numero))?.number);
      if (n) return n;
    }
    customLogger.warning(`${LOG_PREFIX} lid sem telefone resolvível: ${numero}`);
  } catch (e) {
    customLogger.warning(`${LOG_PREFIX} lid->numero falhou: ${e.message}`);
  }
  return null;
}

module.exports = { celularDoLid };
