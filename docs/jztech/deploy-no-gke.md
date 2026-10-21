# Deploy no GKE, parear número e recuperar sessão

> **Guia.** Como este motor roda na infra da JZ Tech, servindo o canal não-oficial do
> **JZ TECH ZAP**. Escrito em 17/09/2026, quando o MyZap substituiu o wuzapi.
> Estudo que originou a decisão (por que a troca, o que o MyZap não faz, o plano):
> `api-zap-ofc` → `docs/canal-nao-oficial/migracao-wuzapi-para-myzap.md`.
> O pool dedicado está em `jztech-infra` → `myzap.tf`.

## Coordenadas

| Item | Valor |
|---|---|
| Projeto GCP | `jztech-490722` |
| Cluster | `jztech-gke-prod`, zona `southamerica-east1-a` |
| Namespace | `myzap` |
| Nó | pool **`myzap-pool`** (e2-standard-4), taint `workload=myzap:NoSchedule` |
| Carga | `StatefulSet/myzap`, **2 réplicas** (shard: cada pod tem os seus números e o seu Service), `updateStrategy: OnDelete` |
| Disco | PVC de 20Gi → `/app/instances` (sessões) e `/app/database` (SQLite) |
| Serviço | `myzap.myzap.svc.cluster.local:3333` (ClusterIP — **não** exposto na internet) |
| Imagem | `southamerica-east1-docker.pkg.dev/jztech-490722/jztech-docker-prod/myzap` |
| Quem consome | `apizap-api` e `apizap-worker` (namespace `apizap`), via `base_url` da conta |

## Como o zap fala com este motor

O endereço **não** está em ConfigMap: ele é o `base_url` da conta MyZap da empresa, na tabela
`whatsappconta` do zap — multiempresa, cadastrado pelo painel (Números → Não-oficial). O
`apitoken` (chave-mestra) vai cifrado na `whatsappcredencial` da conta, e a `sessionkey` de cada
número em `whatsappnumero.myzap_sessionkey_criptografada`.

Cada número vira **uma sessão** chamada `emp{idempresa}_num{idnumero}`, e os quatro webhooks da
sessão (`wh_message`, `wh_connect`, `wh_status`, `wh_qrcode`) apontam todos para
`https://apizap.jztech.com.br/webhook/myzap/{idnumero}` — quem separa é o campo `wook` do corpo.

## Deploy

*Actions → Deploy MyZap to GKE → Run workflow.* Ele **publica a imagem e aplica o manifest, mas
não troca o pod** — marque `reiniciar_pod` só quando aceitar derrubar as sessões conectadas.

Para subir uma imagem já publicada, no momento que você escolher:

```bash
kubectl -n myzap delete pod myzap-0     # derruba as sessões; elas voltam pelos tokens do disco
kubectl -n myzap wait --for=condition=Ready pod/myzap-0 --timeout=600s
```

Com `START_ALL_SESSIONS=true` e o disco preservado, o MyZap reconecta os números sozinho ao
subir — QR novo só é preciso se o WhatsApp tiver invalidado a sessão do lado dele.

> `kubectl rollout status` **não** funciona aqui: ele exige `RollingUpdate`, e este StatefulSet é
> `OnDelete` de propósito. Espere o pod, que é o que interessa.

## O usuário do sistema (e a senha do painel)

`Devices.user_id` é NOT NULL e os engines resolvem o usuário por `process.env.EMAIL` — sem ele,
criar sessão falha **em silêncio**. O MyZap não tem rota de cadastro (só `/api/auth/login`), então
o entrypoint roda `scripts/seed-usuario-sistema.js` a cada boot (idempotente).

**Login do painel:** o e-mail de `EMAIL` e, como senha, **o `TOKEN` do servidor** — o
`AuthController` compara `sha1(senha)` com a coluna e também aceita o TOKEN direto, então não
existe uma segunda credencial para alguém perder.

## Parear um número (o único passo humano)

O painel **não** está publicado na internet de propósito: quem precisa dele é uma pessoa, uma vez
por chip. Use port-forward:

```bash
KUBECONFIG=~/.kube/config-jztech kubectl -n myzap port-forward statefulset/myzap 3333:3333
# abra http://localhost:3333 e use o TOKEN mestre (MYZAP_ENV_FILE → TOKEN)
```

O caminho normal, porém, é **pelo painel do zap**: Números → Não-oficial → conectar, que chama
`POST /numeros/{id}/conectar` e mostra o QR na tela. O port-forward é para diagnóstico.

Depois de ler o QR:

```bash
curl -s localhost:3333/health | jq '{sessions_total, sessions_connected, db}'
```

## Quando a sessão cai

1. `curl -s localhost:3333/health/sessions` (via port-forward) mostra o estado de cada uma.
2. Sessão em `close`/zumbi: apagar a sessão e parear de novo é o caminho — o `deleteSession`
   costuma pendurar, mas o servidor conclui a remoção.
3. **Nunca** suba uma segunda réplica para "ajudar": duas instâncias na mesma sessão fazem o
   WhatsApp desconectar o número.
4. Pod `Pending` e nenhum evento? Confira se o pool `myzap-pool` tem nó
   (`kubectl get nodes -l workload=myzap`). O pool existe com `node_count` controlado pelo
   Terraform, e um pool a zero deixa o pod esperando para sempre.

