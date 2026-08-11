#!/bin/sh
# Entrypoint do MyZap no Kubernetes.
#
# O schema do SQLite vem de 19 migrations no formato sequelize-cli, mas o CLI NÃO
# está nas dependências do projeto — na VPS do upstream alguém roda por fora. Numa
# imagem, se ninguém rodar, o banco sobe vazio e a API responde
#
#   SQLITE_ERROR: no such table: Devices
#
# ou seja: /health diz "ok" e criar sessão falha. Rodamos aqui, a cada boot: o
# sequelize-cli guarda o que já aplicou em SequelizeMeta, então é idempotente.
#
# Falha de migration NÃO impede o app de subir: com o banco velho ele ainda
# atende as sessões que já existem, e um pod que morre em loop seria pior — só
# fica o aviso no log.
set -e

echo "[entrypoint] aplicando migrations do MyZap..."
if sequelize-cli db:migrate; then
    echo "[entrypoint] migrations OK"
else
    echo "[entrypoint] ATENCAO: migrations falharam — subindo o app com o banco como está" >&2
fi

exec "$@"
