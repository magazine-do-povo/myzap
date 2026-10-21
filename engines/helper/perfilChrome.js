const fs = require('fs');
const path = require('path');

/**
 * Apaga os arquivos de RESTAURAÇÃO DE ABAS do perfil do Chrome da sessão.
 *
 * O pm2 mata o Chrome a cada reinício, e o perfil fica marcado "Crashed". Na
 * partida seguinte o Chrome restaura as abas da sessão anterior: a aba do
 * WhatsApp Web volta junto com a que a biblioteca abre, uma tira a vez da outra
 * ("O WhatsApp está aberto em outra janela") e a sessão fica CONNECTED e surda
 * (Sonhare, 26/09: uma hora sem receber nada, e de novo depois de um deploy).
 * O login mora no IndexedDB/Local Storage do perfil; aqui só há as abas.
 *
 * @param {string} pastaDoPerfil instances/<sessão>/session (o userDataDir do LocalAuth)
 * @returns {boolean} se havia algo para apagar
 */
function limparRestauracaoDeAbas(pastaDoPerfil) {
  const alvo = path.join(pastaDoPerfil, 'Default', 'Sessions');
  if (!fs.existsSync(alvo)) return false;
  fs.rmSync(alvo, { recursive: true, force: true });
  return true;
}

module.exports = { limparRestauracaoDeAbas };
