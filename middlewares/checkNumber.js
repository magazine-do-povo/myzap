const Sessions = require("../controllers/SessionsController.js");
const Cache = require("../util/cache");
const logger = require("../util/logger");

const config = require("../config.js");

const CompanyModel = require("../Models/company.js");
const Company = CompanyModel(config.sequelize);

async function checkNumber(req, res, next) {
  try {
    const device = await getConnectedDevice(req, res);
    const number = req?.body?.number;

    if (typeof device?.client === "undefined") {
      logger.error(`[CHECKNUMBER] Dispositivo não conectado - Sessão: ${req?.body?.session ?? ""}`);
      return res.status(400).send({
        error: true,
        message: `O dispositivo ${
          req?.body?.session ?? ""
        } não está conectado.`,
      });
    }

    // JID inteiro ("9775882481727@lid", 23/09/2026, loja piloto da Celularis): o WhatsApp passou
    // a entregar cliente novo como @lid, que não é telefone — o getNumberId não acha e o envio
    // caía em 404 "não está registrado". O zap manda o JID do contato; JID não se limpa nem se
    // verifica, vai como veio (o buildNumber também o deixa passar). Só no whatsapp-web.js (o
    // cliente com getNumberId, como em handleNumberVerification): Venom e WPPConnect ainda
    // acrescentam @c.us por conta própria e seguem o caminho de sempre.
    if (ehJid(number) && typeof device.client.getNumberId === "function") {
      await Cache.set(number, number);
      return next();
    }

    if (!isValidNumber(number)) {
      return res.status(400).send({
        error: true,
        message: `O número informado ${number ?? ""} é inválido.`,
      });
    }

    // CORRIGIDO - Limpar número ANTES de buscar no cache
    const cleanedNumber = cleanNumber(number);
    const cachedValue = await Cache.get(cleanedNumber);

    if (cachedValue === null) {
      await handleNumberVerification(device?.client, number, res, req);
    }

    // CORRIGIDO - O número já foi ajustado em handleNumberVerification se necessário
    // Não sobrescrever aqui! Apenas garante que está limpo se veio do cache
    if (!req.body.number || req.body.number === number) {
      req.body.number = cleanedNumber;
    }
    next();
  } catch (error) {
    logger.error(`[CHECKNUMBER] ${(error.message, error.stack)}`);

    return res.status(500).json({
      response: false,
      status: "error",
      message: `Ocorreu um erro ao verificar o número.`,
    });
  }
}

