const Sessions = require('../../../../controllers/SessionsController');
const customLogger = require('../../../../util/customLogger.js'); // Logger padronizado
const engine = require('../../../../engines/WppConnect');
const helpSS = require('../../../../controllers/helper/core/sessions');
const http = require('../../../../controllers/helper/http');
const config = require('../../../../config.js');
const Device = require('../../../../Models/device.js')(config.sequelize);
const wppHelper = require('../../../../engines/helper/wpp'); // 🆕 Para cleanBrowserCache

/**
 * Depois de quantos minutos um "estou inicializando" deixa de ser verdade.
 *
 * Abrir sessão leva segundos (a rota espera até 12s pelo QR). Se o banco ainda
 * diz INITIALIZING/STARTING depois de 10 minutos, não há inicialização em
 * andamento: há um processo que morreu no meio. O mesmo prazo que o keepalive
 * usa para desconfiar de quem está esperando QR (jobs/sessionKeepAlive.js:69).
 */
const INIT_STUCK_MINUTES = 10;

module.exports = {
  async getPlatformFromMessage(req, res) {
    try {
      const { messageId, session } = req.body;
      const device = await Sessions.getClient(session);
      const response = await device.client.getPlatformFromMessage(messageId);

      res.status(200).json({ status: 'success', data: response });

    } catch (error) {
      customLogger.error(`Error on getPlatformFromMessage: ${error.message}`);
      res.status(500).json({ response: false, data: error.message });
    }
  },

  async downloadMediaByMessage(req, res) {
    try {
      const { session, messageId } = req.body;
      const device = await Sessions.getClient(session);
      const message = await device.client.getMessageById(messageId);

      if (!message) return res.status(400).json({ status: 'error', message: 'Message not found' });
      if (!(message.mimetype || message.isMedia || message.isMMS)) {
        return res.status(400).json({ status: 'error', message: 'Message does not contain media' });
      }

      const buffer = await device.client.decryptFile(message);

      res.status(200).json({
        result: 200,
        base64: buffer.toString('base64'),
        mimetype: message.mimetype,
        session,
        file: message.filename,
        data: message,
      });

    } catch (error) {
      customLogger.error(`Error on downloadMediaByMessage: ${error.message}`);
      res.status(500).json({ response: false, data: error.message });
    }
  },

  async editMessage(req, res) {
    try {
      const { session, messageid, newText } = req.body;
      const device = await Sessions.getClient(session);
      const response = await device.client.editMessage(messageid, newText);

      res.status(200).json({ result: 200, data: response });

    } catch (error) {
      customLogger.error(`Error on editMessage: ${error.message}`);
      res.status(500).json({ response: false, data: error.message });
    }
  },
  async sendLink(req, res) {
    const { session, number, url, text } = req.body;

    if (!url || !Sessions.isURL(url)) {
      return res.status(400).json({
        status: 400,
        error: "URL inválida ou não informada"
      });
    }

    try {
      const data = await Sessions.getClient(session);
      const phone = await Cache.get(number);
      await Sessions.sleep(config.time_typing);
      const response = await data.client.sendLinkPreview(phone, url, text);

      return res.status(200).json({
        result: 200,
        type: 'link',
        messageId: response?.id,
        session,
        data: response
      });

    } catch (error) {
      customLogger.error(`Error on sendLink: ${error?.message}`);
      return res.status(500).json({ response: false, data: error?.message });
    }
  },

  async sendContact(req, res) {
    const { session, number, contact, name } = req.body;

    if (!contact || !name) {
      return res.status(400).json({
        status: 400,
        error: "Contact e Nome são obrigatórios"
      });
    }

    try {
      const data = await Sessions.getClient(session);
      const phone = await Cache.get(number);
      const response = await data.client.sendContactVcard(phone, `${contact}@c.us`, name);

      return res.status(200).json({
        result: 200,
        type: 'contact',
        messageId: response?.id,
        session,
        data: response
      });

    } catch (error) {
      customLogger.error(`Error on sendContact: ${error?.message}`);
      return res.status(500).json({ response: false, data: error?.message });
    }
  },

  async downloadMediaByMessage(req, res) {
    const { session, messageId } = req.body;

    try {
      const device = await Sessions.getClient(session);
      const client = device.client;
      const message = await client.getMessageById(messageId);

      if (!message) {
        return res.status(400).json({ status: 'error', message: 'Message not found' });
      }

      if (!(message.mimetype || message.isMedia || message.isMMS)) {
        return res.status(400).json({ status: 'error', message: 'Message does not contain media' });
      }

      const buffer = await client.decryptFile(message);

      res.status(200).json({
        result: 200,
        base64: buffer.toString('base64'),
        mimetype: message.mimetype,
        session,
        file: message.filename,
        data: message
      });

    } catch (error) {
      customLogger.error(`Error on downloadMediaByMessage: ${error?.message}`);
      return res.status(500).json({ response: false, data: error?.message });
    }
  },
  async startSession(req, res) {
    const session = req.body.session;
    customLogger.debug('[DEBUG] startSession', session);

    const data = await Sessions.getClient(session);

    try {
      // Verifica se existe uma pasta de sessão em ./instances/<session>
      const fs = require('fs');
      const path = require('path');
      const sessionPath = path.join('./instances', session);
      const sessionExists = fs.existsSync(sessionPath);

      if (data) {
        // Atualiza tentativas de start no banco, mantendo compatibilidade com a lógica existente
        await helpSS.atualizarTentativasStart(session, data.attempts_start, new Date(data.last_start));

        const status = data.status;
        const state = data.state;

        // 🚨 CONTROLE DE CONCORRÊNCIA VIA BANCO 🚨
        // Se já está inicializando, NÃO deixa entrar (evita sobrescrever).
        //
        // COM PRAZO DE VALIDADE, e este detalhe já custou as sessões desta
        // instalação. O trava-porta era eterno: bastava um processo morrer entre
        // "marquei INITIALIZING no banco" e "a sessão abriu" para o número ficar
        // preso PARA SEMPRE nesse estado. E preso assim, TODO caminho de
        // recuperação passava a responder "Já inicializando. Aguarde..." sem
        // fazer nada — o keepalive, o painel, o boot, e quem estivesse tentando
        // gerar o QR. Cada restart reforçava a marca em vez de sair dela.
        //
        // Foi exatamente o que aconteceu aqui: o START_ALL_SESSIONS gravava
        // INITIALIZING (engines/WppConnect.js:137) e estourava logo depois, no
        // `this.initSession` (linha 149). As sessões ficaram trancadas, e a
        // única saída era QR novo — que é presencial.
        //
        // Morrer no meio é cenário esperado neste serviço, não exceção: o teto de
        // memória do container existe justamente para matá-lo quando o Chromium
        // vaza. Um OOMKill no instante errado não pode custar um chip.
        const iniciandoAgora = status === 'INITIALIZING' || state === 'STARTING';
        const marcadoEm = data.updated_at || data.last_start;
        const minutosIniciando = marcadoEm
          ? (Date.now() - new Date(marcadoEm).getTime()) / 60000
          : Infinity;
        const inicioPreso = iniciandoAgora && minutosIniciando >= INIT_STUCK_MINUTES;

        if (iniciandoAgora && !inicioPreso) {
          customLogger.debug(`[IDEMPOTENT] ${session} - Inicialização em andamento (status=${status}, state=${state})`);
          return http.json(res, 200, {
            result: 'success',
            session,
            state: state || 'STARTING',
            status: status || 'INITIALIZING',
            message: 'Já inicializando. Aguarde...'
          });
        }

        if (inicioPreso) {
          customLogger.warning(
            `[INIT PRESO] ${session} - banco diz ${status}/${state} há ${minutosIniciando.toFixed(1)} min; ninguém está inicializando. Reiniciando.`
          );
        }

        // Monta objeto de resposta padrão
        const resposta = {
          result: 'success',
          session,
          state: state || 'STARTING',
          status: status || 'INITIALIZING'
        };

        // Se tem QR Code no banco, incluir na resposta
        if (data.qrCode && data.status === 'qrCode') {
          resposta.qrCode = data.qrCode;  // Base64 da imagem do QR Code
          resposta.urlCode = data.urlCode; // Como estava antes
          resposta.state = 'QRCODE';
          resposta.status = 'qrCode';
          resposta.message = 'QR Code disponível para escaneamento';
          
          customLogger.info(`[START WITH QR] ${session} - Retornando QR Code existente`);
          return http.json(res, 200, resposta);
        }

        // Verifica se há um client injetado na memória
        const injectedClient = helpSS.getInjectedClient(session);
        let clientActive = false;
        if (injectedClient) {
          try {
            // Algumas versões do WPPConnect possuem o método getConnectionState para checar o estado atual
            if (typeof injectedClient.getConnectionState === 'function') {
              const currentState = await injectedClient.getConnectionState();
              // Considera conectado se o estado estiver entre os estados conhecidos de conexão
              clientActive = ['inChat', 'isLogged', 'CONNECTED', 'isConnected'].includes(currentState);
            } else {
              // Se não houver método para checar estado, considera que está ativo
              clientActive = true;
            }
          } catch (_err) {
            // Qualquer erro ao checar o estado indica que o client não está ativo
            clientActive = false;
          }
        }

        // Caso exista pasta de sessão e status indique conexão, decide se mantém conectado ou se reconecta
        if (sessionExists && ['CONNECTED', 'inChat', 'isLogged', 'isConnected'].includes(status)) {
          if (clientActive) {
            // Sessão está conectada e client ativo: apenas retornar conectado
            resposta.state = 'CONNECTED';
            resposta.status = status;
            return http.json(res, 200, resposta);
          } else {
            // Sessão deveria estar conectada mas client não está em memória: tentar reconexão automática
            customLogger.info(`[RECONNECT] ${session} - Sessão existe mas client inativo, iniciando reconexão...`);
            
            // 🧹 LIMPEZA AUTOMÁTICA DO CACHE antes da reconexão
            await wppHelper.cleanBrowserCache(session);
            
            // 🛡️ Marca como inicializando no banco ANTES de chamar engine
            await Device.update({
              state: 'STARTING',
              status: 'INITIALIZING',
              updated_at: new Date()
            }, { where: { session } });
            
            engine.start(req, res);
            resposta.state = 'STARTING';
            resposta.status = 'RECONNECTING';
            return http.json(res, 200, resposta);
          }
        }

        // ⛏️ Decisão de gerar novo QR
        const needNewQRStatuses = [
          'notLogged','desconnectedMobile','browserClose','serverClose','autocloseCalled','TIMEOUT','ERROR'
        ];

  // `inicioPreso` entra aqui porque INITIALIZING não está (e não deve estar) na
  // lista acima: enquanto a inicialização é real, forçar novo QR atropelaria
  // quem está trabalhando. Passado o prazo, é o contrário — é o único jeito de
  // sair do estado, e sem isso o guard acima só teria trocado "trancado para
  // sempre" por "destrancado e sem ninguém para abrir".
  const shouldForceNew = needNewQRStatuses.includes(status) || inicioPreso;

        if (shouldForceNew) {
          // Throttle simples para evitar múltiplos starts em sequência
            global.__wppForceStart = global.__wppForceStart || {}; 
            const last = global.__wppForceStart[session];
            const now = Date.now();
            if (last && now - last < 4000) {
              customLogger.info(`[FORCE NEW QR THROTTLED] ${session} - aguardando (${status})`);
              return http.json(res, 200, {
                result: 'success',
                session,
                state: 'STARTING',
                status: 'INITIALIZING',
                message: 'Gerando QR (aguarde)...'
              });
            }
            global.__wppForceStart[session] = now;

          customLogger.info(`[FORCE NEW QR] ${session} - Status atual: ${status} -> reinicializando para gerar QR`);
          await Device.update({
            state: 'STARTING',
            status: 'INITIALIZING',
            qrCode: '',
            urlCode: '',
            attempts: 0,
            updated_at: new Date()
          }, { where: { session } });

          // Dispara engine.start mas a resposta desta rota será controlada aqui
          try { engine.start(req, res); } catch(_e) {}
          return http.json(res, 200, {
            result: 'success',
            session,
            state: 'STARTING',
            status: 'INITIALIZING',
            message: 'Gerando novo QR code...'
          });
        }

        // Caso não precise forçar novo QR, apenas retornar estado atual
  customLogger.debug(`[NO NEW QR] ${session} - Mantendo estado (status=${status})`);
        return http.json(res, 200, {
          result: 'success',
          session,
          state: state || 'STARTING',
          status: status,
          message: 'Aguardando eventos do engine...'
        });
      }

      // Não há dados no banco: iniciar nova sessão
      customLogger.info(`[START FRESH] ${session} - Nenhum dado encontrado, iniciando engine…`);
      
      // 🛡️ Marca como inicializando no banco ANTES de chamar engine
      await Device.update({
        state: 'STARTING',
        status: 'INITIALIZING',
        qrCode: '',
        urlCode: '',
        attempts: 0,
        updated_at: new Date()
      }, { where: { session } });
      
      engine.start(req, res);
      return http.json(res, 200, {
        result: 'success',
        session,
        state: 'STARTING',
        status: 'INITIALIZING'
      });
    } catch (err) {
      customLogger.error('❌ Erro ao iniciar sessão', err);
      return http.fail(res, err, 500, 'Erro ao iniciar sessão');
    }
  }
};
