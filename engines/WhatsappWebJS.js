const { Client, LocalAuth } = require('whatsapp-web.js');
const Sessions = require('../controllers/SessionsController.js');
const SessionsHelper = require('../controllers/helper/core/sessions.js');
const Events = require('../controllers/EventsController.js');
const webhooks = require('../controllers/WebhooksController.js');
const config = require('../config.js');
const HelperWhatsappWeb = require('./helper/wweb.js');
const customLogger = require('../util/customLogger.js'); // ✅ ADICIONADO
const DeviceModel = require('../Models/device.js'); // ✅ ADICIONADO
const UserModel = require('../Models/user.js'); // ✅ ADICIONADO

require('dotenv').config();

const Device = DeviceModel(config.sequelize);
const User = UserModel(config.sequelize);

module.exports = class WhatsappWebJS {
  static async start(req, res, session) {
    let ownsLock = false; // esta invocação é a "dona" da trava global.__wwebInit?
    return new Promise(async (resolve, reject) => {
      let resolved = false; // ✅ ADICIONADO - Flag para evitar resolver múltiplas vezes

      // 🔒 TRAVA DE REENTRÂNCIA: sem isto, dois /start concorrentes (sessionKeepAlive
      // + fila + supervisor) criam DOIS Client no MESMO perfil instances/<sessão> →
      // SingletonLock do Chrome → perfil corrompe → cai e pede QR. Espelha o
      // global.__wppInit que o WppConnect já usa.
      global.__wwebInit = global.__wwebInit || {};
      const emAndamento = global.__wwebInit[session];
      if (emAndamento && (Date.now() - emAndamento) < 11 * 60 * 1000) {
        customLogger.info(`${session} - ⏳ start já em andamento, ignorando chamada duplicada`);
        return resolve({ status: 'INITIALIZING', session });
      }

      // Já há um client na memória com o Chrome VIVO: não recria, qualquer que seja o
      // estado do momento. Antes só o CONNECTED segurava — e bastava o WhatsApp oscilar
      // (getState ≠ CONNECTED por um instante) para o keepalive subir um 2º Client no
      // MESMO perfil: o Chrome reaproveita o navegador aberto, abre OUTRA aba do
      // WhatsApp Web e a primeira vira "O WhatsApp está aberto em outra janela" —
      // conectada e SURDA (Sonhare, 26/09: 1 h sem receber nada). Sessão que cai de
      // verdade passa pelo 'disconnected', que destrói o client e fecha o Chrome.
      try {
        const existing = SessionsHelper.getInjectedClient(session);
        if (existing && typeof existing.getState === 'function') {
          const st = await existing.getState().catch(() => null);
          const chromeVivo = Boolean(existing.pupBrowser && existing.pupBrowser.isConnected && existing.pupBrowser.isConnected());
          if (st === 'CONNECTED' || chromeVivo) {
            customLogger.info(`${session} - ✅ Cliente vivo (${st || 'sem estado'}), start duplicado ignorado`);
            return resolve({ status: st === 'CONNECTED' ? 'CONNECTED' : 'INITIALIZING', session });
          }
        }
      } catch (_) { /* segue para criar */ }

      global.__wwebInit[session] = Date.now();
      ownsLock = true;

      // 🔧 CORRIGIDO - Timeout aumentado para 10 minutos (Windows precisa de mais tempo)
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Timeout na inicialização da sessão ${session} (10 minutos)`));
        }
      }, 600000); // 10 minutos (antes era 5)
      
      try {
        // ✅ ADICIONADO - Criar/atualizar device ANTES de inicializar (igual WPPConnect)
        const sessionkey = req.headers['sessionkey'];
        const number = req?.body?.number || '';
        const body = req?.body || [];

        // O upsert abaixo GRAVA os wh_*, e nem todo /start os manda (keepalive, painel; o
        // reconectar do zap até 06/10/2026). Sem eles valem os que já estão gravados: senão a
        // sessão volta conectada e SURDA, sem mandar nada para quem a usa.
        const anterior = await Device.findOne({ where: { session } }).catch(() => null);
        const webhook = (campo) => req?.body?.[campo] || anterior?.[campo] || '';
        const wh_connect = webhook('wh_connect');
        const wh_status = webhook('wh_status');
        const wh_message = webhook('wh_message');
        const wh_qrcode = webhook('wh_qrcode');

        customLogger.whatsapp(`🚀 Starting WhatsApp WebJS - Session: ${session}`);

        try {
          // ✅ ADICIONADO - Criar device igual WPPConnect
          const { empresa_nome, api_url } = body;
          // findOrCreate: banco novo (semente por migrations) não traz o
          // usuário do sistema — sem ele o upsert abaixo morria em
          // user_id NOT NULL e o QR nunca nascia.
          const { getOrCreateSystemUser } = require('../controllers/helper/core/systemUser.js');
          const sysUser = await getOrCreateSystemUser();
          
          const devicePayload = {
            user_id: sysUser?.id,
            session,
            sessionkey,
            qrCode: '',
            attempts: 0,
            urlCode: '',
            attempts_start: 0,
            last_start: new Date(),
            state: 'STARTING',
            status: 'INITIALIZING',
            number,
            wh_qrcode,
            wh_connect,
            wh_status,
            wh_message,
            created_at: new Date(),
            updated_at: new Date()
          };
          
          await Device.upsert(devicePayload, { conflictFields: ['session'] });
          customLogger.success(`💾 Device criado/atualizado para sessão: ${session}`);
          
        } catch (deviceError) {
          customLogger.error('❌ Erro ao criar/atualizar device:', deviceError);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            reject(new Error(`Erro ao criar device: ${deviceError.message}`));
          }
          return;
        }

        const useHere = config.useHere !== 'true';

        customLogger.whatsapp(`${session} - useHere: ${useHere}`);
        let client;

        // ✅ REMOVIDO Firebase - agora usa pasta local instances/
        customLogger.whatsapp(`${session} - Usando tokens da pasta instances/`);

        // ✅ ADICIONADO - Verificar se pasta instances existe
        const fs = require('fs');
        const path = require('path');
        const instancesPath = path.join('.', 'instances');
        
        if (!fs.existsSync(instancesPath)) {
          fs.mkdirSync(instancesPath, { recursive: true });
          customLogger.info(`${session} - Pasta instances/ criada`);
        }

        const sessionPath = path.join(instancesPath, `${session}`);
        customLogger.whatsapp(`${session} - Caminho da sessão: ${sessionPath}`);
        
        if (fs.existsSync(sessionPath)) {
          customLogger.success(`${session} - ✅ Sessão existente encontrada, tentando carregar...`);
        } else {
          customLogger.info(`${session} - ℹ️ Nova sessão, QR Code será necessário`);
        }

        customLogger.whatsapp(`****** STARTING SESSION ${session} ******`);

        const clientOptions = HelperWhatsappWeb.getClientOptions({
          session,
          useHere,
          sessionData: null // ✅ Não usa mais dados do Firebase
        });

        // ✅ ADICIONADO - Definir authStrategy com LocalAuth para persistir sessões (sem prefixo session-)
        clientOptions.authStrategy = new LocalAuth({ 
          clientId: '', // ✅ Deixar vazio para evitar prefixo
          dataPath: path.join('./instances', session) // ✅ Pasta direta com nome da sessão
        });

        // Sem isto o Chrome restaura a aba do WhatsApp da vez anterior (o pm2 mata o
        // Chrome e o perfil fica "Crashed"): duas abas, "aberto em outra janela", surda.
        try {
          if (require('./helper/perfilChrome.js').limparRestauracaoDeAbas(require('path').join('./instances', session, 'session'))) {
            customLogger.info(`${session} - 🧹 Abas da vez anterior descartadas (sem 2ª aba do WhatsApp)`);
          }
        } catch (e) {
          customLogger.warning(`${session} - não limpou a restauração de abas: ${e.message}`);
        }

        client = new Client(clientOptions);

        // ✅ ADICIONADO - Controle de QR Code timeout
        let qrTimeout;

        // ✅ MELHORADO - Sempre escuta QR Code (não usa mais sessionData)
        client.on('qr', async (qr) => {
          customLogger.whatsapp(`${session} - 📱 Novo QR Code gerado`);
          
          // ✅ IMPORTANTE - Gerar imagem base64 PRIMEIRO
          const qrCodeImage = await HelperWhatsappWeb.generateQRHooksAndEmit({ qr, req, res, session });
          
          // ✅ CORREÇÃO - Salvar a IMAGEM BASE64 no banco, não o texto
          Device.findOne({ where: { session, sessionkey } })
            .then(currentDevice => {
              const attempts = (currentDevice?.attempts || 0) + 1;
              
              return Device.update({
                state: 'QRCODE',
                status: 'qrCode',
                qrCode: qrCodeImage, // ✅ IMAGEM BASE64 em vez de texto
                attempts: attempts,
                urlCode: qr, // ✅ Texto original fica no urlCode
                updated_at: new Date()
              }, { where: { session, sessionkey } });
            })
            .then(() => {
              customLogger.success(`📊 Device atualizado com QR Code base64 - Sessão: ${session}`);
            })
            .catch(dbError => {
              customLogger.error(`❌ Erro ao atualizar device com QR Code: ${dbError.message}`);
            });
          
          // Limpar timeout anterior
          if (qrTimeout) {
            clearTimeout(qrTimeout);
          }
          
          // ✅ MELHORADO - Timeout maior para dar tempo de escanear
          qrTimeout = setTimeout(() => {
            customLogger.warning(`${session} - ⏰ QR Code expirou, mas mantendo sessão ativa...`);
          }, 120000); // 2 minutos
        });

        client.on('ready', async () => {
          customLogger.success(`${session} - 🚀 WhatsApp está pronto!`);
          if (req?.io?.emit) {
            req.io.emit('whatsapp-status', true);
          }
          
          try {
            // ✅ ADICIONADO - Buscar informações completas do dispositivo (seguindo WPPConnect)
            const info = await client.info;
            const state = await client.getState();
            
            // ✅ ADICIONADO - Atualizar com informações completas no banco
            await Device.update({
              state: 'CONNECTED',
              status: 'CONNECTED',
              qrCode: '',
              attempts: 0,
              urlCode: '',
              last_connect: new Date(),
              number: info?.wid?.user || info?.me?.user || null,
              battery: info?.battery || null,
              platform: info?.platform || 'whatsapp-web-js',
              pushname: info?.pushname || null,
              wa_version: info?.wa_version || null,
              wa_js_version: require('whatsapp-web.js/package.json').version || null,
              updated_at: new Date()
            }, { where: { session } });
            
            customLogger.database(`${session} - 📱 Informações completas do dispositivo atualizadas no banco`);
          } catch (error) {
            customLogger.error(`${session} - ❌ Erro ao atualizar informações do dispositivo: ${error.message}`);
            // ✅ Fallback update básico
            Device.update({
              state: 'CONNECTED',
              status: 'CONNECTED',
              updated_at: new Date(),
              last_connect: new Date()
            }, { where: { session } }).catch(err => {
              customLogger.error(`❌ Erro no fallback update: ${err.message}`);
            });
          }
          
          // Notificar sucesso
          Events.StatusMessage(req, 'CONNECTED', session);
          Sessions.addInfoSession(session, { 
            status: 'CONNECTED',
            state: 'CONNECTED',
            timestamp: Date.now()
          });

          // ✅ ADICIONADO - Resolver Promise quando estiver realmente pronto
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId); // ✅ ADICIONADO - Limpar timeout
            resolve({ status: 'CONNECTED', session });
          }
        });

        client.on('authenticated', (sessionData) => {
          customLogger.success(`${session} - 🔐 Autenticação bem-sucedida!`);
          // ✅ REMOVIDO - Não resolver aqui, apenas no 'ready'
          // resolve(sessionData);
        });

        // ✅ ADICIONADO - Evento para sessão carregada de arquivo (sem QR Code)
        client.on('loading_screen', (percent, message) => {
          customLogger.debug(`${session} - 📥 ${percent}% - ${message}`);
          
          // ✅ ADICIONADO - Se chegou a 100%, provavelmente carregou sessão salva
          if (percent === 100 && message === 'WhatsApp') {
            customLogger.success(`${session} - 💾 Sessão carregada com sucesso (sem QR Code)`);
          }
        });

        // ✅ ADICIONADO - Eventos de persistência da sessão
        client.on('auth_failure', (msg) => {
          customLogger.error(`${session} - ❌ Falha na autenticação: ${msg}`);
          
          // ✅ ADICIONADO - Atualizar device no banco com erro (seguindo padrão WPPConnect)
          Device.update({
            state: 'DISCONNECTED',
            status: 'AUTH_FAIL',
            updated_at: new Date(),
            last_disconnect: new Date()
          }, { where: { session, sessionkey } }).catch(err => {
            customLogger.error(`❌ Erro ao atualizar device com AUTH_FAIL: ${err.message}`);
          });
          
          Sessions.addInfoSession(session, { 
            status: 'AUTH_FAIL',
            state: 'DISCONNECTED'
          });
          
          // ✅ ADICIONADO - Rejeitar Promise em caso de falha de auth
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId); // ✅ ADICIONADO - Limpar timeout
            reject(new Error(`Falha na autenticação: ${msg}`));
          }
        });

        // ✅ ADICIONADO - Detectar quando sessão é carregada
        client.on('remote_session_saved', () => {
          customLogger.success(`${session} - 💾 Sessão salva com sucesso!`);
          Sessions.addInfoSession(session, { 
            status: 'SESSION_SAVED',
            state: 'CONNECTED',
            sessionSaved: true
          });
        });

        // ✅ REMOVIDO - Eventos duplicados removidos, mantendo apenas os primeiros

        client.on('disconnected', (reason) => {
          customLogger.warning(`${session} - 🔌 Desconectado: ${reason}`);

          // 🔒 REARMA a trava de reentrância: da queda até o Chrome antigo morrer e o
          // perfil instances/<sessão> ser liberado, NENHUM /start (sessionKeepAlive,
          // fila, supervisor, painel) pode subir um 2º Chrome no MESMO perfil. Esse
          // duplo-launch era a causa do "browser is already running" → SingletonLock →
          // sessão ZUMBI presa em "inicializando". A trava só é solta DEPOIS do
          // destroy concluir (no finally do setTimeout abaixo). O TTL de 11 min do
          // próprio start cobre o caso de o destroy nunca retornar.
          global.__wwebInit = global.__wwebInit || {};
          global.__wwebInit[session] = Date.now();

          // Atualiza o banco; o sessionKeepAlive reconecta a partir daqui — menos quem só volta
          // com QR novo: LOGOUT (tiraram o aparelho no celular, ou o WhatsApp derrubou) e QR que
          // ninguém leu. Esses ficam `notLogged` ("aguardando QR"), e o keepalive não sobe Chrome
          // para mostrar QR a ninguém (Valparaíso e Guarulhos, LOGOUT em 30/09/2026).
          const precisaQr = ['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE', 'Max qrcode retries reached'].includes(String(reason));
          Device.update({
            state: 'DISCONNECTED',
            status: precisaQr ? 'notLogged' : 'disconnected',
            updated_at: new Date(),
            last_disconnect: new Date()
          }, { where: { session, sessionkey } }).catch(err => {
            customLogger.error(`❌ Erro ao atualizar device como DISCONNECTED: ${err.message}`);
          });

          // 🔴 CRÍTICO: destruir o Chrome e SOLTAR o perfil instances/<sessão> antes de
          // qualquer recriação. Sem isto o cliente velho fica pendurado e, quando o
          // sessionKeepAlive chama /start, sobe um 2º Chrome no MESMO perfil →
          // SingletonLock → perfil corrompe → cai de vez e pede QR. Esperamos um pouco
          // (no Windows o Cookies-journal fica preso/EBUSY) e então destruímos.
          setTimeout(async () => {
            try {
              await client.destroy();
              customLogger.info(`${session} - 🧹 Cliente destruído e perfil liberado após desconexão`);
            } catch (e) {
              customLogger.warning(`${session} - ⚠️ Falha ao destruir cliente desconectado: ${e.message}`);
            } finally {
              // Tira a referência morta da memória; o keepAlive recria limpo.
              SessionsHelper.removeClientFromMemory(session);
              // 🔓 Libera a trava SÓ AGORA (perfil já liberado): a partir daqui o
              // próximo /start sobe UM Chrome no perfil livre, sem colidir.
              try { delete global.__wwebInit[session]; } catch (_) { /* noop */ }
            }
          }, 2500);

          // Se for por associação de dispositivo, sinaliza limpeza de cache.
          if (reason && reason.includes('Protocol error')) {
            customLogger.error(`${session} - 🧹 Limpando cache por erro de protocolo`);
            Sessions.addInfoSession(session, {
              status: 'protocolError',
              reason,
              needsCleanup: true,
              timestamp: Date.now()
            });
          }
        });

        // ✅ ADICIONADO - Event para capturar erros gerais
        client.on('change_state', (state) => {
          customLogger.debug(`${session} - 🔄 Mudança de estado: ${state}`);
        });

        customLogger.whatsapp(`${session} - 🚀 Inicializando cliente...`);
        
        // ✅ ADICIONADO - Tratamento de erro na inicialização
        try {
          await client.initialize();
        } catch (initError) {
          customLogger.error(`${session} - ❌ Erro na inicialização: ${initError.message}`);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId); // ✅ ADICIONADO - Limpar timeout
            reject(new Error(`Erro na inicialização: ${initError.message}`));
          }
          return;
        }

        Sessions.addInfoSession(session, {
          session,
          client
        });

        Events.receiveMessage(session, client, req);
        // O vigia de surdez (jobs/sessionHealthCheck) compara isto com o que o
        // WhatsApp Web da sessão recebeu: a hora da última mensagem que CHEGOU aqui.
        client.on('message', (m) => {
          if (!m.fromMe) require('../jobs/sessionHealthCheck.js').registerMessageReceived(session);
        });
        Events.statusMessage(session, client, req);

        client.on('change_battery', (batteryInfo) => {
          const { battery, plugged } = batteryInfo;
          customLogger.debug(`${session} - 🔋 Battery: ${battery}% - Charging? ${plugged}`);
        });

        // ✅ REMOVIDO eventos duplicados (message, change_state, disconnected já tratados acima)
        client.on('message_ack', () => {});
        client.on('message_create', async (message) => {
          if (!message.fromMe) {
            // Exemplo: webhook customizado
          }
        });

        client.on('message_revoke_everyone', async (after, before) => {
          if (before) {
            // Log antes de deletar
          }
        });

        client.on('message_revoke_me', async () => {});
        client.on('media_uploaded', async () => {});
        client.on('group_update', async () => {});
      } catch (error) {
        customLogger.error(`${session} - ❌ Erro geral: ${error.message}`);
        
        // ✅ MELHORADO - Só rejeitar se ainda não foi resolvido
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId); // ✅ ADICIONADO - Limpar timeout
          reject(error);
        }
      }
    }).finally(() => {
      // Solta a trava em QUALQUER caminho terminal (ready/auth_fail/erro/timeout),
      // mas só se ESTA invocação foi a dona dela (chamada duplicada não limpa).
      if (ownsLock) {
        try { delete global.__wwebInit[session]; } catch (_) { /* noop */ }
      }
    });
  }
};
