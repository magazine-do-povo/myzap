const SessionsHelper = require('./helper/core/sessions.js');
const http = require('./helper/core/http.js');
const chalk = require('chalk');
const customLogger = require('../util/customLogger.js'); // Logger padronizado
const config = require('../config.js');
// Models para auto-provisionamento de configuração simplificada da IA
const DeviceCompanyModel = require('../Models/deviceCompany.js');
const DeviceCompany = DeviceCompanyModel(config.sequelize);
const DeviceModel = require('../Models/device.js');
const Device = DeviceModel(config.sequelize);

class Sessions {
  static async instances(req, res) {
    try {
      const sessions = await SessionsHelper.listDevices();
      return http.success(res, sessions);
    } catch (err) {
      return http.fail(res, err, 400, 'Erro ao buscar instâncias');
    }
  }



  static async createClient(session, req, wppconnect = {}) {
    const sessionkey = req.headers['sessionkey'];
    const device = await SessionsHelper.getDevice(session, sessionkey);

    if (device && wppconnect?.session !== session) {
      customLogger.error(`❌ CLIENT INJECTED, SESSION INVALID - ${session} / ${sessionkey}`);
      return false;
    }

    if (device && wppconnect?.session === session) {
      SessionsHelper.injectClient(session, wppconnect);
      customLogger.success(`� CLIENT INJECTED - ${session} / ${sessionkey}`);
      return true;
    }

    customLogger.error(`❌ CLIENT INJECTED, SESSION INVALID - ${session} / ${sessionkey}`);
    return false;
  }

  static async addInfoSession(session, data) {
    try {
      customLogger.info(`[ADD INFO SESSION] ${session} - Adicionando informações da sessão`);
      
      // Injetar o client se fornecido
      if (data.client) {
        SessionsHelper.injectClient(session, data.client);
        customLogger.info(`[CLIENT INJECTED] ${session} - Cliente injetado com sucesso`);
      }

      // Salvar dados adicionais no helper se necessário
      if (data.tokens) {
        customLogger.info(`[TOKENS SAVED] ${session} - Tokens salvos`);
      }

      if (data.status) {
        customLogger.info(`[STATUS UPDATE] ${session} - Status: ${data.status}`);
      }

      if (data.qrCode) {
        customLogger.info(`[QR CODE] ${session} - QR Code atualizado`);
      }

      // 🔄 Auto provisionar configuração simplificada em DeviceCompanies (se não existir)
      try {
        const existente = await DeviceCompany.findOne({ where: { session } });
        if (!existente) {
          // Obter sessionkey a partir da tabela Devices se possível
          let sessionkey = null;
            try {
              const deviceRow = await Device.findOne({ where: { session } });
              sessionkey = deviceRow?.sessionkey || null;
            } catch(_) {}

          await DeviceCompany.create({
            session,
            sessionkey: sessionkey || (data.sessionkey || null),
            empresa_nome: `Empresa ${session}`,
            api_url: null,
            mensagem_padrao: null,
            idprompt: null,
            vector_name: null,
            ia_ativa: false
          });
          customLogger.info(`[ADD INFO SESSION] ${session} - DeviceCompany criado automaticamente`);
        }
      } catch (autoErr) {
        customLogger.error(`[ADD INFO SESSION] ${session} - Falha ao auto-criar DeviceCompany: ${autoErr.message}`);
      }

      return true;
    } catch (error) {
      customLogger.error(`[ADD INFO SESSION ERROR] ${session} - ${error.message}`);
      return false;
    }
  }

  static async getClient(session) {
    return await SessionsHelper.getSessionWithClient(session);
  }

  // ADICIONADO - Função getSession para compatibilidade com código existente
  static getSession(session) {
    try {
      // Retorna client injetado diretamente (igual ao comportamento esperado)
      const injectedClient = SessionsHelper.getInjectedClient(session);
      
      if (injectedClient) {
        return { client: injectedClient };
      }
      
      customLogger.warning(`⚠️ Cliente não encontrado na memória para sessão: ${session}`);
      return null;
    } catch (error) {
      customLogger.error(`❌ Erro ao buscar sessão ${session}: ${error.message}`);
      return null;
    }
  }

