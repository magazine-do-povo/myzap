/**
 * Cada sessão com o agente do SEU produto.
 *
 * A VPS tem AGENT_URL global (o agente do ClickExpress). A sessão do agente do
 * ClickJoias grava api_url = API do ClickJoias; sem esta regra, o global
 * ganhava e o atendente de delivery respondia os clientes de uma joalheria.
 *
 * Uso: node test/agente-por-produto.js  (exit 0 = ok)
 */
const http = require('http');
const path = require('path');
const assert = require('assert');
const raiz = path.join(__dirname, '..');
const f = require.resolve(path.join(raiz, 'util/customLogger.js'));
require.cache[f] = { id: f, filename: f, loaded: true, exports: new Proxy({}, { get: () => () => {} }) };

let falhar = false;
const api = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (falhar) { res.statusCode = 503; return res.end('{}'); }
  const ok = req.url.startsWith('/agente/myzap/agente-config/cjia123');
  res.statusCode = ok ? 200 : 404;
  res.end(JSON.stringify(ok ? { result: { agent_url: 'https://agente-clickjoias.jztech.com.br', agent_auth_token: 'tk-joias', ia_ativa: true } } : {}));
});

let falhas = 0;
const caso = (nome, fn) => Promise.resolve().then(fn).then(() => console.log(`ok   ${nome}`)).catch((e) => { falhas += 1; console.log(`FAIL ${nome}: ${e.message}`); });

api.listen(0, async () => {
  process.env.AGENT_URL = 'https://agente-clickexpress.jztech.com.br';
  process.env.AGENT_AUTH_TOKEN = 'tk-express';
  const { _resolverConfig, iaAtivaRemota } = require(path.join(raiz, 'controllers/helper/ia/agenteClient.js'));
  const apiJoias = `http://127.0.0.1:${api.address().port}/agente`;

  await caso('sessão sem api_url: agente global (ClickExpress, como sempre)', async () => {
    assert.strictEqual((await _resolverConfig('loja1', null)).url, 'https://agente-clickexpress.jztech.com.br');
  });
  await caso('sessão do ClickExpress com api_url: continua no global', async () => {
    const c = await _resolverConfig('loja2', 'https://api-clickexpress.jztech.com.br/public');
    assert.strictEqual(c.token, 'tk-express');
    // É assim que está gravado em produção para 6 lojas (com :443 e caminho de pedido).
    const c2 = await _resolverConfig('loja3', 'https://api-clickexpress.jztech.com.br:443/public//api/pedido-venda-ia/4');
    assert.strictEqual(c2.token, 'tk-express');
  });
  await caso('sessão do ClickJoias: agente do ClickJoias, pela API dela', async () => {
    const c = await _resolverConfig('cjia123', apiJoias);
    assert.strictEqual(c.url, 'https://agente-clickjoias.jztech.com.br');
    assert.strictEqual(c.token, 'tk-joias');
    assert.strictEqual(await iaAtivaRemota('cjia123', apiJoias), true);
  });
  await caso('API do ClickJoias fora do ar: silêncio, NUNCA o agente do ClickExpress', async () => {
    falhar = true;
    assert.strictEqual(await _resolverConfig('cjia999', apiJoias), null);
  });
  api.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nagente por produto: tudo ok');
  process.exit(falhas ? 1 : 0);
});
