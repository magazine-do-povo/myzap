/**
 * O `ready` perdido do whatsapp-web.js 1.34.7 (26/09/2026): Sonhare e Capucho
 * ficaram 4 h CONNECTED e surdas depois do restart das 04h. O health check chama
 * o handler que a biblioteca expôs quando a sincronização já terminou e o
 * cliente nunca ficou pronto (sem `info`).
 *
 * Uso: node test/ready-perdido.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => {
  const arquivo = resolver(rel);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};
const carregar = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido === 'sequelize' ? { Op: { notIn: Symbol('notIn') } } : carregar.call(this, pedido, ...resto);
};
stub('config.js', { sequelize: {} });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('Models/device.js', () => ({ update: async () => [0] }));
stub('controllers/helper/core/sessions.js', { getAllSessions: () => [], removeClientFromMemory() {} });

const { dispararReadyPerdido } = require(resolver('jobs/sessionHealthCheck.js'));

// A página de mentira: roda a função do evaluate contra um `window` controlado.
const pagina = (janela) => ({ evaluate: async (fn) => { global.window = janela; try { return fn(); } finally { delete global.window; } } });
const janela = (hasSynced) => {
  const w = { chamou: 0, require: () => ({ Socket: { hasSynced } }) };
  w.onAppStateHasSyncedEvent = () => { w.chamou++; };
  return w;
};

(async () => {
  let w = janela(true);
  assert.equal(await dispararReadyPerdido('sonhare', { pupPage: pagina(w) }), true);
  assert.equal(w.chamou, 1, 'sincronizado e sem ready: liga os ouvintes');
  console.log('ok   sessão surda (sincronizada, sem info): handler chamado');

  w = janela(false);
  assert.equal(await dispararReadyPerdido('sonhare', { pupPage: pagina(w) }), false);
  assert.equal(w.chamou, 0, 'ainda sincronizando: espera o próximo ciclo');
  console.log('ok   ainda sincronizando: não mexe');

  w = janela(true);
  assert.equal(await dispararReadyPerdido('vaqueiro', { pupPage: pagina(w), info: { wid: 'x' } }), false);
  assert.equal(w.chamou, 0, 'ready normal (tem info): não chama de novo');
  console.log('ok   sessão que ficou pronta normalmente: não mexe');

  assert.equal(await dispararReadyPerdido('quebrada', { pupPage: { evaluate: async () => { throw new Error('page closed'); } } }), false);
  console.log('ok   página fechada: não derruba o health check');
  console.log('ready-perdido: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