  static async getAllSessions(req, res) {
    try {
      const sessions = await SessionsHelper.listDevices();

      if (!sessions.length) {
        return http.notFound(res, 'Nenhuma sessão encontrada!', sessions);
      }

      return http.success(res, sessions, 'Sessões encontradas com sucesso!');
    } catch (err) {
      return http.fail(res, err, 400, 'Erro ao buscar sessões');
    }
  }

  static async getConnectionStatus(req, res) {
    try {
      const session = req.body.session;
      const sessionkey = req.headers['sessionkey'];
      const device = await SessionsHelper.getDevice(session, sessionkey);

      // DEBUG - Log detalhado do device encontrado
      customLogger.info(`[GET STATUS] ${session} - Device encontrado:`, {
        exists: !!device,
        status: device?.status,
        state: device?.state,
        hasQrCode: !!device?.qrCode,
        hasUrlCode: !!device?.urlCode,
        qrCodeLength: device?.qrCode?.length || 0
      });

      if (!device) {
        return http.notFound(res, 'Sessão não encontrada no banco de dados');
      }

      // Status que indicam conexão ativa
      const connectedStatuses = ['inChat', 'CONNECTED', 'isLogged', 'isConnected'];
      
      // Status que permitem reconexão automática (celular ainda conectado)
      const reconnectableStatuses = ['browserClose', 'serverClose', 'autocloseCalled'];

      // SESSÃO CONECTADA
      if (connectedStatuses.includes(device?.status)) {
        return http.json(res, 200, {
          result: 200,
          status: device.status,
          state: 'CONNECTED',
          message: 'Sessão conectada e ativa',
          data: device
        });
      }

      // SESSÃO INICIALIZANDO - Retorna estado atual sem QR ainda
      if (device?.status === 'INITIALIZING' || device?.state === 'STARTING') {
        return http.json(res, 200, {
          result: 200,
          status: device.status || 'INITIALIZING',
          state: device.state || 'STARTING',
          message: 'Sessão está sendo inicializada. Aguarde...',
          data: device
        });
      }

      // QR guardado sem Chrome esperando a leitura (o cliente já desistiu): é QR morto.
      // Diz "desconectado" — quem mostra o QR para de mostrar e oferece gerar outro.
      const temQr = (device?.qrCode && device.qrCode !== '') || device?.status === 'qrCode' || device?.state === 'QRCODE';
      if (temQr && !require('./helper/core/qrVivo.js').qrVivo(session)) {
        customLogger.info(`[QR MORTO] ${session} - status: QR sem Chrome esperando a leitura`);
        return http.json(res, 200, {
          result: 200,
          status: 'disconnected',
          state: 'DISCONNECTED',
          message: 'O QR Code expirou. Chame /start para gerar outro.',
        });
      }

      // TEM QR CODE DISPONÍVEL - Verificar tanto por status quanto por presença do QR (ou cache para WPPConnect)
      if ((device?.qrCode && device.qrCode !== '') || (device?.status === 'qrCode' || device?.state === 'QRCODE')) {
        let qrToReturn = device.qrCode;
        let urlToReturn = device.urlCode;
        if(!qrToReturn){
          try {
            const config = require('../config');
            if(config.engine === '2'){ // WPPConnect
              const wppHelper = require('../engines/helper/wpp');
              const cached = wppHelper.getQrCache(session);
              if(cached){
                qrToReturn = cached.qrCode;
                urlToReturn = cached.urlCode;
                customLogger.info(`[QR CACHE] ${session} - Usando QR em memória (fallback rota status)`);
              }
            }
          } catch(_cacheErr) {}
        }
        customLogger.info(`[QR CODE FOUND] ${session} - Status: ${device.status}, State: ${device.state}, QR: ${!!qrToReturn}`);
        
        if (qrToReturn) {
          // QR Code disponível - mostrar no terminal e retornar
          try {
            const qr = require('qrcode-terminal');
            console.log(chalk.cyan(`\n📱 QR CODE para sessão: ${session}`));
            console.log(chalk.yellow('═'.repeat(50)));
            // Se for base64 não tentar gerar ASCII novamente
            if (qrToReturn.startsWith('data:image')) {
              console.log(chalk.gray('[QR] Base64 armazenado - não exibido em ASCII')); 
            } else {
              qr.generate(urlToReturn || qrToReturn, { small: true });
            }
            console.log(chalk.yellow('═'.repeat(50)));
            console.log(chalk.green('👆 Escaneie o QR Code acima com seu celular!'));
            console.log(chalk.gray(`Sessão: ${session} | Status: ${device.status}\n`));
          } catch (err) {
            console.log(chalk.red(`❌ Erro ao exibir QR Code no terminal: ${err.message}`));
            console.log(chalk.cyan(`QR Code disponível para sessão: ${session}`));
          }
          
          return http.json(res, 200, {
            result: 200,
            status: device.status || 'qrCode',
            state: 'QRCODE',
            message: 'QR Code disponível para escaneamento',
            qrCode: qrToReturn,    // Base64 ou texto bruto
            urlCode: urlToReturn,  // Como estava antes  
            data: device
          });
        } else {
          // Status indica QR mas ainda não foi gerado
          return http.json(res, 200, {
            result: 200,
            status: device.status || 'qrCode',
            state: 'GENERATING_QR',
            message: 'Gerando QR Code. Aguarde alguns segundos...',
            data: device
          });
        }
      }

      // QR CODE ESPERADO mas ainda não gerado
      if (device?.status === 'qrCode' && !device?.qrCode) {
        return http.json(res, 200, {
          result: 200,
          status: device.status,
          state: 'GENERATING_QR',
          message: 'Gerando QR Code. Aguarde alguns segundos...',
          data: device
        });
      }

      // VERIFICAR SE ESTÁ INICIALIZANDO (status INITIALIZING mas sem QR ainda)
      if (device?.status === 'INITIALIZING') {
        return http.json(res, 200, {
          result: 200,
          status: 'INITIALIZING',
          state: 'STARTING',
          message: 'Sessão está sendo inicializada. Aguarde...',
          data: device
        });
      }

      // Tentar reconexão automática para status recuperáveis
      if (reconnectableStatuses.includes(device?.status)) {
        customLogger.info(`[RECONNECT ATTEMPT] ${req.body.session} - Status: ${device?.status}`);
        
        try {
          // Tentar reconectar através do engine específico
          await Sessions.attemptReconnection(req.body.session, req);
          
          return http.json(res, 200, {
            result: 200,
            status: 'RECONNECTING',
            state: 'RECONNECTING',
            message: 'Tentando reconectar automaticamente...',
            data: device
          });
        } catch (reconnectError) {
          customLogger.error(`[RECONNECT FAILED] ${req.body.session} - ${reconnectError.message}`);
          
          return http.json(res, 200, {
            result: 200,
            status: device?.status,
            state: 'DISCONNECTED',
            message: 'Reconexão automática falhou. QR Code necessário.',
            needsQR: true,
            data: device
          });
        }
      }

      return http.invalid(res, 'Sessão não está em chat', device);

    } catch (err) {
      customLogger.error(`[ERROR GET CONNECTION STATUS] ${req.body.session}`);
      return http.fail(res, err, 500, 'Erro ao verificar status da conexão');
    }
  }

