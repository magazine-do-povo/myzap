# Instruções do GitHub Copilot - MyZap API

> **Documentação completa da Engine WhatsApp-Web-JS:** [WHATSAPP_WEBJS_TECHNICAL_GUIDE.md](./WHATSAPP_WEBJS_TECHNICAL_GUIDE.md)

## 📋 Visão Geral do Projeto

MyZap é uma API multi-engine para WhatsApp que suporta **3 engines diferentes**:
- **WhatsappWebJS** (`whatsapp-web.js`) - Engine principal e mais utilizada
- **WppConnect** (`@wppconnect-team/wppconnect`)
- **Venom** (`venom-bot`)

A engine ativa é definida em `.env` → `ENGINE=1` (1=WhatsappWebJS, 2=WppConnect, 3=Venom).

---

## 🏗️ Arquitetura do Projeto

```
myzap/
├── engines/                    # Implementações das 3 engines WhatsApp
│   ├── WhatsappWebJS.js        # 🔴 CORE - Classe principal da engine
│   ├── WppConnect.js
│   ├── Venom.js
│   └── helper/
│       └── wweb.js             # Helper para QR Code e opções do client
│
├── functions/                  # Funções específicas de cada engine
│   ├── WhatsappWebJS/
│   │   ├── mensagens.js        # Proxy
│   │   ├── auth.js             # Proxy
│   │   └── helper/
│   │       ├── mensagens.js    # 🔴 IMPLEMENTAÇÃO de todas as funções
│   │       └── auth.js
│   ├── WPPConnect/
│   └── Venom/
│
├── controllers/                # Controladores das rotas
│   ├── SessionsController.js   # Gerenciamento de sessões (API)
│   ├── EventsController.js     # 🔴 Pipeline de processamento de eventos
│   ├── WebhooksController.js   # Envio de webhooks
│   └── helper/
│       ├── core/
│       │   └── sessions.js     # 🔴 CRÍTICO - Mapa de clients em memória
│       └── events/
│           ├── connectionStateManager.js
│           ├── socketWebhookManager.js
│           └── statusAckManager.js
│
├── jobs/                       # Tarefas agendadas (setInterval nativo)
│   ├── sessionHealthCheck.js   # 🔴 CRÍTICO - Detecta sessões zumbi
│   ├── sessionKeepAlive.js     # Reconexão automática
│   └── ...outros jobs
│
├── routers/                    # Rotas da API por engine
│   ├── WhatsappWebJS.js
│   ├── WppConnect.js
│   └── Venom.js
│
├── Models/                     # Modelos Sequelize (SQLite)
├── middlewares/                # Middlewares de autenticação e validação
├── migrations/                 # Migrações do banco de dados
├── util/                       # Utilitários (logger, helpers)
├── config/                     # Arquivos de configuração JSON
├── instances/                  # 🔴 Dados das sessões WhatsApp (LocalAuth)
└── logs/                       # Logs diários organizados por data
```

---

## ⚠️ REGRA DE OURO PARA DEBUGGING

### Quando houver problemas de conexão/sessão:

**SEMPRE verifique primeiro se houve atualização nas bibliotecas das engines!**

```bash
# Verificar versão atual vs disponível
pnpm outdated whatsapp-web.js
pnpm outdated @wppconnect-team/wppconnect  
pnpm outdated venom-bot

# Atualizar (SOLUÇÃO MAIS COMUM)
pnpm update whatsapp-web.js
```

As engines WhatsApp dependem de engenharia reversa do WhatsApp Web e **quebram frequentemente** com atualizações do WhatsApp.

### 🔴 Erros Críticos que Indicam Biblioteca Desatualizada

| Erro | Significado |
|------|-------------|
| `Attempted to use detached Frame` | Página Puppeteer perdida |
| `Execution context was destroyed` | Navegação inesperada no Chrome |
| `Protocol error (Runtime.callFunctionOn)` | CDP desconectado |
| `Cannot read properties of undefined (reading 'getChat')` | Client não injetado ou sessão morta |
| `The browser is already running` | Sessão duplicada - matar Chrome órfão |

### 🧟 Sessões Zumbi

**Definição:** Sessão aparece `CONNECTED` no banco, mas não processa mensagens.

**Causa:** WhatsApp Web desconectou silenciosamente sem disparar evento.

**Detecção:** Job `sessionHealthCheck.js` verifica a cada 30s:
- `client.getState()` responde?
- `pupPage.evaluate()` responde?
- Última mensagem recebida há mais de 15 min?

**Log característico:** `[🧟 ZOMBIE DETECTED]`

---

## 🔧 Configurações Importantes

### config.js
```javascript
config.engine = 'WhatsappWebJS'  // Engine ativa: WhatsappWebJS | WppConnect | Venom
config.session_keepalive_enabled = true
config.session_keepalive_interval_ms = 300000  // 5 minutos
```

