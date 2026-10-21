/**
 * Cobrança automática no MESMO número não pode pausar a IA.
 *
 * O agente do ClickJoias atende numa sessão própria do número da loja, e a
 * cobrança (Cobra Rápido) sai pelo computador da loja, no mesmo número. Vista
 * da sessão do agente, cada cobrança é fromMe — e o processFromMe tratava como
 * a equipe assumindo: pausava a IA justo para quem acabou de ser cobrado.
 * Agora ele pergunta ao agente antes; { sistema: true } = não pausa.
 *
 * Cobre também o que não pode mudar: agente que não conhece o campo (o do
 * ClickExpress) e agente fora do ar continuam pausando.
 *
 * Uso: node test/fromme-cobranca.js  (exit 0 = ok, 1 = quebrou)
 */
const http = require('http');
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const pausas = [];
stub('controllers/helper/events/chatHistory.js', {
  registerAgentMessage: async ({ numero, text }) => { pausas.push({ numero, text }); },
  isRecentAssistantEcho: async () => false,
});
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));

// Agente de mentira: responde conforme o texto.
let recebidos = [];
const agente = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    const d = JSON.parse(corpo);
    recebidos.push(d);
    res.setHeader('Content-Type', 'application/json');
    if (d.texto.startsWith('Olá Islaine, constam 2 parcela')) return res.end(JSON.stringify({ silencio: true, sistema: true, motivo: 'mensagem_do_sistema' }));
    // Como o agente de verdade: a cobrança é achada pelo TELEFONE — sem celular, não reconhece.
    if (d.texto.startsWith('Oi Paulo, identificamos 5 parcela') && d.celular === '5544999887766') return res.end(JSON.stringify({ silencio: true, sistema: true, motivo: 'mensagem_do_sistema' }));
    if (d.texto === 'AGENTE LENTO') return setTimeout(() => res.end('{}'), 9000);
    res.end(JSON.stringify({ silencio: true, motivo: 'humano_atendendo' }));
  });
});

let falhas = 0;
const caso = (nome, fn) => Promise.resolve().then(fn).then(() => console.log(`ok   ${nome}`)).catch((e) => { falhas += 1; console.log(`FAIL ${nome}: ${e.message}`); });

agente.listen(0, async () => {
  process.env.IA_PROVIDER = 'agente';
  process.env.AGENT_URL = `http://127.0.0.1:${agente.address().port}`;
  process.env.AGENT_AUTH_TOKEN = 't';
  const Outbound = require(resolver('controllers/helper/events/outboundMessageProcessor.js'));
  const fromMe = (body) => Outbound.processFromMe({ message: { body, fromMe: true }, session: 's', sessionkey: 'k', numero: '554491478860@c.us', socketManager: {} });

  await caso('cobrança automática: não pausa', async () => {
    const r = await fromMe('Olá Islaine, constam 2 parcela(s) em atraso, totalizando R$ 225,60');
    assert.strictEqual(r.humano, false);
    assert.strictEqual(pausas.length, 0);
    assert.strictEqual(recebidos[0].origem, 'humano');
    assert.strictEqual(recebidos[0].numero, '554491478860');
  });
  await caso('equipe digitou: pausa (agente responde silêncio comum)', async () => {
    const r = await fromMe('Oi Islaine, aqui é a Lucimar, pode passar na loja');
    assert.strictEqual(r.humano, true);
    assert.strictEqual(pausas.length, 1);
    assert.strictEqual(recebidos.length, 2, 'o agente recebe o texto UMA vez (antes era enviado de novo depois da pausa)');
  });
  await caso('agente não responde a tempo: na dúvida, pausa', async () => {
    const r = await fromMe('AGENTE LENTO');
    assert.strictEqual(r.humano, true);
    assert.strictEqual(pausas.length, 2);
  });
  // Sonhare, 28/09: todo cliente chega como @lid; a cobrança ia sem telefone e pausava a IA.
  await caso('cobrança para cliente @lid: vai com o celular real e não pausa', async () => {
    const client = { getContactLidAndPhone: async ([lid]) => [{ lid, pn: '5544999887766@c.us' }] };
    const r = await Outbound.processFromMe({
      message: { body: 'Oi Paulo, identificamos 5 parcela(s) em atraso totalizando *1.981,65*', fromMe: true },
      session: 's', sessionkey: 'k', numero: '32702032003235@lid', socketManager: {}, client,
    });
    assert.strictEqual(recebidos.at(-1).celular, '5544999887766');
    assert.strictEqual(recebidos.at(-1).numero, '32702032003235');
    assert.strictEqual(r.humano, false);
    assert.strictEqual(pausas.length, 2, 'não pausou');
  });

  agente.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok');
  process.exit(falhas ? 1 : 0);
});
