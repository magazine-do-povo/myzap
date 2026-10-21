/**
 * Foto/vídeo do cliente TEM de chegar ao agente como marcador de texto.
 *
 * O textoMensagem.js já traduzia mídia em "[imagem]" desde 09/09/2026, mas o
 * EventsController montava o texto da IA com `message.body` cru e o marcador
 * morria ali: foto sem legenda virava texto vazio (o agente devolve
 * "mensagem_vazia" e o cliente fica sem resposta nenhuma — WG lenha, Capucho
 * 17/09/2026 19:58, dois comprovantes em foto e um pedido de R$ 45 digitado à
 * mão) e foto com thumbnail virava 3,4 KB de base64 no lugar da fala.
 *
 * Este teste percorre o EventsController REAL: só as bordas (socket, contexto,
 * histórico, áudio, decisionEngine) entram por require.cache. Falha se o que
 * chega ao DecisionEngine não for o texto legível.
 *
 * Uso: node test/midia-para-agente.js  (exit 0 = ok, 1 = quebrou)
 */
process.env.PORT = process.env.PORT || '1';

const assert = require('assert');
const path = require('path');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => {
  const arquivo = resolver(rel);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};

const recebidoPelaIA = [];

// textoDaMensagem é o REAL (é o que está sob teste); o build só devolve o
// contexto mínimo que o controller usa.
const { textoDaMensagem } = require('../controllers/helper/ia/textoMensagem');
stub('controllers/helper/ia/contextBuilder.js', {
  build: async ({ message }) => ({
    session: 'sessao',
    sessionkey: 'chave',
    numero: message.from,
    msgBody: textoDaMensagem(message),
    payload: {},
    empresa: { ia_ativa: 1 },
  }),
  textoDaMensagem,
});
stub('controllers/helper/ia/decisionEngine.js', {
  process: async (args) => { recebidoPelaIA.push(args.msgBody); return true; },
});
stub('controllers/helper/ia/audioProcessor.js', { processAudio: async () => ({ success: true }) });
stub('controllers/helper/events/chatHistory.js', {
  registerUserMessage: async () => {},
  registerAssistantMessage: async () => {},
});
stub('controllers/helper/events/socketWebhookManager.js', class {
  async notifyMessageReceived() {}
  async notifyMessageSent() {}
  async responseDefault() {}
});
stub('controllers/helper/events/outboundMessageProcessor.js', { processFromMe: async () => {} });
stub('controllers/helper/events/statusAckManager.js', {});
stub('controllers/helper/events/connectionStateManager.js', {});
stub('controllers/helper/ia/iaResponseCache.js', { registerIAResponse: () => {}, isIAResponse: () => false });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));

const Events = require('../controllers/EventsController.js');

const thumbnail =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAAB' +
  'AAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAAB' +
  'AAOgAQADAAAAAQABAACgAgAEAAAAAQAAAGSgAwAEAAAAAQAAAGQAAAAA/+0AOFBob3Rvc2hvcCAzLjAA';

const casos = [
  [{ type: 'image', body: '', caption: '', from: '5511976919165@c.us' }, '[imagem]', 'foto sem legenda (o caso do WG lenha)'],
  [{ type: 'image', body: thumbnail, caption: '', from: '5511976919165@c.us' }, '[imagem]', 'foto que vem com thumbnail em base64'],
  [{ type: 'image', body: thumbnail, caption: 'comprovante do pix', from: '5511976919165@c.us' }, '[imagem] comprovante do pix', 'foto com legenda'],
  [{ type: 'document', body: 'Comprovante.pdf', from: '5511976919165@c.us' }, 'Comprovante.pdf', 'PDF continua chegando pelo nome do arquivo'],
  [{ type: 'chat', body: 'Manda o Pix', from: '5511976919165@c.us' }, 'Manda o Pix', 'texto normal não muda'],
  // Capucho 24/09/2026: trocou de aparelho, o aviso virava o "primeiro contato" e o "oi" ia para a IA
  [{ type: 'e2e_notification', body: '', from: '152574535688336@lid' }, undefined, 'aviso "o código de segurança mudou" não chega à IA'],
  [{ type: 'gp2', body: '', from: '152574535688336@lid' }, undefined, 'aviso de grupo não chega à IA'],
];

let falhas = 0;
(async () => {
  for (const [message, esperado, nome] of casos) {
    recebidoPelaIA.length = 0;
    await Events.processMessage(message, 'sessao', {}, { headers: { sessionkey: 'chave' } });
    try {
      assert.strictEqual(recebidoPelaIA[0], esperado);
      console.log(`ok   ${nome}`);
    } catch (e) {
      falhas++;
      console.log(`FALHOU ${nome}: "${String(recebidoPelaIA[0]).slice(0, 50)}" (esperado "${esperado}")`);
    }
  }
  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} caso(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
