/**
 * Aviso automático do áudio não pode calar a IA.
 *
 * Sonhare, 29/09 11:30: o cliente mandou um áudio de mais de 90s e o MyZap
 * respondeu "Recebemos seu áudio, mas ele passa de 90s. Pode enviar um resumo
 * rapidinho?". O eco desse aviso voltou como "equipe digitou" — 30 min de IA
 * calada, justo quando o cliente mandaria o resumo que o aviso pediu. O mesmo
 * valia para "não consegui entender o áudio. Pode digitar?".
 *
 * audioProcessor e outboundMessageProcessor REAIS; envio, histórico e agente
 * por require.cache.
 *
 * Uso: node test/aviso-audio-nao-pausa.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => {
  const arquivo = resolver(rel);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};

const enviados = [];
const pausas = [];
let perguntasAoAgente = 0;
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('controllers/helper/events/audioTranscriber.js', async () => 'transcrito');
stub('controllers/helper/events/mediaDecryptor.js', { decryptFile: async () => { throw new Error('arquivo corrompido'); } });
stub('controllers/helper/events/messageSender.js', { sendText: async ({ text }) => { enviados.push(text); } });
stub('controllers/helper/events/chatHistory.js', {
  registerAgentMessage: async ({ text }) => { pausas.push(text); },
  isRecentAssistantEcho: async () => false,
});
stub('controllers/helper/ia/agenteClient.js', { ehMensagemDoSistema: async () => { perguntasAoAgente++; return false; } });

process.env.IA_PROVIDER = 'agente';
const { processAudio } = require(resolver('controllers/helper/ia/audioProcessor.js'));
const Outbound = require(resolver('controllers/helper/events/outboundMessageProcessor.js'));

const numero = '5544999990000@c.us';
const agora = () => Math.floor(Date.now() / 1000);
const ecoDaLoja = (body) => Outbound.processFromMe({
  message: { body, fromMe: true, timestamp: agora() },
  session: 's', sessionkey: 'k', numero, socketManager: {},
});

(async () => {
  // áudio de 200s: pede o resumo
  assert.strictEqual((await processAudio({ message: { type: 'ptt', duration: 200 }, client: {}, numero, payload: {}, empresa: { ia_ativa: true } })).success, false);
  // áudio que não baixa: pede para digitar
  assert.strictEqual((await processAudio({ message: { type: 'ptt', duration: 10 }, client: {}, numero, payload: {}, empresa: { ia_ativa: true } })).success, false);
  assert.strictEqual(enviados.length, 2, 'os dois avisos saíram');

  for (const aviso of enviados) {
    assert.strictEqual((await ecoDaLoja(aviso)).humano, false, `o eco do aviso não é a equipe: "${aviso}"`);
  }
  assert.deepStrictEqual(pausas, [], 'nenhuma pausa por causa dos avisos');
  assert.strictEqual(perguntasAoAgente, 0, 'o eco é reconhecido antes de perguntar ao agente');
  console.log('ok   avisos do áudio (longo e ilegível) não calam a IA');

  // controle: a equipe digitando continua calando a IA
  assert.strictEqual((await ecoDaLoja('Oi, aqui é a Maria da loja')).humano, true);
  assert.strictEqual(pausas.length, 1);
  console.log('ok   a equipe digitando continua pausando a IA');
  process.exit(0);
})().catch((e) => { console.log(`FAIL ${e.message}`); process.exit(1); });
