/**
 * Smoke do fluxo IA: decisionEngine REAL de ponta a ponta com IA_PROVIDER=agente.
 *
 * Motivação (31/08/2026): a função exportada do decisionEngine chama-se
 * "process" e sombreava o global do Node — process.env.IA_PROVIDER dava
 * TypeError em TODA mensagem, engolido pelo catch genérico. Passou por duas
 * releases porque nada exercitava o caminho completo. Este smoke falha na hora
 * se a mensagem não atravessar guards -> roteamento -> AgenteClient -> sendText.
 *
 * Sem banco e sem WhatsApp: módulos de borda (chatHistory, messageSender,
 * empresaIA, defaultMessageService, iaResponseCache) entram por require.cache;
 * guards, agenteClient, processingLock e o decisionEngine rodam REAIS.
 * O "agente" é um HTTP local que devolve uma resposta fixa.
 *
 * Uso: node test/smoke-ia.js  (exit 0 = ok, 1 = quebrou)
 */
const http = require('http');
const path = require('path');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));

const chamadas = { sendText: [], sendDefault: [], sendPtt: [] };

const stub = (rel, exports) => {
  const arquivo = resolver(rel);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};

// Bordas: histórico diz "já interagiu hoje" (senão o guard primeiro_contato
// bloqueia antes da IA) e nega qualquer sinal de humano na conversa.
stub('controllers/helper/events/chatHistory.js', {
  jaInteragiuHoje: async () => true,
  humanoFalouRecentemente: async () => false,
  clientePediuHumano: async () => false,
  marcarPedidoHumano: async () => {},
  registerAssistantMessage: async () => {},
});
stub('controllers/helper/events/messageSender.js', {
  startTyping: async () => {},
  startRecording: async () => {},
  stopTyping: async () => {},
  sendText: async ({ text }) => { chamadas.sendText.push(text); },
  sendPtt: async ({ base64 }) => { chamadas.sendPtt.push(base64); return true; },
});
stub('controllers/helper/ia/defaultMessageService.js', {
  sendDefault: async (args) => { chamadas.sendDefault.push(args?.motivo ?? args); },
});
// empresaIA puxa OpenAI + sequelize no require — fora do smoke.
stub('controllers/helper/ia/empresaIA.js', { processarMensagem: async () => null });
stub('controllers/helper/ia/iaResponseCache.js', { registerIAResponse: () => {} });
// logger real puxa chalk — stub mantém o smoke sem node_modules (CI leve).
stub('util/customLogger.js', new Proxy({}, {
  get: (_alvo, metodo) => (...args) => console.log(`[${String(metodo)}]`, ...args.map(String)),
}));

const recebidos = [];
const servidor = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    let json = {};
    try { json = JSON.parse(corpo); } catch (_) { json = { corpo }; }
    recebidos.push({ rota: req.url, ...json });
    res.setHeader('Content-Type', 'application/json');
    // /falar devolve a voz separada — é a segunda etapa do turno por áudio
    if (req.url === '/falar') {
      res.end(JSON.stringify({ ok: true, audio_base64: 'BASE64FALSO', audio_mime: 'audio/ogg; codecs=opus', tts_ms: 42 }));
      return;
    }
    // com voz_depois o agente responde só o texto; sem ele, manda o áudio junto
    res.end(JSON.stringify(json.voz_depois
      ? { resposta: 'pong do agente' }
      : { resposta: 'pong do agente' }));
  });
});

const main = async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const porta = servidor.address().port;

  process.env.IA_PROVIDER = 'agente';
  process.env.AGENT_URL = `http://127.0.0.1:${porta}`;
  process.env.AGENT_AUTH_TOKEN = 'smoke';

  const decisionEngine = require(resolver('controllers/helper/ia/decisionEngine.js'));

  const ok = await decisionEngine.process({
    // whatsapp-web.js entrega o pushname em _data.notifyName — é daí que o
    // agente tem de receber o nome (v3.0.18: antes ia sempre null)
    message: { from: '5599000000000@c.us', body: 'bom dia (smoke)', _data: { notifyName: 'Fulano Smoke' } },
    client: {},
    session: 'smoke',
    sessionkey: 'smoke',
    numero: '5599000000000@c.us',
    msgBody: 'bom dia (smoke)',
    empresa: { ia_ativa: true, api_url: null },
    payload: {},
    responseDefault: async () => {},
  });

  const respondeu = chamadas.sendText.includes('pong do agente');
  console.log(`processou=${ok} sendText=${JSON.stringify(chamadas.sendText)} sendDefault=${JSON.stringify(chamadas.sendDefault)}`);
  if (!respondeu) {
    console.error('SMOKE FALHOU: a resposta do agente não chegou ao sendText — o fluxo morreu no meio.');
    process.exit(1);
  }
  const nome = recebidos[0]?.nome;
  if (nome !== 'Fulano Smoke') {
    console.error(`SMOKE FALHOU: nome do cliente não chegou ao agente (recebido: ${JSON.stringify(nome)}).`);
    process.exit(1);
  }
  // ---- caso 2: cliente falou por ÁUDIO ----------------------------------
  // Antes, quem mandava áudio recebia SÓ o PTT e depois de esperar a síntese
  // inteira (5s de modelo + 9 a 12s de voz). Agora o texto sai na hora e a voz
  // vem numa segunda chamada — o smoke garante que as DUAS coisas acontecem.
  chamadas.sendText.length = 0;
  recebidos.length = 0;
  const okAudio = await decisionEngine.process({
    message: {
      from: '5599000000001@c.us',
      body: '',
      _data: { notifyName: 'Fulano Audio' },
      agenteAudioBase64: 'AUDIODOCLIENTE',
      agenteAudioMime: 'audio/ogg',
    },
    client: {},
    session: 'smoke',
    sessionkey: 'smoke',
    numero: '5599000000001@c.us',
    msgBody: '',
    empresa: { ia_ativa: true, api_url: null },
    payload: {},
    responseDefault: async () => {},
  });

  const pediuVozDepois = recebidos.some((r) => r.rota === '/atender' && r.voz_depois === true);
  const mandouTexto = chamadas.sendText.includes('pong do agente');
  const pediuFalar = recebidos.some((r) => r.rota === '/falar' && r.texto === 'pong do agente');
  const mandouPtt = chamadas.sendPtt.includes('BASE64FALSO');
  console.log(`audio: processou=${okAudio} voz_depois=${pediuVozDepois} texto=${mandouTexto} /falar=${pediuFalar} ptt=${mandouPtt}`);
  if (!(pediuVozDepois && mandouTexto && pediuFalar && mandouPtt)) {
    console.error('SMOKE FALHOU: turno por áudio deve mandar o TEXTO primeiro e o PTT depois (via /falar).');
    process.exit(1);
  }

  servidor.close();
  console.log('SMOKE OK: texto atravessou guards -> agente -> sendText (com nome), e áudio saiu em duas etapas.');
  process.exit(0);
};

main().catch((e) => {
  console.error('SMOKE FALHOU (exceção):', e);
  process.exit(1);
});
