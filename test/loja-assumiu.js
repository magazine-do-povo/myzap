/**
 * Loja assumiu a conversa: o atendente digitando no WhatsApp tem de PAUSAR a
 * IA para aquele cliente — e só ele.
 *
 * Caso real (06/09/2026): toda mensagem enviada pela loja (bot, confirmação
 * de pedido pela API e o atendente) era gravada no histórico do número da
 * PRÓPRIA loja (message.from), então humanoFalouRecentemente(cliente) nunca
 * achava nada e o bot seguia respondendo em cima do atendente. Aqui:
 *  1. contextBuilder usa o destinatário quando a mensagem é fromMe;
 *  2. processFromMe ignora eco do bot e texto que saiu pela API, e registra
 *     o atendente humano no número do cliente (avisando o agente só como contexto);
 *  3. bloqueado por humano na conversa, o decisionEngine não responde nem
 *     manda a mensagem padrão.
 * Sem banco e sem WhatsApp: bordas por require.cache, como o smoke.
 *
 * Uso: node test/loja-assumiu.js  (exit 0 = ok, 1 = quebrou)
 */
const http = require('http');
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const registrado = { humano: [], sendDefault: [], sendText: [] };
let humanoRecente = false;
stub('controllers/helper/events/chatHistory.js', {
  jaInteragiuHoje: async () => true,
  humanoFalouRecentemente: async () => humanoRecente,
  clientePediuHumano: async () => false,
  marcarPedidoHumano: async () => {},
  registerAssistantMessage: async () => {},
  registerAgentMessage: async ({ numero, text }) => { registrado.humano.push({ numero, text }); },
  isRecentAssistantEcho: async ({ text }) => text === 'ECO DO BOT',
  jaEnvieiMensagemPadraoHoje: async () => false,
});
stub('controllers/helper/events/messageSender.js', {
  startTyping: async () => {}, startRecording: async () => {}, stopTyping: async () => {},
  sendText: async ({ text }) => { registrado.sendText.push(text); return true; },
  sendPtt: async () => true, sendFileFromUrl: async () => true,
});
stub('controllers/helper/ia/defaultMessageService.js', { sendDefault: async (a) => { registrado.sendDefault.push(a?.motivo); } });
stub('controllers/helper/ia/empresaIA.js', { processarMensagem: async () => null });
stub('controllers/helper/ia/companyLookup.js', { verifyCompany: async () => ({ ia_ativa: true, api_url: null }) });
stub('controllers/helper/events/events.js', { montarPayload: async () => ({}), isPermitido: () => true });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));

let falhas = 0;
const caso = (nome, fn) => Promise.resolve().then(fn).then(() => console.log(`ok   ${nome}`)).catch((e) => { falhas += 1; console.log(`FAIL ${nome}: ${e.message}`); });

