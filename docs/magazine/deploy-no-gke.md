# Deploy no GKE, parear número e recuperar sessão

> **Guia.** Como este fork roda na infra da Magazine do Povo. Escrito em 10/08/2026, junto com o
> provisionamento. Estudo que originou a decisão (incluindo por que StatefulSet e os riscos):
> `magazine-do-povo/infra` → `docs/whatsapp/myzap-proprio.md`.

## Coordenadas

| Item | Valor |
|---|---|
| Projeto GCP | `mgp-whatsapp-prod` (registry, Service Accounts, Workload Identity) |
| Cluster | `magazinedopovo-gke-prod` (projeto compartilhado `magazinedopovo-infra`), zona `southamerica-east1-a` |
| Namespace | `myzap` |
| Carga | `StatefulSet/myzap`, **1 réplica**, `updateStrategy: OnDelete` |
| Disco | PVC de 20Gi → `/app/instances` (sessões) e `/app/database` (SQLite) |
| Serviço | `myzap.myzap.svc.cluster.local:3333` (ClusterIP — **não** exposto na internet) |
| Imagem | `southamerica-east1-docker.pkg.dev/mgp-whatsapp-prod/magazinedopovo-docker-prod/myzap` |

## Deploy

*Actions → Deploy MyZap to GKE → Run workflow.* Ele **publica a imagem e aplica o manifest, mas
não troca o pod** — marque `reiniciar_pod` só quando aceitar derrubar as sessões conectadas.

Para subir uma imagem já publicada, no momento que você escolher:

```bash
kubectl -n myzap delete pod myzap-0     # derruba as sessões; elas voltam pelos tokens do disco
kubectl -n myzap rollout status statefulset/myzap
```

Com `START_ALL_SESSIONS=true` e o disco preservado, o MyZap reconecta os números sozinho ao subir —
QR novo só é preciso se o WhatsApp tiver invalidado a sessão do lado dele.

## Parear um número (o único passo humano)

O painel **não** está publicado na internet de propósito: quem precisa dele é uma pessoa, uma vez
por chip. Use port-forward:

```bash
kubectl -n myzap port-forward statefulset/myzap 3333:3333
# abra http://localhost:3333 e use o TOKEN mestre (MYZAP_ENV_FILE → TOKEN)
```

Crie a sessão, leia o QR com o aparelho do número e confira:

```bash
curl -s localhost:3333/health | jq '{sessions_total, sessions_connected, db}'
```

## Quando a sessão cai

1. `curl -s localhost:3333/health/sessions` (via port-forward) mostra o estado de cada uma.
2. Sessão em `close`/zumbi: apagar a sessão no painel e parear de novo é o caminho — o
   `deleteSession` do MyZap costuma pendurar, mas o servidor conclui a remoção.
3. **Nunca** suba uma segunda réplica para "ajudar": duas instâncias na mesma sessão fazem o
   WhatsApp desconectar o número.

## O que preservar num incidente

O ativo é o PVC `dados-myzap-0`. Perder o disco custa **re-escanear todos os chips**. Antes de
qualquer manobra que apague o volume, copie `instances/` para fora:

```bash
kubectl -n myzap exec myzap-0 -- tar czf - -C /app instances > instances-$(date +%F).tgz
```

## Variáveis (MYZAP_ENV_FILE)

O secret `myzap-secrets` é gerado pelo workflow a partir do `MYZAP_ENV_FILE`. O mínimo:

| Variável | Observação |
|---|---|
| `TOKEN` | **chave-mestra do servidor** — quem tem administra todas as sessões. ⚠️ o `.envcopy` do upstream traz um valor de exemplo (`@Juliana137@137`); jamais usar |
| `JWT_SECRET` | sessão do painel |
| `COMPANY` / `LOGO` | identidade no painel e nas páginas |
| `CORS_ORIGIN` | quem pode chamar a API pelo navegador |

`PORT`, `PRODUCTION`, `START_ALL_SESSIONS`, `USE_CHROME` e `ENGINE` já vêm fixados no manifest —
não repita no env file.
