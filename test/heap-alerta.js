/**
 * Alerta de heap (VPS, 11/10/2026): 41 e-mails de "heap crítico" sem motivo. O monitor
 * comparava heapUsed/heapTotal — heapTotal é o que o V8 já reservou, e ele reserva na medida
 * do uso, então a razão vive perto de 100%. O que pode estourar é o teto do heap
 * (v8.getHeapStatistics().heap_size_limit): é contra ele que se mede agora.
 *
 * Uso: node test/heap-alerta.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const enviados = [];
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('services/emailAlertService.js', { send: async (tipo, dados) => { enviados.push({ tipo, dados }); } });

const { reportarUsoMemoria } = require(resolver('jobs/memoryMonitor.js'));
const MB = 1024 * 1024;
const heapCritico = () => enviados.filter((e) => e.tipo === 'HEAP_CRITICAL');

// 1) o caso da VPS: heap 98% do reservado, mas 12% do teto de 1 GB — nada de alerta
reportarUsoMemoria({ rss: 570 * MB, heapUsed: 118 * MB, heapTotal: 120 * MB, external: 10 * MB }, 1024 * MB);
assert.equal(heapCritico().length, 0, 'heapUsed/heapTotal perto de 100% NÃO é heap crítico');
console.log('ok   heap 98% do reservado e 12% do teto: sem alerta');

// 2) 95% do teto: aí sim
reportarUsoMemoria({ rss: 1100 * MB, heapUsed: 973 * MB, heapTotal: 1000 * MB, external: 10 * MB }, 1024 * MB);
assert.equal(heapCritico().length, 1);
assert.ok(heapCritico()[0].dados.heapPercent > 90 && heapCritico()[0].dados.heapLimit === '1 GB', JSON.stringify(heapCritico()[0].dados));
console.log('ok   heap a 95% do teto: alerta, com o teto no e-mail');

// 3) o processo real deste teste: longe do teto, sem alerta
enviados.length = 0;
reportarUsoMemoria();
assert.equal(heapCritico().length, 0, 'um processo de teste não está perto do teto do heap');
console.log('ok   medição real do processo: sem alerta');

console.log('heap-alerta: tudo ok');
process.exit(0);
