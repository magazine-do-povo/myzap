/**
 * Job de Health Check para Sessões WhatsApp
 * 
 * Detecta sessões "zumbi" que aparecem como conectadas mas não recebem mensagens.
 * 
 * MELHORADO: Agora também rastreia envios e fornece validação pré-envio.
 * - registerSendSuccess() / registerSendFailure() - rastreia envios
 * - isClientHealthy() - valida ANTES de enviar (usar no sendText)
 */

const SessionsHelper = require('../controllers/helper/core/sessions.js');
const customLogger = require('../util/customLogger.js');
const config = require('../config');
const DeviceModel = require('../Models/device.js');

const Device = DeviceModel(config.sequelize);
const { Op } = require('sequelize');

/** Status do banco que já dizem "conectado". */
const CONECTADOS = ['CONNECTED', 'inChat', 'isLogged', 'isConnected'];

// 📊 Mapas de rastreamento
const lastMessageTime = new Map();        // Última msg recebida
const lastSendTime = new Map();           // Último envio OK
const lastSendError = new Map();          // Último erro de envio
const sendFailureCount = new Map();       // Falhas consecutivas de envio

// Mapa de último health check por sessão
const lastHealthCheck = new Map();

// ⚖️ AJUSTE (anti-falso-positivo): o health-check vinha DESTRUINDO sessões saudáveis
// por timeout transitório de getState() durante picos de CPU (envio de mídia). Cada
// destruição é uma chance de não reconectar e exigir QR. Então afrouxamos os gatilhos:
// menos polling, timeouts maiores e mais falhas seguidas antes de considerar zumbi.
const HEALTH_CHECK_INTERVAL_MS = 60000; // 60s (era 30s) - reduz tempestade de getState
const ZOMBIE_THRESHOLD_MINUTES = 60; // 60 min (era 15) - silêncio de inbound NÃO é zumbi
const MAX_CONSECUTIVE_FAILURES = 4; // 4 falhas seguidas (era 2) - tolera pico transitório
const MAX_SEND_FAILURES = 6;         // 6 falhas de envio (era 3) - não zumbifica por azar
const RECOVERY_COOLDOWN_MS = 300000; // 5 min entre recuperações

// Contador de falhas por sessão
const failureCount = new Map();

// Última recuperação por sessão (para cooldown)
const lastRecoveryTime = new Map();

let intervalHandle = null;

/**
 * 📩 Registra timestamp da última mensagem recebida (chamar do EventsController)
 */
function registerMessageReceived(session) {
  lastMessageTime.set(session, Date.now());
  // Reset failure count quando recebe mensagem
  failureCount.set(session, 0);
  
  // Atualizar banco em background (não bloqueia)
  Device.update({ 
    last_message_received: new Date(),
    health_status: 'HEALTHY'
  }, { where: { session } }).catch(() => {});
}

/**
 * ✅ Registra envio bem sucedido (chamar do sendText/sendMedia)
 */
function registerSendSuccess(session) {
  lastSendTime.set(session, Date.now());
  sendFailureCount.set(session, 0);
  lastSendError.delete(session);
  
  // Atualizar banco em background
  Device.update({ 
    last_message_sent: new Date(),
    send_failure_count: 0,
    last_send_error: null,
    health_status: 'HEALTHY'
  }, { where: { session } }).catch(() => {});
}

/**
 * ❌ Registra falha de envio (chamar do sendText/sendMedia)
 */
function registerSendFailure(session, errorMessage) {
  const count = (sendFailureCount.get(session) || 0) + 1;
  sendFailureCount.set(session, count);
  lastSendError.set(session, { message: errorMessage, at: Date.now() });
  
  // Atualizar banco em background
  Device.update({ 
    send_failure_count: count,
    last_send_error: errorMessage,
    health_status: count >= MAX_SEND_FAILURES ? 'CRITICAL' : 'WARNING'
  }, { where: { session } }).catch(() => {});
  
  customLogger.warning(`[SEND FAILURE] ${session}: ${count} falhas consecutivas - ${errorMessage}`);
  
  if (count >= MAX_SEND_FAILURES) {
    customLogger.error(`[SEND FAILURE] ${session}: Atingiu ${MAX_SEND_FAILURES} falhas - sessão problemática`);
  }
}

