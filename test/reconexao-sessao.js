/**
 * Reconexão das sessões (Valparaíso de Goiás e Guarulhos, 06/10/2026): o WhatsApp deu LOGOUT
 * no aparelho em 30/09 e ninguém soube. Três peças que precisam segurar:
 *  - o keepalive, que nunca rodou no k8s: sem HOST/HOST_SSL o config montava "undefined:3333";
 *  - o /start sem os wh_* (keepalive, painel) não pode zerar os webhooks gravados — a sessão
 *    voltaria conectada e surda;
 *  - LOGOUT e QR que ninguém leu ficam `notLogged`, e o keepalive não religa (só com QR novo).
 *
 * Uso: node test/reconexao-sessao.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const pacotes = {
  sequelize: { Sequelize: class { authenticate() { return Promise.resolve(); } } },
  dotenv: { config() {} },
};
const carregar = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido in pacotes ? pacotes[pedido] : carregar.call(this, pedido, ...resto);
};
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));

// 1) config: sem HOST nem HOST_SSL (o k8s não define nenhum), host_ssl fica vazio.
const configDe = (env) => {
  delete require.cache[resolver('config.js')];
  delete process.env.HOST;
  delete process.env.HOST_SSL;
  Object.assign(process.env, { PORT: '3333', TOKEN: 't', CORS_ORIGIN: '*', ENGINE: '1' }, env);
  return require(resolver('config.js'));
};
assert.equal(configDe({}).host_ssl, '', 'sem HOST: nada de "undefined:3333"');
assert.equal(configDe({ HOST: 'http://vps' }).host_ssl, 'http://vps:3333');
assert.equal(configDe({ HOST_SSL: 'https://zap.exemplo' }).host_ssl, 'https://zap.exemplo');
delete process.env.HOST;
delete process.env.HOST_SSL;
console.log('ok   config: sem HOST/HOST_SSL o host_ssl fica vazio (era "undefined:3333")');

// 2) keepalive: chama a si mesmo pelo loopback e não religa quem precisa de QR.
stub('config.js', { host_ssl: '', port: '3333', token: 't', session_keepalive_only_connected: false });
stub('controllers/helper/core/sessions.js', { listDevices: async () => [] });
const { isEligible, resolveBaseUrl } = require(resolver('jobs/sessionKeepAlive.js'));
assert.equal(resolveBaseUrl(), 'http://127.0.0.1:3333');
const sessao = (status, state) => ({ session: 's', sessionkey: 'k', status, state, attempts_start: 0 });
assert.equal(isEligible(sessao('CONNECTED', 'CONNECTED')), true, 'conectada: o /start é no-op, segue elegível');
assert.equal(isEligible(sessao('disconnected', 'DISCONNECTED')), true, 'caiu de passagem: religa sem QR');
assert.equal(isEligible(sessao('notLogged', 'DISCONNECTED')), false, 'LOGOUT / QR que ninguém leu: não religa');
assert.equal(isEligible(sessao('AUTH_FAIL', 'DISCONNECTED')), false, 'recusada pelo WhatsApp: não religa');
console.log('ok   keepalive: loopback e sem religar sessão que precisa de QR');

// 3) engine: o /start guarda os webhooks gravados e o LOGOUT vira `notLogged`.
const gravados = { session: 's', wh_connect: 'https://zap/wh', wh_status: 'https://zap/wh', wh_message: 'https://zap/wh', wh_qrcode: 'https://zap/wh' };
const upserts = [];
const updates = [];
let handlers = {};
const pacote = require.resolve('whatsapp-web.js', { paths: [raiz] });
require.cache[pacote] = { id: pacote, filename: pacote, loaded: true, exports: {
  Client: function () { handlers = {}; this.on = (ev, fn) => { handlers[ev] = fn; }; this.initialize = async () => {}; this.destroy = async () => {}; },
  LocalAuth: function () {},
} };
stub('config.js', { sequelize: {} });
stub('Models/device.js', () => ({
  findOne: async ({ where }) => (where.session === 's' ? gravados : null),
  upsert: async (p) => { upserts.push(p); },
  update: async (p) => { updates.push(p); return [1]; },
}));
stub('Models/user.js', () => ({ findOne: async () => null }));
stub('controllers/helper/core/systemUser.js', { getOrCreateSystemUser: async () => ({ id: 1 }) });
stub('controllers/SessionsController.js', { addInfoSession() {} });
stub('controllers/helper/core/sessions.js', { getInjectedClient: () => null, removeClientFromMemory() {} });
stub('controllers/EventsController.js', { receiveMessage() {}, statusMessage() {}, StatusMessage() {} });
stub('controllers/WebhooksController.js', {});
stub('engines/helper/wweb.js', { getClientOptions: () => ({}) });
stub('engines/helper/perfilChrome.js', { limparRestauracaoDeAbas: () => false });
const WhatsappWebJS = require(resolver('engines/WhatsappWebJS.js'));
const espera = async (ok) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); };

(async () => {
  global.__wwebInit = {};
  WhatsappWebJS.start({ headers: { sessionkey: 'k' }, body: { session: 's' } }, null, 's').catch(() => {});
  await espera(() => upserts.length === 1 && handlers.disconnected);
  assert.equal(upserts[0].wh_message, 'https://zap/wh', '/start sem wh_*: mantém o webhook gravado');
  assert.equal(upserts[0].wh_connect, 'https://zap/wh');
  console.log('ok   /start sem webhooks (keepalive): mantém os gravados');

  WhatsappWebJS.start({ headers: { sessionkey: 'k' }, body: { session: 'nova', wh_message: 'https://zap/novo' } }, null, 'nova').catch(() => {});
  await espera(() => upserts.length === 2);
  assert.equal(upserts[1].wh_message, 'https://zap/novo', 'quem manda o webhook, vale o que mandou');
  console.log('ok   /start com webhooks (zap): grava os que vieram');

  handlers.disconnected('LOGOUT');
  assert.equal(updates.at(-1).status, 'notLogged', 'LOGOUT: aguardando QR');
  handlers.disconnected('Max qrcode retries reached');
  assert.equal(updates.at(-1).status, 'notLogged', 'QR que ninguém leu: aguardando QR');
  handlers.disconnected('NAVIGATION');
  assert.equal(updates.at(-1).status, 'disconnected', 'queda de passagem: o keepalive religa');
  console.log('ok   disconnected: LOGOUT e QR esgotado ficam notLogged; o resto, disconnected');

  console.log('reconexao-sessao: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
