const customLogger = require('../util/customLogger');

/**
 * Reinício diário feito pelo próprio MyZap.
 *
 * O cron da VPS (`0 3 * * * pm2 restart myzap`) falhava todo dia com "pm2: command not
 * found" — o pm2 vive no nvm, fora do PATH do cron — e o processo ficava semanas de pé,
 * com o Chrome de cada sessão vazando memória (11/10/2026: 0,6 a 4,4 GB por sessão). Aqui
 * o próprio processo chama o desligamento limpo do index.js (gracefulShutdown: fecha os
 * Chromes, solta os perfis e sai com 0) e o PM2 o religa sozinho.
 *
 * Só nasce ligado sob PM2 (`pm_id` no ambiente): sem um supervisor que religue um exit 0,
 * reiniciar é se matar — no k8s o CronJob já reinicia um pod por vez, e o gerenciador das
 * lojas trata saída como queda. REINICIO_DIARIO=1 força (Docker com restart: always),
 * REINICIO_DIARIO=0 desliga; REINICIO_DIARIO_HORA (0-23, padrão 3) é no fuso de Brasília.
 */
const FUSO = 'America/Sao_Paulo';

/** Milissegundos até a próxima vez que der `hora`:00 no fuso de Brasília (nunca zero). */
function msAteProximo(hora, agora = new Date()) {
  const [h, m, s] = new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .format(agora).split(':').map(Number);
  const faltam = (hora * 3600 - (h * 3600 + m * 60 + s) + 86400) % 86400;
  return (faltam || 86400) * 1000 - agora.getMilliseconds();
}

function startDailyRestartJob(desligar) {
  const env = process.env.REINICIO_DIARIO;
  const ligado = env === undefined || env === '' ? process.env.pm_id !== undefined : env !== '0';
  if (!ligado) {
    customLogger.info('[REINICIO DIARIO] desligado (REINICIO_DIARIO=0, ou fora do PM2 sem REINICIO_DIARIO=1)');
    return null;
  }

  const pedida = parseInt(process.env.REINICIO_DIARIO_HORA, 10);
  const hora = pedida >= 0 && pedida <= 23 ? pedida : 3;
  const ms = msAteProximo(hora);
  const timer = setTimeout(() => {
    customLogger.info(`[REINICIO DIARIO] ${hora}h: desligando limpo para o PM2 religar`);
    desligar('REINICIO_DIARIO');
  }, ms);
  if (typeof timer.unref === 'function') timer.unref();

  customLogger.info(`[REINICIO DIARIO] agendado para as ${hora}h (${FUSO}), daqui a ${Math.round(ms / 60000)} min`);
  return timer;
}

module.exports = { startDailyRestartJob, msAteProximo };
