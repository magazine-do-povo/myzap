/**
 * O QR guardado no banco ainda serve?
 *
 * Só enquanto o Chrome da sessão está de pé esperando a leitura — o start em
 * andamento, marcado pela trava global.__wwebInit do engine (sai no ready, no
 * erro ou nos 10 min do start). Depois que o cliente desiste (5 QRs, ~2 min),
 * o QR do banco é de um Chrome que não existe mais: lido, o celular diz "Não
 * foi possível conectar o dispositivo" — e o /start e o status devolviam esse
 * QR morto para sempre, nem "Gerar novo QR" gerava outro (Sonhare, 25/09/2026).
 *
 * Só o ENGINE=1 (whatsapp-web.js) tem essa trava; os outros seguem como eram.
 */
const config = require('../../../config.js');

const TTL_MS = 11 * 60 * 1000; // o mesmo da trava do engine

function qrVivo(session) {
  if (String(config.engine) !== '1') return true;
  const inicio = global.__wwebInit && global.__wwebInit[session];
  return Boolean(inicio) && Date.now() - inicio < TTL_MS;
}

module.exports = { qrVivo };
