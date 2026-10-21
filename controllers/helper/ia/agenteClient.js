const customLogger = require('../../../util/customLogger');

/**
 * Cliente do Agente IA do ClickExpress (serviço no GKE).
 *
 * Ativado por IA_PROVIDER=agente. O myzap vira só transporte: entrega a
 * mensagem (texto ou áudio base64) e envia de volta o que o agente responder.
 * Guards, memória, LLM (Gemini/Vertex) e tools do MCP vivem no agente —
 * este arquivo não decide nada.
 *
 * Env:
 *   AGENT_URL        ex.: https://agente-clickexpress.jztech.com.br
 *   AGENT_AUTH_TOKEN o mesmo AGENT_AUTH_TOKEN do serviço
 */
const AGENT_URL = (process.env.AGENT_URL || '').replace(/\/+$/, '');
const AGENT_AUTH_TOKEN = process.env.AGENT_AUTH_TOKEN || '';

// ── Config remota (modo LOCAL, máquina do lojista): sem env configurada, o
// worker busca a config na API do ClickExpress usando a sessionkey que ele já
// tem — mesmo modelo de confiança do MCP. Cache de 10 min por sessionkey.
const API_CLICKEXPRESS =
    (process.env.API_CLICKEXPRESS_URL || 'https://api-clickexpress.jztech.com.br/public').replace(/\/+$/, '');
const configCache = new Map(); // sessionkey -> { cfg, ate }

const hostDe = (url) => {
    try { return new URL(url).hostname; } catch { return ''; }
};

/**
 * Sessão de OUTRO produto (ex.: o agente do ClickJoias): o api_url dela aponta
 * para outra API que não a do ClickExpress. Essa sessão pergunta à API DELA
 * quem é o seu agente — sem isto, o AGENT_URL global da VPS (o agente do
 * ClickExpress) atenderia os clientes de uma loja de joias.
 */
const ehDeOutroProduto = (apiUrlEmpresa) =>
    Boolean(apiUrlEmpresa) && hostDe(apiUrlEmpresa) !== '' && hostDe(apiUrlEmpresa) !== hostDe(API_CLICKEXPRESS);

async function resolverConfig(sessionkey, apiUrlEmpresa) {
    if (AGENT_URL && AGENT_AUTH_TOKEN && !ehDeOutroProduto(apiUrlEmpresa)) {
        return { url: AGENT_URL, token: AGENT_AUTH_TOKEN };
    }

    const agora = Date.now();
    const emCache = configCache.get(sessionkey);
    if (emCache && emCache.ate > agora) return emCache.cfg;

    const base = (apiUrlEmpresa || API_CLICKEXPRESS).replace(/\/+$/, '');
    try {
        const resp = await fetch(`${base}/myzap/agente-config/${encodeURIComponent(sessionkey)}`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const dados = await resp.json();
        const r = dados.result || dados;
        if (!r.agent_url || !r.agent_auth_token) throw new Error('config incompleta');
        const cfg = {
            url: String(r.agent_url).replace(/\/+$/, ''),
            token: r.agent_auth_token,
            // Espelho do toggle do painel (Parametrizacao > Site > Integracoes).
            // API antiga nao manda o campo -> null = desconhecido.
            iaAtiva: typeof r.ia_ativa === 'boolean' ? r.ia_ativa : null,
        };
        configCache.set(sessionkey, { cfg, ate: agora + 10 * 60 * 1000 });
        return cfg;
    } catch (err) {
        customLogger.error(`[AGENTE] falha ao buscar config remota: ${err.message}`);
        return null;
    }
}

async function atender({ sessionkey, numero, celular, nome, texto, audioBase64, audioMime, midiaBase64, midiaMime, origem, apiUrlEmpresa, vozDepois }) {
    const cfg = await resolverConfig(sessionkey, apiUrlEmpresa);
    if (!cfg) {
        customLogger.error('[AGENTE] sem AGENT_URL (env ou config remota) com IA_PROVIDER=agente');
        return null;
    }

    const corpo = {
        sessionkey,
        numero: String(numero || '').replace(/@.*$/, ''), // tira @c.us
        nome: nome || null,
        origem: origem || 'cliente',
    };
    // telefone REAL (contatos @lid escondem o número no message.from)
    if (celular) corpo.celular = celular;
    if (texto) corpo.texto = texto;
    // Foto/figurinha/PDF do cliente: o agente vê o arquivo (o texto traz o marcador).
    if (midiaBase64) {
        corpo.midia_base64 = midiaBase64;
        corpo.midia_mime = midiaMime || 'image/jpeg';
    }
    if (audioBase64) {
        corpo.audio_base64 = audioBase64;
        corpo.audio_mime = audioMime || 'audio/ogg';
        // Voz depois: o agente devolve o TEXTO sem esperar a sintese (que leva
        // de 6 a 12s) e o PTT vem numa segunda chamada. O cliente le a resposta
        // em ~5s em vez de encarar "gravando audio..." por 15 a 30 segundos.
        if (vozDepois) corpo.voz_depois = true;
    }

    try {
        const resp = await fetch(`${cfg.url}/atender`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.token}`,
            },
            body: JSON.stringify(corpo),
            // 90s (acordado com a sessão dos gerenciadores): cliente de WhatsApp
            // não espera 2min — melhor a mensagem padrão da loja aos 90s do que
            // silêncio prolongado. Folga confortável sobre o Gemini com tools.
            signal: AbortSignal.timeout(90000),
        });

        if (!resp.ok) {
            customLogger.error(`[AGENTE] HTTP ${resp.status} do agente`);
            return null;
        }

        const dados = await resp.json();
        if (dados.silencio) {
            customLogger.debug(`[AGENTE] silêncio (${dados.motivo || 's/ motivo'})`);
            return null;
        }
        if (!dados.resposta) return null;
        // audio_base64: quando o cliente manda áudio, o agente pode responder
        // em áudio (TTS) — o texto vem junto como fallback e para o histórico.
        // motivo: 'pedido_humano' faz o myzap avisar a própria loja no WhatsApp.
        return {
            texto: dados.resposta,
            audioBase64: dados.audio_base64 || null,
            audioMime: dados.audio_mime || null,
            motivo: dados.motivo || null,
            // Fotos que o agente quer mostrar (ex.: a peça que o cliente perguntou).
            // Só https e no máximo 3 — quem manda é o agente, quem baixa é o MyZap.
            midias: Array.isArray(dados.midias)
                ? dados.midias
                    .filter((m) => m && typeof m.url === 'string' && /^https:\/\//.test(m.url))
                    .slice(0, 3)
                    .map((m) => ({ url: m.url, legenda: typeof m.legenda === 'string' ? m.legenda.slice(0, 900) : '' }))
                : [],
            // comando do dono (abrir/fechar o site): nova mensagem padrão da loja
            mensagemPadrao: typeof dados.mensagem_padrao === 'string' ? dados.mensagem_padrao : null,
        };
    } catch (err) {
        customLogger.error(`[AGENTE] erro na chamada: ${err.message}`);
        return null;
    }
}

/**
 * Pede ao agente a versao falada de um texto ja enviado (rota /falar).
 *
 * Devolve null em qualquer problema: a conversa ja seguiu com o texto, entao
 * ficar sem o audio e so perder o carisma, nunca a resposta.
 */
async function falar({ sessionkey, texto, apiUrlEmpresa }) {
    const cfg = await resolverConfig(sessionkey, apiUrlEmpresa);
    if (!cfg || !texto) return null;

    try {
        const resp = await fetch(`${cfg.url}/falar`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.token}`,
            },
            body: JSON.stringify({ texto }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) {
            customLogger.warning(`[AGENTE] /falar HTTP ${resp.status}`);
            return null;
        }
        const dados = await resp.json();
        if (!dados.ok || !dados.audio_base64) return null;
        return { audioBase64: dados.audio_base64, audioMime: dados.audio_mime || 'audio/ogg; codecs=opus', ttsMs: dados.tts_ms || null };
    } catch (err) {
        customLogger.warning(`[AGENTE] /falar falhou: ${err.message}`);
        return null;
    }
}

