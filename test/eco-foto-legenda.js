/**
 * Foto que o agente manda (com legenda: nome e preço da peça) não é a equipe assumindo.
 * Sonhare (25/09/2026): o eco da foto trazia a legenda como texto, caía no caminho do
 * texto e virava "atendente digitou" — a IA pausava ("Guard bloqueou! agente_recente").
 *
 * Uso: node test/eco-foto-legenda.js  (exit 0 = ok, 1 = quebrou)
 */
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
stub('controllers/helper/ia/agenteClient.js', { ehMensagemDoSistema: async () => false, atender: async () => null });
globalThis.process.env.IA_PROVIDER = 'agente';

const { registerSystemMedia } = require(resolver('controllers/helper/ia/iaResponseCache.js'));
const Outbound = require(resolver('controllers/helper/events/outboundMessageProcessor.js'));
const eco = (numero, message) => Outbound.processFromMe({ message, session: 's', sessionkey: 's', numero, socketManager: null });

(async () => {
  const A = '5544999990001@c.us', B = '5544999990002@c.us';
  registerSystemMedia('s', A); // o agente acabou de mandar a foto da peça para A
  let r = await eco(A, { type: 'image', hasMedia: true, body: 'SOFÁ NOROEGA CANTO 2,10X2,10 — R$ 2.990,00' });
  assert.equal(r.humano, false, 'eco da foto do agente com legenda não é a equipe');
  assert.equal(pausas.length, 0, 'não pausa a IA');
  console.log('ok   foto do agente com legenda: não pausa a IA');

  r = await eco(B, { type: 'image', hasMedia: true, body: 'olha essa aqui' });
  assert.equal(r.humano, true, 'foto com legenda da equipe (sistema não mandou nada a B) pausa');
  assert.deepEqual(pausas.map((p) => p.numero), [B]);
  console.log('ok   foto com legenda que a EQUIPE mandou: pausa (como era)');

  r = await eco(A, { type: 'chat', hasMedia: false, body: 'Oi! Aqui é a Ana da loja' });
  assert.equal(r.humano, true, 'texto da equipe logo depois da foto do agente ainda pausa');
  console.log('ok   texto da equipe depois da foto do agente: pausa');

  // Sessão reconectada pelo QR sincroniza o histórico: mensagem da loja de horas atrás.
  const antes = pausas.length;
  r = await eco(B, { type: 'chat', hasMedia: false, body: 'Seu pedido 9617 está separado!', timestamp: Math.floor(Date.now() / 1000) - 3 * 3600 });
  assert.equal(r.humano, false, 'histórico sincronizado não é a equipe digitando agora');
  assert.equal(pausas.length, antes, 'não pausa a IA');
  r = await eco(B, { type: 'chat', hasMedia: false, body: 'Oi, aqui é a Ana', timestamp: Math.floor(Date.now() / 1000) - 5 });
  assert.equal(r.humano, true, 'mensagem de agora da equipe continua pausando');
  console.log('ok   histórico que a sessão nova sincroniza: não pausa; equipe digitando agora: pausa');
  console.log('eco-foto-legenda: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
