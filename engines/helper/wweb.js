const { Buffer } = require('buffer');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeBase64 = require('qrcode');
const chalk = require('chalk');
const webhooks = require('../../controllers/WebhooksController.js');
const Sessions = require('../../controllers/SessionsController.js');
const customLogger = require('../../util/customLogger.js'); // ADICIONADO

// MELHORADO - Controle de QR Code para evitar mudanças muito rápidas
let qrCodeCache = new Map(); // Cache para evitar QR Codes duplicados
let qrTimers = new Map(); // Timers para controlar exibição

module.exports = {
  async exportQR(req, res, qrCode, session) {
    try {
      let qrCodeBase64;
      
      // 🔍 VERIFICAR SE JÁ É BASE64 OU PRECISA CONVERTER
      if (qrCode.startsWith('data:image/')) {
        // Já é base64 completo
        qrCodeBase64 = qrCode;
      } else {
        // 🚀 CONVERTER TEXTO PARA BASE64
        qrCodeBase64 = await qrcodeBase64.toDataURL(qrCode, {
          errorCorrectionLevel: 'M',
          type: 'image/png',
          quality: 0.92,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          width: 256
        });
      }
      
      const qrData = {
        qrCode: qrCodeBase64, // 🚀 SEMPRE BASE64
        data: qrCodeBase64,
        session,
        timestamp: Date.now(),
        status: 'qrCode'
      };
      
      // Emitir via Socket.IO para interface web
      if (req.io) {
        req.io.emit('qrcode', qrData);
        customLogger.success(`📡 QR Code base64 emitido via Socket.IO - Sessão: ${session}`);
      } else {
        customLogger.warning(`⚠️ Socket.IO não disponível - Sessão: ${session}`);
      }
      
      // Também emitir evento específico da sessão
      if (req.io) {
        req.io.emit(`qrcode-${session}`, qrData);
        customLogger.info(`📡 QR Code emitido para sessão específica: ${session}`);
      }
      
    } catch (error) {
      customLogger.error(`❌ Erro ao exportar QR Code - Sessão: ${session} - ${error.message}`);
    }
  },

  showTerminalQR(qr, session = 'unknown') {
    // Verificar se é um QR Code novo ou repetido
    const qrHash = require('crypto').createHash('md5').update(qr).digest('hex');
    const lastQR = qrCodeCache.get(session);
    
    if (lastQR === qrHash) {
      console.log(chalk.yellow(`⏳ QR Code mantido para sessão: ${session}`));
      return; // Não reexibir o mesmo QR Code
    }
    
    // Limpar timer anterior se existir
    if (qrTimers.has(session)) {
      clearTimeout(qrTimers.get(session));
    }
    
    // Salvar novo QR Code
    qrCodeCache.set(session, qrHash);
    
    console.log(chalk.cyan('\n' + '═'.repeat(60)));
    console.log(chalk.green(`📱 NOVO QR CODE WHATSAPP WEBJS - Sessão: ${session}`));
    console.log(chalk.yellow('⚡ QR Code gerado! Escaneie RAPIDAMENTE com seu celular!'));
    console.log(chalk.cyan('═'.repeat(60)));
    
    try {
      qrcodeTerminal.generate(qr, { small: true });
    } catch (error) {
      console.log(chalk.red(`❌ Erro ao gerar QR Code no terminal: ${error.message}`));
    }
    
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.blue('📋 INSTRUÇÕES:'));
    console.log(chalk.white('1. Abra o WhatsApp no seu celular'));
    console.log(chalk.white('2. Toque em "Dispositivos conectados"'));
    console.log(chalk.white('3. Toque em "Conectar dispositivo"'));
    console.log(chalk.white('4. Escaneie o QR Code acima AGORA!'));
    console.log(chalk.cyan('═'.repeat(60)));
    
    // Timer para avisar sobre expiração
    const timer1 = setTimeout(() => {
      console.log(chalk.yellow(`⏰ [${session}] QR Code expira em 20 segundos! Escaneie agora!`));
    }, 10000);
    
    const timer2 = setTimeout(() => {
      console.log(chalk.red(`⏰ [${session}] QR Code expira em 10 segundos! URGENTE!`));
    }, 20000);
    
    const timer3 = setTimeout(() => {
      console.log(chalk.red(`❌ [${session}] QR Code expirou! Novo QR Code será gerado...`));
      qrCodeCache.delete(session);
    }, 30000);
    
    // Limpar referência do timer principal
    qrTimers.set(session, timer3);
  },

  // ADICIONADO - Função para limpar cache de sessão corrompida
  async cleanSessionCache(session) {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const sessionPath = path.join('./instances', `${session}`);
      
      if (fs.existsSync(sessionPath)) {
        console.log(chalk.yellow(`🧹 Limpando cache corrompido para sessão: ${session}`));
        
        // Remover pasta da sessão recursivamente
        fs.rmSync(sessionPath, { recursive: true, force: true });
        
        console.log(chalk.green(`✅ Cache limpo para sessão: ${session}`));
        return true;
      } else {
        console.log(chalk.blue(`ℹ️ Nenhum cache encontrado para sessão: ${session}`));
        return false;
      }
    } catch (error) {
      console.log(chalk.red(`❌ Erro ao limpar cache da sessão ${session}: ${error.message}`));
      return false;
    }
  },

  // ADICIONADO - Função para verificar e reparar sessão
  async repairSession(session) {
    console.log(chalk.cyan(`🔧 Reparando sessão: ${session}`));
    
    // 1. Limpar cache
    await this.cleanSessionCache(session);
    
    // 2. Limpar timers
    if (qrTimers.has(session)) {
      clearTimeout(qrTimers.get(session));
      qrTimers.delete(session);
    }
    
    // 3. Limpar QR Code cache
    if (qrCodeCache.has(session)) {
      qrCodeCache.delete(session);
    }
    
    console.log(chalk.green(`✅ Sessão reparada: ${session}`));
  },

  async generateQRHooksAndEmit({ qr, req, res, session }) {
    try {
      // 🚀 CONVERTER QR CODE TEXTO PARA IMAGEM BASE64
      const qrCodeBase64 = await qrcodeBase64.toDataURL(qr, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        width: 256 // TAMANHO ADEQUADO
      });
      
      const payload = {
        message: 'QRCode gerado. Leia para autenticar…',
        state: 'QRCODE',
        qrCode: qrCodeBase64, // 🚀 IMAGEM BASE64 COMPLETA
        attempt: 1,
        urlCode: '', // WhatsApp Web.js não tem urlCode
        session
      };
      
      // Emitir imediatamente igual WPPConnect
      req?.io?.emit('qrcode', payload);
      req?.io?.emit('events', { ...payload, message: 'Evento `events` será descontinuado; use `qrcode`.' });
      
      // Mostrar QR Code no terminal (texto original)
      this.showTerminalQR(qr, session);
      
      // Enviar webhook com imagem base64
      webhooks.wh_qrcode(session, qrCodeBase64);
      
      // Salvar informações da sessão com imagem base64
      Sessions.addInfoSession(session, { 
        qrCode: qrCodeBase64, // 🚀 IMAGEM BASE64
        urlCode: '',
        status: 'qrCode',
        timestamp: Date.now()
      });
      
      console.log(chalk.green(`📡 QR Code base64 enviado para interface web - Sessão: ${session}`));
      
      // 🚀 RETORNAR A IMAGEM BASE64 PARA USO NO ENGINE
      return qrCodeBase64;
      
    } catch (error) {
      console.log(chalk.red(`❌ Erro ao gerar QR Code base64 - Sessão: ${session} - ${error.message}`));
      
      // Fallback - enviar QR original se falhar
      const payload = {
        message: 'QRCode gerado (fallback). Leia para autenticar…',
        state: 'QRCODE',
        qrCode: qr,
        attempt: 1,
        urlCode: '',
        session
      };
      
      req?.io?.emit('qrcode', payload);
      this.showTerminalQR(qr, session);
      
      // 🚀 RETORNAR QR ORIGINAL EM CASO DE ERRO
      return qr;
    }
  },

  getClientOptions({ session, useHere, sessionData }) {
    // Versão e estratégia de cache do WhatsApp Web.
    // ANTES: o HTML do WhatsApp Web era baixado de um repositório de TERCEIRO
    // (github.com/AliAryanTech/...). Se aquele arquivo saísse do ar, mudasse ou
    // ficasse desatualizado frente ao WhatsApp atual, TODAS as sessões caíam /
    // viravam "zumbi" (conecta mas o Store não carrega) de uma vez — sem a gente
    // tocar em nada. Era também risco de segurança (JS de terceiro rodando no
    // contexto da sessão de WhatsApp do cliente). AGORA o controle é NOSSO, via .env:
    //   - WHATSAPP_VERSION      -> fixa uma versão testada (ex.: 2.3000.x). Recomendado.
    //   - WEB_VERSION_CACHE_URL -> cache remoto SOB NOSSO host (nunca de terceiros).
    //   - nada definido         -> 'local': a lib usa a versão corrente e cacheia em disco.
    const webVersion = (process.env.WHATSAPP_VERSION || '').trim();
    const webVersionCacheUrl = (process.env.WEB_VERSION_CACHE_URL || '').trim();
    const webVersionCache = webVersionCacheUrl
      ? { type: 'remote', remotePath: webVersionCacheUrl }
      : { type: 'local' };

    const base = {
      // ADICIONADO - Estratégia de autenticação local para persistir sessões
      authStrategy: new (require('whatsapp-web.js').LocalAuth)({ 
        clientId: session,
        dataPath: './instances'
      }),
      restartOnAuthFail: true,
      takeoverOnConflict: useHere,
      // PADRONIZADO - usar pasta local instances/ igual WPPConnect e Venom
      dataPath: './instances',
      // MELHORADO - Aumentar timeouts para dar mais tempo ao QR Code
      qrMaxRetries: 5, // AUMENTADO para 5 tentativas
      authTimeoutMs: 120000, // AUMENTADO para 120 segundos (2 minutos)
      takeoverTimeoutMs: 120000, // AUMENTADO timeout para takeover
      // Versão/cache do WhatsApp Web — agora sob NOSSO controle via .env (ver nota
      // acima em getClientOptions). Sem dependência de repositório de terceiros.
      ...(webVersion ? { webVersion } : {}),
      webVersionCache,
      puppeteer: {
        // Chrome SEM o D-Bus da sessão do usuário. O pm2 herdou de um SSH antigo
        // DBUS_SESSION_BUS_ADDRESS=/run/user/0/bus; com ele, o Chrome se põe DENTRO da
        // sessão systemd do root (user@0.service) — e morre junto quando ela para.
        // Na VPS, o cron de minuto em minuto do DisparaZap (como root) abre e fecha
        // essa sessão 60x por hora: de 25/09 00h às 09h todo Chrome das sessões levou
        // SIGABRT ~1 min depois de subir (core dump no mesmo segundo do "Stopped User
        // Manager for UID 0"), e o health check via "detached Frame"/zumbi em ciclo de
        // 6 min. O `loginctl enable-linger root` resolveu na VPS; isto garante em
        // qualquer máquina. Headless não precisa do barramento da sessão para nada.
        env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: 'disabled:' },
        // CORRIGIDO - headless: true para não abrir navegador automaticamente
        headless: true, // MUDADO: true para evitar abrir navegador visual
        // MELHORADO - Timeouts maiores para estabilidade
        timeout: 120000, // AUMENTADO para 120 segundos
        // ADICIONADO - Opções para manter processo estável
        defaultViewport: null,
        // 🚀 AUMENTADO - protocolTimeout para evitar "Runtime.callFunctionOn timed out"
        protocolTimeout: 300000, // 5 minutos (era 120000)
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          // MELHORADO - Argumentos adicionais para estabilidade
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--disable-plugins',
          '--no-default-browser-check',
          // ADICIONADO - Argumentos para evitar problemas de associação
          '--disable-web-security',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          // ADICIONADO - Para estabilidade de sessão
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1920,1080',
          // 🚀 OTIMIZAÇÕES DE MEMÓRIA - Reduz 30-40% RAM por sessão
          '--disable-software-rasterizer',       // Reduz uso de CPU/GPU
          '--disable-background-networking',     // Evita conexões em background
          '--disable-sync',                      // Desabilita sincronização Chrome
          '--disable-default-apps',              // Desabilita apps padrão
          '--disable-translate',                 // Desabilita tradutor
          '--disable-cache',                     // Desabilita cache em memória
          '--disk-cache-size=1',                 // Limita cache de disco a 1 byte
          '--media-cache-size=1',                // Limita cache de mídia
          '--js-flags=--max-old-space-size=512'  // Limita memória V8 a 512MB
        ]
      }
    };

    // REMOVIDO Firebase - agora usa pasta local instances/
    // WhatsApp WebJS irá salvar tokens automaticamente na pasta instances/
    console.log(`[WEBJS TOKEN] ${session} - Usando tokens da pasta instances/`);

    return base;
  }
};
