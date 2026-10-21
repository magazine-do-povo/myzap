const Guards = require('./guards');
const { sendDefault } = require('./defaultMessageService');
const EmpresaIA = require('./empresaIA');
const AgenteClient = require('./agenteClient');
const { separarPix } = require('./separarPix');
const MessageSender = require('../events/messageSender');
const ChatHistoryHelper = require('../events/chatHistory');
const customLogger = require('../../../util/customLogger');
const { TEMPO_MENSAGEM_PADRAO_DEFAULT, LOG_PREFIX } = require('./iaConfig');
const processingLock = require('./processingLock');
const { ehSoCumprimento } = require('./primeiroContato');
const { celularDoLid } = require('./celularDoLid');

// Registrar resposta da IA no cache (usado para evitar loop no self-test)
const { registerIAResponse } = require('./iaResponseCache');

/**
 * Engine de decisão: executa guards em sequência e toma ação apropriada.
 * Centraliza toda a lógica de quando processar IA vs mensagem padrão.
 */
// Mensagens que chegam ENQUANTO o bot processa outra (turno leva 5–20s) eram
// DESCARTADAS — cliente que manda rajada perdia 3 de 4 mensagens e achava que
// o bot morreu (caso real: Capucho, 31/08). Agora entram numa fila por número
// e são drenadas como UMA mensagem combinada ao fim do turno.
const filaPendentes = new Map();
const chaveDaFila = (session, sessionkey, numero) => `${session || ''}::${sessionkey || ''}::${numero || ''}`;
const FILA_MAX = 5;

// ponytail: espera por polling (0,5 s, até 90 s — o teto do turno do agente);
// fila de áudio própria só se um dia a ordem entre dois áudios seguidos importar.
const esperarVez = async (chave) => {
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (processingLock.acquire(chave)) return true;
  }
  customLogger.warning(`${LOG_PREFIX} áudio de ${chave.numero} esperou 90s o turno anterior e ficou sem IA`);
  return false;
};

/**
 * Nome exibido do cliente (pushname), independente do engine.
 * Nunca lança: sem nome o agente pergunta, como sempre fez.
 */
const resolverNomeCliente = async (message, client, numero) => {
  const limpar = (v) => {
    const n = String(v || '').trim();
    // número disfarçado de nome não serve
    return n && !/^\+?[\d\s()-]{8,}$/.test(n) ? n.slice(0, 80) : null;
  };
  const direto =
    limpar(message?._data?.notifyName) ||
    limpar(message?.notifyName) ||
    limpar(message?.sender?.pushname) ||
    limpar(message?.sender?.verifiedName) ||
    limpar(message?.sender?.name);
  if (direto) return direto;
  try {
    if (typeof message?.getContact === 'function') {
      const c = await message.getContact();
      const n = limpar(c?.pushname) || limpar(c?.name) || limpar(c?.shortName);
      if (n) return n;
    }
    if (typeof client?.getContactById === 'function') {
      const c = await client.getContactById(numero);
      const n = limpar(c?.pushname) || limpar(c?.name) || limpar(c?.shortName);
      if (n) return n;
    }
  } catch (e) {
    customLogger.warning(`${LOG_PREFIX} nome do contato indisponível: ${e.message}`);
  }
  return null;
};

