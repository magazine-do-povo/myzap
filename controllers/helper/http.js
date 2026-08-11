/**
 * Ponte para `controllers/helper/core/http.js`.
 *
 * `functions/WPPConnect/helper/mensagens/util.js:5` faz
 * `require('../../../../controllers/helper/http')`, mas no repositório o arquivo
 * mora em `core/http.js` — o require não acompanhou a mudança de pasta. Na VPS
 * do upstream isso não aparece (deve existir um arquivo local não commitado);
 * numa imagem construída só com o que está no git, o processo morre no boot:
 *
 *   Error: Cannot find module '../../../../controllers/helper/http'
 *   requireStack: functions/WPPConnect/helper/mensagens/util.js → … → index.js
 *
 * Reexportar em uma linha é menos invasivo que editar o código do upstream: o
 * merge do fork continua limpo, e some sozinho no dia em que eles corrigirem o
 * caminho lá.
 */
module.exports = require('./core/http');
