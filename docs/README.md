# Documentação do MyZap da JZ Tech

> **Referência.** Mapa da pasta `docs/` e a convenção para escrever aqui. Status: criado em
> 21/10/2026, quando a pasta passou a seguir esta convenção. · 21/10/2026

O `README.md` da raiz continua valendo para o código do MyZap, que segue o oficial. Aqui fica o que é
nosso: operar o motor e manter a família de cópias. O `RUNTIME-PACK.md` da raiz explica como o motor
chega aos PCs das lojas.

## Mapa

| Pasta | Domínio | O que tem |
|---|---|---|
| [jztech/](jztech/README.md) | operação na JZ Tech | deploy no GKE, parear número, recuperar sessão |

Cada filho tem a sua pasta, que só existe nele (ex.: `docs/magazine/` no `magazine-do-povo/myzap`).

## Convenção

- Organize **por domínio**, nunca por tipo de arquivo. Cada subpasta tem um `README.md` que é o índice
  dela (tabela Arquivo · Tipo · O que é).
- Ao adicionar ou mover um doc, atualize o índice da pasta e este mapa.
- Nome de arquivo `.md` em kebab-case minúsculo, sem acento nem espaço.
- Tipo no índice: estudo | plano | guia | checklist | chamado | referência.
- Cabeçalho: `# Título` + uma linha `> ` com contexto, status e data absoluta (dd/mm/aaaa).
- Links entre docs: `[[nome-do-arquivo]]` (só o nome, sem caminho nem extensão).
- Não duplique o que já está no código ou no workflow: o doc explica o porquê e o modelo.
- Concluído ou obsoleto vai para `docs/_historico/`. Não apague histórico útil.
