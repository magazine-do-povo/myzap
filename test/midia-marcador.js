/**
 * Imagem/vídeo/figurinha não podem chegar ao agente como thumbnail em base64
 * (Capucho, 08/09/2026 23:16: 3,4 KB de "/9j/4AAQ..." como texto do cliente).
 * Rodar: PORT=1 node test/midia-marcador.js
 */
process.env.PORT = process.env.PORT || '1';
const assert = require('assert');
const { textoDaMensagem } = require('../controllers/helper/ia/textoMensagem');

const b64 = '/9j/4AAQSkZJRgABAQAASABIAAD/4QCMRXhpZgAATU0AKgAAAAgABQESAAMAAAABAAEAAAEaAAUAAAABAAAASgEbAAUAAAABAAAAUgEoAAMAAAABAAIAAIdpAAQAAAABAAAAWgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAGSgAwAEAAAAAQAAAGQAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfg==';
const casos = [
  [{ type: 'image', body: b64, caption: '' }, '[imagem]', 'imagem sem legenda'],
  [{ type: 'image', body: b64, caption: 'comprovante do pix' }, '[imagem] comprovante do pix', 'imagem com legenda'],
  [{ type: 'video', body: b64 }, '[vídeo]', 'vídeo'],
  [{ type: 'sticker', body: b64 }, '[figurinha]', 'figurinha'],
  [{ type: 'chat', body: 'Boa noite' }, 'Boa noite', 'texto normal'],
  [{ type: 'document', body: '1788903739590.pdf' }, '1788903739590.pdf', 'documento mantém o nome do arquivo'],
  [{ type: 'chat', body: b64 }, '[imagem]', 'base64 de JPEG sem tipo de mídia vira marcador'],
  [{ type: 'ptt', body: '' }, '', 'áudio: texto vazio (o áudio vai à parte)'],
  [{ type: 'location', body: 'Rua A, 10' }, 'Rua A, 10', 'localização mantém o texto'],
];
let falhas = 0;
for (const [msg, esperado, nome] of casos) {
  const obtido = textoDaMensagem(msg);
  try { assert.strictEqual(obtido, esperado); console.log(`ok   ${nome}`); }
  catch { falhas++; console.log(`FALHOU ${nome}: "${String(obtido).slice(0, 40)}" (esperado "${esperado}")`); }
}
console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} caso(s) falharam`);
process.exit(falhas === 0 ? 0 : 1);
