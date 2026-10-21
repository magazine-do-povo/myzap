/**
 * O Chrome restaurava a aba do WhatsApp da vez anterior (o pm2 mata o Chrome e o
 * perfil fica "Crashed"): duas abas, "aberto em outra janela", sessão surda
 * (Sonhare, 26/09). Antes de subir o Chrome, os arquivos de restauração de abas
 * saem; o resto do perfil (o login) fica.
 *
 * Uso: node test/perfil-sem-abas-antigas.js  (exit 0 = ok, 1 = quebrou)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { limparRestauracaoDeAbas } = require(path.join(__dirname, '..', 'engines', 'helper', 'perfilChrome.js'));

const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-'));
fs.mkdirSync(path.join(perfil, 'Default', 'Sessions'), { recursive: true });
fs.writeFileSync(path.join(perfil, 'Default', 'Sessions', 'Tabs_13434903381337919'), 'aba do whatsapp');
fs.mkdirSync(path.join(perfil, 'Default', 'IndexedDB'), { recursive: true });
fs.writeFileSync(path.join(perfil, 'Default', 'IndexedDB', 'login'), 'credenciais');

assert.equal(limparRestauracaoDeAbas(perfil), true);
assert.equal(fs.existsSync(path.join(perfil, 'Default', 'Sessions')), false, 'abas da vez anterior saem');
assert.equal(fs.existsSync(path.join(perfil, 'Default', 'IndexedDB', 'login')), true, 'o login fica');
console.log('ok   restauração de abas apagada, login intacto');
assert.equal(limparRestauracaoDeAbas(perfil), false, 'sem nada para apagar: segue');
assert.equal(limparRestauracaoDeAbas(path.join(perfil, 'nao-existe')), false);
console.log('ok   perfil sem restauração (ou novo): nada a fazer');
fs.rmSync(perfil, { recursive: true, force: true });
console.log('perfil-sem-abas-antigas: tudo ok');
