# Runtime Pack — como este repositório vira o motor dos clientes (v3)

Desde a **v3.0.0**, o MyZap chega às máquinas dos clientes como **artefato pronto**
(o *Runtime Pack*): zip com código (dieta ENGINE=1) + `node_modules` de produção (hoisted)
+ Chromium + **node.exe embutido** + banco-semente gerado pelas migrations. O
[gerenciadorMyzap](https://github.com/JZ-TECH-SYS/gerenciadorMyzap) baixa esse zip e troca o
motor de forma **atômica com rollback** — sem Git, Node, pnpm ou compilação no cliente.

## Publicar uma nova versão do motor (o ÚNICO jeito)

```bash
# 1) bump "version" no package.json (ex.: 3.0.3) + commit + push
# 2) tag = gate humano de release:
git tag v3.0.3 && git push --tags
```

O workflow **Release Runtime Pack** (`.github/workflows/release-pack.yml`, windows-latest,
Node 22) monta e publica `myzap-pack-win32-x64.zip` + `.manifest.json` em ~3 min. Os
gerenciadores comparam o manifest de `releases/latest` (boot+2min, a cada 6h, botão) e
aplicam com rollback automático se a versão nova não ficar saudável.

> ⚠️ **Push na `main` NÃO publica motor**. Só a tag libera.
> ⚠️ A major do Node no workflow = ABI do sqlite3 embarcado em TODOS os clientes.

## Build local / detalhes

```bash
node scripts/build-pack.js            # dist-pack/ (zip + manifest)
```

Peças v3 deste repo: `scripts/build-pack.js` (builder com smoke test do node embutido),
`controllers/helper/core/systemUser.js` (dono das sessões criado sob demanda — fim do
"QR nunca aparece" em banco novo), shutdown gracioso no `index.js`, migrations executáveis
de ponta a ponta (geram a semente no CI).

**Especificação completa** (conteúdo do pack, layout `myzap\`/`myzap-data\`, fluxo de
troca/rollback, migração do legado):
[gerenciadorMyzap/docs/RUNTIME_PACK.md](https://github.com/JZ-TECH-SYS/gerenciadorMyzap/blob/main/docs/RUNTIME_PACK.md)
— e o panorama do redesign em
[docs/VERSAO_SUPREMA.md](https://github.com/JZ-TECH-SYS/gerenciadorMyzap/blob/main/docs/VERSAO_SUPREMA.md).
