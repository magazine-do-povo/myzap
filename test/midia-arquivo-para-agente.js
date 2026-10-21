/**
 * Foto, figurinha e PDF do cliente chegam ao agente COMO ARQUIVO (base64),
 * não só como o marcador "[imagem]" — o Gemini lê imagem e PDF, como já ouvia
 * o áudio. O marcador continua no texto (o outro teste, midia-para-agente, cobre).
 *
 * Uso: node test/midia-arquivo-para-agente.js  (exit 0 = ok)
 */
const http = require('http');
const path = require('path');
const assert = require('assert');
const raiz = path.join(__dirname, '..');
const stub = (rel, exports) => { const f = require.resolve(path.join(raiz, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

let tamanho = 1000;
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('controllers/helper/events/mediaDecryptor.js', { decryptFile: async () => Buffer.alloc(tamanho, 7), detectEngine: async () => 'wwebjs' });

let falhas = 0;
const caso = (nome, fn) => Promise.resolve().then(fn).then(() => console.log(`ok   ${nome}`)).catch((e) => { falhas += 1; console.log(`FAIL ${nome}: ${e.message}`); });

(async () => {
  process.env.IA_PROVIDER = 'agente';
  const { processMidia, MAX_MIDIA } = require(path.join(raiz, 'controllers/helper/ia/midiaProcessor.js'));
  const rodar = async (m, extra = {}) => { await processMidia({ message: m, client: {}, numero: '5544999990000@c.us', empresa: { ia_ativa: true }, ...extra }); return m; };

  await caso('foto: vai o arquivo', async () => {
    const m = await rodar({ type: 'image', mimetype: 'image/jpeg' });
    assert.ok(m.agenteMidiaBase64); assert.strictEqual(m.agenteMidiaMime, 'image/jpeg');
  });
  await caso('figurinha: vai como webp', async () => {
    const m = await rodar({ type: 'sticker' });
    assert.strictEqual(m.agenteMidiaMime, 'image/webp');
  });
  await caso('comprovante em PDF: vai', async () => {
    const m = await rodar({ type: 'document', mimetype: 'application/pdf' });
    assert.strictEqual(m.agenteMidiaMime, 'application/pdf');
  });
  await caso('documento do Word: não vai (o modelo não lê)', async () => {
    const m = await rodar({ type: 'document', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    assert.strictEqual(m.agenteMidiaBase64, undefined);
  });
  await caso('grupo: não vai', async () => {
    const m = await rodar({ type: 'image' }, { numero: '123@g.us' });
    assert.strictEqual(m.agenteMidiaBase64, undefined);
  });
  await caso('IA da empresa desligada: não baixa', async () => {
    const m = await rodar({ type: 'image' }, { empresa: { ia_ativa: false } });
    assert.strictEqual(m.agenteMidiaBase64, undefined);
  });
  await caso('arquivo grande demais: segue só o marcador', async () => {
    tamanho = MAX_MIDIA + 1;
    const m = await rodar({ type: 'image' });
    assert.strictEqual(m.agenteMidiaBase64, undefined);
    tamanho = 1000;
  });

  // e o corpo que chega ao agente leva o arquivo
  let recebido = null;
  const agente = http.createServer((req, res) => { let c = ''; req.on('data', (d) => (c += d)); req.on('end', () => { recebido = JSON.parse(c); res.setHeader('Content-Type', 'application/json'); res.end('{"resposta":"vi a foto"}'); }); });
  await new Promise((r) => agente.listen(0, r));
  process.env.AGENT_URL = `http://127.0.0.1:${agente.address().port}`;
  process.env.AGENT_AUTH_TOKEN = 't';
  delete require.cache[require.resolve(path.join(raiz, 'controllers/helper/ia/agenteClient.js'))];
  const AgenteClient = require(path.join(raiz, 'controllers/helper/ia/agenteClient.js'));
  await caso('o agente recebe midia_base64 + midia_mime junto do marcador', async () => {
    const r = await AgenteClient.atender({ sessionkey: 'k', numero: '5544999990000@c.us', texto: '[imagem] é esse?', midiaBase64: 'QUJD', midiaMime: 'image/jpeg' });
    assert.strictEqual(recebido.midia_base64, 'QUJD');
    assert.strictEqual(recebido.midia_mime, 'image/jpeg');
    assert.strictEqual(recebido.texto, '[imagem] é esse?');
    assert.strictEqual(r.texto, 'vi a foto');
  });
  agente.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nmídia como arquivo: tudo ok');
  process.exit(falhas ? 1 : 0);
})();