  static async deleteSession(req, res) {
    try {
      const session = req.body.session;
      const data = await Sessions.getClient(session);
      if (!data) return http.notFound(res, 'Sessão não encontrada!');

      // 1. Fazer logout do WhatsApp client
      const { logout, close } = await SessionsHelper.fecharSessaoComLogout(data, session);
      customLogger.info(`[DELETE SESSION] ${session} - WhatsApp logout: ${logout}, close: ${close}`);

      // 2. Apagar session do banco de dados (a memória já saiu; o banco falhando, quem chamou repete)
      if (!(await SessionsHelper.deleteSessionAndCleanup(session))) {
        return http.fail(res, null, 500, `${session}: sessão fechada, mas o banco não a apagou — repita a exclusão`);
      }
      customLogger.info(`[DELETE SESSION] ${session} - Removida do banco de dados`);

      // 3. Apagar session do cache
      try {
        const Cache = require('../util/cache');
        await Cache.del(session);
        customLogger.info(`[DELETE SESSION] ${session} - Cache removido`);
      } catch (cacheError) {
        customLogger.warn(`[DELETE SESSION] ${session} - Erro ao remover cache: ${cacheError.message}`);
      }

      // 4. Apagar pasta de instâncias físicas (tokens, sessão, etc.)
      try {
        const fs = require('fs');
        const path = require('path');
        const sessionPath = path.join('./instances', session);
        
        if (fs.existsSync(sessionPath)) {
          // Remove pasta da sessão recursivamente (compatível com Windows)
          fs.rmSync(sessionPath, { recursive: true, force: true });
          customLogger.info(`[DELETE SESSION] ${session} - Pasta de instâncias removida: ${sessionPath}`);
        } else {
          customLogger.info(`[DELETE SESSION] ${session} - Nenhuma pasta de instâncias encontrada`);
        }
      } catch (instanceError) {
        customLogger.warn(`[DELETE SESSION] ${session} - Erro ao remover pasta de instâncias: ${instanceError.message}`);
      }

      customLogger.success(`[DELETE SESSION] ${session} - Sessão completamente removida (banco + cache + instâncias)`);
      return http.success(res, { logout, close }, 'Sessão fechada com sucesso');
    } catch (err) {
      customLogger.error(`[DELETE SESSION ERROR] ${req.body.session} - ${err.message}`);
      return http.fail(res, err, 500, 'Erro ao deletar sessão!');
    }
  }

