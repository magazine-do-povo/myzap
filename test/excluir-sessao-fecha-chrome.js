/**
 * Excluir sessão fecha o navegador (VPS, 11/10/2026): o /deleteSession fazia logout e fechava
 * só a ABA — o Chrome de uma sessão excluída em 09/10 seguia vivo dois dias depois (900 MB) e,
 * quando o banco falhava, a sessão nem saía da memória: zumbi a cada minuto no health check e
 * `/start` do keepalive nela. Agora o client é destruído com teto de tempo, a memória sai
 * antes do banco, e o banco falhando volta erro para quem excluiu repetir.
 *
 * Uso: node test/excluir-sessao-fecha-chrome.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };
process.exitCode = 1; // o loop esvaziar no meio (promessa pendurada) não pode passar por "ok"

let bancoFalha = false;
stub('config.js', { sequelize: {}, engine: '1' });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));
stub('Models/device.js', () => ({
  destroy: async () => { if (bancoFalha) throw new Error('SQLITE_BUSY: database is locked'); return 1; },
  findOne: async ({ where }) => ({ dataValues: { session: where.session, wh_message: '' } }),
}));
stub('Models/deviceCompany.js', () => ({}));
stub('util/cache.js', { del: async () => {} });

const SessionsHelper = require(resolver('controllers/helper/core/sessions.js'));
const Sessions = require(resolver('controllers/SessionsController.js'));
SessionsHelper.TETO_FECHAR_MS = 50;
const pendura = () => new Promise(() => {});
const wwebjs = ({ logout, destroy } = {}) => {
  const c = { destruido: 0, page: { fechada: 0, close: async () => { c.page.fechada++; } } };
  c.logout = logout || (async () => {});
  c.destroy = destroy || (async () => { c.destruido++; });
  return c;
};
const S = 'sessao-de-teste-excluir-chrome';

(async () => {
  // 1) logout quebra (página morta, como na VPS): o navegador é destruído mesmo assim
  let c = wwebjs({ logout: async () => { throw new Error('Protocol error: Target closed'); } });
  let r = await SessionsHelper.fecharSessaoComLogout({ client: c }, S);
  assert.deepEqual([r.logout, r.close, c.destruido], [false, true, 1]);
  console.log('ok   logout falhou: destroy() fecha o Chrome mesmo assim');

  // 2) logout que nunca responde: o teto solta, e o destroy ainda roda
  c = wwebjs({ logout: pendura });
  const t0 = Date.now();
  r = await SessionsHelper.fecharSessaoComLogout({ client: c }, S);
  assert.ok(Date.now() - t0 < 2000, 'não fica preso no logout');
  assert.deepEqual([r.logout, r.close, c.destruido], [false, true, 1]);
  console.log('ok   logout pendurado: teto de tempo, e o destroy roda em seguida');

  // 3) destroy pendurado: a exclusão não fica presa nele
  c = wwebjs({ destroy: pendura });
  r = await SessionsHelper.fecharSessaoComLogout({ client: c }, S);
  assert.deepEqual([r.logout, r.close], [true, false]);
  console.log('ok   destroy pendurado: teto de tempo, exclusão segue');

  // 4) wppconnect/venom: close()
  const wpp = { fechado: 0, logout: async () => {}, close: async () => { wpp.fechado++; } };
  r = await SessionsHelper.fecharSessaoComLogout({ client: wpp }, S);
  assert.deepEqual([r.close, wpp.fechado], [true, 1]);
  console.log('ok   wppconnect/venom: close()');

  // 5) banco falha ao apagar: a sessão sai da memória MESMO ASSIM (health check não a vê mais)
  SessionsHelper.injectClient(S, wwebjs());
  bancoFalha = true;
  assert.equal(await SessionsHelper.deleteSessionAndCleanup(S), false, 'avisa que o banco falhou');
  assert.deepEqual(SessionsHelper.getAllSessions().map((s) => s.session), [], 'fora da memória');
  bancoFalha = false;
  SessionsHelper.injectClient(S, wwebjs());
  assert.equal(await SessionsHelper.deleteSessionAndCleanup(S), true);
  assert.equal(SessionsHelper.getInjectedClient(S), undefined);
  console.log('ok   deleteSessionAndCleanup: memória sai antes do banco; banco falhando devolve false');

  // 6) a rota inteira: destrói o Chrome, limpa a memória; banco falhando = 500 para repetir
  const res = () => { const o = { codigo: 0, corpo: null }; o.status = (c2) => { o.codigo = c2; return o; }; o.json = (b) => { o.corpo = b; return o; }; return o; };
  c = wwebjs({ logout: async () => { throw new Error('Target closed'); } });
  SessionsHelper.injectClient(S, c);
  let out = res();
  await Sessions.deleteSession({ body: { session: S } }, out);
  assert.equal(out.codigo, 200, JSON.stringify(out.corpo));
  assert.deepEqual([c.destruido, SessionsHelper.getInjectedClient(S)], [1, undefined]);
  console.log('ok   /deleteSession: Chrome destruído e sessão fora da memória');

  c = wwebjs();
  SessionsHelper.injectClient(S, c);
  bancoFalha = true;
  out = res();
  await Sessions.deleteSession({ body: { session: S } }, out);
  bancoFalha = false;
  assert.equal(out.codigo, 500);
  assert.match(String(out.corpo.reason), /repita/);
  assert.deepEqual([c.destruido, SessionsHelper.getInjectedClient(S)], [1, undefined], 'mesmo com o banco falhando, Chrome fechado e memória limpa');
  console.log('ok   /deleteSession com o banco falhando: 500 "repita", mas Chrome fechado e memória limpa');

  console.log('excluir-sessao-fecha-chrome: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
