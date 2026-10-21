/**
 * Primeiro contato: "oi" leva só a mensagem padrão; pedido/pergunta leva a padrão E a IA.
 * Rajada: o que chega enquanto a padrão sai só vai para a IA se tiver conteúdo.
 * Capucho (25/09/2026 17:28): fornecedor mandou "Boa tarde! Já estão valendo as ofertas…" e o
 * panfleto no mesmo segundo. O texto levou a mensagem padrão + cardápio; a imagem ficou na fila
 * do processingLock, foi drenada e a IA respondeu "Não consigo visualizar imagens por aqui!".
 * decisionEngine e processingLock REAIS; guards, envio e agente por require.cache.
 *
 * Uso: node test/rajada-primeiro-contato.js  (exit 0 = ok, 1 = quebrou)
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
let lojaJaFalou = false;
const atendidas = [];
let durantePadrao = null; // chega outra mensagem enquanto a padrão está saindo
stub('controllers/helper/ia/guards.js', {
  checkGroupMessage: livre, checkCompanyEnabled: livre, checkIaEnabled: livre,
  checkHumanRequest: livre, checkClientRequestedHuman: livre, checkRecentHuman: livre,
  checkFirstContactToday: async () => (lojaJaFalou ? { shouldBlock: false } : { shouldBlock: true, reason: 'primeiro_contato' }),
});
stub('controllers/helper/ia/defaultMessageService.js', {
  sendDefault: async () => { if (durantePadrao) await durantePadrao(); lojaJaFalou = true; return true; },
});
stub('controllers/helper/ia/empresaIA.js', {});
stub('controllers/helper/ia/agenteClient.js', { atender: async (a) => { atendidas.push(a.texto); return { texto: 'resposta da IA' }; }, falar: async () => null });
stub('controllers/helper/events/messageSender.js', new Proxy({}, { get: () => async () => true }));
stub('controllers/helper/events/chatHistory.js', new Proxy({}, { get: () => async () => null }));
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('controllers/helper/ia/iaResponseCache.js', { registerIAResponse() {}, registerSystemMedia() {} });

globalThis.process.env.IA_PROVIDER = 'agente';
const DecisionEngine = require(resolver('controllers/helper/ia/decisionEngine.js'));
const numero = '116231042543646@lid';
const empresa = { mensagem_padrao: 'Olá! Cardápio: https://loja', ia_ativa: true };
const msg = (texto) => DecisionEngine.process({
  message: { body: texto, from: numero, type: 'chat', _data: {} },
  client: { getContactById: async () => ({ pushname: 'Cristiano' }) },
  session: 'CapuchoLanches', sessionkey: 'CapuchoLanches', numero, msgBody: texto,
  empresa, payload: {}, responseDefault: async () => {},
});
const drenar = () => new Promise((r) => setTimeout(r, 50));

const { ehSoCumprimento } = require(resolver('controllers/helper/ia/primeiroContato.js'));
const nova = () => { lojaJaFalou = false; atendidas.length = 0; };
let n = 0;
const outro = () => `55119${String(++n).padStart(8, '0')}@lid`;
const msgDe = (num, texto) => DecisionEngine.process({
  message: { body: texto, from: num, type: 'chat', _data: {} },
  client: { getContactById: async () => ({ pushname: 'Cliente' }) },
  session: 'CapuchoLanches', sessionkey: 'CapuchoLanches', numero: num, msgBody: texto,
  empresa, payload: {}, responseDefault: async () => {},
});

(async () => {
  // frases reais do estudo de 25/09 (298 primeiros contatos)
  for (const f of ['oi', 'Ola boa noite', 'Oiii nega / Boa tarde', 'Boa noite, tudo bem?', 'Manda o cardápio por favor', 'Qual link 🔗', '[imagem]', '[vídeo] [vídeo]', 'boa noite pessoal 😄'])
    assert.ok(ehSoCumprimento(f), `devia ser só cumprimento: "${f}"`);
  for (const f of ['Boa noite gostaria de pedir dois x salada completo para entregar.', 'Quero fazer um pedido', 'Até que horas vocês entregam?', 'Pizza 16 pedaços Borda catupiry', 'Oi, boa noite. Vocês estão pegando free-lancer?', 'Boa noite / Tenho um pedido na fila / Será que demora', 'Comprovante_20260912.pdf'])
    assert.ok(!ehSoCumprimento(f), `devia ter conteúdo: "${f}"`);
  console.log('ok   cumprimento x conteúdo nas frases reais');

  nova(); await msgDe(outro(), 'oi'); await drenar();
  assert.deepEqual(atendidas, [], '"oi" no primeiro contato não vai para a IA');
  console.log('ok   "oi": só a mensagem padrão, a IA espera');

  nova(); await msgDe(outro(), 'Boa noite gostaria de pedir dois x salada completo para entregar.'); await drenar();
  assert.deepEqual(atendidas, ['Boa noite gostaria de pedir dois x salada completo para entregar.'], 'pedido na 1ª mensagem vai para a IA');
  console.log('ok   pedido na primeira mensagem: mensagem padrão e a IA responde (caso do Paulo)');

  nova(); const forn = outro();
  durantePadrao = () => msgDe(forn, '[imagem]');
  await msgDe(forn, 'Boa noite');
  durantePadrao = null; await drenar();
  assert.deepEqual(atendidas, [], 'panfleto (mídia sem texto) chegando durante a padrão não vai para a IA');
  console.log('ok   imagem colada no cumprimento: descartada');

  nova(); const rajada = outro();
  durantePadrao = () => msgDe(rajada, 'quero 2 x-salada');
  await msgDe(rajada, 'Boa noite');
  durantePadrao = null; await drenar();
  assert.deepEqual(atendidas, ['quero 2 x-salada'], '"boa noite" + pedido no mesmo segundo: o pedido vai para a IA');
  console.log('ok   "boa noite" e o pedido em rajada: a IA recebe o pedido');

  nova(); const volta = outro();
  await msgDe(volta, 'oi'); await drenar();
  await msgDe(volta, 'quero pedir um x-bacon'); await drenar();
  assert.deepEqual(atendidas, ['quero pedir um x-bacon'], 'quem escreve de novo depois do "oi" é atendido');
  console.log('ok   depois do "oi", a próxima mensagem vai para a IA');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e.message); process.exit(1); });