  static async attemptReconnection(session, req) {
    const config = require('../config');
    const engine = config.engine;

    customLogger.info(`[RECONNECT] Tentando reconectar sessão ${session} no engine ${engine}`);

    try {
      switch (engine) {
        case '1': // WhatsApp WebJS
          return await Sessions.reconnectWhatsappWebJS(session, req);
          
        case '2': // WppConnect  
          return await Sessions.reconnectWppConnect(session, req);
          
        case '3': // Venom
          return await Sessions.reconnectVenom(session, req);
          
        default:
          throw new Error(`Engine ${engine} não suportado para reconexão`);
      }
    } catch (error) {
      customLogger.error(`[RECONNECT ERROR] ${session} - ${error.message}`);
      throw error;
    }
  }

  static async reconnectWhatsappWebJS(session, req) {
    const data = await Sessions.getClient(session);
    if (!data?.client) throw new Error('Cliente não encontrado');

    // WhatsApp WebJS tem reconexão automática no evento disconnected
    // Forçar inicialização se necessário
    if (data.client.initialize) {
      await data.client.initialize();
      customLogger.info(`[RECONNECT] WhatsApp WebJS ${session} - initialize() chamado`);
      return true;
    }
    
    throw new Error('Método de reconexão não disponível');
  }

  static async reconnectWppConnect(session, req) {
    const data = await Sessions.getClient(session);
    if (!data?.client) throw new Error('Cliente não encontrado');
    const client = data.client;
    if (!client.getConnectionState) {
      throw new Error('Método de verificação de estado não disponível');
    }
    const state = await client.getConnectionState();
    customLogger.info(`[RECONNECT] WppConnect ${session} - Estado atual: ${state}`);

    // Se o telefone foi desvinculado, não há tokens válidos e um novo QR é necessário.
    if (state === 'UNPAIRED') {
      throw new Error('Dispositivo não pareado - QR Code necessário');
    }

    // Tenta reivindicar a sessão nesta máquina
    if (client.useHere) {
      await client.useHere().catch(() => {});
    }
    // Reinicia o watchdog para forçar verificação periódica
    if (client.startPhoneWatchdog) {
      await client.startPhoneWatchdog(15000).catch(() => {});
    }

    // Espera alguns segundos e verifica se a sessão voltou a ficar conectada
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const newState = await client.getConnectionState();
    if (newState && newState !== 'UNPAIRED') {
      customLogger.success(`[RECONNECT] WppConnect ${session} - Reconectado (state=${newState})`);
      return true;
    }

    // Se ainda não reconectou, fecha a instância e cria de novo usando o token salvo em disco
    if (client.close) {
      await client.close().catch(() => {});
    }
    const WppEngine = require('../engines/WppConnect.js');
    // Cria uma nova sessão. O token armazenado em instances/<session> será reutilizado.
    await WppEngine.initSession(req, null);
    return true;
  }

