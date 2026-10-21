/**
 * QR morto (Sonhare, 25/09/2026): o cliente desistiu (5 QRs / 10 min), o Chrome
 * fechou, e o /start e o status seguiam devolvendo o QR do banco — lido, o celular
 * dizia "Não foi possível conectar o dispositivo" e nem "Gerar novo QR" gerava outro.
 * Agora o QR do banco só vale com o start em andamento (trava global.__wwebInit).
 *
 * Uso: node test/qr-vivo.js  (exit 0 = ok, 1 = quebrou)
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
const pacotes = {
  'whatsapp-web.js': { MessageMedia: class {}, Location: class {}, Poll: class {} },
  'mime-types': { lookup: () => false },
  'async-get-file': async () => {},
  'url-exists': (u, cb) => cb(null, false),
  chalk: new Proxy({}, { get: () => (s) => s }),
  'qrcode-terminal': { generate() {} },
};
const carregar = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido in pacotes ? pacotes[pedido] : carregar.call(this, pedido, ...resto);
};

const QR = 'data:image/png;base64,QRDOBANCO';
const device = { session: 's', status: 'qrCode', state: 'QRCODE', qrCode: QR, urlCode: '2@abc' };
const iniciados = [];
stub('config.js', { sequelize: {}, engine: '1' });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('util/cache.js', { get: async () => null, set: async () => {} });
stub('Models/company.js', () => ({}));
stub('Models/device.js', () => ({}));
stub('Models/deviceCompany.js', () => ({}));
stub('controllers/helper/ia/iaResponseCache.js', { registerSystemMedia: () => {} });
stub('jobs/sessionHealthCheck.js', { registerSendSuccess() {}, registerSendFailure() {}, isClientHealthy: async () => ({ healthy: true }) });
stub('controllers/helper/events/mediaDecryptor.js', {});
stub('controllers/helper/core/sessions.js', { getDevice: async () => device, getInjectedClient: () => null });
stub('engines/WhatsappWebJS.js', { start: (req, res, session) => { iniciados.push(session); } });
stub('controllers/SessionsController.js', { getClient: async () => device });

const { qrVivo } = require(resolver('controllers/helper/core/qrVivo.js'));
const mensagens = require(resolver('functions/WhatsappWebJS/helper/mensagens.js'));

const resposta = () => {
  const res = { statusCode: 200, corpo: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = res.send = (b) => { res.corpo = b; return res; };
  return res;
};

(async () => {
  global.__wwebInit = {};
  assert.equal(qrVivo('s'), false, 'sem start em andamento, o QR do banco é morto');
  global.__wwebInit.s = Date.now() - 12 * 60 * 1000;
  assert.equal(qrVivo('s'), false, 'trava vencida (mais de 11 min) não conta');
  global.__wwebInit.s = Date.now();
  assert.equal(qrVivo('s'), true, 'start em andamento: o QR vale');
  console.log('ok   qrVivo: só com o start em andamento');

  // /start com o Chrome esperando: devolve o QR do banco, não sobe outro
  let res = resposta();
  await mensagens.startSession({ body: { session: 's' }, headers: {} }, res);
  assert.equal(res.corpo.qrCode, QR);
  assert.equal(iniciados.length, 0, 'não sobe um 2º Chrome em cima do que espera a leitura');
  console.log('ok   /start com Chrome esperando: devolve o QR vivo');

  // /start depois que o Chrome desistiu: gera outro, sem devolver o morto
  delete global.__wwebInit.s;
  res = resposta();
  await mensagens.startSession({ body: { session: 's' }, headers: {} }, res);
  assert.equal(res.corpo.qrCode, undefined, 'não devolve o QR morto');
  assert.deepEqual(iniciados, ['s'], 'sobe o engine para um QR novo');
  assert.equal(res.corpo.status, 'INITIALIZING');
  console.log('ok   /start com QR morto: gera outro');

  // status: o controller de verdade, com o mesmo device
  delete require.cache[resolver('controllers/SessionsController.js')];
  const Sessions = require(resolver('controllers/SessionsController.js'));
  const pedir = async () => { const r = resposta(); await Sessions.getConnectionStatus({ body: { session: 's' }, headers: { sessionkey: 's' } }, r); return r.corpo; };
  global.__wwebInit.s = Date.now();
  let st = await pedir();
  assert.ok(String(st.qrCode || st.data?.qrCode || '').includes('QRDOBANCO') || st.state === 'QRCODE', 'status com Chrome esperando mostra o QR');
  delete global.__wwebInit.s;
  st = await pedir();
  assert.equal(st.status, 'disconnected');
  assert.equal(st.qrCode, undefined, 'status não entrega QR morto');
  console.log('ok   status: QR morto vira "disconnected"');
  console.log('qr-vivo: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