/**
 * 🔍 Verifica se client está saudável ANTES de enviar (usar no sendText)
 * Retorna { healthy: boolean, reason: string|null, skipFailureCount: boolean }
 * 
 * skipFailureCount=true significa que NÃO devemos incrementar o contador de falhas
 * (usado quando o bloqueio é por já ter muitas falhas - evita loop infinito)
 */
async function isClientHealthy(session, client) {
  if (!client) {
    return { healthy: false, reason: 'Client não existe na memória', skipFailureCount: false };
  }

  // Verificar falhas de envio recentes
  // 🔴 IMPORTANTE: Se bloqueou por muitas falhas, NÃO incrementar mais
  // Isso evita loop infinito de falhas
  const sendFails = sendFailureCount.get(session) || 0;
  if (sendFails >= MAX_SEND_FAILURES) {
    return { 
      healthy: false, 
      reason: `${sendFails} falhas de envio consecutivas - aguardando recuperação automática`,
      skipFailureCount: true  // NÃO incrementar - evita loop!
    };
  }

  // Verificação rápida do estado (timeout de 5s para não travar)
  try {
    const statePromise = Promise.race([
      client.getState(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
    ]);
    
    const state = await statePromise;
    
    if (state !== 'CONNECTED') {
      return { healthy: false, reason: `Estado: ${state}`, skipFailureCount: false };
    }
    
    return { healthy: true, reason: null, state, skipFailureCount: false };
  } catch (error) {
    return { healthy: false, reason: error.message, skipFailureCount: false };
  }
}

/**
 * Verifica se uma sessão está "zumbi"
 */
async function checkSessionHealth(session, client) {
  const checks = {
    session,
    timestamp: new Date().toISOString(),
    getState: null,
    pupPageAlive: null,
    lastMessage: null,
    lastSend: null,
    sendFailures: sendFailureCount.get(session) || 0,
    isZombie: false,
    reason: null
  };

  try {
    // 1. Verificar getState()
    const statePromise = new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('getState timeout')), 30000);
      try {
        const state = await client.getState();
        clearTimeout(timeout);
        resolve(state);
      } catch (e) {
        clearTimeout(timeout);
        reject(e);
      }
    });

    checks.getState = await statePromise;
    
    // 2. Verificar se página do Puppeteer ainda responde
    if (client.pupPage) {
      const pagePromise = new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('pupPage timeout')), 30000);
        try {
          const result = await client.pupPage.evaluate(() => 1 + 1);
          clearTimeout(timeout);
          resolve(result === 2);
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });

      checks.pupPageAlive = await pagePromise;
    }

    // 3. Verificar tempo desde última mensagem
    const lastMsg = lastMessageTime.get(session);
    if (lastMsg) {
      const minutesSinceLastMessage = (Date.now() - lastMsg) / 60000;
      checks.lastMessage = {
        timestamp: new Date(lastMsg).toISOString(),
        minutesAgo: Math.round(minutesSinceLastMessage)
      };

      if (minutesSinceLastMessage > ZOMBIE_THRESHOLD_MINUTES) {
        checks.isZombie = true;
        checks.reason = `Sem mensagens há ${Math.round(minutesSinceLastMessage)} minutos`;
      }
    }

    // 4. Verificar último envio bem sucedido
    const lastSnd = lastSendTime.get(session);
    if (lastSnd) {
      checks.lastSend = {
        timestamp: new Date(lastSnd).toISOString(),
        minutesAgo: Math.round((Date.now() - lastSnd) / 60000)
      };
    }

    // 5. 🆕 Verificar falhas de envio consecutivas
    if (checks.sendFailures >= MAX_SEND_FAILURES) {
      checks.isZombie = true;
      checks.reason = `${checks.sendFailures} falhas de envio consecutivas`;
    }

    // Reset failure count em caso de sucesso
    failureCount.set(session, 0);

  } catch (error) {
    const currentFailures = (failureCount.get(session) || 0) + 1;
    failureCount.set(session, currentFailures);

    checks.error = error.message;

    if (currentFailures >= MAX_CONSECUTIVE_FAILURES) {
      checks.isZombie = true;
      checks.reason = `${currentFailures} falhas consecutivas: ${error.message}`;
    }
  }

  lastHealthCheck.set(session, checks);
  return checks;
}

/**
 * Executa health check em todas as sessões conectadas
 */