  static async reconnectVenom(session, req) {
    const data = await Sessions.getClient(session);
    if (!data?.client) throw new Error('Cliente não encontrado');

    customLogger.info(`[RECONNECT] Venom ${session} - Tentando reconexão baseada na documentação oficial`);
    
    try {
      // Baseado na documentação do Venom, verificar se cliente ainda está ativo
      if (data.client.isConnected) {
        const isConnected = await data.client.isConnected();
        customLogger.info(`[RECONNECT] Venom ${session} - Status conectado: ${isConnected}`);
        
        if (isConnected) {
          return true; // Já está conectado
        }
      }

      // Tentar usar getConnectionState se disponível (algumas versões têm)
      if (data.client.getConnectionState) {
        const state = await data.client.getConnectionState();
        customLogger.info(`[RECONNECT] Venom ${session} - Estado: ${state}`);
        
        // Estados reconectáveis baseados na documentação
        const reconnectableStates = ['DISCONNECTED', 'SYNCING', 'RESUMING'];
        if (reconnectableStates.includes(state)) {
          // Venom pode precisar reinicializar a sessão
          return await Sessions.restartVenomSession(session, req);
        }
      }

      // Última tentativa: verificar se podemos usar restartService
      if (data.client.restartService) {
        await data.client.restartService();
        customLogger.info(`[RECONNECT] Venom ${session} - restartService() executado`);
        return true;
      }

      // Se nenhum método funcionou, precisará de QR Code
      throw new Error('Venom: Métodos de reconexão esgotados - QR Code necessário');
      
    } catch (error) {
      customLogger.error(`[RECONNECT] Venom ${session} - Erro: ${error.message}`);
      throw new Error(`Venom: Falha na reconexão - ${error.message}`);
    }
  }

  static async restartVenomSession(session, req) {
    try {
      customLogger.info(`[RESTART] Venom ${session} - Iniciando restart da sessão`);
      
      // Fechar sessão atual primeiro
      const data = await Sessions.getClient(session);
      if (data?.client?.close) {
        await data.client.close();
        customLogger.info(`[RESTART] Venom ${session} - Sessão anterior fechada`);
      }

      // Pequena pausa para garantir limpeza
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Tentar recriar a sessão usando o método do engine
      const engine = require('../engines/Venom.js');
      const result = await engine.reconnect(session, req, null);
      
      if (result) {
        customLogger.info(`[RESTART] Venom ${session} - Nova sessão criada com sucesso`);
        return true;
      } else {
        throw new Error('Falha ao recriar sessão');
      }
      
    } catch (error) {
      customLogger.error(`[RESTART] Venom ${session} - Falha: ${error.message}`);
      throw new Error(`Restart falhou: ${error.message}`);
    }
  }

