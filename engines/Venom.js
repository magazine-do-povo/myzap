const venom = require('venom-bot');
const Sessions = require('../controllers/SessionsController.js');
const events = require('../controllers/EventsController.js');
const webhooks = require('../controllers/WebhooksController.js');
const config = require('../config.js');
const VenomHelper = require('./helper/vn.js');
const customLogger = require('../util/customLogger.js'); // ADICIONADO
const { Device, User } = require('../Models'); // ADICIONADO

module.exports = class Venom {
  static async start(req, res, session) {
    // Criar ou atualizar dispositivo no banco antes de iniciar a sessão (seguindo padrão WPPConnect)
    try {
      const sessionkey = req.headers['sessionkey'];
      const number = req?.body?.number || '';
      const body = req?.body || {};
      
      const wh_connect = req?.body?.wh_connect || '';
      const wh_status = req?.body?.wh_status || '';
      const wh_message = req?.body?.wh_message || '';
      const wh_qrcode = req?.body?.wh_qrcode || '';

      customLogger.whatsapp(`🚀 Starting Venom - Session: ${session}`);

      // BUSCAR device existente para incrementar attempts_start
      const existingDevice = await Device.findOne({ where: { session } });
      const currentAttemptsStart = existingDevice?.attempts_start || 0;

      // Payload completo seguindo padrão WPPConnect
      const { getOrCreateSystemUser } = require('../controllers/helper/core/systemUser.js');
      const sysUser = await getOrCreateSystemUser();
      const payload = {
        user_id: sysUser?.id,
        session,
        sessionkey,
        qrCode: '',
        attempts: 0,
        urlCode: '',
        attempts_start: currentAttemptsStart + 1, // INCREMENTAR tentativas de start
        last_start: new Date(),
        state: 'STARTING',
        status: 'notLogged',
        number,
        wh_qrcode,
        wh_connect,
        wh_status,
        wh_message,
        created_at: new Date(),
        updated_at: new Date()
      };
      
      await Device.upsert(payload, { conflictFields: ['session'] });
      customLogger.database(`${session} - 📱 Dispositivo Venom criado/atualizado no banco (tentativa ${currentAttemptsStart + 1})`);
    } catch (error) {
      customLogger.error(`${session} - Erro ao criar dispositivo no banco: ${error.message}`);
    }

    // REMOVIDO getToken do Firebase - agora usa pasta local instances/
    customLogger.whatsapp(`${session} - 🐍 Iniciando Venom com tokens da pasta instances/`);

    // Capturar sessionkey antes dos callbacks
    const sessionkey = req.headers['sessionkey'];

    try {
      customLogger.debug(`${session} - Inicializando venom.create() (object signature)`);
      const client = await venom.create({
        session,
        catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
          customLogger.whatsapp(`${session} - 📱 QR Code gerado (tentativa ${attempts})`);
          
          // Atualizar status no banco ao gerar QR code (seguindo padrão WPPConnect)
          Device.update({
            state: 'QRCODE',
            status: 'qrCode',
            qrCode: base64Qr,
            attempts,
            urlCode,
            updated_at: new Date()
          }, { where: { sessionkey, session } }).catch(err => 
            customLogger.error(`${session} - Erro ao atualizar QR no banco: ${err.message}`)
          );
          
          // Enviar QR
          VenomHelper.generateQRHooksAndEmit({ req, res, qrCode: base64Qr, session });
        },
        statusFind: (statusSession) => {
          customLogger.whatsapp(`${session} - 📱 Status: ${statusSession}`);
          Sessions.addInfoSession(session, { status: statusSession });

          // Atualizar status no banco de dados (seguindo padrão WPPConnect)
          const updateData = { status: statusSession, updated_at: new Date() };
          
          // Estados baseados na documentação oficial do Venom
          const onlineStatuses = ['isLogged', 'qrReadSuccess', 'chatsAvailable', 'successChat', 'inChat'];
          const offlineStatuses = ['browserClose', 'qrReadFail', 'autocloseCalled', 'serverClose', 'desconnectedMobile'];
          
          if (onlineStatuses.includes(statusSession)) {
            updateData.state = 'CONNECTED';
            updateData.last_connect = new Date();
            updateData.qrCode = '';
            updateData.attempts = 0;
            updateData.attempts_start = 0; // RESETAR tentativas quando conectar
            updateData.urlCode = '';
          } else if (offlineStatuses.includes(statusSession)) {
            updateData.state = 'DISCONNECTED';
            updateData.last_disconnect = new Date();
          }
          
          Device.update(updateData, { where: { sessionkey, session } })
            .catch(err => customLogger.error(`${session} - Erro ao atualizar status no banco: ${err.message}`));

          if (statusSession !== 'qrReadSuccess') {
            webhooks.wh_connect(session, statusSession);
          }

          const reconnectableStatuses = ['deviceNotConnected', 'serverWssNotConnected'];

          if (offlineStatuses.includes(statusSession)) {
            if (req?.io?.emit) {
              req.io.emit('whatsapp-status', false);
            }
            customLogger.warning(`${session} - 🔴 Status offline: ${statusSession}`);
          }

          if (onlineStatuses.includes(statusSession)) {
            if (req?.io?.emit) {
              req.io.emit('whatsapp-status', true);
            }
            customLogger.success(`${session} - 🟢 Status online: ${statusSession}`);
          }

          // Tentar reconexão automática em alguns casos
          if (reconnectableStatuses.includes(statusSession)) {
            customLogger.warning(`${session} - 🔄 Status reconectável: ${statusSession}`);
            if (req?.io?.emit) {
              req.io.emit('whatsapp-status', 'reconnecting');
            }
          }
        },
        ...VenomHelper.getClientOptions()
      });
      customLogger.debug(`${session} - venom.create() resolvido, obtendo device info`);

      const info = await client.getHostDevice();
      const tokens = await client.getSessionTokenBrowser();

      // Atualizar informações do dispositivo no banco após conexão bem-sucedida (seguindo padrão WPPConnect)
      try {
        await Device.update({
          state: 'CONNECTED',
          status: 'CONNECTED',
          qrCode: '',
          attempts: 0,
          attempts_start: 0, // RESETAR tentativas quando conectar com sucesso
          urlCode: '',
          last_connect: new Date(),
          number: info?.wid?.user || null,
          battery: info?.battery || null,
          platform: info?.platform || 'venom',
          pushname: info?.pushname || null,
          wa_version: info?.wa_version || null,
          wa_js_version: require('venom-bot/package.json').version || null,
          updated_at: new Date()
        }, { 
          where: { sessionkey, session } 
        });
        customLogger.database(`${session} - 📱 Informações completas do dispositivo atualizadas no banco`);
      } catch (error) {
        customLogger.error(`${session} - Erro ao atualizar info do dispositivo: ${error.message}`);
      }

      webhooks.wh_connect(session, 'connected', info, [], tokens);

      events.receiveMessage(session, client);
      events.statusMessage(session, client);

      if (config.useHere === 'true') {
        events.statusConnection(session, client);
      }

      // Adicionar eventos de reconexão baseados na documentação oficial
      if (client.onStateChange) {
        client.onStateChange((state) => {
          customLogger.debug(`${session} - 🔄 State changed: ${state}`);
          
          // Estados baseados na documentação oficial
          const conflictStates = ['CONFLICT'];
          const disconnectedStates = ['UNPAIRED', 'UNPAIRED_IDLE'];
          
          if (conflictStates.includes(state) && client.useHere) {
            customLogger.warning(`${session} - ⚠️ Forçando useHere para conflito`);
            client.useHere();
          }
          
          if (disconnectedStates.includes(state)) {
            customLogger.warning(`${session} - 🔌 Estado desconectado: ${state}`);
            if (req?.io?.emit) {
              req.io.emit('whatsapp-status', false);
            }
          }
        });
      }

      // Monitor de conexão por stream baseado na documentação
      if (client.onStreamChange) {
        let reconnectTimeout;
        client.onStreamChange((state) => {
          customLogger.debug(`${session} - 📡 Stream state: ${state}`);
          
          clearTimeout(reconnectTimeout);
          
          if (state === 'DISCONNECTED' || state === 'SYNCING') {
            customLogger.warning(`[VENOM] ${session} - Stream disconnected, iniciando timeout`);
            reconnectTimeout = setTimeout(() => {
              customLogger.warning(`[VENOM] ${session} - Timeout atingido, fechando cliente`);
              if (client.close) {
                client.close();
              }
            }, 80000); // Baseado na documentação oficial
          }
          
          if (state === 'CONNECTED') {
            customLogger.success(`[VENOM] ${session} - Stream reconectado com sucesso`);
            if (req?.io?.emit) {
              req.io.emit('whatsapp-status', true);
            }
          }
        });
      }

      Sessions.addInfoSession(session, {
        client,
        tokens
      });

  return client; // tokens já armazenados em Sessions
    } catch (error) {
      customLogger.error(`[VENOM ERROR] ${session} - ${error.message}`);
  customLogger.debug(`${session} - Stack: ${error.stack}`);
    }
  }

  static async stop(session) {
    const data = Sessions.getSession(session);
    const response = await data.client.close();
    return !!response;
  }

  static async reconnect(session, req, res) {
    try {
  customLogger.debug(`[VENOM RECONNECT] Tentando reconectar sessão ${session}`);
      
      // Primeiro tentar métodos nativos de reconexão
      const data = Sessions.getSession(session);
      if (!data?.client) {
        throw new Error('Cliente não encontrado');
      }

      // Tentar restartService se disponível
      if (data.client.restartService) {
        await data.client.restartService();
        customLogger.debug(`[VENOM RECONNECT] restartService executado para ${session}`);
        return true;
      }

      // Se métodos nativos falharam, reiniciar completamente
  customLogger.debug(`[VENOM RECONNECT] Reiniciando sessão completa para ${session}`);
      
      // Fechar sessão atual
      await this.stop(session);
      
      // Aguardar limpeza
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Recriar sessão
  await this.start(req, res, session);
  customLogger.debug(`[VENOM RECONNECT] Sessão ${session} recriada com sucesso`);
      return true;
      
    } catch (error) {
  customLogger.error(`[VENOM RECONNECT ERROR] ${session} - ${error.message}`);
      throw error;
    }
  }
};