/**
 * O `ready` PERDIDO do whatsapp-web.js 1.34.7. O WhatsApp avisa "terminei de
 * sincronizar" (change:hasSynced) UMA vez; quando a sessão salva sincroniza
 * rápido, o aviso sai ANTES de a biblioteca escutar — e o handler que carrega os
 * utilitários, LIGA OS OUVINTES DE MENSAGEM e emite o `ready` nunca roda (o main
 * do wwebjs corrige, PR #201653). A sessão fica CONNECTED e surda: 26/09, Sonhare
 * e Capucho 4 h sem receber nada depois do restart das 04h.
 *
 * Sem `client.info` (quem o preenche é esse handler) e com a sincronização já
 * terminada, chama o handler que a própria biblioteca expôs na página. Ainda
 * sincronizando: espera o próximo ciclo.
 */
async function dispararReadyPerdido(session, client) {
  if (!client?.pupPage || client.info) return false;
  const disparou = await client.pupPage.evaluate(() => {
    const Socket = window.require && window.require('WAWebSocketModel').Socket;
    if (!Socket || !Socket.hasSynced || typeof window.onAppStateHasSyncedEvent !== 'function') return false;
    window.onAppStateHasSyncedEvent();
    return true;
  }).catch(() => false);
  if (disparou) customLogger.info(`[HEALTH CHECK] ${session}: ready perdido — sincronização já terminada, ouvintes de mensagem ligados à mão`);
  return disparou === true;
}

/**
 * Vigia de SURDEZ: o WhatsApp Web da sessão recebeu mensagem de cliente e o MyZap
 * não viu. Pega qualquer causa: ready perdido no meio do caminho, aba em "aberto
 * em outra janela", ouvinte que se perdeu. Em 26/09 a Sonhare ficou surda três
 * vezes, cada vez por um motivo, e cada vez só se descobriu porque um cliente
 * reclamou.
 *
 * Só conta mensagem chegada DEPOIS de este client ser visto aqui (histórico que
 * a página carrega não vale) e com 3 min de folga. Surda: fecha o Chrome e tira
 * o client da memória; o keepalive refaz o /start ("pasta existe mas client
 * inativo") sem QR. No máximo uma recriação a cada 10 min por sessão.
 */
const clienteVistoDesde = new WeakMap();
const ultimaRecriacao = new Map();
async function vigiarSurdez(session, client) {
  if (!client?.pupPage) return false;
  if (!clienteVistoDesde.has(client)) clienteVistoDesde.set(client, Date.now());
  const ultimaNaPagina = await client.pupPage.evaluate(() => {
    const TIPOS = ['chat', 'image', 'video', 'audio', 'ptt', 'document', 'sticker', 'location', 'vcard'];
    let t = 0;
    for (const m of window.require('WAWebCollections').Msg.getModelsArray()) {
      const chat = String(m.id && m.id.remote);
      if (m.id.fromMe || !m.t || !TIPOS.includes(m.type) || /status|broadcast|@g\.us|@newsletter/.test(chat)) continue;
      if (m.t > t) t = m.t;
    }
    return t;
  }).catch(() => 0);
  if (!ultimaNaPagina) return false;

  const chegouEm = ultimaNaPagina * 1000;
  const referencia = Math.max(lastMessageTime.get(session) || 0, clienteVistoDesde.get(client));
  const surda = chegouEm > referencia + 60 * 1000 && Date.now() - chegouEm > 3 * 60 * 1000;
  if (!surda || Date.now() - (ultimaRecriacao.get(session) || 0) < 10 * 60 * 1000) return false;

  ultimaRecriacao.set(session, Date.now());
  customLogger.warning(`[HEALTH CHECK] ${session}: SURDA — o WhatsApp recebeu mensagem ${new Date(chegouEm).toLocaleTimeString('pt-BR')} e o MyZap não; recriando o client`);
  try { await client.destroy(); } catch (_) { /* Chrome já morto */ }
  SessionsHelper.removeClientFromMemory(session);
  try { delete global.__wwebInit[session]; } catch (_) { /* sem trava */ }
  return true;
}

