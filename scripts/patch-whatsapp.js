#!/usr/bin/env node

/**
 * Patches do whatsapp-web.js, aplicados no postinstall (o Dockerfile roda o `pnpm install`).
 *
 * 1. sendSeen -> markSeen: erro "Cannot read properties of undefined (reading 'markedUnread')".
 *    Issue: https://github.com/pedroslopez/whatsapp-web.js/issues/5718
 *    Fix: https://github.com/pedroslopez/whatsapp-web.js/pull/5719
 *
 * 2. Mídia não sai: "Data passed to getter must include an id property (it's how we memoize)
 *    but got undefined". O WhatsApp Web 2.3000.1047775310 (17/09/2026) passou a devolver no
 *    processMediaData um modelo com `__x_id` enumerável; espalhado no objeto da mensagem, ele
 *    troca o id do Msg e o getValidatedSender quebra. Texto não é afetado; imagem, vídeo, áudio,
 *    voz e documento são — para qualquer contato, @c.us ou @lid (loja piloto da Celularis,
 *    23/09/2026: a foto de como chegar não saía para cliente novo). Mesma linha do commit do
 *    mantenedor, ainda sem versão publicada:
 *    https://github.com/wwebjs/whatsapp-web.js/commit/78924aea793ddc93e03ddefff8d9da526420ec5a
 *    (issues #201921 e #201922). Sai daqui quando a versão com a correção entrar no lockfile.
 *
 * 3. Mídia recebida não baixa às vezes ("Erro ao baixar mídia: t"): o downloadAndMaybeDecrypt
 *    do WhatsApp Web atual toma o mimetype do argumento e, sem ele, assume
 *    application/octet-stream — a lista de tipos aceitos recusa isso para imagem, áudio e voz com
 *    InvalidMediaFileType (a classe minificada "t"). Só acontece quando a mídia não está no cache
 *    de download do WhatsApp Web (chave: filehash), e por isso é intermitente: o primeiro áudio de
 *    um cliente novo falhava e o seguinte baixava (loja piloto da Celularis, 24/09/2026). O
 *    Message.downloadMedia do 1.34.7 não passa o mimetype; o patch passa `msg.mimetype`, como na
 *    issue #201908 do wwebjs/whatsapp-web.js (testada no 1.34.7, ainda sem correção publicada).
 */

const fs = require('fs');
const path = require('path');

const utilsPath = path.join(
  __dirname,
  '..',
  'node_modules/whatsapp-web.js/src/util/Injected/Utils.js'
);

const messagePath = path.join(
  __dirname,
  '..',
  'node_modules/whatsapp-web.js/src/structures/Message.js'
);

const CORRECAO_ID_DA_MIDIA = 'delete message.__x_id;';
const ANCORA_ID_DA_MIDIA = "        // Bot's won't reply if canonicalUrl is set (linking)\n";

/**
 * Tira o `__x_id` do objeto da mensagem logo depois de montá-lo em window.WWebJS.sendMessage.
 * Idempotente. Lança se não achar onde entrar: sem o patch a mídia não sai, e melhor o build
 * quebrar do que subir o motor mudo.
 */
function patchIdDaMidia(content) {
  if (content.includes(CORRECAO_ID_DA_MIDIA)) return content;
  const partes = content.split(ANCORA_ID_DA_MIDIA);
  if (partes.length !== 2) {
    throw new Error(`âncora do __x_id achada ${partes.length - 1} vez(es) em Utils.js (esperado: 1)`);
  }
  return partes[0]
    + '        // MediaData espalhado acima traz o id privado do modelo e troca o do Msg (patch do MyZap).\n'
    + `        ${CORRECAO_ID_DA_MIDIA}\n\n`
    + ANCORA_ID_DA_MIDIA
    + partes[1];
}

const ANCORA_MIMETYPE = '                        type: msg.type,\n'
  + '                        signal: new AbortController().signal,\n';
const COM_MIMETYPE = '                        type: msg.type,\n'
  + '                        mimetype: msg.mimetype, // patch do MyZap: sem ele, octet-stream e InvalidMediaFileType\n'
  + '                        signal: new AbortController().signal,\n';

/** Passa o mimetype da mensagem ao downloadAndMaybeDecrypt do Message.downloadMedia. Idempotente; lança se a forma mudou. */
function patchMimetypeDoDownload(content) {
  if (content.includes(COM_MIMETYPE)) return content;
  const partes = content.split(ANCORA_MIMETYPE);
  if (partes.length !== 2) {
    throw new Error(`âncora do mimetype achada ${partes.length - 1} vez(es) em Message.js (esperado: 1)`);
  }
  return partes[0] + COM_MIMETYPE + partes[1];
}

if (require.main === module) {
  if (!fs.existsSync(utilsPath)) {
    console.log('[patch] whatsapp-web.js não instalado, pulando patch...');
    process.exit(0);
  }

  try {
    let content = fs.readFileSync(utilsPath, 'utf8');

    if (content.includes('SendSeen.sendSeen')) {
      content = content.replace(
        'await window.Store.SendSeen.sendSeen(chat);',
        'await window.Store.SendSeen.markSeen(chat);'
      );
      console.log('[patch] whatsapp-web.js corrigido: sendSeen -> markSeen');
    } else if (content.includes('SendSeen.markSeen')) {
      console.log('[patch] ℹ️ whatsapp-web.js já está corrigido');
    } else {
      console.log('[patch] ⚠️ sendSeen não encontrado em Utils.js, estrutura pode ter mudado');
    }

    const comIdDaMidia = patchIdDaMidia(content);
    console.log(comIdDaMidia === content && content.includes(CORRECAO_ID_DA_MIDIA)
      ? '[patch] ℹ️ id da mídia já corrigido'
      : '[patch] whatsapp-web.js corrigido: mídia sem o __x_id do MediaData');
    fs.writeFileSync(utilsPath, comIdDaMidia, 'utf8');

    const message = fs.readFileSync(messagePath, 'utf8');
    const comMimetype = patchMimetypeDoDownload(message);
    console.log(comMimetype === message
      ? '[patch] ℹ️ mimetype do download já corrigido'
      : '[patch] whatsapp-web.js corrigido: download de mídia com o mimetype da mensagem');
    fs.writeFileSync(messagePath, comMimetype, 'utf8');
  } catch (error) {
    console.error('[patch] ❌ Erro ao aplicar patch:', error.message);
    process.exit(1);
  }
}

module.exports = { patchIdDaMidia, patchMimetypeDoDownload };