### PM2 (ecosystem.config.js)
- `--max-old-space-size=1024` (heap de 1GB)
- `max_memory_restart: '1G'`
- Modo cluster desabilitado (WhatsApp não suporta)

### Banco de Dados
- **SQLite** com Sequelize ORM
- Arquivo: definido em `config/config.json`
- Modelos em `Models/`

### 🔴 Configurações Críticas do Puppeteer

```javascript
// engines/helper/wweb.js - getClientOptions()
puppeteer: {
  headless: true,
  timeout: 120000,              // 2 minutos
  protocolTimeout: 300000,      // 5 minutos (CRÍTICO - evita timeout)
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--js-flags=--max-old-space-size=512'  // Limite RAM por sessão
  ]
},
qrMaxRetries: 5,
authTimeoutMs: 120000,
webVersionCache: {
  type: 'remote',
  remotePath: 'https://raw.githubusercontent.com/...'  // Cache externo
}
```

---

## 📧 Sistema de Email

### API: MailJZTech
- Endpoint: `https://api-mail.jztech.com.br/enviar-email`
- Variáveis: `EMAIL_TOKEN`, `EMAIL_DESTINATION`, `EMAIL_CC`

### Regras do Email:
1. **SEMPRE** incluir `nome_remetente` no payload
2. **NUNCA** usar emojis no `assunto` (causa rejeição SMTP)
3. Emojis no corpo HTML devem usar **HTML entities** (ex: `&#128994;` para 🟢)
4. Campo `corpo_texto` não é necessário se `corpo_html` estiver presente

---

## ⏰ Sistema de Jobs

**IMPORTANTE:** Todos os jobs usam `setInterval` nativo, **NÃO** usam `node-cron`.

| Job | Arquivo | Função | Intervalo |
|-----|---------|--------|-----------|
| Health Check | `jobs/sessionHealthCheck.js` | 🔴 Detecta sessões zumbi | 30s |
| Session Keep-Alive | `jobs/sessionKeepAlive.js` | Reconexão automática | 5 min |
| Memory Monitor | `jobs/memoryMonitor.js` | Monitora uso de memória | 5 min |
| Daily Report | `jobs/dailyReport.js` | Email diário com métricas | 1x/dia |
| Instance Metrics | `jobs/instanceMetrics.js` | Coleta métricas das instâncias | 1 min |
| Cache Cleanup | `jobs/cacheCleanup.js` | Limpa cache antigo | 1 hora |
| Logs Cleanup | `jobs/logsCleanup.js` | Remove logs antigos | 1 hora |
| Database Cleanup | `jobs/databaseCleanup.js` | Limpa dados antigos do DB | 1 hora |
| Instances Cleanup | `jobs/instancesCleanup.js` | Remove instâncias órfãs | 1 hora |
| Chat History Cleanup | `jobs/chatHistoryCleanup.js` | Limpa histórico de chat | 1 hora |

### Inicialização
Todos os jobs são iniciados em `startup.js` → `initializeJobs()`.

### 🔴 Session Health Check - Funcionamento

```javascript
// jobs/sessionHealthCheck.js
// Verifica a cada 30 segundos:
1. client.getState()          // Responde 'CONNECTED'?
2. client.pupPage.evaluate()  // Chrome responde?
3. lastMessageTime            // Recebeu msg nos últimos 15 min?

// Se detectar zumbi:
- Frame detached → client.destroy() + removeClientFromMemory()
- Outro caso → client.pupPage.reload()
```

---

## 🔌 Engines WhatsApp

### Estrutura de cada Engine
Cada arquivo em `engines/` exporta uma classe com método:
- `start(req, res, session)` - Inicia sessão e retorna Promise

### Fluxo de Inicialização (WhatsappWebJS)
```
WhatsappWebJS.start(req, res, session)
│
├─► Device.upsert() - Cria/atualiza registro no banco
│       state: 'STARTING', status: 'INITIALIZING'
│
├─► new Client(clientOptions) - Cria instância whatsapp-web.js
│       authStrategy: LocalAuth
│       dataPath: ./instances/{session}
│
├─► Registra listeners:
│       client.on('qr')           → Gera QR, salva no banco, emite Socket.IO
│       client.on('authenticated') → 🔴 injectClient(session, client)
│       client.on('ready')        → Device.update(status: 'CONNECTED')
│       client.on('disconnected') → Device.update(status: 'disconnected')
│
└─► client.initialize() - Inicia Puppeteer/Chrome
```

### 🔴 Ponto Crítico: Injeção do Client

```javascript
// controllers/helper/core/sessions.js
SessionsHelper.clients = {}  // Mapa global em memória

// O client é injetado no evento 'authenticated':
client.on('authenticated', () => {
  SessionsHelper.injectClient(session, client);
});

// Funções usam getInjectedClient:
const client = SessionsHelper.getInjectedClient(session);
// Se retornar undefined → erro "Cannot read properties"
```