## Reinício diário (4h, um pod por vez)

Cada sessão é um Chrome inteiro e o serviço **vaza memória ao longo do dia**: medido em
27/09–03/10/2026, o `myzap-0` foi de 1,0 para 5,0 GB e de 0,25 para 1,6 core com as mesmas
sessões. Sem reinício, bate o limite de 10 GiB em ~5 dias e cai sozinho (OOMKill) em horário
aleatório. Por isso o CronJob `myzap-reinicio-diario` (`k8s/reinicio-diario.yaml`, aplicado pelo
workflow) apaga os pods às **4h de Brasília, um por vez**: espera o pod novo ficar Ready e dá
2 min para as sessões reconectarem antes do próximo. Se o primeiro não voltar em 10 min, para
e não derruba o segundo.

É seguro porque a sessão vive no disco: o pod volta e reconecta pelos tokens, sem QR. **O
reinício não limpa sessão zumbi** — desconectada ou esperando QR, ela volta do disco no mesmo
estado e segue segurando um Chrome. Zumbi se apaga pela API, de dentro do pod (não há curl na
imagem, use o node):

```bash
# estado de cada sessão
kubectl -n myzap exec myzap-0 -- node -e 'fetch("http://127.0.0.1:3333/health/sessions").then(r=>r.text()).then(console.log)'
# apagar (sessionkey vem do /health/sessions); a rota costuma demorar, mas conclui
kubectl -n myzap exec myzap-0 -- node -e 'fetch("http://127.0.0.1:3333/deleteSession",{method:"POST",headers:{"Content-Type":"application/json",sessionkey:"<sessionkey>"},body:JSON.stringify({session:"emp4_numN"})}).then(r=>r.text()).then(console.log)'
```

Conferir a rotina: `kubectl -n myzap get jobs` (últimos 3 sucessos e 3 falhas ficam) e
`kubectl -n myzap logs job/<nome>`. Rodar fora de hora, se precisar:
`kubectl -n myzap create job --from=cronjob/myzap-reinicio-diario reinicio-manual`.

## O que preservar num incidente

O ativo é o PVC `dados-myzap-0`. Perder o disco custa **re-escanear todos os chips**, e o QR é
presencial. Antes de qualquer manobra que apague o volume, copie `instances/` para fora:

```bash
kubectl -n myzap exec myzap-0 -- tar czf - -C /app instances > instances-$(date +%F).tgz
```

## Variáveis (MYZAP_ENV_FILE)

O secret `myzap-secrets` é gerado pelo workflow a partir do GitHub Secret `MYZAP_ENV_FILE`.
As três primeiras não são opcionais — sem elas o motor **sobe e falha calado**:

| Variável | Observação |
|---|---|
| `TOKEN` | **chave-mestra do servidor** — quem a tem administra e apaga TODAS as sessões, de todas as empresas. ⚠️ nunca reaproveite o valor que estava no `.envcopy` e no `insomnia_collection.json` (tirados em 18/10/2026): ele segue público no histórico do Git. É o mesmo valor que vai no `MYZAP_ADMIN_TOKEN` do zap |
| `EMAIL` | **obrigatória para CRIAR SESSÃO.** Os engines fazem `User.findOne({ where: { email: process.env.EMAIL } })` para vincular o device ao usuário do sistema (`engines/WhatsappWebJS.js:76`). Sem ela o Sequelize aborta com `WHERE parameter "email" has invalid "undefined" value` e a sessão morre calada: `/start` responde `STARTING` e o `getConnectionStatus` diz que a sessão "não existe" |
| `OPENAI_API_KEY` | **obrigatória para o processo SUBIR**, mesmo sem usar IA: `controllers/helper/events/audioTranscriber.js` instancia o cliente OpenAI no `require`, e sem a variável o Node morre no boot (`CrashLoopBackOff`). Ponha um valor inócuo — este servidor só manda texto e mídia; se alguém ligar transcrição, toma 401 da OpenAI, que é o certo |
| `JWT_SECRET` | sessão do painel |
| `COMPANY` / `LOGO` | identidade no painel e nas páginas |
| `CORS_ORIGIN` | quem pode chamar a API pelo navegador |
| `EMAIL_TOKEN` | pode ficar vazio. Sem ela sai só um `[WARNING] [EMAIL ALERT]` no log |

`PORT`, `PRODUCTION`, `START_ALL_SESSIONS`, `USE_CHROME`, `ENGINE`, `WHATSAPP_VERSION` e as três
`SESSION_KEEPALIVE_*` já vêm fixadas no manifest — não repita no env file.

## Por que este motor tem nó só para ele

Cada sessão é um Chrome inteiro, e o serviço vaza memória ao longo do dia (a própria
documentação dele manda reiniciar de madrugada). No pool compartilhado da frota ele seria
vizinho da API do zap, do ClickRH, do Conecta e dos CronJobs — e sob pressão de memória o
kubelet não desaloja só o culpado, despeja pod alheio. O `requests == limits` (3 CPU / 10 GiB)
fecha o cerco: passou do teto, o container morre sozinho (OOMKill) e reinicia só ele.