/**
 * Toggle do painel visto pela config remota (modo LOCAL).
 *
 * true/false = valor do painel; null = desconhecido (env AGENT_URL setada —
 * modo online, quem manda e o push no DeviceCompany — API fora do ar ou
 * antiga sem o campo). O guard usa o banco local como fallback no null.
 */
async function iaAtivaRemota(sessionkey, apiUrlEmpresa) {
    if (AGENT_URL && AGENT_AUTH_TOKEN && !ehDeOutroProduto(apiUrlEmpresa)) return null;
    const cfg = await resolverConfig(sessionkey, apiUrlEmpresa);
    return cfg ? cfg.iaAtiva : null;
}

/**
 * Mensagem que saiu do WhatsApp da loja (fromMe) e nao foi o proprio MyZap:
 * foi alguem da equipe ou outro SISTEMA no mesmo numero? O caso real e a
 * cobranca automatica que sai pelo computador da loja (Cobra Rapido): vista
 * pela sessao do agente, ela parecia a equipe assumindo, e a IA se calava
 * justo para quem acabou de ser cobrado.
 *
 * Quem sabe e o agente: ele recebe o texto (como sempre recebeu, com
 * origem 'humano') e responde { sistema: true } quando reconhece a mensagem.
 * Agente que nao conhece o campo responde silencio comum, e tudo segue como
 * antes (pausa). Qualquer falha tambem: na duvida, pausa.
 */
async function ehMensagemDoSistema({ sessionkey, numero, celular, texto, apiUrlEmpresa }) {
    const cfg = await resolverConfig(sessionkey, apiUrlEmpresa);
    if (!cfg || !texto) return false;
    try {
        const resp = await fetch(`${cfg.url}/atender`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
            body: JSON.stringify({
                sessionkey,
                numero: String(numero || '').replace(/@.*$/, ''),
                // telefone REAL do @lid: é por ele que o agente acha a cobrança que saiu
                ...(celular ? { celular } : {}),
                texto,
                origem: 'humano',
            }),
            // Curto: enquanto isto roda, a pausa ainda nao foi registrada.
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return false;
        const dados = await resp.json();
        return dados?.sistema === true;
    } catch (err) {
        customLogger.warning(`[AGENTE] fromMe sem resposta do agente (${err.message}) — tratando como equipe`);
        return false;
    }
}

module.exports = { atender, falar, iaAtivaRemota, ehMensagemDoSistema, ehDeOutroProduto, _resolverConfig: resolverConfig };
