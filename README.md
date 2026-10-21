<h1 align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/f/f7/WhatsApp_logo.svg" width="100px" alt="MyZAP Logo"><br>
  🚀 MyZAP - WhatsApp API + IA
</h1>

<p align="center">
  <strong>API REST completa para WhatsApp com Inteligência Artificial integrada</strong><br>
  <em>Multi-engine • Open Source • Production Ready</em>
</p>

<p align="center">
  <img alt="Repository size" src="https://img.shields.io/github/repo-size/JZ-TECH-SYS/myzap">
  <img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/JZ-TECH-SYS/myzap">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Node Version" src="https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen">
</p>

---

## 📋 Índice

- [Sobre o Projeto](#-sobre-o-projeto)
- [Funcionalidades](#-funcionalidades)
- [Tecnologias](#-tecnologias)
- [Requisitos](#-requisitos)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Uso](#-uso)
- [API Endpoints](#-api-endpoints)
- [Inteligência Artificial](#-inteligência-artificial)
- [Deploy em Produção](#-deploy-em-produção)
- [Otimizações](#-otimizações)
- [Créditos](#-créditos)
- [Licença](#-licença)

---

## 🎯 Sobre o Projeto

**MyZAP** é uma API REST completa que permite integrar o WhatsApp com qualquer aplicação através de requisições HTTP. Este fork adiciona recursos avançados de **Inteligência Artificial** usando OpenAI, sistema de gerenciamento de sessões, otimizações de performance e muito mais.

### ✨ Diferenciais desta versão:

- 🤖 **IA Integrada**: Sistema completo de chatbot com OpenAI GPT
- 🎯 **Guards Inteligentes**: Controle fino sobre quando a IA deve responder
- 📊 **Dashboard Administrativo**: Interface web completa para gerenciamento
- 🔄 **Auto-restart**: Scripts de manutenção e reinício automático
- ⚡ **Performance**: Otimizações de memória e processamento
- 🛡️ **Validação de Números**: Sistema robusto de verificação antes do envio
- 📝 **Histórico Inteligente**: Sistema de chat history com limpeza automática
- 🚫 **Controle de Grupos**: Bloqueio automático de respostas em grupos

---

## 🚀 Funcionalidades

### 📱 WhatsApp Core
- ✅ Envio de mensagens (texto, imagem, vídeo, áudio, documento)
- ✅ Envio de localização, contatos, links
- ✅ Leitura de mensagens recebidas
- ✅ Download de mídias
- ✅ Status de envio (enviado, entregue, lido)
- ✅ Gerenciamento de sessões múltiplas
- ✅ QR Code para autenticação
- ✅ Suporte a 3 engines: **WhatsApp-Web.js**, **WPPConnect**, **Venom**

### 🤖 Inteligência Artificial
- 🧠 **OpenAI GPT Integration**: Respostas automáticas inteligentes
- 🎯 **Sistema de Prompts**: Configure prompts personalizados por empresa
- 📚 **RAG (Retrieval-Augmented Generation)**: IA com acesso a documentos específicos
- 🕐 **Guards de Cooldown**: Evita spam e sobrecarga
- 👤 **Detecção de Pedido Humano**: Transfere automaticamente para atendente
- 🔇 **Pausa após Humano**: IA para automaticamente quando humano assume
- 💬 **Mensagem Padrão**: Fallback quando IA não deve responder
- 🎤 **Transcrição de Áudio**: Processa mensagens de voz automaticamente

### 🛠️ Administração
- 📊 **Dashboard Web**: Interface completa para gerenciamento
- 🔧 **Gerenciamento de Sessões**: Controle total de instâncias do WhatsApp
- ⚙️ **Configuração por Empresa**: Prompts e configurações individuais
- 📈 **Monitoramento de Tokens**: Controle de uso da API OpenAI
- 🧹 **Jobs de Limpeza**: Manutenção automática do banco de dados
- 💾 **Cache Inteligente**: Sistema de cache para números validados

---

## 🛠️ Tecnologias

- **Runtime**: Node.js 20+
- **Framework**: Express.js
- **Banco de Dados**: SQLite (sequelize ORM)
- **WhatsApp Engines**: 
  - [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js/)
  - [wppconnect](https://github.com/wppconnect-team/wppconnect)
  - [venom-bot](https://github.com/orkestral/venom)
- **IA**: OpenAI GPT-4
- **Template Engine**: EJS
- **Process Manager**: PM2
- **Documentação**: Swagger

---

## 📋 Requisitos

### Sistema Operacional
- Ubuntu 20.04+ (recomendado)
- Debian 10+
- Windows 10+ (desenvolvimento)

### Software
```bash
Node.js >= 20.0.0
Google Chrome Stable
PM2 (produção)
Git
```

### Hardware Mínimo
- **CPU**: 2 cores
- **RAM**: 2GB (recomendado 4GB)
- **Disco**: 10GB livres

---

## 🔧 Instalação

### 1. Instalar Dependências do Sistema (Ubuntu/Debian)

```bash
apt update && apt upgrade -y

# Dependências do Chrome/Chromium
apt install -y curl nano git net-tools htop \
  gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 \
  libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 \
  libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates \
  fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils \
  wget build-essential apt-transport-https libgbm-dev
```

### 2. Instalar Node.js 20

```bash
curl https://raw.githubusercontent.com/creationix/nvm/master/install.sh | bash
source ~/.profile
nvm install 20
nvm use 20
node --version  # Deve mostrar v20.x.x
```

### 3. Instalar Google Chrome

```bash
cd /opt
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt install gdebi-core -y
gdebi google-chrome-stable_current_amd64.deb
google-chrome --version
```

### 4. Clonar o Repositório

```bash
cd /opt
git clone https://github.com/JZ-TECH-SYS/myzap.git
cd myzap
```

### 5. Instalar Dependências do Node

```bash
# Ativar corepack (gerenciador de package managers)
corepack enable

# Instalar dependências com pnpm
pnpm install
```

### 6. Configurar Banco de Dados

```bash
# Criar estrutura do banco
pnpm run migrate

# Ou usar o script automatizado
bash ./scripts/database.sh
```

---

## ⚙️ Configuração

### 1. Arquivo `.env`

Crie um arquivo `.env` na raiz do projeto:

```env
# API
PORT=3000
NODE_ENV=production

# OpenAI (para IA)
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx

# Banco de Dados
DB_DIALECT=sqlite
DB_STORAGE=./database/db.sqlite

# Sessão
SESSION_SECRET=seu_secret_aqui_muito_seguro

# Admin padrão
DEFAULT_ADMIN_EMAIL=admin@admin.com
DEFAULT_ADMIN_TOKEN=your_token_api
```

### 2. Configuração da IA

Acesse o dashboard em `http://seu-servidor:3000/admin/ia-manager` e configure:

- **Session**: Nome da sessão do WhatsApp
- **SessionKey**: Token de autenticação
- **Empresa Nome**: Nome para identificação
- **ID Prompt**: ID do prompt criado no OpenAI
- **Vector Name**: ID do vector store para RAG (opcional)
- **IA Ativa**: Ativar/Desativar respostas automáticas
- **Mensagem Padrão**: Mensagem fallback quando IA não responde

---

## 🚀 Uso

### Desenvolvimento

```bash
pnpm dev
```

### Produção

```bash
# Iniciar com PM2 — pelo ecosystem (é ele que dá tempo de fechar os Chromes no restart)
pm2 start ecosystem.config.js --env production

# Ou usar o script
bash ./scripts/start.sh
```

### Acessar a API

```
Dashboard: http://localhost:3000/dashboard
API Docs: http://localhost:3000/api-docs
Health Check: http://localhost:3000/health
```

### Credenciais Padrão

```
Email: admin@admin.com
Password: your_token_api
```

---

## 📡 API Endpoints

### Sessões

```bash
# Iniciar sessão
POST /api/whatsappWebJS/start
{
  "session": "minhaempresa",
  "sessionkey": "token123"
}

# Obter QR Code
GET /api/whatsappWebJS/getQrCode?session=minhaempresa

# Status da conexão
POST /api/whatsappWebJS/getConnectionStatus
{
  "session": "minhaempresa"
}
```

### Mensagens

```bash
# Enviar texto
POST /api/whatsappWebJS/sendText
{
  "session": "minhaempresa",
  "sessionkey": "token123",
  "number": "5511999999999",
  "text": "Olá! Como posso ajudar?"
}

# Enviar imagem
POST /api/whatsappWebJS/sendImage
{
  "session": "minhaempresa",
  "sessionkey": "token123",
  "number": "5511999999999",
  "base64": "data:image/jpeg;base64,...",
  "caption": "Veja essa imagem"
}
```

### Documentação Completa

Acesse `/api-docs` para documentação Swagger completa.

---

## 🤖 Inteligência Artificial

### Como Funciona

O sistema de IA é baseado em **Guards** (verificações) que decidem quando processar com IA:

1. **Guard de Grupo**: Bloqueia mensagens de grupos
2. **Guard de Empresa**: Verifica se empresa existe
3. **Guard de IA Ativa**: Verifica se IA está habilitada
4. **Guard de Pedido Humano**: Detecta palavras como "quero falar com atendente"
5. **Guard de Humano Recente**: Pausa IA se humano falou nos últimos 10min
6. **Guard de Cliente Solicitou**: Cliente pediu atendimento humano

### Sistema RAG (Retrieval-Augmented Generation)

A IA pode consultar documentos específicos (manuais, catálogos, políticas) através de **Vector Stores**:

1. Crie um Vector Store no OpenAI
2. Faça upload dos seus documentos
3. Configure o `vector_name` no dashboard
4. A IA automaticamente consulta os documentos relevantes

### Histórico de Conversas

- Mantém últimas **20 mensagens** por conversa
- Limpeza automática de mensagens antigas
- Contexto preservado entre mensagens

### Transcrição de Áudio

- Mensagens de voz são automaticamente transcritas
- Processadas como texto pela IA
- Limite: 25MB e 90 segundos

---

## 🚀 Deploy em Produção

### Com PM2

```bash
# Instalar PM2
npm install -g pm2

# Iniciar aplicação (sempre pelo ecosystem: kill_timeout para fechar os Chromes)
pm2 start ecosystem.config.js --env production

# Configurar inicialização automática
pm2 startup
pm2 save

# Logs
pm2 logs myzap
pm2 monit
```

### Restart Automático

Sob PM2 o próprio MyZap se reinicia todo dia (padrão 3h, fuso de Brasília) com o
desligamento limpo — não precisa de cron (o `pm2 restart` no cron nem achava o pm2, que
vive no nvm). `REINICIO_DIARIO_HORA` muda a hora, `REINICIO_DIARIO=0` desliga. Detalhes em
[CONFIGURACAO_RESTART_AUTOMATICO.md](CONFIGURACAO_RESTART_AUTOMATICO.md).

### Nginx (Proxy Reverso)

```nginx
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### SSL com Certbot

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d seu-dominio.com
```

---

## ⚡ Otimizações

### Argumentos do Chrome Otimizados

- Reduz **30-40% de RAM** por sessão
- Desabilita recursos desnecessários (GPU, audio, extensions)
- Aplicado nas 3 engines

### Limits SQL

- Consultas limitadas a **50 registros** por padrão
- Histórico de IA limitado a **20 mensagens**
- Reduz consumo de memória em **50-70%**

### Jobs de Limpeza Automática

| Job | Frequência | Ação |
|-----|-----------|------|
| Cache Cleanup | 6h | Remove cache antigo (>7 dias) |
| Chat History | 24h | Remove histórico antigo (>30 dias) |
| Database | 24h | Limpa tabelas temporárias |
| Instances | 1h | Remove instâncias mortas |
| Logs | 24h | Remove logs antigos (>7 dias) |
| Memory Monitor | 15min | Monitora uso de memória |

### Impacto das Otimizações

| Métrica | Antes | Depois | Melhoria |
|---------|-------|--------|----------|
| RAM/sessão | 500-850 MB | 300-450 MB | **-40-50%** |
| SWAP | 1.9 GB | 0-200 MB | **-90%** |
| Disco | 2.5 GB | 1.3-1.7 GB | **-800 MB** |

---

## 🎓 Créditos

### Projeto Original

Este projeto é um **fork** do excelente trabalho de:

- **Bill Barsch** - [billbarsch/myzap](https://github.com/billbarsch/myzap) - Desenvolvedor Original
- **Eduardo Policarpo** - [edupoli](https://github.com/edupoli) - Desenvolvedor 2.0
- **Jonathan Henrique** - [jhowbhz](https://github.com/jhowbhz) - Desenvolvedor 3.0

### Bibliotecas Base

- [wppconnect-team/wppconnect](https://github.com/wppconnect-team/wppconnect)
- [pedroslopez/whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js/)
- [orkestral/venom](https://github.com/orkestral/venom)

### Modificações JZ-TECH-SYS

Este fork adiciona:

- ✨ Sistema completo de IA com OpenAI
- 📊 Dashboard administrativo avançado
- 🎯 Sistema de Guards inteligentes
- ⚡ Otimizações de performance
- 🛡️ Validação robusta de números
- 📝 Sistema de histórico inteligente
- 🔧 Jobs de manutenção automática
- 🚫 Controle de grupos
- 🎤 Transcrição de áudio
- 📚 Sistema RAG

**Desenvolvido por:** [JZ-TECH-SYS](https://github.com/JZ-TECH-SYS)

---

## 📝 Licença

Este projeto está sob a licença **MIT**. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

```
MIT License

Copyright (c) 2025 JZ-TECH-SYS (fork)
Copyright (c) 2024 Bill Barsch (original)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

## 🆘 Suporte

### Comunidade Original MyZAP

- 📱 WhatsApp: +55 (63) 99215-8117 - Bill Barsch
- 📱 WhatsApp: +55 (43) 99661-1437 - Eduardo Policarpo
- 📱 WhatsApp: +55 (31) 99435-9434 - Jonathan Henrique

### Grupos de Apoio

<a href="https://chat.whatsapp.com/EeAWALQb6Ga5oeTbG7DD2k">
  <img src="https://img.shields.io/badge/WhatsApp-Grupo_1-25D366?style=for-the-badge&logo=whatsapp&logoColor=white">
</a>

<a href="https://t.me/joinchat/tOiGjpK_0xg4OGZh">
  <img src="https://img.shields.io/badge/Telegram-Grupo-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white">
</a>

---

## 🌟 Versão Profissional

Para uma versão completa com auto-instalador, updates automáticos e suporte premium:

👉 **[WhiteLabel APIBrasil](https://whitelabel.apibrasil.com.br)**

---

<p align="center">
  <strong>Feito com ❤️ por <a href="https://github.com/JZ-TECH-SYS">JZ-TECH-SYS</a></strong><br>
  <em>Baseado no projeto original de <a href="https://github.com/billbarsch">Bill Barsch</a></em>
</p>




