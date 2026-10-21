const customLogger = require('../../../util/customLogger');
const MediaDecryptor = require('../events/mediaDecryptor');

/**
 * Foto, figurinha e documento (PDF ou imagem) do cliente — ENTENDIDOS pelo agente.
 *
 * Até aqui a mídia chegava ao agente só como marcador ("[imagem]", com a
 * legenda): o modelo sabia que veio uma foto, mas não via a foto. O Gemini lê
 * imagem e PDF nativamente, como já ouvia o áudio — então o arquivo vai junto,
 * em base64, igual ao áudio (audioProcessor). O marcador continua no texto: o
 * histórico, os guards e quem ainda não lê o arquivo seguem funcionando igual.
 *
 * Só com IA_PROVIDER=agente, fora de grupo e com a IA da empresa ligada.
 * Falhou o download? Segue só com o marcador — nunca derruba a mensagem.
 */
const TIPOS = new Set(['image', 'sticker', 'document']);
const MIMES_DOCUMENTO = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/i;
const MAX_MIDIA = 8 * 1024 * 1024; // 8 MB: foto de celular e comprovante em PDF cabem com folga

async function processMidia({ message, client, numero, empresa }) {
    if (process.env.IA_PROVIDER !== 'agente') return;
    if (!message || !TIPOS.has(String(message.type || ''))) return;
    if (numero?.endsWith('@g.us') || message?.from?.endsWith('@g.us')) return;
    if (empresa?.ia_ativa === false) return;

    const mime = String(message.mimetype || message._data?.mimetype || '').split(';')[0].trim()
        || (message.type === 'sticker' ? 'image/webp' : 'image/jpeg');
    if (message.type === 'document' && !MIMES_DOCUMENTO.test(mime)) return;

    try {
        const buffer = await MediaDecryptor.decryptFile({ client, message });
        const tamanho = buffer?.byteLength ?? buffer?.length ?? 0;
        if (!tamanho) throw new Error('mídia vazia');
        if (tamanho > MAX_MIDIA) {
            customLogger.warning(`[MIDIA] ${message.type} de ${Math.round(tamanho / 1024)} KB acima do limite — segue só o marcador`);
            return;
        }
        message.agenteMidiaBase64 = Buffer.from(buffer).toString('base64');
        message.agenteMidiaMime = mime;
    } catch (err) {
        customLogger.warning(`[MIDIA] ${message.type} não baixou (${err.message}) — segue só o marcador`);
    }
}

module.exports = { processMidia, MAX_MIDIA };
