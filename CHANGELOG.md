# 📝 Changelog

Todas as mudanças notáveis neste fork serão documentadas neste arquivo.

---

## [3.0.23] - 2026-10-19

### 🛠️ Loja fechada recebe o aviso de fechada, não a mensagem padrão com o link

Regra do dono: com a loja fechada (chave "Está aberto?" desligada ou fora do
expediente, quem decide é a API do ClickExpress), a mensagem padrão de "faça seu
pedido" levava o cliente a um site fechado. Agora sai "No momento estamos fechados
e não estamos atendendo. Assim que abrirmos, é só mandar uma mensagem por aqui",
uma vez por dia por número, e a padrão não conta como enviada: a primeira mensagem
com a loja aberta ainda leva o link e os anexos. Sem resposta da API, a padrão de
sempre sai, nunca o aviso.

Versão de correção em cima da v3.0.22: leva só isto para a frota (a `main` tem
outras mudanças que ainda não foram liberadas para as máquinas de lojista).

Teste: `node test/anexos-padrao.js` — reprova sem o conserto.

## [3.0.22] - 2026-09-19

### 🛠️ O marcador de mídia finalmente chega ao agente

A v3.0.21 traduziu imagem/vídeo/figurinha em `[imagem]`/`[vídeo]`/`[figurinha]`,
mas o `EventsController` montava o texto da IA com `message.body` cru e jogava o
marcador fora — o conserto nunca valeu em campo. Foto SEM legenda chegava vazia
ao agente, que respondia `mensagem_vazia`, ou seja, silêncio: em 17/09 um cliente
do Capucho mandou dois comprovantes em foto, não recebeu nada e o pedido de R$ 45
foi digitado à mão pela loja. Foto COM thumbnail chegava como 3,4 KB de base64 no
lugar da fala do cliente. Em 30 dias de produção: zero turnos com `[imagem]` e 17
com base64.

Agora o texto que segue para a IA sai de `textoDaMensagem()`, recalculado depois
do passo de áudio (que pode trocar a mensagem pela versão transcrita). PDF
continua chegando pelo nome do arquivo.

Teste: `node test/midia-para-agente.js` — percorre o EventsController real com as
bordas stubadas e reprova sem o conserto. Entrou no `pnpm test`.

## [3.0.21] - 2026-09-09

### 🛠️ Imagem, vídeo e figurinha não chegam mais ao agente como base64

No whatsapp-web.js o `body` de uma mensagem de mídia é o thumbnail em base64.
Em 08/09 um cliente do Capucho mandou uma foto e o agente recebeu 3,4 KB de
`/9j/4AAQ...` como se fosse texto do cliente (gastou token e não entendeu nada).
Agora `textoDaMensagem()` entrega a legenda ou um marcador — `[imagem]`,
`[vídeo]`, `[figurinha]` — e o agente sabe o que fazer (comprovante em imagem
vira chamado para a equipe). Documento continua com o nome do arquivo.
Teste: `PORT=1 node test/midia-marcador.js`.

## [3.0.20] - 2026-09-06

### 🛠️ Loja assumiu a conversa: a IA agora pausa de verdade

- Mensagem enviada pela loja (fromMe) era gravada no histórico do número da
  PRÓPRIA loja (`message.from`), então a pausa "atendente humano falou" nunca
  disparava para o cliente e o bot seguia respondendo em cima do atendente.
  `contextBuilder` passa a usar o destinatário quando a mensagem é fromMe.
- Texto/caption que sai pela API (confirmação de pedido, NF-e, teste do painel)
  é marcado como saída do sistema (`registerIAResponse`) antes de enviar, e
  `processFromMe` ignora eco do bot e saída do sistema — só o atendente de
  verdade registra e pausa. O texto do atendente vai ao agente só como contexto.
- Bloqueio por humano na conversa (`agente_recente`/`aguardando_humano`) não
  manda mais a mensagem padrão.
- `HUMAN_PAUSE_MINUTES` padrão 120 → 30 (igual ao agente), renovado a cada
  mensagem do atendente.
- Áudio, foto ou figurinha que a loja manda pelo celular também conta como
  "atendente na conversa" (caso real: o Vaqueiro respondeu por áudio e o bot
  seguiu falando por cima). A voz do bot, os anexos da mensagem padrão e a mídia
  enviada pela API são marcados como saída do sistema por destino (2 min).
- `test/loja-assumiu.js` cobre tudo isso; `npm test` roda os três testes.

## [3.0.19] - 2026-09-06

### ✨ Anexos na mensagem padrão

- A mensagem padrão do primeiro contato pode vir acompanhada de fotos ou PDF
  (cardápio, promoção) configurados no painel do ClickExpress. O myzap busca a
  lista em `GET /myzap/anexos-padrao/{sessionkey}` na hora de mandar (cache de
  60 s) e só envia com a loja aberta — a API é quem decide "aberto".
