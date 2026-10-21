/**
 * Configurações globais da IA
 * Centralizadas para facilitar manutenção
 */

module.exports = {
  // Cooldown entre respostas da IA (segundos) - reduzido para melhor UX
  IA_COOLDOWN_SECONDS: 0,
  
  // Tempo que a IA fica pausada após um HUMANO da loja responder o cliente
  // (minutos). Regra de negócio (JV, revisada 31/08/2026 à noite): humano
  // assumiu, o bot pausa por 2 HORAS (renovada a cada mensagem do atendente)
  // — 24h derrubava a IA o dia inteiro em loja que também atende à mão
  // (caso real: Capucho). Ajustável por env sem release.
  // 30 min como o agente (PAUSA_HUMANO_MINUTOS): 120 deixava o cliente sem bot
  // por 2 h depois de uma resposta rápida do atendente
  HUMAN_PAUSE_MINUTES: Number(process.env.HUMAN_PAUSE_MINUTES || 30),
  
  // Tempo padrão para mensagem padrão (minutos) - fallback quando não configurado
  TEMPO_MENSAGEM_PADRAO_DEFAULT: 30,
  
  // Aceitar processamento de áudio (sempre ativo)
  ACEITAR_AUDIO: true,
  
  // Tamanho máximo de áudio (bytes) - 25MB
  MAX_AUDIO_SIZE: 25 * 1024 * 1024,
  
  // Duração máxima de áudio (segundos)
  MAX_AUDIO_DURATION: 90,
  
  // Prefix para logs da IA
  LOG_PREFIX: '[IA]',
  
  /**
   * Explicação dos cooldowns:
   * 
   * 1. IA_COOLDOWN_SECONDS (3s):
   *    - Evita que a IA processe várias mensagens simultâneas
   *    - Após a IA responder, aguarda apenas 3s antes de processar nova mensagem
   *    - Permite conversas fluidas mantendo controle
   * 
   * 2. HUMAN_PAUSE_MINUTES (10min):
   *    - Quando um humano (agente) responde manualmente uma conversa
   *    - A IA para de responder automaticamente por 10 minutos
   *    - Permite que o agente humano assuma a conversa sem interferência da IA
   * 
   * 3. TEMPO_MENSAGEM_PADRAO_DEFAULT (30min):
   *    - Controla frequência de envio da mensagem padrão
   *    - Evita spam da mensagem padrão para o mesmo cliente
   *    - Se já enviou mensagem padrão nos últimos 30min, não envia novamente
   */
};
