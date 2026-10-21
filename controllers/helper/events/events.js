const moment = require('moment');
moment.locale('pt-br');
const MediaDecryptor = require('./mediaDecryptor');

// Telefone do contato @lid (23/09/2026, loja piloto da Celularis: a lista do zap mostrava o LID
// "193214069866529" no lugar do telefone). O WhatsApp não manda o telefone junto; o
// whatsapp-web.js resolve com getContactLidAndPhone. Cache em memória por sessão: acerto vale
// 24 h, falha ou telefone vazio 10 min; a consulta desiste em 3 s e a mensagem segue sem `pn`.
// ponytail: cache só em memória, teto de 5000 contatos — reinício do pod refaz as consultas.
const telefonesDoLid = new Map();
const TELEFONE_OK_MS = 24 * 60 * 60 * 1000;
const TELEFONE_FALHA_MS = 10 * 60 * 1000;
const TELEFONE_TIMEOUT_MS = 3000;
// Aviso do sistema não pede telefone: ao conectar chegam dezenas de uma vez (113 na loja
// piloto), e cada consulta vai ao servidor do WhatsApp.
const TIPOS_SEM_CONSULTA = ['notification_template', 'e2e_notification', 'notification', 'gp2', 'protocol', 'ciphertext'];

module.exports = {
  tiposPermitidos: [
    'chat', 'image', 'sticker', 'audio', 'ptt', 'video', 'link',
    'location', 'document', 'vcard', 'multi_vcard',
    'list', 'list_response', 'order',
    'payment', 'gp2', 'protocol', 'product',
    'poll_creation', 'template_button_reply', 'groups_v4_invite',
    'e2e_notification'
  ],

  fromBloqueado: ['status', 'status@broadcast'],
  subtypesBloqueado: ['ephemeral_keep_in_chat', 'initial_pHash_mismatch'],

  /**
   * Aviso do sistema ("o código de segurança mudou", entrou no grupo…) não é o cliente falando.
   * 24/09/2026, Capucho: a loja trocou de aparelho e TODO cliente passou a receber o
   * e2e_notification antes da mensagem dele — o aviso virava o "primeiro contato" (saía a
   * mensagem padrão) e o "oi" de verdade, que chegava logo atrás, caía direto na IA.
   */
  ehAvisoDoSistema(message) {
    return TIPOS_SEM_CONSULTA.includes(message?.type);
  },

  isPermitido(message) {
    return this.tiposPermitidos.includes(message?.type)
      && !this.fromBloqueado.includes(message?.from)
      && !this.subtypesBloqueado.includes(message?.subtype);
  },

  normalizarTipo(message) {
    if (message?.type === 'chat' && message?.subtype === 'url') return 'link';
    if (message?.type === 'chat') return 'text';
    return message?.type;
  },

  formatarData(timestamp) {
    return moment.unix(timestamp).format('DD-MM-YYYY HH:mm:ss');
  },

  tipoAckToStatus(ack) {
    const mapa = {
      0: 'CLOCK', 1: 'SENT', 2: 'RECEIVED', 3: 'READ', 4: 'PLAYED',
      '-1': 'FAILED', '-2': 'EXPIRED', '-3': 'CONTENT_GONE', '-4': 'CONTENT_TOO_BIG',
      '-5': 'CONTENT_UNUPLOADABLE', '-6': 'INACTIVE', '-7': 'MD_DOWNGRADE'
    };
    return mapa[ack] || 'UNKNOWN';
  },

  // Mídia recebida às vezes não baixa na primeira vez (24/09/2026, loja piloto da Celularis: o
  // primeiro áudio de um cliente novo falhou e o seguinte baixou). Tenta de novo com espera curta,
  // e o erro, que o WhatsApp Web devolve minificado ("t"), vai inteiro para o log.
  ESPERA_NOVA_TENTATIVA_MS: 1500,

  async baixarComNovaTentativa(baixar, tentativas = 3) {
    for (let i = 1; i <= tentativas; i++) {
      try {
        const media = await baixar();
        const base64 = media?.data || (typeof media === 'string' ? media : null);
        if (base64) return base64;
        console.log(`⚠️ Mídia não veio do WhatsApp Web (tentativa ${i}/${tentativas})`);
      } catch (e) {
        console.log(`⚠️ Erro ao baixar mídia (tentativa ${i}/${tentativas}): ${this.descreverErro(e)}`);
      }
      if (i < tentativas) await new Promise((ok) => setTimeout(ok, this.ESPERA_NOVA_TENTATIVA_MS));
    }
    return null;
  },

  /** O erro inteiro numa linha: nome e mensagem, o String() quando diz outra coisa e o começo da pilha. */
  descreverErro(e) {
    const partes = [e?.name, e?.message].filter(Boolean).join(': ') || String(e);
    const texto = String(e);
    const pilha = String(e?.stack || '').split('\n').slice(1, 5).map((l) => l.trim()).filter(Boolean).join(' | ');
    return partes + (texto !== partes ? ` / ${texto}` : '') + (pilha ? ` [${pilha}]` : '');
  },

  /**
   * Vídeo não é baixado por padrão, e nada acima de MIDIA_MAX_MB (8 MB) é. Medido na VPS em
   * 11/10/2026: cada vídeo recebido era baixado inteiro, em base64 na memória do Node, e jogado
   * fora — quem lê a mídia (midiaProcessor, audioProcessor) só usa imagem, figurinha e documento
   * até 8 MB e áudio; e o Chrome da sessão guarda cada blob pedido em disco (CapuchoLanches:
   * 14 GB em blob_storage, +2 GB por dia). O payload do webhook sai igual, com os metadados e
   * `base64` null; quem precisa do arquivo busca depois por /downloadMedia.
   * MIDIA_BAIXAR_VIDEO=1 volta a baixar vídeo; MIDIA_MAX_MB muda o teto.
   */
  deveBaixar(type, message) {
    if (type === 'video' && process.env.MIDIA_BAIXAR_VIDEO !== '1') return false;
    const maxMb = parseFloat(process.env.MIDIA_MAX_MB) || 8;
    // whatsapp-web.js: `_data.size` (bytes); wppconnect/venom: `size`/`filesize`. Sem tamanho, baixa.
    const bytes = Number(message?._data?.size ?? message?.size ?? message?._data?.filesize ?? message?.filesize);
    return !(bytes > maxMb * 1024 * 1024);
  },

  async baixarMidia(type, client, message) {
    const tipos = ['image', 'video', 'audio', 'ptt', 'document', 'sticker'];
    if (!tipos.includes(type) || !message) return null;
    if (!this.deveBaixar(type, message)) {
      console.log(`⏭️ ${type} não baixado (vídeo só com MIDIA_BAIXAR_VIDEO=1; teto MIDIA_MAX_MB=${parseFloat(process.env.MIDIA_MAX_MB) || 8})`);
      return null;
    }

    try {
      // 1) whatsapp-web.js: método no objeto da mensagem
      if (typeof message.downloadMedia === 'function') {
        const base64 = await this.baixarComNovaTentativa(() => message.downloadMedia());
        if (base64) return base64;
      } else if (client && typeof client.getMessageById === 'function') {
        // Fallback para caso mensagem tenha sido serializada e perdeu métodos
        try {
          const id = message?.id?._serialized || message?.id;
            if (id) {
              const fullMsg = await client.getMessageById(id);
              if (fullMsg && typeof fullMsg.downloadMedia === 'function') {
                const media = await fullMsg.downloadMedia();
                const base64 = media?.data || (typeof media === 'string' ? media : null);
                if (base64) return base64;
              }
            }
        } catch (e) {
          console.log('[baixarMidia] Fallback getMessageById falhou:', e.message || e);
        }
      }

      // 2) Engines que expõem decryptFile direto
      if (client && typeof client.decryptFile === 'function') {
        const buffer = await client.decryptFile(message);
        if (buffer) return Buffer.isBuffer(buffer) ? buffer.toString('base64') : null;
      }

      // 3) Adapter genérico
      if (MediaDecryptor && typeof MediaDecryptor.decryptFile === 'function') {
        const buffer = await MediaDecryptor.decryptFile({ client, message });
        if (buffer) return buffer.toString('base64');
      }

      return null;
    } catch (error) {
      console.log(`⚠️ Erro ao baixar mídia: ${this.descreverErro(error)}`);
      return null;
    }
  },

  /** Os dígitos do telefone do contato @lid, ou null. Nunca lança: a mensagem não espera por isto. */
  async telefoneDoLid(client, session, lid) {
    const chave = `${session}|${lid}`;
    const guardado = telefonesDoLid.get(chave);
    if (guardado && guardado.ate > Date.now()) return guardado.pn;

    let pn = null;
    if (typeof client?.getContactLidAndPhone === 'function') {
      let relogio;
      try {
        const r = await Promise.race([
          client.getContactLidAndPhone([lid]),
          new Promise((_, falha) => { relogio = setTimeout(() => falha(new Error('timeout')), TELEFONE_TIMEOUT_MS); }),
        ]);
        pn = String(r?.[0]?.pn || '').replace(/@.*$/, '').replace(/\D/g, '') || null;
      } catch (e) {
        console.log(`⚠️ [LID] telefone de ${lid} não veio: ${e?.message || e}`);
      } finally {
        clearTimeout(relogio);
      }
    }

    telefonesDoLid.delete(chave); // reinsere no fim: o teto descarta o mais antigo
    if (telefonesDoLid.size >= 5000) telefonesDoLid.delete(telefonesDoLid.keys().next().value);
    telefonesDoLid.set(chave, { pn, ate: Date.now() + (pn ? TELEFONE_OK_MS : TELEFONE_FALHA_MS) });
    return pn;
  },

  async montarPayload(message, session, client) {
    // O WhatsApp Web de set/2026 guarda o id serializado em `$1`, e o `_serialized` não vem na
    // cópia que chega ao Node (23/09/2026, loja piloto da Celularis): o zap deduplica pelo id e,
    // sem ele, tratava toda mensagem como repetida. Devolve a chave de sempre (`id` e `data.id`
    // do payload são o mesmo objeto).
    if (message?.id && !message.id._serialized && message.id.$1) message.id._serialized = message.id.$1;

    const type = this.normalizarTipo(message);   // text, image, …
  const base64 = await this.baixarMidia(type, client, message);
    const timestamp = this.formatarData(message.timestamp);
    const nome = message?._data?.notifyName   // whatsapp-web.js
      || message?.sender?.pushname
      || message?.sender?.verifiedName
      || message?.sender?.shortName
      || message?.sender?.name
      || '';

    const base = {
      wook: message.fromMe ? 'SEND_MESSAGE' : 'RECEIVE_MESSAGE',
      status: message.fromMe ? 'SENT' : 'RECEIVED',
      type,
      fromMe: message.fromMe,
      id: message.id,
      session,
      isGroupMsg: message.isGroupMsg,
      author: message.author || null,
      name: nome,
      to: message.to?.split('@')[0],
      from: message.from?.split('@')[0],
      quotedMsg: message.quotedMsg || '',
      quotedMsgId: message.quotedMsgId || '',
      datetime: timestamp,
      data: message
    };

    // Contato @lid: `lid` é o destino para responder e `pn`, quando o WhatsApp devolve, o
    // telefone para identificar e exibir. `from`/`to` continuam como sempre.
    const outraPonta = message.fromMe ? message.to : message.from;
    if (typeof outraPonta === 'string' && outraPonta.endsWith('@lid')) {
      base.lid = outraPonta;
      const pn = TIPOS_SEM_CONSULTA.includes(type) ? null : await this.telefoneDoLid(client, session, outraPonta);
      if (pn) base.pn = pn;
    }

    /* ---------------- extras específicos ---------------- */
    let extras = {};

    switch (type) {
      case 'text':
        extras = { content: message.body };
        break;

      case 'image':
        extras = { caption: message.caption || '', mimetype: message.mimetype, base64 };
        break;

      case 'video':
        // Sem base64 por padrão (ver deveBaixar): os metadados têm de bastar para quem baixa depois.
        extras = { caption: message.caption || '', content: message.body, mimetype: message.mimetype, filename: message.filename || message._data?.filename || null, base64 };
        break;

      case 'sticker':
        extras = { caption: message.caption || '', mimetype: message.mimetype, content: message.body, base64 };
        break;

      case 'audio':
      case 'ptt':
        extras = { mimetype: message.mimetype, base64 };
        break;

      case 'document':
        extras = { mimetype: message.mimetype, filename: message.filename || message._data?.filename || null, caption: message.caption || '', base64 };
        break;

      case 'location':
        extras = { content: message.body, loc: message.loc, lat: message.lat, lng: message.lng };
        break;

      case 'link':
        extras = { thumbnail: message.thumbnail, title: message.title, description: message.description, url: message.body };
        break;

      case 'vcard':
        extras = { contactName: message.vcardFormattedName, contactVcard: message.body };
        break;

      case 'multi_vcard':
        extras = { contactName: message.vcardFormattedName, vcardList: message.vcardList };
        break;

      case 'list':
        extras = { content: message.list };
        break;

      case 'list_response':
        extras = { listResponse: message.listResponse, content: message.content };
        break;

      case 'order':
        try {
          // CORRIGIDO - Verificar se método existe antes de chamar
          if (typeof client.getOrderbyMsg === 'function') {
            const orderInfo = await client.getOrderbyMsg(message.id);
            extras = { content: '', order: orderInfo };
          } else {
            // Fallback: retornar dados básicos do pedido se disponíveis
            extras = { 
              content: '', 
              order: message.order || message._data?.order || null,
              warning: 'getOrderbyMsg não disponível nesta engine'
            };
          }
        } catch (err) {
          console.error('[PAYLOAD] erro getOrderbyMsg:', err);
          extras = { content: '', order: null, error: err.message };
        }
        break;

      default:
        // outros tipos sem extras
        break;
    }

    console.log('[DEBUG] montarPayload OK – type:', type);
    return { ...base, ...extras };
  }
};