- `messageSender.sendFileFromUrl`: imagem vai como foto, PDF como documento
  (webjs, wppconnect e venom).
- Um anexo que falhar não segura os outros nem o texto.
- `npm test` roda o smoke da IA e o teste dos anexos (`test/anexos-padrao.js`).

## [2.0.0] - 2025-11-16

### 🎉 Fork Inicial - JZ-TECH-SYS

Este é o primeiro release oficial do fork **JZ-TECH-SYS/myzap** baseado no projeto original [billbarsch/myzap](https://github.com/billbarsch/myzap).

### ✨ Novas Funcionalidades

#### 🤖 Sistema de Inteligência Artificial
- ✅ Integração completa com OpenAI GPT-4
- ✅ Sistema de Prompts personalizados por empresa
- ✅ RAG (Retrieval-Augmented Generation) com Vector Stores
- ✅ Transcrição automática de mensagens de áudio
- ✅ Histórico inteligente de conversas (últimas 20 mensagens)
- ✅ Sistema de Guards para controle fino de quando a IA responde
- ✅ Detecção automática de pedido de atendimento humano
- ✅ Pausa automática da IA quando humano assume conversa

#### 🎯 Sistema de Guards (Validações Inteligentes)
- ✅ `checkGroupMessage`: Bloqueia respostas automáticas em grupos
- ✅ `checkCompanyEnabled`: Valida empresa configurada
- ✅ `checkIaEnabled`: Verifica se IA está ativa
- ✅ `checkHumanRequest`: Detecta pedidos de atendimento humano
- ✅ `checkRecentHuman`: Pausa IA se humano falou recentemente (10min)
- ✅ `checkClientRequestedHuman`: Cliente solicitou humano explicitamente

#### 📊 Dashboard Administrativo
- ✅ Interface web completa em `/admin/ia-manager`
- ✅ Gerenciamento visual de sessões
- ✅ Ativação/desativação de IA por sessão
- ✅ Configuração de prompts e vectors
- ✅ Monitoramento de status de sessões
- ✅ Edição inline de configurações

#### 🛡️ Validação de Números
- ✅ Verificação robusta se número existe no WhatsApp antes de enviar
- ✅ Tentativa automática com/sem 9º dígito (números brasileiros)
- ✅ Cache de números validados para performance
- ✅ Evita números fantasma e erros de envio

#### ⚡ Otimizações de Performance
- ✅ Argumentos otimizados do Chrome (reduz 30-40% RAM)
- ✅ Limits SQL em consultas (reduz 50-70% memória)
- ✅ Sistema de cache inteligente
- ✅ Jobs de limpeza automática:
  - Cache Cleanup (6h)
  - Chat History Cleanup (24h)
  - Database Cleanup (24h)
  - Instances Cleanup (1h)
  - Logs Cleanup (24h)
  - Memory Monitor (15min)

#### 📝 Sistema de Histórico
- ✅ Modelo `ChatHistory` com campos otimizados
- ✅ Registro de mensagens do usuário e assistente
- ✅ Suporte a diferentes tipos de mensagem (text, audio, ia, transferencia_humano)
- ✅ Limpeza automática de mensagens antigas (>30 dias)
- ✅ Consultas otimizadas com limit

#### 🔧 Melhorias Técnicas
- ✅ Logger padronizado (`customLogger`) em todo projeto
- ✅ Middleware `checkNumber` robusto
- ✅ Adapter unificado `messageSender` para 3 engines
- ✅ Sistema de eventos modularizado
- ✅ Migrations organizadas
- ✅ Documentação inline completa

### 🔄 Mudanças

#### Estrutura de Arquivos
```
controllers/helper/ia/          # Novo diretório de IA
  ├── audioProcessor.js         # Processamento de áudio
  ├── contextBuilder.js         # Construção de contexto
  ├── decisionEngine.js         # Engine de decisão principal
  ├── defaultMessageService.js  # Serviço de mensagem padrão
  ├── empresaIA.js              # Integração OpenAI
  ├── guards.js                 # Sistema de Guards
  ├── humanDetector.js          # Detecção de pedido humano
  └── iaConfig.js               # Configurações da IA

controllers/helper/events/      # Eventos modernizados
  ├── messageSender.js          # Adapter unificado
  ├── chatHistory.js            # Gerenciamento de histórico
  ├── events.js                 # Pipeline de eventos
  └── triggers.js               # Sistema de triggers

jobs/                           # Jobs de manutenção
  ├── cacheCleanup.js
  ├── chatHistoryCleanup.js
  ├── databaseCleanup.js
  ├── instancesCleanup.js
  ├── logsCleanup.js
  └── memoryMonitor.js

Models/                         # Novos modelos
  ├── chatHistory.js
  ├── deviceCompany.js
  └── tokenUsage.js

Views/pages/admin/              # Interface administrativa
  └── ia-manager.ejs
```

#### Engines Otimizadas
- ✅ `engines/helper/wweb.js` - Argumentos Chrome otimizados
- ✅ `engines/helper/stealth.js` - Stealth mode melhorado
- ✅ `engines/helper/vn.js` - Venom otimizado

#### Middlewares
- ✅ `checkNumber.js` - Validação completa de números
- ✅ `checkAuthMiddleware.js` - Autenticação aprimorada

### 🐛 Correções

- ✅ Corrigido problema de `isGroupMsg` undefined no whatsapp-web.js
- ✅ Corrigido validação de números brasileiros com/sem 9º dígito
- ✅ Corrigido cache salvando números incorretos
- ✅ Corrigido detecção de grupos por sufixo `@g.us`
- ✅ Corrigido memory leaks em consultas SQL sem limit
- ✅ Corrigido logs excessivos ocupando disco

### 📚 Documentação

- ✅ README.md completamente reescrito
- ✅ CHANGELOG.md criado
- ✅ Documentação inline em todos os módulos
- ✅ Créditos ao projeto original preservados
- ✅ Guia completo de instalação e configuração

### 🎯 Melhorias de UX

- ✅ Dashboard intuitivo para gerenciamento
- ✅ Feedback visual de status das sessões
- ✅ Mensagens de erro mais claras
- ✅ Logs estruturados e padronizados

### ⚙️ Configurações

#### Novas Variáveis de Ambiente
```env
OPENAI_API_KEY=sk-proj-xxxxx  # Chave da API OpenAI
NODE_ENV=production            # Ambiente de execução
```

#### Configurações de IA (`iaConfig.js`)
```javascript
IA_COOLDOWN_SECONDS: 0         # Cooldown entre respostas (0 = sem cooldown)
HUMAN_PAUSE_MINUTES: 10        # Pausa após humano falar (10min)
TEMPO_MENSAGEM_PADRAO_DEFAULT: 30  # Cooldown mensagem padrão (30min)
ACEITAR_AUDIO: true            # Aceitar mensagens de áudio
MAX_AUDIO_SIZE: 25MB           # Tamanho máximo de áudio
MAX_AUDIO_DURATION: 90         # Duração máxima (segundos)
```

### 📊 Impacto das Otimizações

| Métrica | Antes | Depois | Melhoria |
|---------|-------|--------|----------|
| RAM/sessão | 500-850 MB | 300-450 MB | **-40-50%** |
| SWAP | 1.9 GB | 0-200 MB | **-90%** |
| Disco | 2.5 GB | 1.3-1.7 GB | **-800 MB** |
| Queries SQL | Ilimitadas | Max 50 | **-70% RAM** |
| Histórico IA | Todas msgs | 20 msgs | **+Contexto** |

### 🔐 Segurança

- ✅ Validação de números antes do envio
- ✅ Sanitização de mensagens padrão
- ✅ Autenticação por sessionkey
- ✅ Logs estruturados para auditoria

### 🚀 Performance

- ✅ Cache de números validados
- ✅ Consultas SQL otimizadas com indexes
- ✅ Limpeza automática de dados antigos
- ✅ Monitoramento de memória em tempo real

---

## Próximas Versões (Roadmap)

### [2.1.0] - Em Planejamento
- [ ] Suporte a múltiplos provedores de IA (Anthropic, Gemini)
- [ ] Sistema de filas com Bull para melhor escalabilidade
- [ ] Webhooks customizáveis por evento
- [ ] API de analytics e métricas
- [ ] Suporte a mensagens agendadas
- [ ] Sistema de templates de mensagem

### [2.2.0] - Futuro
- [ ] Interface de chat em tempo real
- [ ] Suporte a chatbots com fluxos visuais
- [ ] Integração com CRM populares
- [ ] Sistema de tags e categorização de conversas
- [ ] Relatórios avançados de uso

---

## 🙏 Créditos

Este fork é baseado no excelente trabalho de:

- **Bill Barsch** - [billbarsch/myzap](https://github.com/billbarsch/myzap)
- **Eduardo Policarpo** - Desenvolvedor 2.0
- **Jonathan Henrique** - Desenvolvedor 3.0

**Fork mantido por:** [JZ-TECH-SYS](https://github.com/JZ-TECH-SYS)

---

## 📝 Formato

Este changelog segue o formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

### Tipos de mudanças:
- **✨ Novas Funcionalidades**: Novas features
- **🔄 Mudanças**: Alterações em funcionalidades existentes
- **🐛 Correções**: Bug fixes
- **🗑️ Removido**: Funcionalidades removidas
- **⚠️ Descontinuado**: Funcionalidades que serão removidas
- **🔐 Segurança**: Correções de segurança
