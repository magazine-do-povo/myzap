"use strict";

const config = require("./config");
const SessionsHelper = require("./controllers/helper/core/sessions.js");
const customLogger = require("./util/customLogger");

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
 * 🚀 Inicia todas as sessões salvas no banco de dados
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

    // Importar a engine dinamicamente baseado na configuração
    const engine = config.engine || 'WhatsappWebJS';
    let startSessionFunction;

    try {
      if (engine === 'WhatsappWebJS' || engine === '1') {
        const WhatsappWebJS = require('./engines/WhatsappWebJS');
        startSessionFunction = WhatsappWebJS.start;
      } else if (engine === 'WppConnect' || engine === '2') {
        const WppConnect = require('./engines/WppConnect');
        startSessionFunction = WppConnect.start;
      } else if (engine === 'Venom' || engine === '3') {
        const Venom = require('./engines/Venom');
        startSessionFunction = Venom.start;
      } else {
        customLogger.warn(`[STARTUP] Engine desconhecida: ${engine}. Usando WhatsappWebJS como padrão.`);
        const WhatsappWebJS = require('./engines/WhatsappWebJS');
        startSessionFunction = WhatsappWebJS.start;
      }
    } catch (error) {
      customLogger.error(`[STARTUP] Erro ao carregar engine ${engine}:`, error.message);
      return;
    }

    // Iniciar cada sessão SEM BLOQUEAR (não usar await)
    // Isso permite que todas as sessões iniciem mesmo que algumas precisem de QR code
    for (const device of devices) {
      const deviceData = device.dataValues || device;

      // Device sem `session` não é sessão de ninguém: é lixo de linha órfã no
      // banco. Tentar iniciar isso subia um Chromium para nada (a parte caríssima
      // do MyZap) e ainda somava tentativa de start no registro errado.
      if (!deviceData.session) {
        customLogger.warning('[STARTUP] Ignorando device sem session (registro órfão no banco)');
        continue;
      }

      customLogger.info(`[STARTUP] Iniciando sessão: ${deviceData.session}`);

      // Criar mock de req e res para a engine (ela espera req, res, session)
      const mockReq = {
        headers: {
          sessionkey: deviceData.sessionkey
        },
        body: {
          // `session` NO BODY, e não só como 3º argumento: das três engines, só
          // Venom e WhatsappWebJS aceitam `start(req, res, session)`. A WppConnect
          // — a que está em uso (ENGINE=2) — é `start(req, res)` e lê
          // `req.body.session`. Sem esta linha ela recebia session vazia, gravava
          // tudo num device de session '' e nunca achava os tokens em
          // ./instances/<session>: o restart não reconectava NINGUÉM, mesmo com o
          // Socket.IO já contornado.
          session: deviceData.session,
          number: deviceData.number || '',
          wh_connect: deviceData.wh_connect || '',
          wh_status: deviceData.wh_status || '',
          wh_message: deviceData.wh_message || '',
          wh_qrcode: deviceData.wh_qrcode || ''
        }
      };
      
      const mockRes = {
        status: () => mockRes,
        json: (data) => data,
        send: (data) => data
      };
      
      // Chama a função start da engine SEM AWAIT (não bloqueia)
      // Isso permite iniciar todas as sessões em paralelo
      startSessionFunction(mockReq, mockRes, deviceData.session)
        .then(() => {
          customLogger.success(`[STARTUP] ✅ Sessão ${deviceData.session} iniciada com sucesso`);
        })
        .catch((error) => {
          customLogger.error(`[STARTUP] ❌ Erro ao iniciar sessão ${deviceData.session}:`, error.message);
        });
      
      // Pequeno delay entre inicializações para não sobrecarregar
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