async function process({
  message,
  client,
  session,
  sessionkey,
  numero,
  msgBody,
  empresa,
  payload,
  responseDefault
}) {
  customLogger.debug(`${LOG_PREFIX} Iniciando para ${numero}`);

  const chaveFila = chaveDaFila(session, sessionkey, numero);

  if (!processingLock.acquire({ session, sessionkey, numero })) {
    const texto = typeof msgBody === 'string' ? msgBody.trim() : '';
    if (texto) {
      const fila = filaPendentes.get(chaveFila) || [];
      if (fila.length < FILA_MAX) fila.push(texto);
      filaPendentes.set(chaveFila, fila);
      customLogger.debug(`${LOG_PREFIX} Em atendimento; mensagem enfileirada (${fila.length}) para ${numero}`);
      return true;
    }
    // Áudio chega com o texto vazio e não cabe na fila de texto: era DESCARTADO
    // enquanto a IA respondia a mensagem anterior ("bom dia" e o áudio logo em
    // seguida — Sonhare, 28/09). Espera o turno em andamento e segue.
    if (!message?.agenteAudioBase64 || !(await esperarVez({ session, sessionkey, numero }))) return true;
  }

  try {
    return await processInternal({
      message,
      client,
      session,
      sessionkey,
      numero,
      msgBody,
      empresa,
      payload,
      responseDefault
    });
  } finally {
    processingLock.release({ session, sessionkey, numero });

    const fila = filaPendentes.get(chaveFila);
    if (fila && fila.length) {
      filaPendentes.delete(chaveFila);
      const combinado = fila.join('\n');
      customLogger.info(`${LOG_PREFIX} Drenando ${fila.length} mensagem(ns) enfileirada(s) de ${numero}`);
      setImmediate(() => {
        process({
          message: { ...message, body: combinado, agenteAudioBase64: null, agenteAudioMime: null, agenteMidiaBase64: null, agenteMidiaMime: null },
          client,
          session,
          sessionkey,
          numero,
          msgBody: combinado,
          empresa,
          payload: { ...payload, body: combinado },
          responseDefault
        }).catch((e) => customLogger.error(`${LOG_PREFIX} Erro ao drenar fila`, e?.message || e));
      });
    }
  }
}

/**
 * Processamento interno após adquirir o lock
 */
