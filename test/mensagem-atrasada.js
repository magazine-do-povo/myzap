/**
 * Depois de uma queda, a sessão recebe de uma vez o que ficou represado. Mensagem
 * com mais de 10 min não vai para a IA (Sonhare, 26/09: ela respondeu "Maria deu
 * certo" e "Amém 🙏", conversa com a equipe, uma hora depois).
 *
 * Uso: node test/mensagem-atrasada.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');
const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('controllers/helper/events/chatHistory.js', {});
stub('controllers/helper/ia/humanDetector.js', {});
stub('controllers/helper/ia/agenteClient.js', {});
stub('controllers/helper/ia/iaConfig.js', { HUMAN_PAUSE_MINUTES: 30 });

const { checkMensagemAtrasada } = require(resolver('controllers/helper/ia/guards.js'));
const agora = Math.floor(Date.now() / 1000);

(async () => {
  assert.deepEqual(await checkMensagemAtrasada({ message: { timestamp: agora - 3600 } }), { shouldBlock: true, reason: 'mensagem_atrasada' });
  console.log('ok   mensagem de 1 h atrás (represada na queda): não vai para a IA');
  assert.equal((await checkMensagemAtrasada({ message: { timestamp: agora - 90 } })).shouldBlock, false);
  console.log('ok   mensagem de agora (ou do reinício de 1-2 min): vai para a IA');
  assert.equal((await checkMensagemAtrasada({ message: {} })).shouldBlock, false);
  console.log('ok   sem timestamp (outro motor): não bloqueia');
  console.log('mensagem-atrasada: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
