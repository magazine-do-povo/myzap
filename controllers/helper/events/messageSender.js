/**
 * Adapter unificado para envio de mensagens e indicadores de digitação
 * compatível com: WPPConnect, Venom, whatsapp-web.js.
 */
const customLogger = require('../../../util/customLogger');
const { registerSystemMedia } = require('../ia/iaResponseCache');

async function detectEngine(client) {
  if (!client || typeof client !== 'object') return 'desconhecido';
  // Heurísticas simples
  if (client?.constructor?.name === 'Client' && client?.getChatById) return 'webjs';
  if (client?.sendText && client?.getWAVersion) return 'wppconnect';
  if (client?.sendText && client?.getSessionTokenBrowser) return 'venom';
  return 'generico';
}

/**
 * Verifica se um número está registrado no WhatsApp
 * @param {Object} client - Cliente do WhatsApp
 * @param {string} number - Número limpo (apenas dígitos)
 * @returns {Promise<Object|null>} Retorna o ID do WhatsApp ou null se não existir
 */
async function verifyNumber(client, number) {
  if (!client || !number) return null;
  const engine = await detectEngine(client);
  
  try {
    switch (engine) {
      case 'webjs':
        // whatsapp-web.js usa getNumberId()
        if (typeof client.getNumberId === 'function') {
          let numberId = await client.getNumberId(number);
          
          // Tenta sem o 9º dígito se o número tiver 13 dígitos (55 + DDD + 9 dígitos)
          if (!numberId && number.length === 13 && number.startsWith('55')) {
            const numberWithout9 = number.slice(0, 4) + number.slice(5);
            customLogger.info(`[MessageSender] Tentando sem o 9º dígito: ${numberWithout9}`);
            numberId = await client.getNumberId(numberWithout9);
          }
          
          // Tenta com o 9º dígito se o número tiver 12 dígitos (55 + DDD + 8 dígitos)
          if (!numberId && number.length === 12 && number.startsWith('55')) {
            const numberWith9 = number.slice(0, 4) + '9' + number.slice(4);
            customLogger.info(`[MessageSender] Tentando com o 9º dígito: ${numberWith9}`);
            numberId = await client.getNumberId(numberWith9);
          }
          
          return numberId; // Retorna objeto com _serialized ou null
        }
        break;
      case 'wppconnect':
      case 'venom':
        // WPPConnect/Venom usam checkNumberStatus()
        if (typeof client.checkNumberStatus === 'function') {
          const status = await client.checkNumberStatus(number);
          if (status?.numberExists) {
            return status?.id || { _serialized: `${number}@c.us` };
          }
          return null;
        }
        break;
      default:
        // Fallback - assume que existe
        return { _serialized: `${number}@c.us` };
    }
  } catch (err) {
    customLogger.error(`[MessageSender] Erro ao verificar número (${engine}): ${err.message}`);
  }
  return null;
}

async function sendText({ client, to, text }) {
  if (!client || !to || !text) return false;
  const engine = await detectEngine(client);
  try {
    switch (engine) {
      case 'webjs':
        // whatsapp-web.js -> sendMessage(chatId, content, options)
        // Fix para erro markedUnread: usar sendSeen: false
        await client.sendMessage(to, text, { sendSeen: false });
        break;
      case 'wppconnect':
      case 'venom':
        // Ambos expõem sendText(number, text, [opts])
        await client.sendText(to, text);
        break;
      default:
        if (typeof client.sendText === 'function') {
          await client.sendText(to, text);
        } else if (typeof client.sendMessage === 'function') {
          await client.sendMessage(to, text);
        } else {
          throw new Error('Nenhum método de envio suportado (sendText / sendMessage)');
        }
    }
    return true;
  } catch (err) {
    customLogger.error(`[MessageSender] Falha ao enviar texto (${engine}) -> ${err.message}`);
    return false;
  }
}

// webjs: chatstate DIRETO na página (window.WWebJS.sendChatstate), sem passar
// pelo getChatById — o lookup do Chat quebra a cada atualização do WhatsApp
// Web ("Evaluation failed: r", 31/08) e o cliente ficava sem o "digitando...".
// É exatamente o que Chat.sendStateTyping faz por dentro, menos o lookup.
async function chatstateWebjs(client, to, estado) {
  if (!client?.pupPage) return;
  await client.pupPage.evaluate(
    (state, chatId) => window.WWebJS?.sendChatstate?.(state, chatId),
    estado,
    to
  );
}