  static async forceReconnect(req, res) {
    try {
      const session = req.body.session;
      const data = await Sessions.getClient(session);
      
      if (!data) {
        return http.notFound(res, 'Sessão não encontrada!');
      }

      customLogger.info(`[FORCE RECONNECT] Tentativa manual para sessão ${session}`);

      try {
        await Sessions.attemptReconnection(session, req);
        
        return http.success(res, {
          session,
          status: 'RECONNECTING',
          message: 'Reconexão iniciada com sucesso'
        }, 'Tentativa de reconexão iniciada');
        
      } catch (reconnectError) {
        customLogger.error(`[FORCE RECONNECT FAILED] ${session} - ${reconnectError.message}`);
        
        return http.json(res, 400, {
          result: 400,
          status: 'RECONNECT_FAILED',
          session,
          message: reconnectError.message,
          needsQR: reconnectError.message.includes('QR Code')
        });
      }

    } catch (err) {
      customLogger.error(`[FORCE RECONNECT ERROR] ${req.body.session} - ${err.message}`);
      return http.fail(res, err, 500, 'Erro ao tentar reconectar');
    }
  }

  // ADICIONADO - Método para reparar sessão com problemas de associação
  static async repairSession(req, res) {
    try {
      const session = req.body.session;
      
      if (!session) {
        return http.fail(res, 'Sessão não informada', 400, 'Sessão obrigatória');
      }

      customLogger.info(`[REPAIR SESSION] Reparando sessão ${session}`);

      // Verificar se é WhatsApp WebJS
      const config = require('../config');
      
      if (config.engine === '1') {
        // WhatsApp WebJS
        const HelperWhatsappWeb = require('../engines/helper/wweb.js');
        await HelperWhatsappWeb.repairSession(session);
        
        customLogger.info(`[REPAIR SESSION] ${session} - Cache WhatsApp WebJS limpo`);
      }
      
      // Limpar sessão do banco também
      await SessionsHelper.deleteSessionAndCleanup(session);
      
      return http.success(res, {
        session,
        status: 'REPAIRED',
        message: 'Sessão reparada com sucesso. Tente conectar novamente.',
        nextStep: 'Inicie uma nova conexão'
      }, 'Sessão reparada com sucesso');

    } catch (err) {
      customLogger.error(`[REPAIR SESSION ERROR] ${req.body.session} - ${err.message}`);
      return http.fail(res, err, 500, 'Erro ao reparar sessão');
    }
  }

  /**
   * Remove sessão da memória sem precisar de req/res
   * Método seguro para uso em reconexões automáticas
   */
  static removeSessionFromMemory(session) {
    try {
      if (Sessions.client[session]) {
        // Tentar fechar client se existir
        if (Sessions.client[session].client && typeof Sessions.client[session].client.close === 'function') {
          Sessions.client[session].client.close().catch(() => {});
        }
        
        // Remover da memória
        delete Sessions.client[session];
        customLogger.info(`[SESSIONS] Sessão ${session} removida da memória`);
      }
    } catch (error) {
      customLogger.warning(`[SESSIONS] Erro ao remover sessão ${session} da memória:`, error.message);
    }
  }

