/**
 * Sonhare, 26/09/2026: o keepalive chamou /start numa sessão VIVA que oscilou
 * (getState ≠ CONNECTED por um instante). Subiu um 2º Client no mesmo perfil, o
 * Chrome abriu outra aba do WhatsApp Web e a primeira virou "aberto em outra
 * janela" — conectada e surda por 1 h. Com o Chrome da sessão vivo, o /start não
 * cria outro Client.
 *
 * Uso: node test/start-sem-segunda-aba.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

let clientesCriados = 0;
let naMemoria = null;
const pacote = require.resolve('whatsapp-web.js', { paths: [raiz] });
require.cache[pacote] = { id: pacote, filename: pacote, loaded: true, exports: {
  Client: function () { clientesCriados++; throw new Error('parou aqui: criaria outro Client'); },
  LocalAuth: function () {},
} };
stub('controllers/SessionsController.js', {});
stub('controllers/helper/core/sessions.js', { getInjectedClient: () => naMemoria, removeClientFromMemory() {} });
stub('controllers/EventsController.js', {});
stub('controllers/WebhooksController.js', {});
stub('config.js', { sequelize: {} });
stub('engines/helper/wweb.js', {});
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('Models/device.js', () => ({ findOne: async () => null, update: async () => [0], create: async () => ({}) }));
stub('Models/user.js', () => ({ findOne: async () => null }));

const WhatsappWebJS = require(resolver('engines/WhatsappWebJS.js'));
const req = { headers: { sessionkey: 's' }, body: {} };

(async () => {
  global.__wwebInit = {};
  naMemoria = { getState: async () => 'OPENING', pupBrowser: { isConnected: () => true } };
  const r = await WhatsappWebJS.start(req, null, 'sonhare');
  assert.equal(clientesCriados, 0, 'Chrome vivo: não cria outro Client');
  assert.equal(r.status, 'INITIALIZING');
  console.log('ok   sessão viva oscilando (OPENING): /start não abre outra aba');

  global.__wwebInit = {};
  naMemoria = { getState: async () => 'CONNECTED', pupBrowser: { isConnected: () => true } };
  assert.equal((await WhatsappWebJS.start(req, null, 'sonhare')).status, 'CONNECTED');
  assert.equal(clientesCriados, 0);
  console.log('ok   sessão CONNECTED: /start ignorado (como era)');

  // Chrome morto: o /start passa da trava e vai criar (aqui os stubs param a criação).
  global.__wwebInit = {};
  naMemoria = { getState: async () => null, pupBrowser: { isConnected: () => false } };
  const passouDaTrava = await WhatsappWebJS.start(req, null, 'caiu').then((x) => x.status !== 'INITIALIZING' && x.status !== 'CONNECTED', () => true);
  assert.equal(passouDaTrava, true, 'Chrome morto: aí sim recria');
  console.log('ok   Chrome morto: /start segue para recriar');
  console.log('start-sem-segunda-aba: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
