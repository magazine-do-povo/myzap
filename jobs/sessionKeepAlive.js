const axios = require('axios');
const SessionsHelper = require('../controllers/helper/core/sessions.js');
const customLogger = require('../util/customLogger.js');
const config = require('../config');

const CONNECTED_STATUSES = new Set(['CONNECTED', 'inChat', 'isLogged', 'isConnected']);
const CONNECTED_STATES = new Set(['CONNECTED', 'inChat', 'isLogged', 'isConnected']);

// Status que indicam que a sessão está aguardando QR Code (NÃO tentar reiniciar)
const WAITING_QR_STATUSES = new Set(['qrCode', 'QRCODE', 'WAITING_QR', 'INITIALIZING', 'STARTING']);

// Configurações de controle de tentativas
const MAX_START_ATTEMPTS = 10; // AUMENTADO: Máximo de tentativas antes de parar
const QR_COOLDOWN_MINUTES = 5; // REDUZIDO: Minutos de espera entre tentativas quando tem QR

let intervalHandle = null;
let timeoutHandle = null;
let running = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldRunOnThisProcess() {
  // 🔧 FIX: Só pular se estiver em CLUSTER mode com múltiplas instâncias
  // Em modo fork, pm_id pode ser qualquer número (ex: 4) e o job DEVE rodar
  const pmExecMode = process.env.exec_mode;
  const pmInstances = parseInt(process.env.instances || '1', 10);
  const pmId = process.env.pm_id ?? process.env.PM_ID;
  if (pmExecMode === 'cluster_mode' && pmInstances > 1 && pmId && pmId !== '0') {
    return false;
  }
  return true;
}

/**
 * URL para a API falar COM ELA MESMA. Sempre loopback, de propósito.
 *
 * Antes isto usava `HOST_SSL`/`HOST`, e no Kubernetes esses valores apontam para
 * o Service (`http://myzap.myzap.svc.cluster.local:3333`) — o que faz a chamada
 * sair do pod, passar pelo kube-proxy e voltar. Dois jeitos de isso falhar
 * exatamente quando mais importa:
 *
 *  - NO BOOT: o `START_ALL_SESSIONS` roda dentro do callback de `server.listen`,
 *    mas o pod só entra nos Endpoints do Service quando a readinessProbe passa
 *    (`initialDelaySeconds: 20`). Nos primeiros segundos o Service não tem para
 *    onde mandar, e toda reabertura de sessão falharia.
 *  - EM CRISE: se a probe começar a falhar (pico de CPU no envio de mídia, por
 *    exemplo), o Service tira o endpoint e o keepalive perde a capacidade de
 *    religar sessão — justamente no momento em que ele existe para agir.
 *
 * Loopback não depende de DNS, de Service, de endpoint nem de readiness. O
 * servidor é HTTP puro (`http.Server` em index.js:28) e escuta em 0.0.0.0,
 * então 127.0.0.1 sempre chega. É também o que o `.envcopy` do projeto já
 * sugeria (`HOST=http://127.0.0.1`).
 */
function resolveBaseUrl() {
  return `http://127.0.0.1:${config.port}`;
}

function isEligible(device) {
  if (!device?.session) {
    return false;
  }

  if (!device.sessionkey) {
    customLogger.warning(`[SESSION KEEPALIVE] Sessao ${device.session} ignorada: sessionkey ausente`);
    return false;
  }

  // NOVO - Verificar se está aguardando QR Code ou inicializando (NÃO tentar reiniciar)
  const status = device.status || '';
  const state = device.state || '';
  
  // CRÍTICO - Nunca interferir enquanto está inicializando
  if (WAITING_QR_STATUSES.has(status) || WAITING_QR_STATUSES.has(state)) {
    // Verificar se já passou tempo suficiente desde a última tentativa
    const lastStart = device.last_start ? new Date(device.last_start) : null;
    const now = new Date();
    
    if (lastStart) {
      const minutesSinceLastStart = (now - lastStart) / (1000 * 60);
      
      // AUMENTADO: Aguardar pelo menos 10 minutos antes de tentar novamente
      if (minutesSinceLastStart < 10) {
        customLogger.debug(`[SESSION KEEPALIVE] ${device.session} inicializando (${minutesSinceLastStart.toFixed(1)} min) - aguardando timeout de 10min`);
        return false;
      }
    } else {
      // Se não tem last_start, pular por segurança
      customLogger.debug(`[SESSION KEEPALIVE] ${device.session} status ${status} sem last_start - pulando`);
      return false;
    }
  }
  
  // NOVO - Verificar limite de tentativas
  const attemptsStart = device.attempts_start || 0;
  if (attemptsStart >= MAX_START_ATTEMPTS) {
    customLogger.debug(`[SESSION KEEPALIVE] ${device.session} atingiu limite de ${MAX_START_ATTEMPTS} tentativas - pulando`);
    return false;
  }

  // CORRIGIDO - Também reconectar sessões que caíram (DISCONNECTED, TIMEOUT, notLogged)
  const RECONNECT_STATUSES = new Set(['DISCONNECTED', 'TIMEOUT', 'notLogged', 'disconnected']);
  
  if (!config.session_keepalive_only_connected) {
    return true;
  }

  // Se está conectado OU se caiu e precisa reconectar
  if (CONNECTED_STATUSES.has(status) || CONNECTED_STATES.has(state)) {
    return true;
  }
  
  // NOVO - Também reconectar sessões que caíram
  if (RECONNECT_STATUSES.has(status) || RECONNECT_STATUSES.has(state)) {
    customLogger.info(`[SESSION KEEPALIVE] ${device.session} caiu (${status}/${state}) - tentando reconectar`);
    return true;
  }
  
  return false;
}

