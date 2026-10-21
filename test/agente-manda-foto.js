/**
 * O agente pode mandar FOTO (a peça que o cliente perguntou): a resposta traz
 * midias [{url, legenda}] e o MyZap envia cada uma depois do texto.
 * Só https, no máximo 3.   Uso: node test/agente-manda-foto.js
 */
const http = require('http');
const path = require('path');
const assert = require('assert');
const raiz = path.join(__dirname, '..');
const f = require.resolve(path.join(raiz, 'util/customLogger.js'));
require.cache[f] = { id: f, filename: f, loaded: true, exports: new Proxy({}, { get: () => () => {} }) };

const agente = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    resposta: 'Olha ela aqui:',
    midias: [
      { url: 'https://api.loja.com/previa/imagem/loja/1', legenda: 'Brinco argola — R$ 125,00' },
      { url: 'http://inseguro/2', legenda: 'x' },
      { url: 'https://a/3' }, { url: 'https://a/4' }, { url: 'https://a/5' },
    ],
  }));
});
agente.listen(0, async () => {
  process.env.AGENT_URL = `http://127.0.0.1:${agente.address().port}`;
  process.env.AGENT_AUTH_TOKEN = 't';
  const AgenteClient = require(path.join(raiz, 'controllers/helper/ia/agenteClient.js'));
  const r = await AgenteClient.atender({ sessionkey: 'k', numero: '5544999990000@c.us', texto: 'tem foto?' });
  try {
    assert.strictEqual(r.texto, 'Olha ela aqui:');
    assert.strictEqual(r.midias.length, 3, 'no máximo 3');
    assert.ok(r.midias.every((m) => m.url.startsWith('https://')), 'só https');
    assert.strictEqual(r.midias[0].legenda, 'Brinco argola — R$ 125,00');
    console.log('ok   midias: só https, até 3, com legenda\n\nagente manda foto: tudo ok');
    process.exit(0);
  } catch (e) {
    console.log(`FAIL ${e.message}`);
    process.exit(1);
  } finally { agente.close(); }
});
