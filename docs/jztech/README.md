# Documentação da JZ Tech — índice

> O que este fork tem de específico para rodar na infra da JZ Tech. Status: motor do canal
> não-oficial do JZ TECH ZAP, substituindo o wuzapi desde 17/09/2026.

O que está aqui é sobre **operar este motor na nossa infra** — o código do MyZap em si segue
o upstream, e o `README.md` da raiz continua valendo para ele.

## Mapa

| Arquivo | Tipo | O que é |
|---|---|---|
| [deploy-no-gke.md](deploy-no-gke.md) | guia | Coordenadas no cluster, como o zap fala com o motor, deploy manual (e por que é manual), parear o chip, recuperar sessão e as variáveis que fazem o motor subir ou falhar calado. O reinício diário às 4h e como apagar sessão zumbi |

## O essencial, em cinco linhas

- A VPS (pm2) saiu de uso em 18/10/2026: o deploy é só o do GKE, e a VPS não recebe mais nada daqui.
- O deploy é **manual de propósito**: trocar a imagem derruba a sessão, e o QR é presencial.
- O `TOKEN` é **chave-mestra do servidor inteiro**, não uma senha qualquer.
- `EMAIL` e `OPENAI_API_KEY` ausentes fazem o motor falhar **em silêncio** — leia a tabela.
- O ativo é o PVC: perder o disco custa re-escanear todos os chips.
