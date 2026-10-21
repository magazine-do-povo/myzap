/**
 * Loja SEM mensagem padrão (agente do ClickJoias): o primeiro "oi" do dia vai para a IA.
 * Sonhare (25/09/2026): o guard primeiro_contato bloqueava a IA, o sendDefault não tinha
 * o que mandar, e como a loja nunca "falava" no dia, toda mensagem era primeiro contato —
 * a IA nunca respondia. Com mensagem padrão (ClickExpress), segue como era.
 *
 * Uso: node test/sem-mensagem-padrao.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => {
  const arquivo = resolver(rel);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};
const livre = async () => ({ shouldBlock: false });
const padroes = [];
const atendidas = [];
stub('controllers/helper/ia/guards.js', {
  checkGroupMessage: livre, checkCompanyEnabled: livre, checkIaEnabled: livre,
  checkHumanRequest: livre, checkClientRequestedHuman: livre, checkRecentHuman: livre,
  // ninguém da loja falou hoje com este número
  checkFirstContactToday: async () => ({ shouldBlock: true, reason: 'primeiro_contato' }),
});
stub('controllers/helper/ia/defaultMessageService.js', { sendDefault: async (p) => { padroes.push(p.motivo); return Boolean(p.mensagemPadrao); } });
stub('controllers/helper/ia/empresaIA.js', {});
stub('controllers/helper/ia/agenteClient.js', { atender: async (a) => { atendidas.push(a.texto); return { texto: 'Oi! Sou a Bia 🙂' }; }, falar: async () => null });
stub('controllers/helper/events/messageSender.js', new Proxy({}, { get: () => async () => true }));
stub('controllers/helper/events/chatHistory.js', new Proxy({}, { get: () => async () => null }));
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('controllers/helper/ia/iaResponseCache.js', { registerIAResponse() {}, registerSystemMedia() {} });

globalThis.process.env.IA_PROVIDER = 'agente';
const DecisionEngine = require(resolver('controllers/helper/ia/decisionEngine.js'));
const cliente = { getContactById: async () => ({ pushname: 'Cliente' }), getContactLidAndPhone: async () => [] };
const oi = (empresa, numero) => DecisionEngine.process({
  message: { body: 'oi', from: `${numero}@c.us`, type: 'chat', _data: {} },
  client: cliente, session: 'cjia', sessionkey: 'cjia', numero: `${numero}@c.us`, msgBody: 'oi',
  empresa, payload: {}, responseDefault: async () => {},
});

(async () => {
  await oi({ mensagem_padrao: '', ia_ativa: true, api_url: 'https://api.clickjoias' }, '5544999990001');
  assert.deepEqual(atendidas, ['oi'], 'sem mensagem padrão, o "oi" vai para o agente');
  assert.deepEqual(padroes, [], 'sem mensagem padrão, nada de primeiro_contato');
  console.log('ok   loja sem mensagem padrão: o primeiro "oi" vai para a IA');

  await oi({ mensagem_padrao: 'Olá! Nosso cardápio: https://loja', ia_ativa: true }, '5544999990002');
  assert.deepEqual(atendidas, ['oi'], 'com mensagem padrão, o primeiro contato NÃO vai para a IA');
  assert.deepEqual(padroes, ['primeiro_contato'], 'com mensagem padrão, ela sai no primeiro contato');
  console.log('ok   loja com mensagem padrão: primeiro contato recebe a mensagem padrão (como era)');
  console.log('sem-mensagem-padrao: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
