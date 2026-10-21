/**
 * O primeiro contato do dia é só cumprimento (ou pedido de cardápio, ou mídia sem texto)?
 *
 * Regra da loja (Capucho, 24–25/09/2026): no primeiro contato sai a mensagem padrão com o
 * link e o cardápio. Se a pessoa só disse "oi", a IA espera ela escrever de novo; se já
 * veio com o pedido ou com uma pergunta, a IA responde logo depois da mensagem padrão.
 * Medido em 14 dias (Capucho + Vaqueiro, 298 primeiros contatos): 16% já traziam o pedido
 * inteiro ("Boa noite gostaria de pedir dois x salada completo para entregar") e 18% uma
 * pergunta — com a IA calada, a Márcia (2 cachorros, 1 Calafranbacon, 1 Big Burg e o
 * endereço) ficou sem resposta.
 *
 * Na dúvida é CONTEÚDO: a IA responder a mais custa uma mensagem; responder a menos custa
 * o pedido.
 */

// Marcadores que o textoMensagem põe no lugar da mídia
const MIDIA = /\[(imagem|image|áudio|audio|v[íi]deo|figurinha|sticker|documento|localiza[çc][ãa]o|contato)\]/gi;

// Palavras de cumprimento e de "me manda o cardápio" — a mensagem inteira tem de ser só isso
// "ooi", "oiii", "boaaa noite": letra repetida não muda a palavra
const colapsar = (p) => p.replace(/(.)\1+/gu, '$1');

const PALAVRAS = new Set(`
  oi oie oii oiii oiee oieee ola olá olaa opa opaa eae eai aí ai alo alô hey
  boa boas bom noite noitee tarde dia dias tudo td bem bom joia jóia blz beleza tranquilo
  como vai vc você voce vcs vocês voces está esta tá ta
  pessoal amigo amiga amg moça moca moço moco chefe gente meu minha querido querida
  nega nego neguinha mano mana parceiro parceira patrão patrao padrinho madrinha tio tia irmão irmao
  e o a os as de do da pra para por favor pf pfv pfvr gentileza obrigado obrigada
  cardápio cardapio cardápios cardapios menu link site manda mande me passa envia envie
  pode poderia consegue qual quais tem seu sua
  muito muita ok okay sim obg valeu vlw boq noire
`.trim().split(/\s+/).map((p) => colapsar(p)));

function ehSoCumprimento(texto) {
  const semMidia = String(texto || '').replace(MIDIA, ' ');
  const palavras = semMidia
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return palavras.every((p) => PALAVRAS.has(colapsar(p)));
}

module.exports = { ehSoCumprimento };
