/**
 * O PIX copia-e-cola que o agente manda vai numa mensagem SÓ DELE.
 *
 * No WhatsApp, copiar uma mensagem copia o texto inteiro — e o app do banco
 * recusa o código com "segue o PIX de R$ 149,00" grudado. O agente põe o código
 * numa linha sozinha (o fim da resposta); aqui essa linha vira outra mensagem,
 * depois do texto. Sem código na resposta, nada muda.
 *
 * O código tem espaço no meio (nome do recebedor: "LUCIMAR COLOMBO SEMI JOIA"),
 * por isso a linha é casada do 000201 até o CRC (6304 + 4 hex), não por \S+.
 *
 * A linha digitável do boleto (o agente do ClickJoias manda uma por parcela)
 * segue a mesma regra: sozinha na linha, vira mensagem própria — é ela que o
 * cliente cola no app do banco. 47 dígitos (48 em convênio), com ou sem os
 * pontos e espaços da impressão.
 */
const LINHA_PIX = /^\s*(000201\S[^\n]*?6304[0-9A-Fa-f]{4})\s*$/;
const ehLinhaDigitavel = (l) => /^\s*[\d. ]+\s*$/.test(l) && /^\d{47,48}$/.test(l.replace(/\D/g, ''));
const ehCodigo = (l) => LINHA_PIX.test(l) || ehLinhaDigitavel(l);

function separarPix(texto) {
  const linhas = String(texto || '').split('\n');
  const codigos = linhas.filter(ehCodigo).map((l) => l.trim());
  if (!codigos.length) return [texto];
  const resto = linhas.filter((l) => !ehCodigo(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return [...(resto ? [resto] : []), ...codigos];
}

module.exports = { separarPix };