async function startTyping({ client, to }) {
  if (!client || !to) return;
  const engine = await detectEngine(client);
  try {
    switch (engine) {
      case 'webjs':
        await chatstateWebjs(client, to, 'typing');
        break;
      case 'wppconnect':
      case 'venom':
        if (typeof client.startTyping === 'function') {
          await client.startTyping(to);
        }
        break;
      default:
        // no-op
        break;
    }
  } catch (err) {
    customLogger.warning(`[MessageSender] Erro startTyping (${engine}): ${err.message} ${(err.stack || '').split('\n')[1]?.trim() || ''}`);
  }
}

/** "gravando áudio..." — usado quando a resposta ao cliente vem em voz (TTS) */
async function startRecording({ client, to }) {
  if (!client || !to) return;
  const engine = await detectEngine(client);
  try {
    if (engine === 'webjs') await chatstateWebjs(client, to, 'recording');
    else if (typeof client.startRecording === 'function') await client.startRecording(to);
  } catch (err) {
    customLogger.warning(`[MessageSender] Erro startRecording (${engine}): ${err.message}`);
  }
}

async function stopTyping({ client, to }) {
  if (!client || !to) return;
  const engine = await detectEngine(client);
  try {
    switch (engine) {
      case 'webjs':
        await chatstateWebjs(client, to, 'stop');
        break;
      case 'wppconnect':
      case 'venom':
        if (typeof client.stopTyping === 'function') {
          await client.stopTyping(to);
        }
        break;
      default:
        break; // no-op
    }
  } catch (err) {
    customLogger.warning(`[MessageSender] Erro stopTyping (${engine}): ${err.message} ${(err.stack || '').split('\n')[1]?.trim() || ''}`);
  }
}

/**
 * Envia áudio como mensagem de voz (PTT). Usado pela resposta em áudio do
 * Atendente IA (cliente mandou áudio -> agente devolve TTS em ogg/opus).
 * Falhou? O chamador cai para sendText — nunca deixar o cliente sem resposta.
 */
async function sendPtt({ client, to, base64, mimetype, session }) {
  if (!client || !to || !base64) return false;
  registerSystemMedia(session, to);
  const engine = await detectEngine(client);
  try {
    switch (engine) {
      case 'webjs': {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = new MessageMedia(mimetype || 'audio/ogg; codecs=opus', base64, 'resposta.ogg');
        await client.sendMessage(to, media, { sendAudioAsVoice: true, sendSeen: false });
        break; }
      case 'wppconnect':
      case 'venom':
        if (typeof client.sendPttFromBase64 === 'function') {
          await client.sendPttFromBase64(to, `data:audio/ogg;base64,${base64}`, 'resposta');
        } else {
          throw new Error('sendPttFromBase64 indisponível');
        }
        break;
      default:
        throw new Error('engine sem suporte a PTT');
    }
    return true;
  } catch (err) {
    customLogger.error(`[MessageSender] Falha ao enviar PTT (${engine}) -> ${err.message}`);
    return false;
  }
}

async function baixarComoBase64(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { base64: buffer.toString('base64'), mimetype: resp.headers.get('content-type') || null };
}

/**
 * Manda um arquivo (imagem ou documento) a partir de uma URL pública.
 * Imagem vai como foto; qualquer outro mime (PDF) vai como documento.
 */
async function sendFileFromUrl({ client, to, url, filename, mimetype, caption, session }) {
  if (!client || !to || !url) return false;
  registerSystemMedia(session, to);
  const engine = await detectEngine(client);
  try {
    const baixado = await baixarComoBase64(url);
    const mime = mimetype || baixado.mimetype || 'application/octet-stream';
    const nome = filename || url.split('/').pop() || 'arquivo';
    switch (engine) {
      case 'webjs': {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = new MessageMedia(mime, baixado.base64, nome);
        await client.sendMessage(to, media, {
          sendSeen: false,
          caption: caption || undefined,
          sendMediaAsDocument: !mime.startsWith('image/'),
        });
        break; }
      case 'wppconnect':
      case 'venom': {
        const dataUrl = `data:${mime};base64,${baixado.base64}`;
        if (typeof client.sendFileFromBase64 === 'function') {
          await client.sendFileFromBase64(to, dataUrl, nome, caption || '');
        } else if (typeof client.sendFile === 'function') {
          await client.sendFile(to, dataUrl, nome, caption || '');
        } else {
          throw new Error('sendFileFromBase64 indisponível');
        }
        break; }
      default:
        throw new Error('engine sem suporte a arquivo');
    }
    return true;
  } catch (err) {
    customLogger.error(`[MessageSender] Falha ao enviar arquivo (${engine}) -> ${err.message}`);
    return false;
  }
}

module.exports = { sendText, sendPtt, sendFileFromUrl, startTyping, startRecording, stopTyping, detectEngine, verifyNumber };