(async () => {
  const { build } = require(resolver('controllers/helper/ia/contextBuilder.js'));
  const req = { headers: { sessionkey: 'k' } };
  await caso('mensagem do cliente: numero = quem mandou', async () => {
    const c = await build({ message: { from: 'cliente@lid', to: 'loja@c.us', fromMe: false, body: 'oi' }, session: 's', client: {}, req });
    assert.strictEqual(c.numero, 'cliente@lid');
  });
  await caso('mensagem da loja (fromMe): numero = o cliente destinatário', async () => {
    const c = await build({ message: { from: 'loja@c.us', to: 'cliente@lid', fromMe: true, body: 'já vai sair' }, session: 's', client: {}, req });
    assert.strictEqual(c.numero, 'cliente@lid');
  });

  const Outbound = require(resolver('controllers/helper/events/outboundMessageProcessor.js'));
  const { registerIAResponse } = require(resolver('controllers/helper/ia/iaResponseCache.js'));
  const fromMe = (body) => Outbound.processFromMe({ message: { body, fromMe: true }, session: 's', sessionkey: 'k', numero: 'cliente@lid', socketManager: {} });
  await caso('eco do bot não vira humano', async () => { const r = await fromMe('ECO DO BOT'); assert.strictEqual(r.humano, false); assert.strictEqual(registrado.humano.length, 0); });
  await caso('texto que saiu pela API (confirmação de pedido) não vira humano', async () => {
    registerIAResponse('🏬 *Vaqueiro Pizzaria* Olá *Leticia*, muito obrigado pela sua preferência!');
    const r = await fromMe('🏬 *Vaqueiro Pizzaria* Olá *Leticia*, muito obrigado pela sua preferência!');
    assert.strictEqual(r.humano, false); assert.strictEqual(registrado.humano.length, 0);
  });
  await caso('atendente digitou: registra no número do CLIENTE', async () => {
    const r = await fromMe('Oi Leticia, aqui é o Vaqueiro, sua pizza sai em 20 min');
    assert.strictEqual(r.humano, true);
    assert.deepStrictEqual(registrado.humano.map((h) => h.numero), ['cliente@lid']);
  });
  const { registerSystemMedia } = require(resolver('controllers/helper/ia/iaResponseCache.js'));
  const midiaFromMe = (type) => Outbound.processFromMe({ message: { body: '', type, hasMedia: true, fromMe: true }, session: 's', sessionkey: 'k', numero: 'cliente@lid', socketManager: {} });
  await caso('áudio (voz do bot) mandado pelo sistema não vira humano', async () => {
    registerSystemMedia('s', 'cliente@lid'); const antes = registrado.humano.length;
    const r = await midiaFromMe('ptt'); assert.strictEqual(r.humano, false); assert.strictEqual(registrado.humano.length, antes);
  });
  await caso('áudio do ATENDENTE pelo celular (sem envio do sistema) pausa a IA', async () => {
    const antes = registrado.humano.length;
    const r = await midiaFromMe('ptt'); // a marca do sistema foi consumida? não — expira em 2 min; usa outro cliente
    const r2 = await Outbound.processFromMe({ message: { body: '', type: 'ptt', hasMedia: true, fromMe: true }, session: 's', sessionkey: 'k', numero: 'outro@lid', socketManager: {} });
    assert.strictEqual(r2.humano, true); assert.strictEqual(registrado.humano[registrado.humano.length - 1].numero, 'outro@lid');
    assert.ok(/ptt do atendente/.test(registrado.humano[registrado.humano.length - 1].text));
  });
  await caso('evento sem texto e sem mídia (ack/protocolo) não registra nada', async () => { const antes = registrado.humano.length; await fromMe(''); assert.strictEqual(registrado.humano.length, antes); });

  // decisionEngine real: humano falou há pouco -> bloqueia sem chamar o agente e sem saudação
  process.env.IA_PROVIDER = 'agente';
  let chamadasAgente = 0;
  const servidor = http.createServer((rq, rs) => { chamadasAgente += 1; rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ resposta: 'não devia' })); });
  await new Promise((r) => servidor.listen(0, r));
  process.env.AGENT_URL = `http://127.0.0.1:${servidor.address().port}`; process.env.AGENT_AUTH_TOKEN = 'x';
  const { process: processar } = require(resolver('controllers/helper/ia/decisionEngine.js'));
  const msg = { from: 'cliente@lid', body: 'e aí, saiu?', fromMe: false };
  const empresa = { ia_ativa: true, mensagem_padrao: 'Olá! Bem-vindo.', api_url: null };
  humanoRecente = true;
  await caso('humano na conversa: bot não responde e NÃO manda a mensagem padrão', async () => {
    await processar({ message: msg, client: {}, session: 's', sessionkey: 'k', numero: 'cliente@lid', msgBody: msg.body, empresa, payload: {}, responseDefault: async () => {} });
    assert.strictEqual(chamadasAgente, 0, 'agente foi chamado');
    assert.deepStrictEqual(registrado.sendDefault, [], 'mandou mensagem padrão');
    assert.deepStrictEqual(registrado.sendText, [], 'respondeu');
  });
  humanoRecente = false;
  await caso('sem humano recente: volta a passar pelos guards normalmente', async () => {
    await processar({ message: msg, client: {}, session: 's', sessionkey: 'k', numero: 'cliente@lid', msgBody: msg.body, empresa, payload: {}, responseDefault: async () => {} });
    assert.ok(chamadasAgente >= 1, 'agente não foi chamado');
  });
  servidor.close();
  console.log(falhas ? `\n${falhas} caso(s) quebrado(s)` : '\nloja assumiu: tudo ok');
  process.exit(falhas ? 1 : 0);
})();
