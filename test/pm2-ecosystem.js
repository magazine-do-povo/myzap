/**
 * PM2 pelo ecosystem (VPS, 11/10/2026): a produção rodava com `pm2 start index.js`, sem o
 * ecosystem.config.js — kill_timeout no padrão de 1,6 s, e o PM2 matava o Node antes de o
 * gracefulShutdown fechar os Chromes (sessão presa em INITIALIZING depois de todo deploy).
 * Aqui se garante que o ecosystem dá tempo ao desligamento (o deploy da VPS saiu em 18/10/2026).
 *
 * Uso: node test/pm2-ecosystem.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const app = require(path.join(raiz, 'ecosystem.config.js')).apps.find((a) => a.name === 'myzap');
assert.ok(app, 'app "myzap" no ecosystem');

// 1) kill_timeout cobre a saída forçada do gracefulShutdown (o hardExit do index.js) com folga
const indexSrc = fs.readFileSync(path.join(raiz, 'index.js'), 'utf8');
const hardExit = Number((indexSrc.match(/const hardExit = setTimeout\(\(\) => process\.exit\(0\), (\d+)\)/) || [])[1]);
assert.ok(hardExit > 0, 'hardExit do gracefulShutdown encontrado no index.js');
assert.ok(app.kill_timeout >= hardExit + 5000, `kill_timeout ${app.kill_timeout} < hardExit ${hardExit} + 5 s: o PM2 mataria o Node antes de fechar os Chromes`);
console.log(`ok   kill_timeout ${app.kill_timeout} ms cobre a saída forçada de ${hardExit} ms`);

// 2) restart por memória só para vazamento real (derruba todas as sessões): ausente ou ≥ 2 GB
const mem = String(app.max_memory_restart || '');
const mb = /^(\d+)G$/i.test(mem) ? Number(RegExp.$1) * 1024 : /^(\d+)M$/i.test(mem) ? Number(RegExp.$1) : null;
assert.ok(!mem || mb >= 2048, `max_memory_restart ${mem}: o Node usa ~570 MB e cada mídia passa pela memória — 1G reiniciava por pico`);
assert.deepEqual([app.exec_mode, app.instances], ['fork', 1], 'uma instância em fork: as sessões vivem na memória do processo');
console.log(`ok   max_memory_restart ${mem || 'ausente'}, fork com 1 instância`);

console.log('pm2-ecosystem: tudo ok');
process.exit(0);