async function getConnectedDevice(req, res) {
  const device = await Sessions.getClient(req.body.session);

  let status_permited = ["inChat", "qrReadSuccess", "isLogged", "CONNECTED"];

  // 🔴 CORRIGIDO: Verificar também se o CLIENT está realmente conectado
  // O status no banco pode estar desatualizado
  let clientReallyConnected = false;
  
  if (device?.client) {
    try {
      // Verificar estado REAL do client (com timeout de 3s)
      const statePromise = Promise.race([
        device.client.getState?.() || Promise.resolve(null),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      const realState = await statePromise;
      clientReallyConnected = realState === 'CONNECTED';
    } catch (e) {
      // Se deu erro/timeout, verificar se client.info existe (autenticado)
      clientReallyConnected = !!device.client.info;
    }
  }

  // Aceita se: status no banco é permitido OU client está realmente conectado
  if (!device || (!status_permited.includes(device.status) && !clientReallyConnected)) {
    console.log(`[CHECKNUMBER] Dispositivo não conectado - Sessão: ${req?.body?.session ?? ""} - Status: ${device?.status} - ClientConnected: ${clientReallyConnected}`);
    return res.status(400).send({
      error: true,
      status: device?.status,
      state: device?.state,
      message: `O dispositivo ${req?.body?.session ?? ""} não está conectado.`,
    });
  }

  return device;
}

function cleanNumber(number) {
  if (!number) {
    throw new Error(`O número não foi informado.`);
  }

  // LIMPEZA - Remove tudo exceto números
  let cleaned = number.toString().replace(/[^0-9]/g, "");
  
  // CORRIGIR FORMATO BRASILEIRO - Adicionar código do país (55) se necessário
  if (cleaned.length === 10 || cleaned.length === 11) {
    // DDD (2 dígitos) + Número (8 ou 9 dígitos) = 10 ou 11 dígitos
    // Falta o código do país! Adicionar 55
    cleaned = '55' + cleaned;
    console.log(`[CLEAN NUMBER] Adicionado código BR: ${number} → ${cleaned}`);
  } else if (cleaned.length === 12 || cleaned.length === 13) {
    // Já tem o código do país (55)
    console.log(`[CLEAN NUMBER] Número completo: ${number} → ${cleaned}`);
  } else {
    console.log(`[CLEAN NUMBER] Formato incomum: ${number} → ${cleaned}`);
  }
  
  return cleaned;
}

/** "<dígitos>@lid", "<dígitos>@c.us" ou grupo "<dígitos[-dígitos]>@g.us": já é o destino. */
function ehJid(number) {
  return typeof number === "string" && /^\d+(-\d+)?@(lid|c\.us|g\.us)$/.test(number);
}

function isValidNumber(number) {
  return number.length >= 10 && number.length <= 24;
}

function isGroupNumber(number) {
  const condition =
    (number.length >= 18 && number.length <= 24) || number.includes("-");
  return condition;
}

async function handleNumberVerification(client, number, res, req) {
  try {
    const cleanedNumber = cleanNumber(number);
    console.log(`[NUMBER VERIFICATION] Verificando: ${cleanedNumber}`);
    
    if (isGroupNumber(cleanedNumber)) {
      console.log(`[GROUP NUMBER] ${cleanedNumber} → ${cleanedNumber}@g.us`);
      await Cache.set(cleanedNumber, `${cleanedNumber}@g.us`);
    } else {
      // WHATSAPP-WEB.JS - Usar getNumberId() (método correto)
      if (client && typeof client.getNumberId === 'function') {
        console.log(`[WEBJS] Verificando número ${cleanedNumber} com getNumberId()...`);
        
        let numberId = null;
        let validNumber = null; // Número que realmente funcionou
        
        // 1️⃣ Tenta com o número original
        numberId = await client.getNumberId(cleanedNumber);
        if (numberId) {
          validNumber = cleanedNumber;
          console.log(`[SUCCESS] Número encontrado no formato original: ${cleanedNumber}`);
        }
        
        // 2️⃣ Se não encontrou e tem 13 dígitos (55 + DDD + 9 dígitos) → Tenta SEM o 9
        if (!numberId && cleanedNumber.length === 13 && cleanedNumber.startsWith('55')) {
          const numberWithout9 = cleanedNumber.slice(0, 4) + cleanedNumber.slice(5);
          console.log(`[WEBJS] Tentando sem o 9º dígito: ${numberWithout9}`);
          numberId = await client.getNumberId(numberWithout9);
          
          if (numberId) {
            validNumber = numberWithout9;
            console.log(`[SUCCESS] Número encontrado sem o 9º dígito: ${numberWithout9}`);
          }
        }
        
        // 3️⃣ Se não encontrou e tem 12 dígitos (55 + DDD + 8 dígitos) → Tenta COM o 9
        if (!numberId && cleanedNumber.length === 12 && cleanedNumber.startsWith('55')) {
          const numberWith9 = cleanedNumber.slice(0, 4) + '9' + cleanedNumber.slice(4);
          console.log(`[WEBJS] Tentando com o 9º dígito: ${numberWith9}`);
          numberId = await client.getNumberId(numberWith9);
          
          if (numberId) {
            validNumber = numberWith9;
            console.log(`[SUCCESS] Número encontrado com o 9º dígito: ${numberWith9}`);
          }
        }
        
        // ❌ Se nenhum formato funcionou
        if (!numberId || !validNumber) {
          console.log(`[ERROR] Número ${cleanedNumber} NÃO EXISTE no WhatsApp em nenhum formato`);
          return res.status(404).json({
            response: false,
            status: "error",
            message: `O telefone informado não está registrado no WhatsApp.`,
          });
        }

        // Salvar no cache usando o NÚMERO QUE FUNCIONOU
        const whatsappId = numberId._serialized || `${validNumber}@c.us`;
        console.log(`[NUMBER VERIFIED] ${validNumber} → ${whatsappId}`);
        
        // Salva DOIS registros no cache para evitar reprocessamento:
        await Cache.set(validNumber, whatsappId); // Número correto
        if (validNumber !== cleanedNumber) {
          await Cache.set(cleanedNumber, whatsappId); // Número original também
          console.log(`[CACHE] Salvos ambos: ${cleanedNumber} e ${validNumber}`);
        }
        
        // CRITICAL: Atualizar req.body.number com o número VÁLIDO
        req.body.number = validNumber;
      } 
      // WPPCONNECT/VENOM - Usar checkNumberStatus()
      else if (client && typeof client.checkNumberStatus === 'function') {
        console.log(`[WPPCONNECT/VENOM] Verificando número ${cleanedNumber} com checkNumberStatus()...`);
        const profile = await client.checkNumberStatus(cleanedNumber);
        console.log(`[DEBUG] Resultado checkNumberStatus:`, JSON.stringify(profile, null, 2));

        if (!profile?.numberExists) {
          console.log(`[ERROR] Número ${cleanedNumber} NÃO EXISTE no WhatsApp segundo checkNumberStatus`);
          return res.status(404).json({
            response: false,
            status: "error",
            message: `O telefone informado ${cleanedNumber} não está registrado no WhatsApp.`,
            profile: profile,
          });
        }

        const whatsappId = profile?.id?._serialized || `${cleanedNumber}@c.us`;
        console.log(`[NUMBER VERIFIED] ${cleanedNumber} → ${whatsappId}`);
        await Cache.set(cleanedNumber, whatsappId);
      } 
      else {
        // ⚠️ FALLBACK - Se client não tem nenhum método de verificação
        const fallbackId = `${cleanedNumber}@c.us`;
        console.log(`⚠️ [FALLBACK] ${cleanedNumber} → ${fallbackId} (nenhum método de verificação disponível)`);
        await Cache.set(cleanedNumber, fallbackId);
      }
    }
  } catch (error) {
    logger.error(`[HANDLE NUMBER VERIFICATION] ${error.message}`);

    throw new Error(`Erro ao verificar o número: ${error.message}`);
  }
}

exports.checkNumber = checkNumber;
exports.ehJid = ehJid;
