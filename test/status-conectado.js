/**
 * Sessão que atende mas ficou "INITIALIZING" no banco (Capucho, 25/09/2026): o
 * `ready` do whatsapp-web.js 1.34.7 não disparou (corrida do hasSynced, #201653) e
 * o painel da loja mostrava "inicializando". O health check, que já pergunta o
 * estado ao vivo, acerta o banco: CONNECTED ao vivo → CONNECTED no banco.
 *
 * Uso: node test/status-conectado.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');
const Module = require('module');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => {
  const arquivo = resolver(rel);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};
const Op = { notIn: Symbol('notIn') };
const carregar = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido === 'sequelize' ? { Op } : carregar.call(this, pedido, ...resto);
};

const updates = [];
let sessoes = [];
stub('config.js', { sequelize: {} });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('Models/device.js', () => ({ update: async (dados, opcoes) => { updates.push({ dados, opcoes }); return [1]; } }));
stub('controllers/helper/core/sessions.js', { getAllSessions: () => sessoes, removeClientFromMemory() {} });

const { runHealthCheckCycle } = require(resolver('jobs/sessionHealthCheck.js'));
const cliente = (estado) => ({ getState: async () => estado, pupPage: { evaluate: async () => 2 } });

(async () => {
  sessoes = [{ session: 'capucho', client: cliente('CONNECTED') }];
  await runHealthCheckCycle();
  assert.equal(updates.length, 1, 'sessão viva: o banco é acertado');
  const { dados, opcoes } = updates[0];
  assert.equal(dados.status, 'CONNECTED');
  assert.equal(opcoes.where.session, 'capucho');
  assert.deepEqual(opcoes.where.status[Op.notIn], ['CONNECTED', 'inChat', 'isLogged', 'isConnected'], 'só escreve quando o banco NÃO diz conectado');
  console.log('ok   CONNECTED ao vivo acerta o banco (só se ele diz outra coisa)');

  updates.length = 0;
  sessoes = [{ session: 'semqr', client: cliente('UNPAIRED') }];
  await runHealthCheckCycle();
  assert.equal(updates.length, 0, 'sessão sem parear não vira CONNECTED');
  console.log('ok   sessão que não está conectada não é mexida');
  console.log('status-conectado: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
