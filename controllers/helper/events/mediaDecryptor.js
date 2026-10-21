const customLogger = require('../../../util/customLogger');

/**
 * Adapter para descriptografia de arquivos de mídia
 * Compatível com: WPPConnect, Venom, whatsapp-web.js
 */

async function detectEngine(client) {
  if (!client || typeof client !== 'object') return 'desconhecido';
  // Heurísticas simples baseadas em métodos disponíveis
  if (client?.constructor?.name === 'Client' && client?.getChatById) return 'webjs';
  if (client?.sendText && client?.getWAVersion) return 'wppconnect';
  if (client?.sendText && client?.getSessionTokenBrowser) return 'venom';
  return 'generico';
}

const crypto = require('crypto');

// Info do HKDF por tipo de mídia (protocolo do WhatsApp)
const INFO_HKDF = {
  ptt: 'WhatsApp Audio Keys',
  audio: 'WhatsApp Audio Keys',
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  document: 'WhatsApp Document Keys',
  sticker: 'WhatsApp Image Keys',
};

/**
 * Descriptografia MANUAL (sem navegador): baixa o .enc da CDN do WhatsApp e
 * descriptografa com a mediaKey (HKDF-SHA256 -> AES-256-CBC), como o Baileys.
 *
 * Existe porque o downloadMedia() do whatsapp-web.js roda dentro da página e
 * quebra a cada atualização do WhatsApp Web ("Evaluation failed: r" — caso
 * real com áudios em 31/08/2026, ainda presente na 1.34.7). Este caminho só
 * depende de HTTPS + crypto do Node.
 */
async function decryptManual(message) {
  const dados = message?._data || message || {};
  const mediaKey = message?.mediaKey || dados.mediaKey;
  const url = dados.deprecatedMms3Url
    || (dados.directPath ? `https://mmg.whatsapp.net${dados.directPath}` : null);
  const tipo = message?.type || dados.type;
  const info = INFO_HKDF[tipo];

  if (!mediaKey || !url || !info) {
    throw new Error(`decrypt manual sem dados (mediaKey=${!!mediaKey} url=${!!url} tipo=${tipo})`);
  }

  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`download da mídia HTTP ${resp.status}`);
  const cifrado = Buffer.from(await resp.arrayBuffer());
  if (cifrado.length <= 10) throw new Error('mídia cifrada curta demais');

  // HKDF expande a mediaKey em 112 bytes: iv (16) + chave AES (32) + macKey (32)...
  const expandido = Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(mediaKey, 'base64'), Buffer.alloc(0), Buffer.from(info), 112)
  );
  const iv = expandido.subarray(0, 16);
  const chave = expandido.subarray(16, 48);
  const macKey = expandido.subarray(48, 80);

  const corpo = cifrado.subarray(0, cifrado.length - 10);
  const macRecebido = cifrado.subarray(cifrado.length - 10);

  // valida o MAC (10 primeiros bytes do HMAC de iv+corpo) antes de decifrar
  const macCalculado = crypto.createHmac('sha256', macKey)
    .update(Buffer.concat([iv, corpo])).digest().subarray(0, 10);
  if (!crypto.timingSafeEqual(macRecebido, macCalculado)) {
    throw new Error('MAC da mídia não confere');
  }

  const decifrador = crypto.createDecipheriv('aes-256-cbc', chave, iv);
  return Buffer.concat([decifrador.update(corpo), decifrador.final()]);
}

async function decryptFile({ client, message }) {
  if (!client || !message) {
    throw new Error('Cliente ou mensagem não fornecidos');
  }

  const engine = await detectEngine(client);
  
  try {
    switch (engine) {
      case 'webjs':
        // WhatsApp Web.js - a mídia é baixada a partir do próprio objeto da mensagem
        if (message) {
          let msgObj = message;
          // Fallback: se perdeu métodos (objeto plain), tentar reobter via client.getMessageById
          const hasDownload = typeof msgObj.downloadMedia === 'function';
          if (!hasDownload && client && typeof client.getMessageById === 'function') {
            try {
              const id = msgObj?.id?._serialized || msgObj?.id || msgObj?.id?._id;
              if (id) {
                const fetched = await client.getMessageById(id);
                if (fetched) msgObj = fetched;
              }
            } catch (e) {
              customLogger.debug('[MediaDecryptor] Fallback getMessageById falhou: ' + (e.message || e));
            }
          }
          if (typeof msgObj.downloadMedia === 'function') {
            try {
              const media = await msgObj.downloadMedia();
              if (media?.data) return Buffer.from(media.data, 'base64');
              if (typeof media === 'string') return Buffer.from(media, 'base64');
              throw new Error(media ? 'Objeto de mídia sem campo data' : 'downloadMedia retornou vazio');
            } catch (e) {
              customLogger.warning(`[MediaDecryptor] downloadMedia falhou (${e.message}) — tentando decrypt manual`);
              return await decryptManual(msgObj);
            }
          }
          // Sem métodos do wwebjs (objeto plain): direto no manual
          return await decryptManual(msgObj);
        }
        throw new Error('mensagem ausente no WhatsApp Web.js');
        
      case 'wppconnect':
      case 'venom':
        // Ambos expõem decryptFile(message)
        if (typeof client.decryptFile === 'function') {
          return await client.decryptFile(message);
        }
        throw new Error('decryptFile não disponível');
        
      default:
        // Tentar métodos conhecidos em ordem de prioridade
        if (typeof client.decryptFile === 'function') {
          return await client.decryptFile(message);
        } else if (typeof client.downloadMedia === 'function') {
          const media = await client.downloadMedia(message);
          if (media && media.data) {
            return Buffer.from(media.data, 'base64');
          }
        } else if (message.downloadMedia && typeof message.downloadMedia === 'function') {
          const media = await message.downloadMedia();
          if (media && media.data) {
            return Buffer.from(media.data, 'base64');
          }
        }
        
        throw new Error(`Nenhum método de descriptografia suportado para engine: ${engine}`);
    }
  } catch (err) {
    const onde = (err.stack || '').split('\n')[1]?.trim() || '';
    customLogger.error(`[MediaDecryptor] Falha ao descriptografar (${engine}): ${err.message} ${onde}`);
    throw new Error(`Erro na descriptografia: ${err.message}`);
  }
}

module.exports = { decryptFile, detectEngine };
