# MyZap da Magazine do Povo — imagem para o GKE.
#
# O upstream roda em VPS com pm2. Aqui o supervisor é o Kubernetes, então o
# processo é um só (`node index.js`) e quem reinicia é o kubelet.
#
# O motor é wppconnect, ou seja WhatsApp WEB: precisa de um Chromium de verdade
# dentro da imagem. Instalamos o do Debian e desligamos o download do Chromium do
# puppeteer — baixar um segundo navegador dobraria a imagem sem uso.
#
# ⚠️ ESTADO EM DISCO: `instances/` (perfil do Chrome + tokens de cada sessão) e
# `database/` (SQLite). Os dois são montados como volume no StatefulSet — sem
# isso, cada restart exige escanear o QR de novo.
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_BIN=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PORT=3333

# chromium: o navegador do wppconnect. ffmpeg: conversão de áudio/vídeo do MyZap.
# fonts-liberation + fonts-noto-color-emoji: sem fonte o WhatsApp Web renderiza
# caixas vazias e o QR sai ilegível.
# python3/make/g++: node-gyp, para o sqlite3 quando não houver binário pronto.
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        ffmpeg \
        ca-certificates \
        fonts-liberation \
        fonts-noto-color-emoji \
        tini \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# O install vem antes do código para aproveitar a camada em build seguinte.
#
# `scripts/` entra junto porque o `postinstall` do MyZap roda
# `scripts/patch-whatsapp.js` — sem ele o install morre com MODULE_NOT_FOUND. O
# patch corrige o whatsapp-web.js ("markedUnread") e precisa rodar DEPOIS do
# node_modules existir, que é exatamente onde o postinstall roda.
COPY package.json pnpm-lock.yaml .npmrc ./
COPY scripts ./scripts
RUN corepack enable && corepack prepare pnpm@latest --activate \
    # `--prod` ficaria sem o que o postinstall (scripts/patch-whatsapp.js) precisa,
    # e o patch é o que mantém o wppconnect falando com o WhatsApp Web atual.
    && pnpm install --frozen-lockfile \
    && pnpm store prune

COPY . .

# Os dois diretórios de estado nascem aqui para o volume montar em cima com o
# dono certo (o container roda como `node`, não root).
RUN mkdir -p /app/instances /app/database && chown -R node:node /app

USER node

EXPOSE 3333

# tini como PID 1: o Chromium deixa processos filhos, e sem um init eles viram
# zumbis e o pod acaba estourando o limite de PID.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
