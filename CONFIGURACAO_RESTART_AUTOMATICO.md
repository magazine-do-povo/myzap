# 🚀 REINÍCIO DIÁRIO DO MYZAP

## O cron não é mais necessário

Até 11/10/2026 a recomendação era um cron na VPS:

```bash
0 3 * * * pm2 restart myzap
```

Ele **falhava todo dia** com `pm2: command not found`: o pm2 é instalado pelo nvm, dentro
de `~/.nvm/versions/node/<versão>/bin`, e o cron roda com um PATH mínimo que não passa
por aí. Resultado: o processo ficava semanas de pé, e o Chrome de cada sessão vaza
memória (medido em 11/10/2026: de 0,6 a 4,4 GB por sessão).

Agora **o próprio MyZap se reinicia** (`jobs/dailyRestart.js`): na hora marcada ele chama o
mesmo desligamento limpo do `SIGTERM` (`gracefulShutdown` do `index.js` — fecha os Chromes,
solta os perfis em `instances/` e sai com código 0) e o PM2 o religa sozinho. Não depende
de PATH, de cron nem de ninguém.

**Se a linha ainda estiver no crontab, remova-a** (`crontab -e`) — ela só gera e-mail de erro.

---

## Configuração (variáveis no `.env`)

| Variável | Padrão | O que faz |
|----------|--------|-----------|
| `REINICIO_DIARIO` | ligado sob PM2 | `0` desliga; `1` força fora do PM2 (ex.: Docker com `restart: always`) |
| `REINICIO_DIARIO_HORA` | `3` | Hora do reinício (0–23), fuso `America/Sao_Paulo` |

O job **só nasce ligado quando o processo roda sob o PM2** (variável `pm_id` presente): sem
um supervisor que religue um processo que saiu com 0, reiniciar seria se matar. No cluster
(k8s) o CronJob `k8s/reinicio-diario.yaml` já reinicia um pod por vez; nas lojas, o
gerenciador trata saída como queda — nesses dois lugares o job fica desligado sozinho.

Para o reinício ser limpo o PM2 precisa esperar os Chromes fecharem: rode o MyZap **pelo
`ecosystem.config.js`** (`kill_timeout: 20000`), não por `pm2 start index.js`. Ver o
cabeçalho do `ecosystem.config.js`.

---

## Verificação

```bash
# No boot, o job diz quando vai reiniciar:
pm2 logs myzap --lines 200 | grep "REINICIO DIARIO"
#   [REINICIO DIARIO] agendado para as 3h (America/Sao_Paulo), daqui a 412 min

# No dia seguinte, o uptime do processo tem de ser de poucas horas:
pm2 status
```

---

## Windows (Agendador de Tarefas)

Nas lojas o MyZap roda sob o gerenciador, não sob PM2, e o job fica desligado. Quem roda
PM2 no Windows tem o mesmo reinício automático; quem não roda e quer um reinício diário
continua podendo agendar um `.bat` com `pm2 restart myzap` no Agendador de Tarefas.

---

## ⚠️ IMPORTANTE

- O reinício é RÁPIDO (até ~20 s para fechar os Chromes + o boot)
- Sessões WhatsApp reconectam sozinhas pelos tokens em `instances/` (sem QR)
- Escolha horário com MENOS movimento (madrugada)

---

**Atualizado em:** 11/10/2026 — o reinício passou a ser do próprio MyZap