### Funções específicas
As funções de cada engine ficam em `functions/{EngineName}/`:
- `sendText`, `sendImage`, `sendFile`, etc.

### Troca de Engine
Altere `ENGINE=1|2|3` no `.env` e reinicie.

---

## 🐛 Problemas Comuns e Soluções

### 1. Sessão desconecta após QR scan
- **Causa provável:** Atualização da biblioteca da engine
- **Solução:** `pnpm update whatsapp-web.js` (ou engine em uso)

### 2. Emails não chegam
- Verificar `nome_remetente` no payload
- Remover emojis do `assunto`
- Verificar `EMAIL_TOKEN` e `EMAIL_DESTINATION`

### 3. Memória alta / OOM
- Verificar `ecosystem.config.js` tem `--max-old-space-size=1024`
- Verificar jobs de cleanup estão rodando
- Considerar reinício automático via PM2

### 4. QR code não aparece
- Limpar pasta `instances/{session}/`
- Verificar se porta não está em uso
- Verificar logs em `logs/{data}/`

### 5. Heap mostrando valor errado
- Use `v8.getHeapStatistics().heap_size_limit` para heap limit real
- `process.memoryUsage().heapTotal` mostra apenas heap alocado atual

### 6. Erro "Cannot read properties of undefined (reading 'getChat')"
- **Causa:** Client não foi injetado em `SessionsHelper.clients`
- **Verificar:** 
  1. Evento `authenticated` foi disparado?
  2. `injectClient()` foi chamado?
  3. Sessão ainda está conectada?
- **Log para investigar:** Procurar por `[CLIENT INJECTED]` nos logs

### 7. Erro "The browser is already running"
- **Causa:** Processo Chrome anterior não foi encerrado
- **Solução:** `pkill -f "chrome.*{session}"` ou aguardar timeout de 10min

### 8. Sessões Zumbi (CONNECTED mas não recebe mensagens)
- **Causa:** WhatsApp Web desconectou silenciosamente
- **Detecção:** Job `sessionHealthCheck.js` verifica automaticamente
- **Log:** `[🧟 ZOMBIE DETECTED]`
- **Ação automática:** Destroy + remove da memória

---

## 📊 Métricas e Monitoramento

### Memória (v8)
```javascript
const v8 = require('v8');
const heapStats = v8.getHeapStatistics();
// heapStats.heap_size_limit = limite real do heap
// heapStats.used_heap_size = heap em uso
```

### Planejamento de Capacidade
```
Sessões suportadas = (RAM disponível - 500MB) / 150MB por sessão
```

Para 31GB RAM: ~200 sessões teóricas (recomendado: 150 máximo).

---

## 🚀 Deploy e Produção

### Produção (GKE)
- **Onde:** cluster `jztech-gke-prod`, namespace `myzap`, StatefulSet `myzap` (um pod por shard).
- **Deploy:** Actions → **Deploy MyZap to GKE** (manual). Ver `docs/jztech/deploy-no-gke.md`.
- A VPS com PM2 saiu de uso em 18/10/2026: não há mais deploy nem diagnóstico por SSH.

### Comandos úteis
```bash
kubectl -n myzap get pod
kubectl -n myzap logs myzap-0 --tail=200
```

---

## 📝 Convenções de Código

### Logging
Usar o logger customizado em `util/logger.js`:
```javascript
const logger = require('./util/logger');
logger.info('Mensagem', { dados });
logger.error('Erro', { error });
```

### Nomenclatura
- Controllers: `PascalCase` + `Controller.js`
- Models: `camelCase.js`
- Jobs: `camelCase.js`
- Routers: `PascalCase.js`

### Async/Await
Preferir async/await sobre callbacks ou .then().

---

## 🔐 Autenticação

### Middlewares
- `authMiddleware.js` - JWT para rotas protegidas
- `checkAPITokenMiddleware.js` - Validação de token da API
- `checkAuthMiddleware.js` - Verificação de sessão

### 2FA
Implementado para usuários admin via `twoFactorSecret` no modelo User.

---

## 📚 Referências Rápidas

### Variáveis de Ambiente Importantes
- `EMAIL_TOKEN` - Token da API de email
- `EMAIL_DESTINATION` - Email de destino para alertas
- `EMAIL_CC` - Cópia de email (opcional)
- `JWT_SECRET` - Segredo para tokens JWT
- `API_TOKEN` - Token da API principal

### Arquivos de Configuração
- `config.js` - Configurações principais da aplicação
- `config/config.json` - Configuração do Sequelize/banco
- `ecosystem.config.js` - Configuração do PM2
- `nodemon.json` - Configuração do nodemon (dev)
