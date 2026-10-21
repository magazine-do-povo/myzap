
const wppconnect = require('@wppconnect-team/wppconnect');
const Sessions = require('../controllers/SessionsController.js');
const events = require('../controllers/EventsController.js');
const webhooks = require('../controllers/WebhooksController.js');
const fnSocket = require('../controllers/FNSocketsController.js');
const { exec } = require('child_process');
const config = require('../config.js');
const DeviceModel = require('../Models/device.js');
const UserModel = require('../Models/user.js');
const logger = require('../util/logger.js');
const customLogger = require('../util/customLogger.js'); // ADICIONADO
const WppHelper = require('./helper/wpp');
const DeviceCompanyModel = require('../Models/deviceCompany.js');
const DeviceCompany = DeviceCompanyModel(config.sequelize);

require('dotenv').config();

const Device = DeviceModel(config.sequelize);
const User = UserModel(config.sequelize);

module.exports = class Wppconnect {

  /**
   * Endpoint /start
   * - garante linha na tabela device
   * - dispara initSession
   */
  static async start(req, res) {
    const session = req?.body?.session || '';
    const sessionkey = req.headers['sessionkey'];
    const number = req?.body?.number || '';
    const body = req?.body || [];

    const wh_connect = req?.body?.wh_connect || '';
    const wh_status = req?.body?.wh_status || '';
    const wh_message = req?.body?.wh_message || '';
    const wh_qrcode = req?.body?.wh_qrcode || '';

    customLogger.whatsapp(`🚀 Starting WppConnect - Session: ${session}`);

    try {
      // VERIFICAR SE SESSÃO JÁ EXISTE E ESTÁ CONECTADA
      const existingClient = Sessions.getClient(session);
      if (existingClient && existingClient.status === 'inChat') {
        customLogger.info(`✅ Sessão ${session} já conectada`);
        return res?.status(200)?.json({ 
          result: 200, 
          status: 'CONNECTED',
          response: `Sessão ${session} já está ativa` 
        });
      }

      // REGRA SIMPLES: SE TEM QR CODE NO BANCO, LIMPAR E GERAR NOVO
      const existingDevice = await Device.findOne({ where: { session } });
      if (existingDevice && existingDevice.status === 'qrCode') {
        customLogger.info(`� ${session} - Tem QR Code existente, limpando para gerar novo`);
        await Device.update({
          status: 'INITIALIZING',
          state: 'STARTING',
          qrCode: null,
          urlCode: null,
          updated_at: new Date()
        }, { where: { session } });
      }

      // DETECTA SESSÃO PERDIDA APÓS RESTART (existe no banco mas não na memória)
      const device = await Device.findOne({ where: { session } });
      if (device && (device.status === 'inChat' || device.status === 'isLogged') && !existingClient) {
        customLogger.info(`🔄 Detectada sessão perdida após restart: ${session} - Status banco: ${device.status}`);
        customLogger.info(`🚀 Tentando reconectar sessão existente: ${session}`);
        // Continua para initSession que tentará restaurar a sessão automaticamente
      }

      // cria / atualiza device
      const { empresa_nome, api_url } = body;
      const { getOrCreateSystemUser } = require('../controllers/helper/core/systemUser.js');
      const sysUser = await getOrCreateSystemUser();
      
      // USAR existingDevice já buscado acima para incrementar attempts_start
      const currentAttemptsStart = existingDevice?.attempts_start || 0;
      
      const payload = WppHelper.getPayloadCreateDevice({
        userId: sysUser?.id,
        session, sessionkey, number,
        wh_connect, wh_status, wh_message, wh_qrcode
      });
      
      // INCREMENTAR tentativas de start
      payload.attempts_start = currentAttemptsStart + 1;
      customLogger.info(`📊 Sessão ${session} - tentativa de start #${currentAttemptsStart + 1}`);
      
      await Device.upsert(payload, { conflictFields: ['session'] });
      if (empresa_nome && api_url) {
        await DeviceCompany.upsert({
          session,
          sessionkey,
          empresa_nome,
          api_url
        }, { conflictFields: ['session'] });
      }
    } catch (err) {
      customLogger.error('❌ Erro ao criar/atualizar device', err);
      logger.error('Erro ao criar/atualizar device', err);
      return res?.status(500)?.json({ result: 500, status: 'ERROR', response: err });
    }

    // socket + webhook (primeiro estado)
    const socketFns = new fnSocket(req.io);
    socketFns.events(session, {
      message: 'Iniciando WhatsApp. Aguarde…',
      state: 'STARTING',
      status: 'INITIALIZING',
      session, number
    });
    webhooks?.wh_connect(session, 'INITIALIZING', number, body, { message: 'Iniciando WhatsApp. Aguarde…' });

  // Se já houver QR Code gerado em tentativa anterior (ex: restart rápido), devolver imediatamente
    try {
      const existing = await Device.findOne({ where: { session } });
      if (existing && existing.status === 'qrCode' && existing.qrCode) {
        return res?.status(200)?.json({
          result: 200,
            session,
            status: 'qrCode',
            state: 'QRCODE',
            message: 'QR Code disponível',
            qrCode: existing.qrCode,
            urlCode: existing.urlCode
        });
      }
    } catch (_) {}

    req.funcoesSocket = socketFns;

    // ATUALIZAR STATUS NO BANCO PARA INITIALIZING
    try {
      await Device.update({
        state: 'STARTING',
        status: 'INITIALIZING',
        updated_at: new Date()
      }, { where: { session, sessionkey }});
      customLogger.debug(`[DB UPDATE] ${session} - Status atualizado para INITIALIZING`);
    } catch (err) {
      customLogger.warning(`[DB UPDATE WARNING] ${session} - Erro ao atualizar status: ${err.message}`);
    }

    // cria sessão
    // Inicia em background
    this.initSession(req, res);

    // Aguarda até 12s pelo QR ou conexão antes de responder (WPPConnect pode demorar mais)
    const startWait = Date.now();
    const waitLimit = 12000; // ms
    const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
    while(!res.headersSent && Date.now() - startWait < waitLimit){
      try {
        // Primeiro: tentar cache em memória imediatamente
        try {
          const helper = require('./helper/wpp');
          const cached = helper.getQrCache(session);
          if(cached && cached.qrCode){
            return res.status(200).json({
              result: 200,
              session,
              status: 'qrCode',
              state: 'QRCODE',
              message: 'QR Code disponível (cache)',
              qrCode: cached.qrCode,
              urlCode: cached.urlCode
            });
          }
        } catch(_ignoreCacheErr) {}

        const dev = await Device.findOne({ where: { session } });
        if(dev){
          // QR disponível
          if(dev.status === 'qrCode' && dev.qrCode){
            return res.status(200).json({
              result: 200,
              session,
              status: 'qrCode',
              state: 'QRCODE',
              message: 'QR Code disponível',
              qrCode: dev.qrCode,
              urlCode: dev.urlCode
            });
          }
          // Conectado antes de gerar QR (casos raros)
          if(['inChat','isLogged','CONNECTED'].includes(dev.status)){
            return res.status(200).json({
              result: 200,
              session,
              status: dev.status,
              state: 'CONNECTED',
              message: 'Sessão conectada'
            });
          }
        }
      } catch(_) {}
      await sleep(400);
    }

    if(!res.headersSent){
      return res.status(200).json({
        result: 200,
        session,
        status: 'INITIALIZING',
        state: 'STARTING',
        message: 'Inicializando sessão...'
      });
    }
  }

  /**
   * Instancia o cliente WPPConnect e registra todos os callbacks
   */
  static async initSession(req, res) {
    const session = req?.body?.session;
    const sessionkey = req.headers['sessionkey'];
    const io = req.io;
    if (global.__wppInit && global.__wppInit[session]) {
      customLogger.info(`[INIT SUPRESSED] ${session} - Já existe initSession em andamento`);
      return;
    }
    global.__wppInit = global.__wppInit || {};
    global.__wppInit[session] = Date.now();
    
    // VERIFICAR TOKENS EXISTENTES ANTES DE GERAR QR CODE
    const fs = require('fs');
    const path = require('path');
    const sessionPath = path.join('./instances', session);
    const hasExistingTokens = fs.existsSync(sessionPath);
    
    if (hasExistingTokens) {
      customLogger.info(`🔑 Tokens encontrados para ${session}, tentando reconectar automaticamente`);
      
      // Verificar se há arquivos de sessão válidos
      const tokenFiles = fs.readdirSync(sessionPath).filter(file => 
        file.includes('session') || file.includes('token') || file.includes('.json')
      );
      
      if (tokenFiles.length > 0) {
        customLogger.info(`📁 ${tokenFiles.length} arquivo(s) de sessão encontrados: [${tokenFiles.join(', ')}]`);
      }
    } else {
      customLogger.info(`🆕 Primeira inicialização para ${session}, QR Code será necessário`);
    }

    const options = WppHelper.buildOptions(session);

    try {
  await wppconnect.create({
        session,
        catchQR: (qr, asciiQR, attempts, urlCode) =>
          WppHelper.handleCatchQR({
            req, res, qrCode: qr, asciiQR, attempts, urlCode,
            session, sessionkey
          }),
        statusFind: (statusSession, _sess) =>
          WppHelper.handleStatusFind(_sess, statusSession, { sessionkey, io }),
        ...options
      }).then(async (client) => {
        client.onStateChange((state) =>
          WppHelper.handleStateChange(session, state, { sessionkey, io })
        );

        client.onInterfaceChange((iface) =>
          WppHelper.handleInterfaceChange(session, iface, req.funcoesSocket)
        );

        client.onNotificationMessage((n) =>
          WppHelper.handleNotificationMessage(session, n, req.funcoesSocket)
        );

        // salva refs
        Sessions?.createClient(session, req, client);
        events?.statusConnection(session, client, req);
        events?.receiveMessage(session, client, req);
        events?.statusMessage(session, client, req);

        // infos do host
        const wa_version = await client.getWAVersion();
        const wa_js_version = await client.getWAJSVersion();
        const stateSession = await client.getConnectionState();
        const number = await client.getWid();
        const host_device = await client.getHostDevice();

        await WppHelper.updateDeviceAfterSessionStart({
          session, sessionkey, stateSession,
          number, host_device, wa_version, wa_js_version
        });

        // Inicia o watchdog para checar periodicamente a conexão com o telefone.
        // O intervalo (em ms) pode ser ajustado conforme necessidade.
        if (client.startPhoneWatchdog) {
          // verificação a cada 15 segundos
          await client.startPhoneWatchdog(15000);
        }

        // Em sessões multi‑device, se o WhatsApp Web estiver "dormindo" em outro
        // dispositivo, useHere() reivindica o uso nesta instância.
        if (client.useHere) {
          await client.useHere().catch(() => {});
        }

        logger.info(`[${session}] READY - ${stateSession}`);
      }).catch((err) => {
        customLogger.error(`❌ Erro ao criar sessão ${session}:`, err);
        
        logger.error('Erro ao criar sessão no browser', err);
        exec(`rm -rf instances/${session}`);
        return res?.status(500)?.json({ result: 500, status: 'ERROR', response: err });
  }).finally(()=> { try { delete global.__wppInit[session]; } catch(_){} });

      wppconnect.defaultLogger.level = 'silly';
    } catch (err) {
      customLogger.error(`❌ Erro fatal na sessão ${session}:`, err);
      
      logger.error('Erro fatal, sessão não criada', err);
      exec(`rm -rf instances/${session}`);
      return res?.status(500)?.json({ result: 500, status: 'ERROR', response: err });
    }
  }
};
