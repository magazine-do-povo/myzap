/**
 * 🚀 Configuração do PM2 para MyZap
 * 
 * Este arquivo centraliza todas as configurações do PM2 para o ambiente de produção.
 * 
 * Uso:
 *   pm2 startOrReload ecosystem.config.js --env production --update-env   (o deploy faz isto)
 *   pm2 delete myzap && pm2 start ecosystem.config.js --env production
 *
 * SEMPRE por este arquivo. Até 11/10/2026 a produção rodava com `pm2 start index.js`, sem
 * ele: o kill_timeout ficava no padrão de 1,6 s e o PM2 matava o Node antes de os Chromes
 * fecharem — a origem da sessão presa em INITIALIZING depois de todo deploy.
 *
 * Recursos configurados:
 * - kill_timeout: tempo para o gracefulShutdown fechar os Chromes antes do SIGKILL
 * - max_memory_restart: rede de segurança contra vazamento real (não contra pico)
 * - node_args: Define 1GB de heap para o Node.js (com 31GB RAM disponível, é conservador)
 * - Logs organizados por tipo
 * - Variáveis de ambiente de produção
 *
 * @author JZ-TECH
 * @date 2025-12-14
 */

module.exports = {
  apps: [{
    // ═══════════════════════════════════════════════════════════
    // CONFIGURAÇÕES BÁSICAS
    // ═══════════════════════════════════════════════════════════
    name: 'myzap',
    script: 'index.js',
    
    // ═══════════════════════════════════════════════════════════
    // CONFIGURAÇÕES DE MEMÓRIA
    // ═══════════════════════════════════════════════════════════
    // Reiniciar se o Node passar de 2 GB de RSS. Era 1G: o Node em produção usa ~570 MB
    // de RSS com 4 sessões e cada mídia recebida passa pela memória em base64 — um pico
    // acima de 1 GB é normal, e um restart por memória DERRUBA as 4 sessões de uma vez.
    // Com o heap travado em 1 GB (node_args), passar de 2 GB só acontece com vazamento
    // fora do heap (buffers), que é o único caso em que reiniciar resolve. Os Chromes
    // são processos à parte e não contam aqui.
    max_memory_restart: '2G',
    
    // Definir 1GB de heap para o Node.js
    // Isso permite que o GC trabalhe com mais espaço antes de ficar crítico
    node_args: '--max-old-space-size=1024',
    
    // ═══════════════════════════════════════════════════════════
    // CONFIGURAÇÕES DE INSTÂNCIA
    // ═══════════════════════════════════════════════════════════
    // Modo fork (não cluster) - importante para WhatsApp sessions
    instances: 1,
    exec_mode: 'fork',
    
    // Não usar watch em produção
    watch: false,
    
    // ═══════════════════════════════════════════════════════════
    // CONFIGURAÇÕES DE RESTART
    // ═══════════════════════════════════════════════════════════
    // Tentar reiniciar até 10 vezes
    max_restarts: 10,
    
    // Esperar 4 segundos entre restarts
    restart_delay: 4000,
    
    // Se crashar 10 vezes em 1 minuto, parar de tentar
    min_uptime: '60s',
    
    // Exponential backoff restart delay (mais tempo entre restarts consecutivos)
    exp_backoff_restart_delay: 100,

    // ═══════════════════════════════════════════════════════════
    // ENCERRAMENTO
    // ═══════════════════════════════════════════════════════════
    // Quanto o PM2 espera entre o SIGINT e o SIGKILL. O gracefulShutdown do index.js
    // leva até 8 s fechando os Chromes + 3 s fechando o servidor, com saída forçada
    // aos 12 s. O padrão do PM2 (1,6 s) matava o Node no meio: o Chrome de cada sessão
    // ficava órfão segurando o SingletonLock do perfil em instances/, e o próximo start
    // caía em "browser is already running" — sessão presa em INITIALIZING após deploy.
    kill_timeout: 20000,

    // ═══════════════════════════════════════════════════════════
    // CONFIGURAÇÕES DE LOG
    // ═══════════════════════════════════════════════════════════
    // Logs serão salvos em /root/.pm2/logs/ por padrão
    // Mas podemos personalizar:
    // output: './logs/pm2-out.log',
    // error: './logs/pm2-error.log',
    
    // Merge stdout e stderr em um único log
    merge_logs: true,
    
    // Adicionar timestamp nos logs
    time: true,
    
    // ═══════════════════════════════════════════════════════════
    // VARIÁVEIS DE AMBIENTE
    // ═══════════════════════════════════════════════════════════
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
