# Família MyZap: oficial → pai → filhos

> **Guia.** Como as correções do MyZap oficial chegam ao pai e do pai à cópia de cada empresa, o que
> roda onde, os dois robôs e o que fazer quando um deles trava. Status: montada em 21/10/2026. A
> primeira sincronização do Magazine foi à mão, por PR, e a segunda já foi do robô, sozinho. O oficial
> ainda não foi trazido: 22 commits pendentes, com conflito. · 21/10/2026

Mesmo modelo da família wuzapi, que já roda: `JZ-TECH-SYS/jztechwuzapi`,
[docs/FAMILIA-WUZAPI.md](https://github.com/JZ-TECH-SYS/jztechwuzapi/blob/main/docs/FAMILIA-WUZAPI.md).
O gerenciador desktop do MyZap tem a família dele, com guia próprio:
[[familia-gerenciador-myzap]], no `docs/` do
[JZ-TECH-SYS/gerenciadorMyzap](https://github.com/JZ-TECH-SYS/gerenciadorMyzap/tree/main/docs).

## A árvore

```
billbarsch/myzap (branch myzap2.0)   o OFICIAL (público, anda pouco)
   │  upstream.yml (no pai, 08:27): avisa na issue e, sem conflito, abre o PR do branch upstream/auto
   │  → o João revisa e mescla. Nunca entra sozinho.
   ▼
JZ-TECH-SYS/myzap                    o PAI (PÚBLICO). Correção nossa entra AQUI, por PR.
   │  sync-pai.yml (em cada filho, 03:47): merge do pai + build/teste offline + PR mesclado pelo robô
   └──► magazine-do-povo/myzap       filho (fork do GitHub do pai)
```

Celularis, Faci Lar e Eberts **não têm cópia** do MyZap.

Regra da família: **correção só nasce no pai.** Uma correção feita direto num filho fica só nele, e
cada linha diferente do pai é um conflito em potencial na próxima sincronização. O que é da empresa
(deploy, `k8s/`, `docs/<empresa>/`) fica no filho, e o pai não mexe.

## O pai e o oficial não têm commit em comum

O pai é uma cópia **reescrita** do oficial até o `478edb9` (16/07/2024): a raiz `bd4e7fa` é o
`aaf6413` do oficial sem a assinatura GPG, e há 311 commits com a mesma árvore e outro SHA. Por isso
o git não acha base e recusa o merge ("refusing to merge unrelated histories").

O `upstream.yml` contorna isso sem mudar arquivo: no branch `upstream/auto`, faz
`git merge -s ours --allow-unrelated-histories` do commit mais novo do oficial cuja árvore a `main`
já tem (hoje, o `478edb9`) e só depois o merge de verdade. Quando o primeiro merge do oficial entrar
na `main`, os históricos ficam ligados e os merges seguintes são normais.

**Distância em 21/10/2026.** Até a v3.0.23, o pai tinha 185 commits próprios à frente do oficial, e o oficial tem
**22 commits** que o pai não tem (15 sem contar merges):

- labels e QR em JSON no WPPConnect (2024), de um fork;
- correções de README;
- deploy automático numa VPS dele (agosto de 2026): o workflow `publicar-vps-2.yml`, um `compose.yaml`
  e o `Dockerfile`, além de `logs/*.log` versionados;
- uma mudança de autenticação no `middlewares/validations.js`: a sessão passa a ser o próprio
  `sessionkey`, o que contraria o nosso modelo (sessão `emp{id}_num{id}` com `sessionkey` própria).

Para o motor que usamos (`ENGINE=1`, whatsapp-web.js) não há correção ali: o código novo é do
WPPConnect, e nos arquivos compartilhados mudam só essa autenticação (`validations.js`, 3 linhas) e um
bloco de resposta removido do `SessionsController.js` (o resto é reindentação). O merge dá conflito em 10
arquivos (issue [#14](https://github.com/JZ-TECH-SYS/myzap/issues/14)).

## O que roda onde

| Repositório | Onde roda | Como a versão chega lá |
|---|---|---|
| pai `JZ-TECH-SYS/myzap` | JZ Tech: cluster `jztech-gke-prod`, namespace `myzap`, `StatefulSet/myzap` em **reserva fria** (0 réplicas desde 19/10/2026, pool `myzap-pool` com autoscaling 0–1). Imagem `southamerica-east1-docker.pkg.dev/jztech-490722/jztech-docker-prod/myzap` | à mão: Actions → *Deploy MyZap to GKE* ([[deploy-no-gke]]) |
| pai, pelos packs | os **PCs das lojas**, pelo gerenciador desktop: o Runtime Pack `win32-x64` da release `v*` (`RUNTIME-PACK.md`) | tag `v*` → `release-pack.yml` → o gerenciador baixa de `releases/latest` (no boot, a cada 6 h ou pelo botão) |
| `magazine-do-povo/myzap` | Magazine: cluster `magazinedopovo-gke-prod` (projeto `magazinedopovo-infra`), namespace `myzap`, StatefulSet com **0 réplicas** desde 17/09/2026 (sem chip para parear). Imagem no `magazinedopovo-docker-prod` do projeto `mgp-whatsapp-prod` | à mão: o *Deploy MyZap to GKE* do próprio filho (`docs/magazine/deploy-no-gke.md`) |

A frota dos PCs **não segue a `main`**: segue a tag. A v3.0.23 foi um cherry-pick em branch de
release, e o resto da `main` ficou fora da frota. Sincronizar filho ou trazer o oficial não muda nada
nas lojas até alguém lançar uma tag.

## Os workflows

Todos chegam a todos os repositórios pela própria sincronização. Os dois robôs têm um `if` no job
que os prende ao lugar certo, e só rodam por agenda ou à mão.

| Arquivo | Roda em | Quando | O que faz |
|---|---|---|---|
| `smoke.yml` | todos | push na `main` e PR, só com mudança de código | smoke da IA (Node puro) e boot (`pnpm install` + `test/boot-test.js`) |
| `release-pack.yml` | todos (só o pai lança tag) | tag `v*`, manual | Runtime Pack `win32-x64` para os PCs |
| `deploy-gke.yml` | cada um com o seu | **só manual** | imagem e manifest no GKE da empresa; o pod só troca com `reiniciar_pod` |
| `upstream.yml` | **só o pai** | **08:27** de Brasília, manual | vigia do oficial + PR do `upstream/auto` |
| `sync-pai.yml` | **só os filhos** | **03:47** de Brasília, manual | sincroniza o filho com o pai |

Na prática: o oficial é olhado às 08:27, e o que o João mescla no pai durante o dia chega aos filhos na
madrugada seguinte (ou na hora, pela seção "Forçar a sincronização agora").

### `upstream.yml` (pai)

1. Compara a `main` com o `myzap2.0` do `billbarsch/myzap` (busca anônima: o oficial é público).
2. Se faltam commits, faz o merge no branch **`upstream/auto`**, com a âncora da seção anterior
   enquanto não houver commit em comum. O merge vai por cima do que já estiver lá (nunca force-push, então
   commit seu no branch fica). Depois roda o build/teste e abre ou atualiza o PR para a `main` marcando o
   @joaosn. **Não mescla sozinho.**
3. Conflito, ou merge que muda `.github/workflows/`: não empurra nada. Avisa na issue, com os
   arquivos, e o merge fica à mão (seção "Trazer o oficial à mão").
4. Quando o oficial anda, faz **um** comentário na issue "Acompanhamento do upstream" (label
   `upstream`), com os commits novos e o resultado do passo 2.

### `sync-pai.yml` (filhos)

1. Busca a `main` do pai por https, **sem chave nem secret**: o pai é público, e a busca não usa nem o
   token do filho. Se a `main` do filho já a contém: **"em dia com o pai"**, e fecha a issue `sync-pai`
   se houver uma aberta.
2. Faz o merge do pai no branch `sync/pai-<sha>`.
3. **Conflito:** abre ou atualiza a issue com label `sync-pai`, marcando o @joaosn, com os arquivos
   em conflito, e para sem empurrar nada.
4. **O merge muda `.github/workflows/`:** também para com issue. O `GITHUB_TOKEN` não pode gravar
   workflow, então essa vez é à mão (seção "Sincronizar à mão").
5. **Sem conflito:** build/teste, push do branch, PR e merge (merge commit) com o `GITHUB_TOKEN`. Apaga
   o branch e fecha a issue, se houver.
6. Falha no build/teste, no push ou no PR: issue com o link do run. O run seguinte continua do branch
   já empurrado.

A issue avisa uma vez por commit do pai. Push e merge do `GITHUB_TOKEN` **não disparam outros
workflows** (nem o `smoke.yml`, nem deploy): é o desejado (seção "Deploy").

### O build/teste dos robôs: offline e sem custo

Os dois robôs rodam a mesma coisa, antes de empurrar:

1. `pnpm install --frozen-lockfile` (pnpm do `packageManager`, Node 20, sem baixar o Chromium);
2. `node --check` em todos os `.js` versionados, menos `public/libs/`;
3. os testes do `package.json` (`pnpm test`) e o `test/boot-test.js`, dentro de `unshare -rn`, um
   **namespace sem rede** (só loopback).

Sem rede, nenhum teste alcança IA, WhatsApp, e-mail ou API de verdade, nem um teste novo escrito errado.
E o job não recebe chave nenhuma: os robôs não leem secret nem variable. Em 21/10/2026, os 34 testes
do `test` e o boot passaram sem rede no pai e na árvore da primeira sincronização do Magazine (Node 20,
container `--network none`), e no runner do GitHub, dentro do `unshare`, na primeira rodada automática
(run [39620529320](https://github.com/magazine-do-povo/myzap/actions/runs/39620529320)). O Ubuntu 24.04
dos runners barra namespace sem root pelo AppArmor: o passo desliga a trava com `sudo sysctl`. Se o
`unshare` falhar mesmo assim, o passo fica vermelho, e nunca roda os testes com rede.

### O agendamento do GitHub atrasa horas

Os horários (03:47 e 08:27) não são pontuais. Na família wuzapi, em 20/10/2026, os runs vieram 4 a 5
horas depois. Nada aqui depende de horário, porque o deploy é manual.

Atenção, porque os dois repositórios são **públicos**: o GitHub **desliga sozinho** o agendamento de
repositório público que passa 60 dias sem atividade. Se o pai ficar parado, o `upstream.yml` e o
`sync-pai.yml` dos filhos param sem aviso. Para conferir e religar:

```bash
gh workflow list -R JZ-TECH-SYS/myzap --all          # "disabled_inactivity" = desligado
gh workflow enable upstream.yml -R JZ-TECH-SYS/myzap
gh workflow enable sync-pai.yml -R magazine-do-povo/myzap
```

## Permissões

| O quê | Onde | Situação em 21/10/2026 |
|---|---|---|
| Token do Actions só leitura (os robôs pedem `contents`, `pull-requests` e `issues: write` no próprio job) | os 2 repositórios | ok |
| "Allow GitHub Actions to create and approve pull requests" | orgs `JZ-TECH-SYS` e `magazine-do-povo` (desde 20/10/2026) e os 2 repositórios | ok |
| Issues ligadas (o robô avisa por issue) | `magazine-do-povo/myzap` | **ligadas em 21/10/2026**: fork do GitHub nasce com issues desligadas |
| Chave para ler o pai | — | não precisa: o pai é público |

Se o pai virar privado, os filhos param com a issue "Não consegui buscar a main do pai". Aí é preciso
uma deploy key por filho, como na família wuzapi (seção "Deploy keys" do guia dela).

Se um robô falhar com "not permitted to create or approve pull requests", falta a permissão da
tabela, na org ou no repositório:

```bash
gh api -X PUT repos/<org>/<repo>/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
```

## Adicionar um filho novo

```bash
FILHO=org/myzap                       # ex.: celularis/myzap

# 1. o repositório, COM o histórico do pai (daí em diante o merge é trivial)
gh repo fork JZ-TECH-SYS/myzap --org "${FILHO%/*}" --fork-name "${FILHO#*/}" --default-branch-only --clone=false
#   ou um repositório comum: gh repo create $FILHO --public, e push da main de um clone do pai

# 2. issues (o fork vem sem), Actions ligado, token só leitura e o robô pode abrir PR
gh api -X PATCH repos/$FILHO -F has_issues=true
gh api -X PUT repos/$FILHO/actions/permissions -F enabled=true -f allowed_actions=all
gh api -X PUT repos/$FILHO/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
#   fork novo pode vir com os workflows desligados: ligue na aba Actions do repositório

# 3. primeira rodada: tem de terminar "em dia com o pai"
gh workflow run sync-pai.yml -R $FILHO
```

O deploy da empresa nova (o `deploy-gke.yml` e o `k8s/myzap.yaml` dela, com projeto, registro, cluster
e réplicas dela) é commit **no filho**, nunca no pai. Depois, ponha o filho na árvore, nas tabelas
deste guia e no laço abaixo.

## Forçar a sincronização agora

```bash
FILHOS="magazine-do-povo/myzap"
for f in $FILHOS; do gh workflow run sync-pai.yml -R $f; done
sleep 15
for f in $FILHOS; do
  id=$(gh run list -R $f --workflow sync-pai.yml --limit 1 --json databaseId --jq '.[0].databaseId')
  gh run watch $id -R $f --exit-status >/dev/null
  echo "$f: $(gh run view $id -R $f --json conclusion --jq .conclusion) $(gh run view $id -R $f --log | grep -oE 'em dia com o pai \([0-9a-f]+\)|sincronizado com o pai .*' | head -1)"
done
```

O oficial, no pai: `gh workflow run upstream.yml -R JZ-TECH-SYS/myzap`.

## Quando trava: conflito, workflow, sem acesso

**Issue `sync-pai` num filho.** O texto diz o motivo:

- **conflito** ou **workflow**: sincronize à mão (abaixo). Quando a `main` do filho contiver o pai, a
  próxima rodada diz "em dia" e fecha a issue sozinha;
- **falha** (build/teste, push ou PR): leia o log do run. "not permitted to create or approve pull
  requests" é a seção "Permissões";
- **não consegui buscar o pai**: o pai foi renomeado, apagado ou virou privado.

### Sincronizar à mão

```bash
FILHO=magazine-do-povo/myzap
D=$(mktemp -d) && git clone https://github.com/$FILHO.git $D && cd $D
git remote add pai https://github.com/JZ-TECH-SYS/myzap.git && git fetch --no-tags pai main
git switch -c sync/pai-manual-$(date +%Y%m%d) origin/main
git merge --no-ff pai/main -m "chore(sync): sincroniza com o pai JZ-TECH-SYS/myzap ($(git rev-parse --short pai/main))"
#   conflito: o que é da empresa fica (deploy-gke.yml, k8s/, a 1ª linha do Dockerfile, docs/<empresa>/);
#   o resto vem do pai. Em rename/rename o git grava marcador de 8 caracteres:
grep -rnE '^(<{7,}|>{7,})( |$)' --include='*.js' --include='*.yml' --include='*.yaml' --include='*.md' --include='Dockerfile' . | grep -v node_modules
#   o mesmo build/teste do robô (Linux; sem rede nos testes)
PUPPETEER_SKIP_DOWNLOAD=1 pnpm install --frozen-lockfile
git ls-files -z '*.js' ':!:public/libs/**' | xargs -0 -n1 node --check
unshare -rn sh -ec 'ip link set lo up; pnpm test; node test/boot-test.js'
git push -u origin HEAD
gh pr create -R $FILHO --base main --head "$(git branch --show-current)" --fill   # o smoke roda no PR; verde → gh pr merge <n> -R $FILHO --merge
```

O `-R` e o `--base main` importam: o filho do Magazine é **fork**, e sem eles o `gh` abre o PR no pai.
Nunca use force-push nem reescreva o histórico de um filho: o merge é que liga o filho ao pai.

### Trazer o oficial à mão

Quando a issue `upstream` diz conflito ou workflow:

```bash
D=$(mktemp -d) && git clone https://github.com/JZ-TECH-SYS/myzap.git $D && cd $D
git fetch --no-tags https://github.com/billbarsch/myzap.git +refs/heads/myzap2.0:refs/remotes/oficial/myzap2.0
git switch -c sync/oficial-$(date +%Y%m%d) origin/main
# só enquanto a main não tiver commit em comum com o oficial (a primeira vez): liga os históricos
git merge -s ours --allow-unrelated-histories -m "chore(sync): liga o histórico ao oficial billbarsch/myzap (478edb9, árvore que a main já tem)" 478edb9
git merge --no-ff oficial/myzap2.0 -m "chore(sync): merge do oficial billbarsch/myzap ($(git rev-parse --short oficial/myzap2.0))"
```

Na resolução, o pai é a referência:

- fica o nosso: deploy (`Dockerfile`, `k8s/`, `deploy-gke.yml`), sessão, IA, mídia e o modelo de
  autenticação;
- **não** entram os workflows de deploy do oficial (`publicar-vps-2.yml`) nem `logs/*.log`: `git rm`
  neles.

Depois, o mesmo build/teste de "Sincronizar à mão" e um PR para a `main`. Para consertar o PR
automático do robô, dá para empurrar commits no próprio `upstream/auto`: o robô faz o merge por cima e
não apaga nada.

## Deploy: manual, em cada empresa

O robô **nunca implanta**. Push e merge do `GITHUB_TOKEN` não disparam workflow, e o `deploy-gke.yml`
de cada repositório é só `workflow_dispatch`. O motivo: trocar a imagem significa apagar o pod, apagar o
pod **derruba as sessões de WhatsApp**, e o QR é presencial. Por isso o StatefulSet usa
`updateStrategy: OnDelete` ([[deploy-no-gke]]). Quem escolhe a hora é gente.

Nos PCs das lojas, quem implanta é a tag `v*` (seção "O que roda onde"), também por decisão de gente.

O `deploy-gke.yml` do pai e o do Magazine ainda têm o passo `Namespace`
(`kubectl create namespace ... | kubectl apply`). A regra das orgs é o deploy de app não reaplicar
Namespace. Confira antes do próximo deploy manual.

## A primeira sincronização (21/10/2026)

**Robôs no pai:** PR [#13](https://github.com/JZ-TECH-SYS/myzap/pull/13). O primeiro `upstream.yml`
(run [39618911383](https://github.com/JZ-TECH-SYS/myzap/actions/runs/39618911383)) achou a âncora
`478edb9` e os 22 commits, deu conflito em 10 arquivos e comentou na issue
[#14](https://github.com/JZ-TECH-SYS/myzap/issues/14). Não abriu PR.

**`magazine-do-povo/myzap`: merge normal do pai, à mão:** PR
[#1](https://github.com/magazine-do-povo/myzap/pull/1), com o smoke e o boot verdes. O filho estava 101
commits atrás, com 21 próprios (base `5be397a`, 06/08/2026). O PR lista cada commit do Magazine e
onde ele ficou. Em resumo:

| Conflito | Ficou |
|---|---|
| `deploy-gke.yml`, `k8s/myzap.yaml` | do Magazine (projeto, registro, cluster, SA, secret, taint, réplicas) |
| `Dockerfile`, `.dockerignore` | do pai; o `Dockerfile` com o nome da Magazine na 1ª linha |
| `functions/WhatsappWebJS/helper/mensagens.js` | do pai: o "QR morto" do Magazine (`7545858`) o pai resolveu depois com `qrVivo()` |
| `jobs/sessionKeepAlive.js` | os dois: loopback e `triggerStart` do Magazine, `PRECISA_QR` do pai |
| 3 migrations renomeadas dos dois lados | os nomes do pai. O conteúdo é igual, e as 3 são idempotentes: um banco antigo do Magazine só as reaplica sem efeito |

O `deploy.yml` (deploy na VPS, já desligado à mão no Magazine) saiu, como no pai. Depois do merge, o
`sync-pai.yml` respondeu "em dia com o pai (`8ace4ce`)".

**Primeira rodada automática.** O PR [#15](https://github.com/JZ-TECH-SYS/myzap/pull/15) do pai
(`docs/README.md`) chegou ao Magazine pelo robô: merge, os 34 testes e o boot sem rede no runner, e o
PR [#2](https://github.com/magazine-do-povo/myzap/pull/2) aberto e mesclado pelo `github-actions`, com o
branch apagado depois. Nenhum workflow disparou, e o PR do robô não mostra check vermelho.

## Correções do Magazine que valeriam para todos

Ficaram só no filho. Nenhuma foi trazida para o pai:

| Correção | Situação no pai |
|---|---|
| `120f118` e `f7cfdf2`: o boot (`START_ALL_SESSIONS`) reabre as sessões pelo próprio `POST /start`, em loopback, em vez de chamar a engine com um `req` de mentira | o pai ainda tem o `req` de mentira no `startup.js`, e o manifesto dele liga `START_ALL_SESSIONS`. Hoje quem religa a sessão no pai é o keepalive. Vale um PR no pai |
| `74eeb91`: shim de `controllers/helper/http` | o pai ainda faz `require('../../../../controllers/helper/http')` em `functions/WPPConnect/helper/mensagens/util.js:5`, e o arquivo mora em `core/http.js`. Só derruba o boot com `ENGINE=2` (WPPConnect), que ninguém usa |

Se uma cópia achar um bug novo, a correção vai para o pai, por PR, e chega a todos na madrugada
seguinte.