async function runHealthCheckCycle() {
  try {
    const allSessions = SessionsHelper.getAllSessions();
    
    if (!allSessions || allSessions.length === 0) {
      customLogger.debug('[HEALTH CHECK] Nenhuma sessão ativa na memória');
      return;
    }

    const results = {
      total: allSessions.length,
      healthy: 0,
      warning: 0,
      zombie: 0,
      details: []
    };

    for (const sessionInfo of allSessions) {
      const { session, client } = sessionInfo;
      
      if (!client) {
        results.warning++;
        continue;
      }

      const health = await checkSessionHealth(session, client);
      results.details.push(health);

      if (health.isZombie) {
        results.zombie++;
        customLogger.error(`[🧟 ZOMBIE DETECTED] ${session}: ${health.reason}`);
        
        // Atualizar banco para marcar como ZOMBIE
        await Device.update({
          state: 'ZOMBIE',
          status: 'ZOMBIE',
          updated_at: new Date()
        }, { where: { session } }).catch(() => {});

        // 🔄 RECONEXÃO AUTOMÁTICA - Tentar reviver a sessão zumbi
        try {
          customLogger.warning(`[🔄 AUTO-RECONNECT] ${session}: Tentando reviver sessão zumbi...`);
          
          // Verificar condições que exigem destroy completo (refresh não resolve)
          const isDetachedFrame = health.reason && health.reason.includes('detached Frame');
          const hasManyFailures = health.sendFailures >= MAX_SEND_FAILURES;
          const isBrowserRunning = health.reason && health.reason.includes('browser is already running');
          
          // 🔴 Se tem muitas falhas de envio, precisa destruir e recriar
          const needsFullRestart = isDetachedFrame || hasManyFailures || isBrowserRunning;
          
          if (needsFullRestart) {
            // Sessão irrecuperável com refresh, precisa destruir e recriar
            const reason = isDetachedFrame ? 'Frame detached' : 
                          hasManyFailures ? `${health.sendFailures} falhas de envio` :
                          'Browser já rodando';
            customLogger.warning(`[AUTO-RECONNECT] ${session}: ${reason} - destruindo cliente para restart...`);
            
            try {
              // Tentar fechar o cliente de forma limpa
              await client.destroy().catch(() => {});
            } catch (e) {
              customLogger.debug(`[AUTO-RECONNECT] ${session}: Ignorando erro ao destruir: ${e.message}`);
            }
            
            // Remover da lista de sessões ativas
            SessionsHelper.removeClientFromMemory(session);
            
            // 🔴 IMPORTANTE: Limpar contadores de falha para permitir nova tentativa!
            lastMessageTime.delete(session);
            failureCount.delete(session);
            lastHealthCheck.delete(session);
            sendFailureCount.delete(session);  // 🆕 Limpar falhas de envio!
            lastSendError.delete(session);      // 🆕 Limpar último erro de envio!
            
            // Atualizar banco para marcar como desconectado (sessionKeepAlive vai recriar)
            await Device.update({
              state: 'disconnected',
              status: 'disconnected',
              send_failure_count: 0,  // 🆕 Resetar no banco também!
              last_send_error: null,
              health_status: 'RECOVERING',
              qrcode: null,
              updated_at: new Date()
            }, { where: { session } }).catch(() => {});
            
            customLogger.warning(`[AUTO-RECONNECT] ${session}: Cliente destruído - sessionKeepAlive vai reiniciar em breve`);
            
          } else if (client.pupPage && !client.pupPage.isClosed()) {
            // Tentar refresh da página (para casos menos graves)
            customLogger.info(`[AUTO-RECONNECT] ${session}: Refreshing page...`);
            await client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 }).catch(e => {
              customLogger.warning(`[AUTO-RECONNECT] ${session}: Refresh falhou: ${e.message}`);
            });
            
            // Aguardar um pouco e verificar se voltou
            await new Promise(r => setTimeout(r, 5000));
            
            const newState = await client.getState().catch(() => 'UNKNOWN');
            customLogger.info(`[AUTO-RECONNECT] ${session}: Novo estado após refresh: ${newState}`);
            
            if (newState === 'CONNECTED') {
              customLogger.success(`[✅ REVIVED] ${session}: Sessão revivida com sucesso!`);
              // Reset do timestamp para dar mais tempo
              lastMessageTime.set(session, Date.now());
              failureCount.set(session, 0);
              
              // Atualizar banco
              await Device.update({
                state: 'CONNECTED',
                status: 'CONNECTED',
                updated_at: new Date()
              }, { where: { session } }).catch(() => {});
            }
          }
        } catch (reconnectError) {
          customLogger.error(`[AUTO-RECONNECT] ${session}: Erro na reconexão: ${reconnectError.message}`);
        }

      } else if (health.getState !== 'CONNECTED') {
        results.warning++;
        customLogger.warning(`[HEALTH CHECK] ${session}: state=${health.getState}`);
      } else {
        results.healthy++;
        // `ready` perdido (ver dispararReadyPerdido): liga os ouvintes que faltaram.
        await dispararReadyPerdido(session, client);
        // E se mesmo assim a sessão não recebe o que o WhatsApp dela recebeu: recria.
        if (await vigiarSurdez(session, client)) continue;
        // E o banco, que ficou em INITIALIZING sem o `ready`, passa a dizer o que a
        // sessão é ao vivo (Capucho, 25/09 11h13: o painel mostrava "inicializando").
        await Device.update(
          { state: 'CONNECTED', status: 'CONNECTED', updated_at: new Date() },
          { where: { session, status: { [Op.notIn]: CONECTADOS } } }
        ).then(([n]) => {
          if (n) customLogger.info(`[HEALTH CHECK] ${session}: banco corrigido para CONNECTED (o ready não tinha disparado)`);
        }).catch(() => {});
      }
    }

    // Log resumo
    if (results.zombie > 0 || results.warning > 0) {
      customLogger.warning(
        `[HEALTH CHECK] Total: ${results.total} | ` +
        `✅ Healthy: ${results.healthy} | ` +
        `⚠️ Warning: ${results.warning} | ` +
        `🧟 Zombie: ${results.zombie}`
      );
    } else {
      customLogger.debug(`[HEALTH CHECK] ${results.total} sessão(ões) OK`);
    }

  } catch (error) {
    customLogger.error(`[HEALTH CHECK] Erro no ciclo: ${error.message}`);
  }
}