  /**
   * 🔍 VERIFICAR STATUS REAL - Verifica se a sessão está realmente conectada no Puppeteer/Chrome
   * Endpoint: POST /verifyRealStatus
   * Body: { session: "nome_da_sessao" }
   * 
   * Esta função:
   * 1. Pega o client WhatsApp da memória
   * 2. Verifica se está conectado usando client.getState()
   * 3. Se conectado mas banco está diferente → Atualiza banco
   * 4. Retorna status real
   */
  static async verifyRealStatus(req, res) {
    try {
      const session = req.body.session;
      
      if (!session) {
        return http.invalid(res, 'Parâmetro session é obrigatório');
      }

      customLogger.info(`[VERIFY REAL STATUS] ${session} - Iniciando verificação REAL...`);

      // 1. Buscar device do banco
      const sessionkey = req.headers['sessionkey'];
      const device = await SessionsHelper.getDevice(session, sessionkey);
      
      if (!device) {
        return http.notFound(res, 'Sessão não encontrada no banco de dados');
      }

      // 2. Buscar client da memória
      const client = SessionsHelper.getInjectedClient(session);
      
      if (!client) {
        customLogger.warning(`[VERIFY REAL STATUS] ${session} - Client não encontrado na memória`);
        return http.json(res, 200, {
          result: 200,
          realStatus: 'NO_CLIENT',
          dbStatus: device.status,
          dbState: device.state,
          synced: false,
          functional: false,
          message: '❌ Client não está na memória. Sessão não iniciada ou perdida.',
          action: 'Requer reinicialização da sessão'
        });
      }

      // 3. Diagnóstico completo
      let diagnostics = {
        hasClient: !!client,
        hasInfo: false,
        hasPupPage: !!client.pupPage,
        hasPupBrowser: !!client.pupBrowser,
        getStateResult: null,
        canGetWid: false,
        canGetContacts: false,
        functional: false
      };

      let realState = null;
      let clientInfo = null;
      let isFunctional = false;

      try {
        // TESTE 1: getState()
        realState = await client.getState();
        diagnostics.getStateResult = realState;
        customLogger.info(`[VERIFY REAL STATUS] ${session} - getState(): ${realState}`);
      } catch (stateErr) {
        diagnostics.getStateError = stateErr.message;
        customLogger.error(`[VERIFY REAL STATUS] ${session} - getState() falhou: ${stateErr.message}`);
      }

      try {
        // TESTE 2: client.info (só existe se evento 'ready' disparou)
        clientInfo = client.info;
        diagnostics.hasInfo = !!clientInfo;
        diagnostics.hasWid = !!clientInfo?.wid;
        
        if (clientInfo?.wid) {
          diagnostics.widUser = clientInfo.wid.user;
          customLogger.info(`[VERIFY REAL STATUS] ${session} - client.info.wid: ${clientInfo.wid.user}`);
        }
      } catch (infoErr) {
        diagnostics.infoError = infoErr.message;
      }

      try {
        // TESTE 3: Tentar obter WID via pupPage (teste mais profundo)
        if (client.pupPage) {
          const widFromPage = await client.pupPage.evaluate(() => {
            return window.Store?.Conn?.wid?._serialized || null;
          });
          diagnostics.canGetWid = !!widFromPage;
          diagnostics.widFromPage = widFromPage;
          
          if (widFromPage) {
            customLogger.info(`[VERIFY REAL STATUS] ${session} - WID via pupPage: ${widFromPage}`);
          }
        }
      } catch (pageErr) {
        diagnostics.pageError = pageErr.message;
      }

      try {
        // TESTE 4: ⭐ TESTE FUNCIONAL REAL - Tentar buscar o próprio número
        // Este é o teste DECISIVO - se funcionar, a sessão está operacional
        if (client.pupPage) {
          const isReady = await client.pupPage.evaluate(() => {
            // Verifica se o Store está carregado e funcional
            return !!(
              window.Store && 
              window.Store.Conn && 
              window.Store.Conn.wid && 
              window.Store.Chat
            );
          });
          diagnostics.storeReady = isReady;
          
          if (isReady) {
            // chatCount/storeReady ficam apenas como DIAGNOSTICO (o criterio de
            // 'funcional' esta abaixo — NAO dependemos mais so do storeReady).
            const chatCount = await client.pupPage.evaluate(() => {
              try {
                return window.Store.Chat.models?.length || 0;
              } catch {
                return -1;
              }
            });
            diagnostics.chatCount = chatCount;
            diagnostics.canGetContacts = chatCount > 0;
          }
        }
      } catch (funcErr) {
        diagnostics.functionalError = funcErr.message;
        customLogger.error(`[VERIFY REAL STATUS] ${session} - Teste funcional falhou: ${funcErr.message}`);
      }

      // ⭐ FUNCIONAL = a sessao realmente ENVIA. Confiamos na API OFICIAL da lib:
      // getState()=CONNECTED + WID carregado (client.info.wid). NAO exigimos mais o
      // storeReady (window.Store.Conn.wid/Store.Chat): essa estrutura INTERNA mudou
      // em versoes novas do WhatsApp Web e passou a dar FALSO NEGATIVO — a sessao
      // envia normal (sendMessage/self-test OK) porem storeReady vinha false,
      // travando a fila do gerenciador (envio bloqueado eterno). storeReady/chatCount
      // ficam so como diagnostico/reforco positivo.
      isFunctional = (realState === 'CONNECTED') && (diagnostics.hasWid === true || diagnostics.storeReady === true);
      diagnostics.functional = isFunctional;
      customLogger.info(`[VERIFY REAL STATUS] ${session} - Funcional: ${isFunctional} (state=${realState}, hasWid=${diagnostics.hasWid}, storeReady=${diagnostics.storeReady})`);

      // 4. Determinar status real
      const dbIsConnected = ['CONNECTED', 'inChat', 'isLogged'].includes(device.status);
      const reallyConnected = isFunctional; // ⭐ Usar resultado do teste funcional

      // 5. Resposta baseada no status FUNCIONAL
      if (reallyConnected) {
        // Sessão realmente funcional
        if (!dbIsConnected) {
          // Atualizar banco se estava desincronizado
          await Device.update({
            status: 'CONNECTED',
            state: 'CONNECTED',
            qrCode: '',
            urlCode: '',
            attempts: 0,
            number: clientInfo?.wid?.user || diagnostics.widFromPage?.split('@')[0] || device.number,
            last_connect: new Date(),
            updated_at: new Date()
          }, { where: { session } });
        }
        
        return http.json(res, 200, {
          result: 200,
          realStatus: realState,
          dbStatus: dbIsConnected ? device.status : 'CONNECTED',
          dbState: device.state,
          synced: true,
          functional: true,
          updated: !dbIsConnected,
          message: '✅ Sessão FUNCIONAL - Pode enviar mensagens!',
          clientInfo: {
            number: clientInfo?.wid?.user || diagnostics.widFromPage?.split('@')[0],
            pushname: clientInfo?.pushname,
            platform: clientInfo?.platform
          },
          diagnostics
        });
      } else {
        // ⚠️ Sessão NÃO funcional - Responder RÁPIDO e sugerir ação
        customLogger.warning(`[VERIFY REAL STATUS] ${session} - Sessão não funcional`);
        
        // 🚀 OTIMIZADO: Não tentar reparar de forma síncrona (causa timeout)
        // Apenas informar o usuário e dar opções
        
        const hasClient = !!client;
        const hasPupPage = !!client?.pupPage;
        const canTryRepair = hasClient && hasPupPage;
        
        // Sugestão de ação baseada no diagnóstico
        let suggestedAction = 'Deletar sessão e reconectar com QR Code';
        let canAutoRepair = false;
        
        // Se tem client e pupPage, pode tentar reparar
        if (canTryRepair && realState === 'CONNECTED') {
          suggestedAction = 'Clique em "Tentar Reparar" ou delete e reconecte';
          canAutoRepair = true;
        } else if (!hasClient) {
          suggestedAction = 'Sessão perdida. Delete e reconecte com QR Code';
        } else if (realState === null || realState === 'UNPAIRED') {
          suggestedAction = 'Sessão deslogada. Delete e reconecte com QR Code';
        }
        
        return http.json(res, 200, {
          result: 200,
          realStatus: realState,
          dbStatus: device.status,
          dbState: device.state,
          synced: false,
          functional: false,
          canAutoRepair: canAutoRepair,
          message: realState === 'CONNECTED' 
            ? '⚠️ getState()=CONNECTED mas sessão NÃO funciona! Store não carregou.'
            : `❌ Sessão não funcional. Estado: ${realState || 'desconhecido'}`,
          action: suggestedAction,
          diagnostics
        });
      }

    } catch (err) {
      customLogger.error(`[VERIFY REAL STATUS ERROR] ${req.body.session} - ${err.message}`);
      return http.fail(res, err, 500, 'Erro ao verificar status real');
    }
  }
}

module.exports = Sessions;
