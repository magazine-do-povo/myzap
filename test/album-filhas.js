/**
 * Álbum (duas ou mais fotos mandadas juntas): o whatsapp-web.js 1.34.7 só emite a
 * primeira filha. Caso real (24/09/2026, Castanheira): os 2 álbuns do dia chegaram com
 * 1 foto de 2 — frente e verso do documento viravam só a frente. Aqui: depois do álbum,
 * as filhas saem do chat e passam pelo mesmo caminho, sem repetir a que já veio.
 * Sem banco e sem WhatsApp: bordas por require.cache, como o loja-assumiu.
 *
 * Uso: node test/album-filhas.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
const vazio = new Proxy({}, { get: () => () => {} });
for (const rel of ['controllers/helper/events/events.js', 'controllers/helper/events/chatHistory.js', 'controllers/helper/ia/contextBuilder.js',
  'controllers/helper/ia/audioProcessor.js', 'controllers/helper/ia/decisionEngine.js', 'controllers/helper/events/socketWebhookManager.js',
  'controllers/helper/events/outboundMessageProcessor.js', 'controllers/helper/events/statusAckManager.js',
  'controllers/helper/events/connectionStateManager.js', 'util/customLogger.js']) stub(rel, vazio);
stub('controllers/helper/ia/iaResponseCache.js', { registerIAResponse: () => {}, isIAResponse: () => false });

const Events = require(resolver('controllers/EventsController.js'));
const processadas = [];
Events.processMessage = async (m) => { processadas.push(m.id.id); };
Events.ESPERAS_ALBUM_MS = [0, 5];

const filha = (id, $1 = true) => ({ id: $1 ? { id, $1: `false_x@lid_${id}` } : { id, _serialized: `false_x@lid_${id}` }, type: 'image', _data: { parentMsgKey: { id: 'ALBUM1' } } });
const chat = { fetchMessages: async () => [filha('F1'), { id: { id: 'OUTRA' }, type: 'chat', _data: {} }, filha('F2')] };
const album = { id: { id: 'ALBUM1' }, type: 'album', getChat: async () => chat, _data: { expectedImageCount: 2 } };

(async () => {
  let falhas = 0;
  const caso = async (nome, fn) => { try { await fn(); console.log(`ok   ${nome}`); } catch (e) { falhas += 1; console.log(`FAIL ${nome}: ${e.message}`); } };

  await Events.aoCriar(album, 's', {}, {});
  await Events.aoCriar(filha('F1', false), 's', {}, {}); // a primeira filha, pelo message_create (com _serialized)
  await new Promise((r) => setTimeout(r, 50));

  await caso('o álbum e as duas filhas passam, cada uma uma vez', () => assert.deepStrictEqual(processadas.sort(), ['ALBUM1', 'F1', 'F2']));
  await caso('mensagem do chat que não é filha do álbum não entra', () => assert.ok(!processadas.includes('OUTRA')));
  await caso('o chat que falha não derruba nada', async () => {
    const quebrado = { id: { id: 'ALBUM2' }, type: 'album', getChat: async () => { throw new Error('sem chat'); } };
    const antes = console.error; console.error = () => {};
    await Events.aoCriar(quebrado, 's', {}, {});
    await new Promise((r) => setTimeout(r, 30));
    console.error = antes;
    assert.ok(processadas.includes('ALBUM2'));
  });
  process.exit(falhas ? 1 : 0);
})();