async function processInternal({
  message,
  client,
  session,
  sessionkey,
  numero,
  msgBody,
  empresa,
  payload,
  responseDefault
}) {
  // Configurações da empresa
  const mensagemPadrao = typeof empresa?.mensagem_padrao === 'string' ? empresa.mensagem_padrao.trim() : '';
  const cooldownPadrao = Number.isInteger(empresa?.tempo_mensagem_padrao) ? empresa.tempo_mensagem_padrao : TEMPO_MENSAGEM_PADRAO_DEFAULT;

  // Helper para enviar mensagem padrão
  const enviarPadrao = (motivo, force = false) => sendDefault({
    client,
    session,
    sessionkey,
    numero,
    mensagemPadrao,
    cooldownPadrao,
    motivo,
    force,
    apiUrlEmpresa: empresa?.api_url || null
  });

  // Sequência de guards (ordem importa!)
  const guardSequence = [
    () => Guards.checkGroupMessage({ message }),
    () => Guards.checkMensagemAtrasada({ message }),
    () => Guards.checkCompanyEnabled({ empresa }),
    // Primeiro contato do dia existe para mandar a MENSAGEM PADRÃO antes da IA. Loja
    // sem mensagem padrão (o agente do ClickJoias responde tudo) não tem o que mandar:
    // com o guard, a IA era bloqueada, o sendDefault saía sem enviar nada — e como a
    // loja "não falou hoje", TODA mensagem seguinte era primeiro contato de novo: a IA
    // nunca respondia (Sonhare, 25/09/2026, depois do 8cf6eff).
    ...(mensagemPadrao ? [() => Guards.checkFirstContactToday({ session, sessionkey, numero })] : []),
    () => Guards.checkIaEnabled({ empresa, sessionkey }),
    // Modo agente: a detecção de "quero falar com humano" mora no AGENTE
    // (detector melhor, pausa própria e registro do chamado no painel) — os
    // guards de cliente-pediu-humano só valem na rota OpenAI antiga.
    ...(globalThis.process.env.IA_PROVIDER === 'agente'
      ? []
      : [
          () => Guards.checkHumanRequest({ msgBody, session, sessionkey, numero }),
          () => Guards.checkClientRequestedHuman({ session, sessionkey, numero }),
        ]),
    () => Guards.checkRecentHuman({ session, sessionkey, numero }),
  ];

  // Executar guards em sequência
  for (const guard of guardSequence) {
    try {
      const result = await guard();
      console.log(`${LOG_PREFIX} Guard result: ${JSON.stringify(result)}`);
      if (result.shouldBlock) {
        console.log(`${LOG_PREFIX} ⛔ Guard bloqueou! Motivo: ${result.reason}`);
        // Caso especial: pedido de humano (envia mensagem específica)
        if (result.reason === 'pedido_humano' && result.transferMessage) {
          await MessageSender.sendText({ client, to: numero, text: result.transferMessage });
          await ChatHistoryHelper.registerAssistantMessage({
            session,
            sessionkey,
            numero,
            text: result.transferMessage,
            messageType: 'transferencia_humano',
          });
          await responseDefault(payload);
          return true; // processado
        }

        // Manda msg padrão exceto para grupos e quando um humano está na
        // conversa (a saudação automática no meio do atendimento confunde)
        if (!['grupo', 'agente_recente', 'aguardando_humano', 'mensagem_atrasada'].includes(result.reason)) {
          await enviarPadrao(result.reason);
        }
        if (result.reason === 'primeiro_contato') {
          // O que chegou ENQUANTO a mensagem padrão saía é parte do primeiro contato. Só
          // cumprimento/mídia sem texto sai da fila (25/09 17:28: panfleto de fornecedor
          // colado no texto dele caiu na IA como "[imagem]"); o resto — "boa noite" e,
          // no mesmo segundo, "quero 2 x-salada" — segue para a IA quando a fila drenar.
          const chave = chaveDaFila(session, sessionkey, numero);
          const comConteudo = (filaPendentes.get(chave) || []).filter((t) => !ehSoCumprimento(t));
          if (comConteudo.length) filaPendentes.set(chave, comConteudo);
          else filaPendentes.delete(chave);
          // Primeira mensagem já com o pedido ou com pergunta: a IA responde logo depois
          // da mensagem padrão, passando pelos guards que faltam (IA ligada, humano na
          // conversa). Só "oi"/"cardápio" espera a pessoa escrever de novo.
          if (!ehSoCumprimento(msgBody)) {
            console.log(`${LOG_PREFIX} Primeiro contato com conteúdo: IA responde depois da mensagem padrão`);
            continue;
          }
        }

        await responseDefault(payload);
        return true; // processado (bloqueado por guard)
      }
    } catch (err) {
      customLogger.error(`${LOG_PREFIX} Erro em guard: ${err.message}`);
    }
  }

  // Se chegou aqui, todos os guards passaram -> processar IA
  return await processIA({
    message,
    client,
    session,
    sessionkey,
    numero,
    msgBody,
    empresa,
    payload,
    responseDefault,
    enviarPadrao
  });
}