/**
 * Inicia o job de health check
 */
function startHealthCheckJob() {
  // Verificar se deve rodar neste processo (PM2 cluster)
  // 🔧 FIX: Só pular se estiver em CLUSTER mode com múltiplas instâncias
  // Em modo fork, pm_id pode ser qualquer número (ex: 4) e o job DEVE rodar
  const pmExecMode = process.env.exec_mode;
  const pmInstances = parseInt(process.env.instances || '1', 10);
  const pmId = process.env.pm_id ?? process.env.PM_ID;
  if (pmExecMode === 'cluster_mode' && pmInstances > 1 && pmId && pmId !== '0') {
    customLogger.info('[HEALTH CHECK] Ignorando neste worker PM2 (cluster mode)');
    return;
  }

  // Delay inicial de 2 minutos para dar tempo das sessões conectarem
  const initialDelay = 120000;

  setTimeout(() => {
    // Primeiro ciclo
    runHealthCheckCycle();

    // Agendar ciclos recorrentes
    intervalHandle = setInterval(runHealthCheckCycle, HEALTH_CHECK_INTERVAL_MS);
    if (typeof intervalHandle.unref === 'function') {
      intervalHandle.unref();
    }
  }, initialDelay);

  customLogger.info(
    `[HEALTH CHECK] Job agendado. Intervalo: ${HEALTH_CHECK_INTERVAL_MS}ms | ` +
    `Threshold zumbi: ${ZOMBIE_THRESHOLD_MINUTES} min | ` +
    `Delay inicial: ${initialDelay}ms`
  );
}

/**
 * Para o job de health check
 */
function stopHealthCheckJob() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    customLogger.info('[HEALTH CHECK] Job parado');
  }
}

/**
 * Retorna estatísticas do health check
 */
function getHealthStats() {
  return {
    lastMessageTimes: Object.fromEntries(lastMessageTime),
    lastSendTimes: Object.fromEntries(lastSendTime),
    sendFailureCounts: Object.fromEntries(sendFailureCount),
    lastHealthChecks: Object.fromEntries(lastHealthCheck),
    failureCounts: Object.fromEntries(failureCount)
  };
}

module.exports = {
  runHealthCheckCycle, // exposto para o teste (test/status-conectado.js)
  dispararReadyPerdido, // exposto para o teste (test/ready-perdido.js)
  vigiarSurdez, // exposto para o teste (test/vigia-surdez.js)
  startHealthCheckJob,
  stopHealthCheckJob,
  registerMessageReceived,
  registerSendSuccess,
  registerSendFailure,
  isClientHealthy,
  checkSessionHealth,
  getHealthStats
};
