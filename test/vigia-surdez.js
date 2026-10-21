/**
 * Vigia de SURDEZ (26/09/2026): a Sonhare ficou três vezes CONNECTED e surda,
 * cada vez por um motivo. O health check compara a última mensagem de cliente no
 * WhatsApp Web da sessão com a última que o MyZap recebeu; surda → recria.
 *
 * Uso: node test/vigia-surdez.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const carregar = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido === 'sequelize' ? { Op: { notIn: Symbol('notIn') } } : carregar.call(this, pedido, ...resto);
};
const removidas = [];
stub('config.js', { sequelize: {} });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('Models/device.js', () => ({ update: async () => [0] }));
stub('controllers/helper/core/sessions.js', { getAllSessions: () => [], removeClientFromMemory: (s) => removidas.push(s) });

const { vigiarSurdez, registerMessageReceived } = require(resolver('jobs/sessionHealthCheck.js'));
const MIN = 60 * 1000;
const agoraReal = Date.now();
let agora = agoraReal;
Date.now = () => agora;

// Página de mentira: a última mensagem de cliente que o WhatsApp Web recebeu.
const cliente = (ultimaMsgMs) => {
  const c = { destruido: 0, destroy: async () => { c.destruido++; } };
  c.pupPage = { evaluate: async (fn) => {
    global.window = { require: () => ({ Msg: { getModelsArray: () => (ultimaMsgMs ? [{ id: { fromMe: false, remote: '123@lid' }, t: Math.floor(ultimaMsgMs / 1000), type: 'chat' }] : []) } }) };
    try { return fn(); } finally { delete global.window; }
  } };
  return c;
};

(async () => {
  // Client visto há 10 min; o WhatsApp recebeu mensagem há 5 min e o MyZap nada.
  agora = agoraReal - 10 * MIN;
  const surda = cliente(agoraReal - 5 * MIN);
  await vigiarSurdez('sonhare', surda);          // primeira vez: registra quando viu o client
  agora = agoraReal;
  assert.equal(await vigiarSurdez('sonhare', surda), true);
  assert.equal(surda.destruido, 1, 'fecha o Chrome da sessão surda');
  assert.deepEqual(removidas, ['sonhare'], 'tira da memória para o keepalive recriar');
  console.log('ok   mensagem no WhatsApp há 5 min e nada no MyZap: recria a sessão');

  assert.equal(await vigiarSurdez('sonhare', cliente(agoraReal - 4 * MIN)), false);
  console.log('ok   não recria de novo antes de 10 min');

  // Histórico: mensagem de ANTES de o client ser visto não conta.
  const nova = cliente(agoraReal - 30 * MIN);
  assert.equal(await vigiarSurdez('capucho', nova), false);
  console.log('ok   mensagem antiga (histórico que a página carrega): não mexe');

  // O MyZap recebeu depois da mensagem: ouvindo normalmente.
  agora = agoraReal - 20 * MIN;
  const ouvindo = cliente(agoraReal - 6 * MIN);
  await vigiarSurdez('vaqueiro', ouvindo);
  agora = agoraReal - 5 * MIN;
  registerMessageReceived('vaqueiro');
  agora = agoraReal;
  assert.equal(await vigiarSurdez('vaqueiro', ouvindo), false);
  assert.equal(ouvindo.destruido, 0);
  console.log('ok   sessão que recebeu a mensagem: não mexe');

  // Mensagem recém-chegada (menos de 3 min): ainda dá tempo de o evento chegar.
  agora = agoraReal - 10 * MIN;
  const fresca = cliente(agoraReal - 1 * MIN);
  await vigiarSurdez('outra', fresca);
  agora = agoraReal;
  assert.equal(await vigiarSurdez('outra', fresca), false);
  console.log('ok   mensagem de 1 min atrás: espera');
  console.log('vigia-surdez: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
