// O Chrome das sessões não usa o D-Bus da sessão do usuário: node test/chrome-sem-dbus.js
// (25/09/2026: preso à sessão systemd do root, morria a cada vez que ela parava.)
const assert = require('node:assert/strict');
// o config.js do MyZap exige estas; o teste não sobe servidor nenhum
Object.assign(process.env, { PORT: '0', TOKEN: 'teste', CORS_ORIGIN: '*', ENGINE: '1' });
process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/0/bus';
process.env.QUALQUER_OUTRA = 'fica';
const wweb = require('../engines/helper/wweb');
const opcoes = wweb.getClientOptions({ session: 'teste', useHere: true, sessionData: null });
assert.equal(opcoes.puppeteer.env.DBUS_SESSION_BUS_ADDRESS, 'disabled:', 'Chrome sem o barramento da sessão');
assert.equal(opcoes.puppeteer.env.QUALQUER_OUTRA, 'fica', 'o resto do ambiente segue para o Chrome');
assert.equal(process.env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/run/user/0/bus', 'o processo do MyZap não é alterado');
console.log('chrome-sem-dbus: 3 ✓');
