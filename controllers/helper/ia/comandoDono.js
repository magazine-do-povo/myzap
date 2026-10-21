const AgenteClient = require('./agenteClient');
const MessageSender = require('../events/messageSender');
const MediaDecryptor = require('../events/mediaDecryptor');
const { registerIAResponse, isIAResponse } = require('./iaResponseCache');
const { MAX_AUDIO_SIZE, LOG_PREFIX } = require('./iaConfig');
const customLogger = require('../../../util/customLogger');

/**
 * Comando do DONO: a loja escreve (ou grava áudio) no chat "Você" do próprio
 * WhatsApp e o agente abre ou fecha o site de pedidos.
 *
 * Até aqui essa mensagem virava "atendente humano falando com cliente" e só
 * pausava o bot para o número da própria loja, sem efeito nenhum. Agora vai ao
 * agente com origem 'dono'. Loja que não ligou o recurso (parâmetro 226 no
 * ClickExpress) recebe silêncio do agente e nada muda.
 *
 * A mensagem padrão é trocada AQUI, no DeviceCompany deste MyZap: é ele quem
 * responde os clientes desta loja, tanto no modo online quanto no local.
 */

const soNumero = (id) => String(id || '').replace(/@.*$/, '');

/**
 * Mensagem que a loja mandou para ela mesma (chat "Você" / "Message yourself").
 * Só loja do ClickExpress: o agente de outro produto não conhece o modo dono e
 * responderia, como a um cliente, cada recado que o dono anota para si.
 */
function ehChatDoDono(message, client, empresa) {
  if (!message?.fromMe) return false;
  if (AgenteClient.ehDeOutroProduto(empresa?.api_url)) return false;
  const para = String(message.to || '');
  if (!para || para.endsWith('@g.us') || para.includes('broadcast')) return false;
  const meu = soNumero(client?.info?.wid?._serialized || client?.info?.wid?.user);
  return (Boolean(meu) && soNumero(para) === meu) || para === String(message.from || '');
}

async function baixarAudio(client, message) {
  try {
    const buffer = await MediaDecryptor.decryptFile({ client, message });
    if (!buffer || buffer.byteLength > MAX_AUDIO_SIZE) return null;
    return { base64: Buffer.from(buffer).toString('base64'), mime: message.mimetype || 'audio/ogg' };
  } catch (err) {
    customLogger.warning(`${LOG_PREFIX} áudio do dono não baixou: ${err.message}`);
    return null;
  }
}

/**
 * Nunca lança: roda dentro do evento message_create, e uma exceção aqui
 * derrubaria o processo.
 */
async function processar({ message, client, session, sessionkey, empresa }) {
  try {
    // Mensagem ANTIGA que a sessão reconectada sincroniza não é o dono pedindo
    // agora (mesma regra do processFromMe): um "fechar" de ontem não pode
    // fechar a loja hoje depois de um reinício.
    const idadeSeg = Number(message.timestamp) > 0 ? Math.floor(Date.now() / 1000) - Number(message.timestamp) : 0;
    if (idadeSeg > 120) return;

    const ehAudio = message.type === 'ptt' || message.type === 'audio';
    const texto = message.type === 'chat' ? String(message.body || '').trim() : '';
    // A resposta do bot neste chat e o aviso "cliente pediu atendente" também
    // chegam aqui como fromMe: saíram pelo sistema, não são o dono falando.
    if (!ehAudio && (!texto || isIAResponse(texto))) return;
    if (!empresa) return;

    const audio = ehAudio ? await baixarAudio(client, message) : null;
    if (ehAudio && !audio) return;

    const r = await AgenteClient.atender({
      sessionkey,
      numero: message.to,
      texto,
      audioBase64: audio?.base64 || null,
      audioMime: audio?.mime || null,
      origem: 'dono',
      apiUrlEmpresa: empresa.api_url || null,
    });
    if (!r?.texto) return; // recurso desligado nesta loja: silêncio

    let resposta = r.texto;
    if (typeof r.mensagemPadrao === 'string' && r.mensagemPadrao) {
      try {
        await empresa.update({ mensagem_padrao: r.mensagemPadrao });
      } catch (err) {
        customLogger.error(`${LOG_PREFIX} mensagem padrão do dono não gravou: ${err.message}`);
        resposta += '\n\n⚠️ Mas não consegui trocar a mensagem automática do WhatsApp. Avise o suporte.';
      }
    }

    registerIAResponse(resposta);
    await MessageSender.sendText({ client, to: message.to, text: resposta });
    customLogger.info(`${LOG_PREFIX} comando do dono`, { session, motivo: r.motivo });
  } catch (err) {
    customLogger.error(`${LOG_PREFIX} comando do dono falhou: ${err.message}`);
  }
}

module.exports = { ehChatDoDono, processar };
