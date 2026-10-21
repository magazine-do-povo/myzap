const customLogger = require('../../../util/customLogger');
const transcribe = require('../events/audioTranscriber');
const MessageSender = require('../events/messageSender');
const MediaDecryptor = require('../events/mediaDecryptor');
const { ACEITAR_AUDIO, MAX_AUDIO_SIZE, MAX_AUDIO_DURATION } = require('./iaConfig');
const { registerIAResponse } = require('./iaResponseCache');

/**
 * Processa mensagens de áudio: validações, transcrição e conversão para texto.
 * IMPORTANTE: Só processa áudio se IA estiver ativa (ela faz a transcrição)
 * Retorna: { success: boolean, message?, payload?, skipAudio?: boolean }
 */
async function processAudio({ message, client, numero, payload, session, sessionkey, empresa }) {
    // 🚫 Se é mensagem de grupo, não processar áudio (evita responder em grupos)
    const isGroup = numero?.endsWith('@g.us') || message?.from?.endsWith('@g.us');
    if (isGroup) {
        customLogger.debug(`[AUDIO] Ignorando áudio de grupo: ${numero}`);
        return { success: true, skipAudio: true };
    }

    // 🚫 Se IA não estiver ativa, rejeitar áudio (não há quem transcreva)
    const iaAtiva = empresa?.ia_ativa !== false;
    if (!iaAtiva) {
        return { success: true, skipAudio: true };
    }

    if (message.type !== 'audio' && message.type !== 'ptt') {
        return { success: true }; // não é áudio, continua processamento normal
    }

    // Aviso automático sai registrado como fala do SISTEMA: sem isso o eco dele
    // voltava como "equipe digitou" e calava a IA 30 min — justo quando o
    // cliente mandava o resumo que o aviso pediu (Sonhare, 29/09 11:30).
    const avisar = (text) => {
        registerIAResponse(text);
        return MessageSender.sendText({ client, to: numero, text });
    };

    // Verificação global de áudio habilitado
    if (!ACEITAR_AUDIO) {
        await avisar('Desculpe, não estou processando áudios no momento. Pode digitar sua mensagem? 😊');
        return { success: false, skipAudio: true };
    }

    // Modo agente: sem mensagem intermediária — o "digitando..." e a resposta
    // em segundos bastam; o aviso só atrapalhava (pedido do JV, 31/08).
    if (process.env.IA_PROVIDER !== 'agente') {
        await avisar('Recebi seu áudio. Só um instante enquanto o escuto, já te respondo! 😊🚀');
    }

    if (message.duration && message.duration > MAX_AUDIO_DURATION) {
        await avisar(`Recebemos seu áudio, mas ele passa de ${MAX_AUDIO_DURATION}s. Pode enviar um resumo rapidinho? 😊`);
        return { success: false };
    }

    try {
        const mediaBuffer = await MediaDecryptor.decryptFile({ client, message });
        if (mediaBuffer.byteLength > MAX_AUDIO_SIZE) {
            await avisar('O áudio ficou grande demais. Poderia enviar algo mais curto? 😉');
            return { success: false };
        }

        // Modo agente: o Gemini entende o áudio nativamente — segue o OGG cru
        // em base64 e a transcrição (Whisper) fica de fora do caminho.
        if (process.env.IA_PROVIDER === 'agente') {
            message.agenteAudioBase64 = Buffer.from(mediaBuffer).toString('base64');
            message.agenteAudioMime = message.mimetype || 'audio/ogg';
            message.body = '';
            message.type = 'chat';
            payload.body = '';
            payload.type = 'chat';
            return { success: true, message, payload };
        }

        const textoTranscrito = await transcribe({ buffer: mediaBuffer, session, sessionkey });
        if (!textoTranscrito) throw new Error('transcrição vazia');

        // Atualizar message e payload com texto transcrito
        message.body = textoTranscrito;
        message.type = 'chat';
        payload.body = textoTranscrito;
        payload.type = 'chat';

        return { success: true, message, payload };
    } catch (err) {
        customLogger.error(`[IA] Erro ao transcrever áudio: ${err.message}`);
        await avisar('Desculpe, não consegui entender o áudio. Pode digitar? 🤔');
        return { success: false };
    }
}

module.exports = { processAudio };
