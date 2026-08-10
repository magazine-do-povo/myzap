# MyZap na Magazine do Povo — o que este fork tem de diferente

> Índice. Este repositório é **fork de `JZ-TECH-SYS/myzap`** e o código do produto não é nosso:
> só acrescentamos o necessário para rodar no GKE da Magazine. Criado em 10/08/2026.

| Arquivo | Tipo | O que é |
|---|---|---|
| [deploy-no-gke.md](deploy-no-gke.md) | guia | Como este fork sobe (imagem, StatefulSet com disco, secret, deploy manual), como **parear um número** e o que fazer quando a sessão cai |

## O que foi acrescentado (e por quê)

| Arquivo | Por quê |
|---|---|
| `Dockerfile` | O upstream roda em VPS com `pm2`; aqui quem supervisiona é o Kubernetes. Traz o **Chromium do Debian** (o motor é wppconnect = WhatsApp Web), `ffmpeg`, fontes e `tini` |
| `k8s/myzap.yaml` | **StatefulSet de 1 réplica com disco**, e não Deployment: o estado da sessão vive em `instances/` e o banco é SQLite em `database/`. Dois pods abrindo a mesma sessão fazem o WhatsApp derrubar o número |
| `.github/workflows/deploy-gke.yml` | Deploy **manual**. Fork recebe commits de fora, e trocar o pod desconecta chip |

**Nada do código do MyZap foi alterado.** Se algum dia precisar, o merge do upstream continua
possível — os arquivos acima não existem lá.
