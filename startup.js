"use strict";

const SessionsHelper = require("./controllers/helper/core/sessions.js");
const customLogger = require("./util/customLogger");

// O boot reabre sessão pelo MESMO caminho do keepalive (HTTP em si mesmo).
// Uma implementação só: se um dia mudar como se abre uma sessão, muda nos dois.
const { triggerStart, resolveBaseUrl } = require("./jobs/sessionKeepAlive");

// Imports dos jobs
const { startCacheCleanupJob } = require("./jobs/cacheCleanup");
const { startLogsCleanupJob } = require("./jobs/logsCleanup");
const { startDatabaseCleanupJob } = require("./jobs/databaseCleanup");
const { startInstancesCleanupJob } = require("./jobs/instancesCleanup");
const { startChatHistoryCleanupJob } = require("./jobs/chatHistoryCleanup");
const { startDailyReportJob } = require("./jobs/dailyReport");
const { startMemoryMonitorJob } = require("./jobs/memoryMonitor");
const { startInstanceMetricsJob } = require("./jobs/instanceMetrics");
// 🔍 Health Check - Detecta sessões zumbi
const { startHealthCheckJob } = require("./jobs/sessionHealthCheck");

/**
 * 🚀 Reabre, no boot, as sessões salvas no banco.
 *
 * PEDE PELA PRÓPRIA API (HTTP), NÃO CHAMA A ENGINE POR DENTRO — e essa é a
 * decisão inteira desta função.
 *
 * A versão anterior fabricava um `req`/`res` de mentira e chamava
 * `Engine.start(...)` direto. Nunca funcionou uma vez, e cada conserto revelava
 * a próxima peça que faltava no boneco:
 *
 *   1. sem `req.io` .......... Cannot read properties of undefined (reading 'emit')
 *   2. sem `req.body.session`  a engine em uso (WppConnect) lê o nome do BODY;
 *                             chegava vazio e gravava tudo num device de
 *                             session '' — "📊 Sessão  - tentativa de start #3"
 *   3. sem o receptor ....... guardar `WppConnect.start` numa variável desliga o
 *                             método da classe; dentro dele `this` fica
 *                             undefined (classe = strict mode) e
 *                             `this.initSession(req, res)` (WppConnect.js:149)
 *                             estourava
 *                             Cannot read properties of undefined (reading 'initSession')
 *   4. sem `res.headersSent`   o `while` que espera o QR (WppConnect.js:152)
 *                             nunca via a resposta e girava os 12s inteiros,
 *                             POR SESSÃO, atrasando até o agendamento dos jobs
 *
 * Persegui essa paridade até ficar claro que ela não tem fim: o alvo é o `req`
 * do Express, que cresce quando alguém mexe em middleware. Então paramos de
 * imitar e passamos a usar o original — o MESMO `POST /start` que o
 * `sessionKeepAlive` já usava e que comprovadamente funciona. De graça vêm o
 * Socket.IO, o body, a validação de `apitoken`/`sessionkey` e a escolha da
 * engine pelo Router (index.js:119) — a engine deixa de ser problema desta
 * função.
 *
 * Dá para chamar por HTTP aqui porque `index.js` invoca isto DENTRO do callback
 * de `server.listen`: a porta já está aceitando conexão.
 */
