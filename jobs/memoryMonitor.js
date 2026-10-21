const os = require('os');
const v8 = require('v8');
const customLogger = require('../util/customLogger');
const emailAlertService = require('../services/emailAlertService');

let intervalHandle = null;

/**
 * 🚀 Job de monitoramento de memória
 * Reporta uso de memória do sistema e do processo a cada intervalo
 */
function startMemoryMonitorJob() {
  const intervaloMinutos = parseInt(process.env.MEMORY_MONITOR_INTERVAL_MINUTES, 10) || 15;
  const INTERVAL = intervaloMinutos * 60 * 1000;
  
  // Monitorar a cada X minutos
  intervalHandle = setInterval(() => {
    reportarUsoMemoria();
  }, INTERVAL);
  
  if (typeof intervalHandle.unref === 'function') {
    intervalHandle.unref();
  }
  
  // Reportar uma vez ao iniciar (após 1 minuto)
  setTimeout(() => {
    reportarUsoMemoria();
  }, 60 * 1000);
  
  customLogger.info(`[MEMORY MONITOR] Job agendado (${intervaloMinutos} minutos)`);
}

function reportarUsoMemoria(processMemory = process.memoryUsage(), heapLimite = v8.getHeapStatistics().heap_size_limit) {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usedPercent = ((usedMem / totalMem) * 100).toFixed(2);

    customLogger.info(`[MEMORY] Sistema: ${formatBytes(usedMem)}/${formatBytes(totalMem)} (${usedPercent}%)`);
    customLogger.info(`[MEMORY] Processo: RSS=${formatBytes(processMemory.rss)} Heap=${formatBytes(processMemory.heapUsed)}/${formatBytes(processMemory.heapTotal)} (teto ${formatBytes(heapLimite)})`);
    
    // Alertar se memória crítica
    if (usedPercent > 85) {
      customLogger.warning(`⚠️ [MEMORY] Uso crítico de memória do sistema: ${usedPercent}%`);
      
      // 📧 Enviar alerta por email
      emailAlertService.send('MEMORY_CRITICAL', { 
        memoryPercent: parseFloat(usedPercent),
        totalMemory: formatBytes(totalMem),
        usedMemory: formatBytes(usedMem),
        freeMemory: formatBytes(freeMem),
        uptime: process.uptime()
      });
    }
    
    // Alertar se o heap chega perto do TETO (--max-old-space-size). Antes comparava com
    // heapTotal, que é só o que o V8 já reservou — e ele reserva na medida do uso, então a
    // razão vive perto de 100%: 41 e-mails de "heap crítico" sem motivo (VPS, 11/10/2026).
    const heapPercent = (processMemory.heapUsed / heapLimite) * 100;
    if (heapPercent > 90) {
      customLogger.warning(`⚠️ [MEMORY] Uso crítico de heap do processo: ${heapPercent.toFixed(2)}% do teto de ${formatBytes(heapLimite)}`);

      // 📧 Enviar alerta por email
      emailAlertService.send('HEAP_CRITICAL', {
        heapPercent: heapPercent,
        heapUsed: formatBytes(processMemory.heapUsed),
        heapLimit: formatBytes(heapLimite),
        rss: formatBytes(processMemory.rss),
        external: formatBytes(processMemory.external),
        uptime: process.uptime()
      });
    }
    
  } catch (err) {
    customLogger.error(`[MEMORY MONITOR] Erro: ${err.message}`);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = { startMemoryMonitorJob, reportarUsoMemoria /* exposto para o teste (test/heap-alerta.js) */ };
