/**
 * Cache de respostas da IA para evitar loop no modo ALLOW_SELF_TEST.
 * Quando você envia uma mensagem para seu próprio número para testar,
 * este cache evita que a resposta da IA seja processada novamente como input.
 * @module iaResponseCache
 */

const iaResponsesCache = new Map();
const CACHE_TTL_MS = 60000; // 60 segundos

/**
 * Normaliza texto para comparação.
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado (primeiros 100 chars)
 */
function normalizeText(text) {
  if (!text) return '';
  return text.toString().trim().substring(0, 100);
}

/**
 * Registra uma resposta da IA no cache.
 * @param {string} text - Texto da resposta da IA
 */
function registerIAResponse(text) {
  if (!text) return;
  const key = normalizeText(text);
  iaResponsesCache.set(key, Date.now());
  
  // Limpar entradas antigas
  for (const [k, v] of iaResponsesCache) {
    if (Date.now() - v > CACHE_TTL_MS) {
      iaResponsesCache.delete(k);
    }
  }
}

/**
 * Verifica se um texto é uma resposta recente da IA.
 * @param {string} text - Texto a verificar
 * @returns {boolean} true se é resposta da IA
 */
function isIAResponse(text) {
  const key = normalizeText(text);
  
  if (iaResponsesCache.has(key)) {
    return true;
  }
  
  // Match parcial (primeiros 50 chars)
  const shortKey = key.substring(0, 50);
  for (const [cachedKey] of iaResponsesCache) {
    if (cachedKey.startsWith(shortKey) || shortKey.startsWith(cachedKey.substring(0, 50))) {
      return true;
    }
  }
  
  return false;
}

// Mídia (áudio/foto/arquivo) enviada pelo SISTEMA — voz do bot, anexos da
// mensagem padrão, PDF pela API — por destino. Sem texto para comparar, é o
// único jeito de distinguir do áudio/foto que o atendente manda pelo celular.
const SYSTEM_MEDIA_TTL_MS = 2 * 60 * 1000;
const systemMedia = new Map();
// chave = sessão (loja) + id do chat sem o sufixo (@c.us/@lid), que é o que o
// bot usa ao enviar e o que vem em message.to: duas lojas na mesma VPS falando com o
// mesmo cliente não podem se marcar uma à outra
const chaveDestino = (session, destino) => `${String(session || '')}|${String(destino || '').replace(/@.*$/, '').trim()}`;

function registerSystemMedia(session, destino) {
  const k = chaveDestino(session, destino);
  if (!String(destino || '').trim()) return;
  systemMedia.set(k, Date.now() + SYSTEM_MEDIA_TTL_MS);
  if (systemMedia.size > 500) {
    for (const [kk, exp] of systemMedia) if (Date.now() > exp) systemMedia.delete(kk);
  }
}

function isSystemMedia(session, destino) {
  const k = chaveDestino(session, destino);
  const exp = systemMedia.get(k);
  if (!exp) return false;
  if (Date.now() > exp) { systemMedia.delete(k); return false; }
  return true;
}

module.exports = {
  registerIAResponse,
  isIAResponse,
  registerSystemMedia,
  isSystemMedia,
};