async function startAllSessions() {
  try {
    customLogger.info("[STARTUP] Buscando sessões no banco de dados...");

    const devices = await SessionsHelper.listDevices();

    if (!devices || devices.length === 0) {
      customLogger.info("[STARTUP] Nenhuma sessão encontrada para iniciar");
      return;
    }

    customLogger.info(`[STARTUP] ${devices.length} sessão(ões) encontrada(s)`);

    const baseURL = resolveBaseUrl();
    customLogger.info(`[STARTUP] Reabrindo sessões via ${baseURL}/start`);

    for (const device of devices) {
      const deviceData = device.dataValues || device;

      // Device sem `session` não é sessão de ninguém: é lixo de linha órfã no
      // banco (o defeito nº 2 acima criava uma). Tentar iniciar isso subia um
      // Chromium para nada — a parte caríssima do MyZap, o motivo de ele ter uma
      // máquina só dele — e ainda somava tentativa no registro errado.
      if (!deviceData.session) {
        customLogger.warning('[STARTUP] Ignorando device sem session (registro órfão no banco)');
        continue;
      }

      customLogger.info(`[STARTUP] Iniciando sessão: ${deviceData.session}`);

      const ok = await triggerStart(deviceData, baseURL);
      if (ok) {
        customLogger.success(`[STARTUP] ✅ Sessão ${deviceData.session} iniciada com sucesso`);
      } else {
        customLogger.error(`[STARTUP] ❌ Falha ao iniciar sessão ${deviceData.session}`);
      }

      // Uma sessão de cada vez, com respiro: cada `/start` pode subir um
      // Chromium, e três subindo juntos é justamente o pico de memória que
      // derruba este serviço.
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    customLogger.success("[STARTUP] Processo de inicialização de sessões disparado");

  } catch (error) {
    customLogger.error("[STARTUP] Erro ao iniciar sessões:", error);
    throw error;
  }
}

/**
 * 🧹 Inicia todos os jobs de limpeza e manutenção
 */
function startCleanupJobs() {
  try {
    customLogger.info("[JOBS] Iniciando jobs de limpeza e manutenção...");

    // Iniciar job de limpeza de cache
    if (typeof startCacheCleanupJob === 'function') {
      startCacheCleanupJob();
    } else {
      customLogger.warning("[JOBS] startCacheCleanupJob não disponível");
    }

    // Iniciar job de limpeza de logs
    if (typeof startLogsCleanupJob === 'function') {
      startLogsCleanupJob();
    } else {
      customLogger.warning("[JOBS] startLogsCleanupJob não disponível");
    }

    // Iniciar job de limpeza de banco de dados
    if (typeof startDatabaseCleanupJob === 'function') {
      startDatabaseCleanupJob();
    } else {
      customLogger.warning("[JOBS] startDatabaseCleanupJob não disponível");
    }

    // Iniciar job de limpeza de instâncias
    if (typeof startInstancesCleanupJob === 'function') {
      startInstancesCleanupJob();
    } else {
      customLogger.warning("[JOBS] startInstancesCleanupJob não disponível");
    }

    // Iniciar job de limpeza de histórico de chat
    if (typeof startChatHistoryCleanupJob === 'function') {
      startChatHistoryCleanupJob();
    } else {
      customLogger.warning("[JOBS] startChatHistoryCleanupJob não disponível");
    }

    // Iniciar job de relatório diário
    if (typeof startDailyReportJob === 'function') {
      startDailyReportJob();
    } else {
      customLogger.warning("[JOBS] startDailyReportJob não disponível");
    }

    // Iniciar job de monitoramento de memória
    if (typeof startMemoryMonitorJob === 'function') {
      startMemoryMonitorJob();
    } else {
      customLogger.warning("[JOBS] startMemoryMonitorJob não disponível");
    }

    // Iniciar job de métricas de instâncias
    if (typeof startInstanceMetricsJob === 'function') {
      startInstanceMetricsJob();
    } else {
      customLogger.warning("[JOBS] startInstanceMetricsJob não disponível");
    }

    // 🔍 Iniciar job de health check para detectar sessões zumbi
    if (typeof startHealthCheckJob === 'function') {
      startHealthCheckJob();
    } else {
      customLogger.warning("[JOBS] startHealthCheckJob não disponível");
    }

    customLogger.success("[JOBS] Todos os jobs foram inicializados");
    
  } catch (error) {
    customLogger.error("[JOBS] ❌ Erro ao iniciar jobs:", error);
  }
}

/**
 * 🔄 Inicializa todos os jobs (alias para startCleanupJobs)
 */
function initializeJobs() {
  return startCleanupJobs();
}

module.exports = {
  startAllSessions,
  startCleanupJobs,
  initializeJobs
};
