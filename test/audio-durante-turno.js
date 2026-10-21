/**
 * Áudio que chega enquanto a IA responde a mensagem anterior não some.
 *
 * Sonhare, 28/09: "Bom dia" e, logo em seguida, um áudio. O áudio chega com o
 * texto vazio (vai em agenteAudioBase64) e a fila do processingLock só guarda
 * texto — com a IA ocupada, ele era descartado sem rastro. Agora espera o turno
 * em andamento e vai para a IA. Texto continua na fila, como antes.
 * decisionEngine e processingLock REAIS; guards, envio e agente por require.cache.
 *
 * Uso: node test/audio-durante-turno.js  (exit 0 = ok, 1 = quebrou)
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
const atendidas = [];
stub('controllers/helper/ia/guards.js', {
  checkGroupMessage: livre, checkMensagemAtrasada: livre, checkCompanyEnabled: livre, checkIaEnabled: livre,
  checkHumanRequest: livre, checkClientRequestedHuman: livre, checkRecentHuman: livre, checkFirstContactToday: livre,
});
stub('controllers/helper/ia/defaultMessageService.js', { sendDefault: async () => true });
stub('controllers/helper/ia/empresaIA.js', {});
stub('controllers/helper/ia/agenteClient.js', {
  // turno de IA de verdade leva segundos: o áudio chega no meio dele
  atender: async (a) => { atendidas.push(a.audioBase64 ? `[áudio ${a.audioBase64}]` : a.texto); await new Promise((r) => setTimeout(r, 700)); return { texto: 'resposta da IA' }; },
  falar: async () => null,
});
stub('controllers/helper/events/messageSender.js', new Proxy({}, { get: () => async () => true }));
stub('controllers/helper/events/chatHistory.js', new Proxy({}, { get: () => async () => null }));
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('controllers/helper/ia/iaResponseCache.js', { registerIAResponse() {}, registerSystemMedia() {} });

globalThis.process.env.IA_PROVIDER = 'agente';
const DecisionEngine = require(resolver('controllers/helper/ia/decisionEngine.js'));
const numero = '133268590608568@lid';
const chegar = (texto, audio) => DecisionEngine.process({
  message: { body: texto, from: numero, type: audio ? 'ptt' : 'chat', _data: {}, agenteAudioBase64: audio || null },
  client: {}, session: 'cjia', sessionkey: 'cjia', numero, msgBody: texto,
  empresa: { ia_ativa: true }, payload: {}, responseDefault: async () => {},
});

(async () => {
  const bomDia = chegar('Bom dia');
  await new Promise((r) => setTimeout(r, 100)); // a IA já está respondendo o "Bom dia"
  const audio = chegar('', 'T2dnUw');
  await Promise.all([bomDia, audio]);
  assert.deepStrictEqual(atendidas, ['Bom dia', '[áudio T2dnUw]'], `o áudio tem de ir para a IA depois do turno (foi: ${JSON.stringify(atendidas)})`);
  console.log('ok   "Bom dia" + áudio durante a resposta: o áudio vai para a IA em seguida');

  atendidas.length = 0;
  const primeira = chegar('tem sofá?');
  await new Promise((r) => setTimeout(r, 100));
  await chegar('de 3 lugares');
  await primeira;
  await new Promise((r) => setTimeout(r, 900)); // a fila de texto drena no fim do turno
  assert.deepStrictEqual(atendidas, ['tem sofá?', 'de 3 lugares'], 'texto durante o turno continua na fila, como antes');
  console.log('ok   texto durante o turno: fila de sempre');
  process.exit(0);
})().catch((e) => { console.log(`FAIL ${e.message}`); process.exit(1); });
