/**
 * Cliente @lid (23/09/2026, loja piloto da Celularis): o JID inteiro passa direto pelo
 * checkNumber e pelo buildNumber (dígitos seguem o caminho antigo, com getNumberId e @c.us);
 * o id serializado em `$1` volta como `_serialized`; citar/reagir acham o chat pelo id; e o
 * payload de entrada traz `lid` e, quando o WhatsApp devolve, `pn` — sem nunca travar.
 * Sem WhatsApp e sem node_modules: tudo que não é deste repositório entra por stub.
 *
 * Uso: node test/destino-lid.js  (exit 0 = ok, 1 = quebrou)
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

const momento = () => ({ format: () => '23-09-2026 19:32:09' });
momento.locale = () => {};
momento.unix = momento;
const pacotes = {
  'whatsapp-web.js': { MessageMedia: class {}, Location: class {}, Poll: class {} },
  'mime-types': { lookup: () => false },
  'async-get-file': async () => {},
  'url-exists': (u, cb) => cb(null, false),
  moment: momento,
};
const carregar = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido in pacotes ? pacotes[pedido] : carregar.call(this, pedido, ...resto);
};

const cache = new Map();
const consultados = [];
const enviados = [];
const chats = [];
const LID = '9775882481727@lid';
const cliente = {
  getState: async () => 'CONNECTED',
  getNumberId: async (n) => { consultados.push(n); return { _serialized: `${n}@c.us` }; },
  sendMessage: async (para, texto) => { enviados.push(para); return { id: { $1: `true_${para}_ABC` }, to: para }; },
  getChatById: async (id) => {
    chats.push(id);
    return { fetchMessages: async () => [{ id: { $1: `false_${LID}_3EB0` }, reply: async (t) => ({ id: { $1: 'true_x_R' }, body: t }) }] };
  },
};
stub('controllers/SessionsController.js', { getClient: async () => ({ status: 'CONNECTED', client: cliente }), getSession: () => ({ client: cliente }) });
stub('util/cache.js', { get: async (k) => cache.get(k) ?? null, set: async (k, v) => cache.set(k, v) });
stub('util/logger.js', { error() {}, info() {} });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('config.js', { sequelize: {} });
stub('Models/company.js', () => ({}));
stub('controllers/helper/ia/iaResponseCache.js', { registerSystemMedia: () => {} });
stub('engines/WhatsappWebJS.js', {});
stub('jobs/sessionHealthCheck.js', { registerSendSuccess() {}, registerSendFailure() {}, isClientHealthy: async () => ({ healthy: true }) });
stub('controllers/helper/events/mediaDecryptor.js', {});

const { checkNumber } = require(resolver('middlewares/checkNumber.js'));
const mensagens = require(resolver('functions/WhatsappWebJS/helper/mensagens.js'));
const events = require(resolver('controllers/helper/events/events.js'));

const resposta = () => {
  const res = { statusCode: 200, corpo: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = res.send = (b) => { res.corpo = b; return res; };
  return res;
};
const passar = async (number) => {
  const req = { body: { session: 's', number } };
  let seguiu = false;
  const res = resposta();
  await checkNumber(req, res, () => { seguiu = true; });
  return { req, res, seguiu };
};

(async () => {
  let r = await passar(LID);
  assert.ok(r.seguiu && r.req.body.number === LID, 'JID @lid passa como veio');
  assert.deepStrictEqual(consultados, [], 'JID não chama getNumberId');
  assert.strictEqual(cache.get(LID), LID, 'o próprio JID fica no cache');

  r = await passar('5591985329053');
  assert.ok(r.seguiu && r.req.body.number === '5591985329053', 'telefone segue limpo como sempre');
  assert.deepStrictEqual(consultados, ['5591985329053'], 'telefone continua passando pelo getNumberId');

  cache.clear(); // o buildNumber não pode depender do cache para o JID
  let res = resposta();
  await mensagens.sendText({ body: { session: 's', number: LID, text: 'oi' } }, res);
  assert.strictEqual(enviados.pop(), LID, 'sendText manda para o @lid, sem @c.us');
  assert.strictEqual(res.corpo?.id ?? res.corpo?.messageId ?? null, `true_${LID}_ABC`, 'id da resposta sai do `$1`');

  res = resposta();
  await mensagens.sendText({ body: { session: 's', number: '5599000000000', text: 'oi' } }, res);
  assert.strictEqual(enviados.pop(), '5599000000000@c.us', 'dígitos sem cache: fallback @c.us de sempre');

  res = resposta();
  await mensagens.reply({ body: { session: 's', number: LID, text: 'resposta', messageid: `false_${LID}_3EB0` } }, res);
  assert.strictEqual(chats.pop(), LID, 'citar acha o chat pelo id serializado');
  assert.strictEqual(res.statusCode, 200, 'a mensagem citada é achada pelo `$1`');

  // Entrada: `$1` vira `_serialized`, `lid` e `pn` no payload, cache e as recusas.
  let chamadas = 0;
  const comTelefone = { getContactLidAndPhone: async ([lid]) => { chamadas++; return [{ lid, pn: '5591985329053@c.us' }]; } };
  const msg = (extra = {}) => ({ type: 'chat', body: 'Oi', fromMe: false, from: LID, to: '559133330000@c.us', timestamp: 1790202729,
    id: { $1: `false_${LID}_3EB0`, id: '3EB0', fromMe: false, remote: LID }, ...extra });
  let p = await events.montarPayload(msg(), 's', comTelefone);
  assert.strictEqual(p.id._serialized, `false_${LID}_3EB0`, '`$1` volta como `_serialized`');
  assert.strictEqual(p.data.id._serialized, p.id._serialized, 'data.id também');
  assert.strictEqual(p.lid, LID, 'lid no payload');
  assert.strictEqual(p.pn, '5591985329053', 'pn só com dígitos');
  assert.strictEqual(p.from, '9775882481727', '`from` não muda');
  await events.montarPayload(msg(), 's', comTelefone);
  assert.strictEqual(chamadas, 1, 'segunda mensagem do mesmo contato usa o cache');

  p = await events.montarPayload(msg({ type: 'notification_template', from: '111@lid' }), 's', comTelefone);
  assert.ok(p.lid === '111@lid' && !('pn' in p) && chamadas === 1, 'aviso do sistema não consulta telefone');

  p = await events.montarPayload(msg({ fromMe: true, from: '559133330000@c.us', to: '222@lid' }), 's', comTelefone);
  assert.strictEqual(p.lid, '222@lid', 'no fromMe o lid é o `to`');

  const quebrado = { getContactLidAndPhone: async () => { throw new Error('sem rede'); } };
  p = await events.montarPayload(msg({ from: '333@lid' }), 's', quebrado);
  assert.ok(p.lid === '333@lid' && !('pn' in p), 'erro na consulta: segue sem pn');

  const inicio = Date.now();
  p = await events.montarPayload(msg({ from: '444@lid' }), 's', { getContactLidAndPhone: () => new Promise(() => {}) });
  assert.ok(!('pn' in p) && Date.now() - inicio < 4000, 'consulta que não volta desiste em ~3 s');

  p = await events.montarPayload(msg({ from: '5511999999999@c.us', id: { _serialized: 'false_x_1' } }), 's', comTelefone);
  assert.ok(!('lid' in p) && p.id._serialized === 'false_x_1', 'contato @c.us: nada muda');

  // Download da mídia recebida (24/09/2026): tenta de novo e registra o erro inteiro.
  events.ESPERA_NOVA_TENTATIVA_MS = 5;
  const minificado = () => { const e = new Error('t'); e.name = 't'; return e; };
  let tentativas = 0;
  const ptt = msg({ type: 'ptt', from: '555@lid', downloadMedia: async () => {
    tentativas++;
    if (tentativas < 3) throw minificado();
    return { data: 'T0dnUw==', mimetype: 'audio/ogg; codecs=opus' };
  } });
  p = await events.montarPayload(ptt, 's', comTelefone);
  assert.ok(tentativas === 3 && p.base64 === 'T0dnUw==', 'duas falhas e a terceira baixa: o payload leva o base64');

  tentativas = 0;
  const semMidia = msg({ type: 'image', from: '666@lid', downloadMedia: async () => { tentativas++; throw minificado(); } });
  p = await events.montarPayload(semMidia, 's', comTelefone);
  assert.ok(tentativas === 3 && !p.base64, 'três falhas: segue sem base64, sem travar');
  assert.ok(/^t: t \[/.test(events.descreverErro(minificado())), 'o erro minificado sai com nome, mensagem e pilha');

  // Rota /downloadMedia: a mensagem do fetchMessages vem só com `$1`.
  const idMidia = `false_${LID}_AUD1`;
  let idNoDownload = null;
  let resultado = { data: 'QUJD', mimetype: 'audio/ogg', filename: null, filesize: 3 };
  const guardada = { id: { $1: idMidia, id: 'AUD1', fromMe: false, remote: LID }, hasMedia: true,
    downloadMedia: async function () { idNoDownload = this.id._serialized; if (resultado instanceof Error) throw resultado; return resultado; } };
  cliente.getChatById = async (id) => { chats.push(id); return { fetchMessages: async () => [guardada] }; };
  res = resposta();
  await mensagens.downloadMediaByMessage({ body: { session: 's', messageid: idMidia } }, res);
  assert.ok(res.statusCode === 200 && res.corpo.data === 'QUJD', 'acha pelo `$1` e baixa');
  assert.strictEqual(idNoDownload, idMidia, 'o downloadMedia recebe o id serializado');

  resultado = undefined;
  res = resposta();
  await mensagens.downloadMediaByMessage({ body: { session: 's', messageid: idMidia } }, res);
  assert.ok(res.statusCode === 500 && /não entregou a mídia/.test(res.corpo.message), 'mídia indisponível: erro com detalhe, sem TypeError');

  resultado = minificado();
  res = resposta();
  await mensagens.downloadMediaByMessage({ body: { session: 's', messageid: idMidia } }, res);
  assert.ok(res.statusCode === 500 && /: t: t$/.test(res.corpo.message), 'erro minificado chega ao zap com nome e mensagem');

  console.log('destino-lid: ok');
})().catch((e) => { console.error('destino-lid: QUEBROU —', e.message); process.exit(1); });