async function processIA({
  message,
  client,
  session,
  sessionkey,
  numero,
  msgBody,
  empresa,
  payload,
  responseDefault,
  enviarPadrao
}) {
  try {
    // Cliente mandou áudio -> a resposta virá em voz: mostrar "gravando
    // áudio..."; texto -> "digitando...". Segura a expectativa nos turnos longos.
    if (message?.agenteAudioBase64) {
      await MessageSender.startRecording({ client, to: numero });
    } else {
      await MessageSender.startTyping({ client, to: numero });
    }

    // IA_PROVIDER=agente -> serviço do agente (Gemini/Vertex + MCP no GKE).
    // Qualquer outro valor mantém a rota OpenAI intacta (rollback = trocar env).
    let respostaIA;
    // globalThis.process: a funcao exportada deste modulo chama-se "process"
    // (linha 18) e SOMBREIA o global do Node — process.env aqui era a funcao,
    // .env dava undefined e TODA mensagem morria com "Cannot read properties
    // of undefined (reading 'IA_PROVIDER')" antes de chegar ao agente.
    if (globalThis.process.env.IA_PROVIDER === 'agente') {
      // Turno longo (pedido completo por áudio: ouvir + criar pedido + TTS)
      // não pode parecer travado: renova o chatstate a cada 20s (o WhatsApp
      // expira o "digitando..." sozinho em ~25s) e manda avisos de progresso
      // aos 30s e 65s — turno de áudio normal (9s + TTS ~10s) NÃO dispara
      // (aos 18s o aviso chegava colado na resposta, parecendo bug).
      const ehAudio = Boolean(message?.agenteAudioBase64);
      const renovarEstado = setInterval(() => {
        const mostrar = ehAudio ? MessageSender.startRecording : MessageSender.startTyping;
        mostrar({ client, to: numero });
      }, 20000);
      const avisosProgresso = [
        setTimeout(() => {
          registerIAResponse('Só um momento, estou montando tudo aqui… 😊');
          MessageSender.sendText({ client, to: numero, text: 'Só um momento, estou montando tudo aqui… 😊' });
        }, 30000),
        setTimeout(() => {
          registerIAResponse('Quase pronto! Finalizando os últimos detalhes… 😉');
          MessageSender.sendText({ client, to: numero, text: 'Quase pronto! Finalizando os últimos detalhes… 😉' });
        }, 65000),
      ];
      // WhatsApp novo esconde o telefone atrás de @lid (ver celularDoLid).
      const celularReal = await celularDoLid(client, numero);
      // Nome do cliente: no whatsapp-web.js o pushname vem em `_data.notifyName`
      // (message.notifyName/sender.pushname são campos do Venom/WPPConnect) —
      // por isso o agente perguntava o nome em TODA conversa (01/09: 37 de 37
      // conversas sem nome). Fallback: o contato do WhatsApp.
      const nomeCliente = await resolverNomeCliente(message, client, numero);

      try {
        respostaIA = await AgenteClient.atender({
          sessionkey,
          numero,
          celular: celularReal,
          nome: nomeCliente,
          texto: msgBody,
          audioBase64: message?.agenteAudioBase64 || null,
          audioMime: message?.agenteAudioMime || null,
          midiaBase64: message?.agenteMidiaBase64 || null,
          midiaMime: message?.agenteMidiaMime || null,
          // texto primeiro, voz logo atras (ver envio abaixo)
          vozDepois: Boolean(message?.agenteAudioBase64),
          // modo local: a config do agente pode vir da API da empresa (api_url
          // do DeviceCompany) — a máquina do lojista não precisa de .env
          apiUrlEmpresa: empresa?.api_url || null,
        });
      } finally {
        clearInterval(renovarEstado);
        avisosProgresso.forEach(clearTimeout);
      }
    } else {
      respostaIA = await EmpresaIA.processarMensagem({
        session,
        sessionkey,
        message,
        idprompt: empresa.idprompt || 'pmpt_697f8d2ca1c881948c3746f2ebeef2a30576966ac7b02dd3',
        vetor: empresa.vector_name || null,
      });
    }

    // AgenteClient devolve objeto {texto, audioBase64?}; EmpresaIA, string.
    const r = typeof respostaIA === 'string' ? { texto: respostaIA } : (respostaIA || null);

    // Cliente pediu atendente: manda um aviso pro PRÓPRIO número da loja
    // (conversa "Você" no WhatsApp) com o telefone clicável — quem está no
    // celular cai direto na conversa. Complementa o sino do painel web.
    if (r?.motivo === 'pedido_humano') {
      try {
        const donoWid = client?.info?.wid?._serialized;
        if (donoWid) {
          const foneCliente = (typeof celularReal !== 'undefined' && celularReal)
            ? celularReal
            : String(numero).replace(/@.*$/, '');
          const aviso = [
            '🔔 *Cliente pediu atendimento humano!*',
            `📱 wa.me/${foneCliente.length <= 11 ? '55' + foneCliente : foneCliente}`,
            `💬 "${String(msgBody || '').slice(0, 120)}"`,
            '',
            '_Toque no link para abrir a conversa. O bot já pausou para este cliente._',
          ].join('\n');
          // saída do sistema: no chat "Você" não pode virar comando do dono
          registerIAResponse(aviso);
          await MessageSender.sendText({ client, to: donoWid, text: aviso });
        }
      } catch (e) {
        customLogger.warning(`${LOG_PREFIX} aviso à loja falhou: ${e.message}`);
      }
    }

    if (r?.texto) {
      // Registrar resposta da IA no cache (evitar loop no self-test)
      registerIAResponse(r.texto);

      await MessageSender.stopTyping({ client, to: numero });
      // Cliente falou por áudio -> agente pode responder em áudio (TTS).
      // PTT falhou (engine/codec)? Texto salva a conversa.
      // Cliente que fala por audio recebia SO o PTT, e depois de esperar a
      // sintese inteira: 5s de modelo + 9 a 12s de voz olhando "gravando
      // audio...". Pior, link e chave PIX chegavam ditados, sem nada para
      // tocar ou copiar. Agora o texto sai assim que fica pronto e a voz vem
      // atras, como um complemento.
      // PIX copia-e-cola do agente sai numa mensagem só dele (copiar com um toque).
      for (const parte of separarPix(r.texto)) {
        // Cada pedaço é resposta da IA: o eco do código sozinho não bate com o
        // texto inteiro e virava "atendente digitou" (Sonhare, 25/09).
        registerIAResponse(parte);
        await MessageSender.sendText({ client, to: numero, text: parte });
      }

      // Fotos que o agente mandou mostrar (a peça, com a legenda). Falhou uma,
      // as outras seguem — e a conversa já está no texto.
      for (const m of r.midias || []) {
        try {
          await MessageSender.sendFileFromUrl({ client, session, to: numero, url: m.url, caption: m.legenda || undefined });
        } catch (e) {
          customLogger.warning(`${LOG_PREFIX} foto do agente não foi (${e.message})`, { session, numero });
        }
      }

      if (r.audioBase64) {
        // agente ja mandou a voz junto (fluxo antigo / voz_depois desligado)
        await MessageSender.sendPtt({
          client,
          session,
          to: numero,
          base64: r.audioBase64,
          mimetype: r.audioMime || 'audio/ogg; codecs=opus',
        });
      } else if (message?.agenteAudioBase64) {
        // sintese sob demanda: falhou? a conversa ja seguiu no texto
        MessageSender.startRecording({ client, to: numero });
        const voz = await AgenteClient.falar({
          sessionkey,
          texto: r.texto,
          apiUrlEmpresa: empresa?.api_url || null,
        });
        await MessageSender.stopTyping({ client, to: numero });
        if (voz) {
          await MessageSender.sendPtt({
            client,
            session,
            to: numero,
            base64: voz.audioBase64,
            mimetype: voz.audioMime,
          });
          customLogger.info(`${LOG_PREFIX} PTT enviado depois do texto`, { session, numero, tts_ms: voz.ttsMs });
        }
      }
      await ChatHistoryHelper.registerAssistantMessage({
        session,
        sessionkey,
        numero,
        text: r.texto,
        messageType: 'ia',
      });
      customLogger.info(`${LOG_PREFIX} Resposta IA enviada`, { session, numero });
    } else {
      await MessageSender.stopTyping({ client, to: numero });
      await enviarPadrao('ia_sem_resposta');
    }
  } catch (error) {
    customLogger.error(`${LOG_PREFIX} Erro ao processar IA`, error?.stack || error?.message || error);
    await MessageSender.stopTyping({ client, to: numero });
    await enviarPadrao('erro_ia');
  }

  await responseDefault(payload);
  return true;
}

module.exports = { process };
