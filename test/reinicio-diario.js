/**
 * Reinício diário pelo próprio MyZap (VPS, 11/10/2026): o cron `pm2 restart myzap` falhava
 * todo dia com "pm2: command not found" (pm2 no nvm, fora do PATH do cron) e o processo
 * ficava semanas de pé. Agora o processo chama o desligamento limpo na hora marcada
 * (fuso de Brasília) e o PM2 religa — e só nasce ligado sob PM2.
 *
 * Uso: node test/reinicio-diario.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));

const { startDailyRestartJob, msAteProximo } = require(resolver('jobs/dailyRestart.js'));
const H = 3600 * 1000;

// 1) a conta da hora, em Brasília (UTC-3): 02:00 → 1 h até as 3h; 03:00 em ponto → amanhã
assert.equal(msAteProximo(3, new Date('2026-10-11T05:00:00Z')), 1 * H);
assert.equal(msAteProximo(3, new Date('2026-10-11T06:00:00Z')), 24 * H, 'na hora exata, só no dia seguinte');
assert.equal(msAteProximo(3, new Date('2026-10-11T06:00:01.500Z')), 24 * H - 1500);
assert.equal(msAteProximo(0, new Date('2026-10-11T02:59:59Z')), 1000, 'meia-noite de Brasília, não UTC');
assert.equal(msAteProximo(15, new Date('2026-10-11T12:00:00Z')), 6 * H);
console.log('ok   a próxima ocorrência é calculada no fuso America/Sao_Paulo');

// 2) o agendamento: setTimeout capturado, sem esperar de verdade
let agendado = null;
const setTimeoutReal = global.setTimeout;
global.setTimeout = (fn, ms) => { agendado = { fn, ms }; return { unref() {} }; };
const limpar = () => { agendado = null; delete process.env.REINICIO_DIARIO; delete process.env.REINICIO_DIARIO_HORA; delete process.env.pm_id; };
try {
  // fora do PM2 e sem a variável: não agenda (sem supervisor, reiniciar é se matar)
  limpar();
  assert.equal(startDailyRestartJob(() => {}), null);
  assert.equal(agendado, null);
  console.log('ok   fora do PM2 (sem pm_id) e sem REINICIO_DIARIO: desligado');

  // sob PM2: agenda para as 3h e, na hora, chama o desligamento limpo
  limpar();
  process.env.pm_id = '0';
  const chamadas = [];
  const timer = startDailyRestartJob((sinal) => chamadas.push(sinal));
  assert.ok(timer && agendado, 'agendou');
  assert.ok(Math.abs(agendado.ms - msAteProximo(3)) < 1000, `3h: ${agendado.ms} ms`);
  agendado.fn();
  assert.deepEqual(chamadas, ['REINICIO_DIARIO'], 'na hora, chama o gracefulShutdown');
  console.log('ok   sob PM2: agenda para as 3h e chama o desligamento limpo na hora');

  // REINICIO_DIARIO=0 desliga mesmo sob PM2
  limpar();
  process.env.pm_id = '0';
  process.env.REINICIO_DIARIO = '0';
  assert.equal(startDailyRestartJob(() => {}), null);
  console.log('ok   REINICIO_DIARIO=0: desligado');

  // REINICIO_DIARIO=1 força fora do PM2, na hora pedida; hora inválida cai no padrão
  limpar();
  process.env.REINICIO_DIARIO = '1';
  process.env.REINICIO_DIARIO_HORA = '4';
  startDailyRestartJob(() => {});
  assert.ok(Math.abs(agendado.ms - msAteProximo(4)) < 1000, '4h');
  process.env.REINICIO_DIARIO_HORA = '25';
  startDailyRestartJob(() => {});
  assert.ok(Math.abs(agendado.ms - msAteProximo(3)) < 1000, 'hora inválida: 3h');
  console.log('ok   REINICIO_DIARIO=1 força fora do PM2; REINICIO_DIARIO_HORA vale, inválida vira 3h');
} finally {
  global.setTimeout = setTimeoutReal;
  limpar();
}

console.log('reinicio-diario: tudo ok');
process.exit(0);