/**
 * Pede à própria API para abrir a sessão, via HTTP.
 *
 * Este rodeio — sair pela rede para bater em si mesmo — é o que faz a coisa
 * funcionar, e é de propósito. Quem monta o `req` é o Express: é ele que injeta
 * o Socket.IO (index.js:52), preenche o body, valida `apitoken`/`sessionkey`
 * (middlewares/validations.js) e chama o método da engine pelo Router, com o
 * receptor certo. Nada disso existe quando se chama a engine por dentro do
 * processo com um `req` de mentira.
 *
 * Também é o Router que resolve QUAL engine atende (index.js:119), então quem
 * chama aqui não precisa saber se é WppConnect, Venom ou WhatsappWebJS.
 *
 * Devolve true/false para quem chamou poder logar o resultado — o keepalive
 * ignora o retorno, o boot usa.
 */
async function triggerStart(device, baseURL) {
  try {
    await axios.post(
      `${baseURL}/start`,
      { session: device.session },
      {
        headers: {
          apitoken: config.token,
          sessionkey: device.sessionkey,
        },
        timeout: 20000,
      }
    );

    customLogger.debug(`[SESSION KEEPALIVE] start enviado para ${device.session}`);
    return true;
  } catch (error) {
    const errorMessage = error?.response?.data?.error || error?.message || 'Erro desconhecido';
    customLogger.warning(`[SESSION KEEPALIVE] Falha ao iniciar ${device.session}: ${errorMessage}`);
    return false;
  }
}

async function runCycle() {
  if (running) {
    customLogger.debug('[SESSION KEEPALIVE] Ciclo anterior ainda em execucao, ignorando novo disparo');
    return;
  }

  running = true;
  const baseURL = resolveBaseUrl();

  try {
    const records = await SessionsHelper.listDevices();
    if (!records?.length) {
      customLogger.debug('[SESSION KEEPALIVE] Nenhuma sessao cadastrada no banco');
      return;
    }

    const devices = records
      .map((item) => (item?.dataValues ? { ...item.dataValues } : item))
      .filter((device) => isEligible(device));

    if (!devices.length) {
      customLogger.debug('[SESSION KEEPALIVE] Nenhuma sessao elegivel para keepalive');
      return;
    }

    customLogger.info(`[SESSION KEEPALIVE] Executando ciclo para ${devices.length} sessao(oes)`);

    for (const device of devices) {
      await triggerStart(device, baseURL);
      await wait(2000);
    }
  } catch (err) {
    customLogger.error(`[SESSION KEEPALIVE] Erro no ciclo: ${err.message}`);
  } finally {
    running = false;
  }
}

function startSessionKeepAliveJob() {
  if (!config.session_keepalive_enabled) {
    customLogger.info('[SESSION KEEPALIVE] Job desabilitado nas configuracoes');
    return;
  }

  if (!shouldRunOnThisProcess()) {
    customLogger.info('[SESSION KEEPALIVE] Ignorando agendamento neste worker PM2');
    return;
  }

  const interval = parseInt(config.session_keepalive_interval_ms, 10) || 300000;
  const initialDelay = Math.min(interval, 15000);

  const scheduleRecurring = () => {
    intervalHandle = setInterval(runCycle, interval);
    if (typeof intervalHandle.unref === 'function') {
      intervalHandle.unref();
    }
  };

  timeoutHandle = setTimeout(async () => {
    try {
      await runCycle();
    } finally {
      scheduleRecurring();
    }
  }, initialDelay);

  if (typeof timeoutHandle.unref === 'function') {
    timeoutHandle.unref();
  }

  customLogger.info(
    `[SESSION KEEPALIVE] Job agendado. Intervalo: ${interval}ms | Delay inicial: ${initialDelay}ms`
  );
}

module.exports = {
  startSessionKeepAliveJob,
  // Reaproveitados pelo START_ALL_SESSIONS (startup.js) para que exista UMA
  // forma de abrir sessão no processo, e não duas com comportamentos diferentes.
  triggerStart,
  resolveBaseUrl,
};
