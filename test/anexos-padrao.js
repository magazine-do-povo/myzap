/**
 * Anexos da mensagem padrão: o texto sai, depois os arquivos — e só com a
 * loja aberta. Sem banco e sem WhatsApp: chatHistory/messageSender entram por
 * require.cache; anexosPadrao e defaultMessageService rodam REAIS contra uma
 * API local que responde o que o ClickExpress responderia.
 *
 * Uso: node test/anexos-padrao.js  (exit 0 = ok, 1 = quebrou)
 */
const http = require('http');
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => {
  const arquivo = resolver(rel);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
};

const enviados = { textos: [], arquivos: [], registrados: [] };
stub('controllers/helper/events/chatHistory.js', {
  // a padrão "nunca saiu hoje" (cada caso manda de novo); o aviso de fechada vale o que foi registrado
  jaEnvieiMensagemPadraoHoje: async ({ tipo }) => tipo === 'aviso_fechada' && enviados.registrados.includes('aviso_fechada'),
  registerAssistantMessage: async ({ messageType }) => { enviados.registrados.push(messageType); },
});
stub('controllers/helper/events/messageSender.js', {
  sendText: async ({ text }) => { enviados.textos.push(text); return true; },
  sendFileFromUrl: async ({ url, filename, mimetype }) => {
    enviados.arquivos.push({ url, filename, mimetype });
    return !/quebrado/.test(url); // um anexo falha, os outros seguem
  },
});
stub('controllers/helper/ia/iaResponseCache.js', { registerIAResponse: () => {} });
stub('controllers/helper/ia/iaConfig.js', { LOG_PREFIX: '[TESTE]' });
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));

// API local: a loja "abre" ou "fecha" conforme a sessionkey pedida
const respostas = {
  aberta: { aberto: true, anexos: [
    { nome: 'cardapio.pdf', tipo: 'pdf', url: 'http://x/cardapio.pdf', tamanho: 1000 },
    { nome: 'promo.jpg', tipo: 'imagem', url: 'http://x/quebrado.jpg', tamanho: 500 },
    { nome: 'combo.png', tipo: 'imagem', url: 'http://x/combo.png', tamanho: 700 },
  ] },
  fechada: { aberto: false, anexos: [{ nome: 'cardapio.pdf', tipo: 'pdf', url: 'http://x/cardapio.pdf', tamanho: 1000 }] },
  vazia: { aberto: true, anexos: [] },
};
let chamadasApi = 0;
const servidor = http.createServer((req, res) => {
  chamadasApi += 1;
  const chave = decodeURIComponent(req.url.split('/').pop());
  res.setHeader('content-type', 'application/json');
  if (!respostas[chave]) { res.statusCode = 500; return res.end('{}'); }
  res.end(JSON.stringify({ result: respostas[chave], error: false }));
});

servidor.listen(0, async () => {
  const base = `http://127.0.0.1:${servidor.address().port}/public`;
  const apiUrlEmpresa = `${base}/api/pedido-venda-ia/3`;
  const { sendDefault, AVISO_LOJA_FECHADA } = require(resolver('controllers/helper/ia/defaultMessageService.js'));
  const { baseDaApi, mimeDoAnexo } = require(resolver('controllers/helper/ia/anexosPadrao.js'));
  const enviar = (sessionkey) => sendDefault({
    client: {}, session: 's', sessionkey, numero: '5511999990000@c.us',
    mensagemPadrao: 'Olá! Bem-vindo.', motivo: 'primeiro_contato', apiUrlEmpresa,
  });
  let falhas = 0;
  const caso = (nome, fn) => { try { fn(); console.log(`ok   ${nome}`); } catch (e) { falhas += 1; console.log(`FAIL ${nome}: ${e.message}`); } };

  caso('base da API sai do api_url da empresa', () => assert.strictEqual(baseDaApi(apiUrlEmpresa), base));
  caso('mime por tipo/extensão', () => {
    assert.strictEqual(mimeDoAnexo({ tipo: 'pdf', url: 'http://x/a.pdf' }), 'application/pdf');
    assert.strictEqual(mimeDoAnexo({ tipo: 'imagem', url: 'http://x/a.png' }), 'image/png');
    assert.strictEqual(mimeDoAnexo({ tipo: 'imagem', url: 'http://x/a.jpg' }), 'image/jpeg');
  });

  assert.strictEqual(await enviar('aberta'), true);
  caso('loja aberta: texto primeiro, depois cada anexo, falha de um não segura os outros', () => {
    assert.deepStrictEqual(enviados.textos, ['Olá! Bem-vindo.']);
    assert.deepStrictEqual(enviados.arquivos.map((a) => a.filename), ['cardapio.pdf', 'promo.jpg', 'combo.png']);
    assert.strictEqual(enviados.arquivos[0].mimetype, 'application/pdf');
  });

  // regra do dono (19/10/2026): o link de "faça seu pedido" com a loja fechada leva a um site fechado
  enviados.textos.length = 0; enviados.arquivos.length = 0; enviados.registrados.length = 0;
  const saiuPadrao = await enviar('fechada');
  caso('loja fechada: sai o aviso no lugar da padrão, sem anexos, e a padrão não conta como enviada', () => {
    assert.deepStrictEqual(enviados.textos, [AVISO_LOJA_FECHADA]);
    assert.deepStrictEqual(enviados.arquivos, []);
    assert.deepStrictEqual(enviados.registrados, ['aviso_fechada']);
    assert.strictEqual(saiuPadrao, false);
  });
  enviados.textos.length = 0;
  await enviar('fechada');
  caso('loja fechada: o aviso sai uma vez por dia', () => assert.deepStrictEqual(enviados.textos, []));

  enviados.textos.length = 0; enviados.arquivos.length = 0;
  await enviar('vazia');
  caso('sem anexos configurados: só o texto', () => assert.deepStrictEqual(enviados.arquivos, []));

  enviados.textos.length = 0; enviados.arquivos.length = 0;
  await enviar('inexistente');
  caso('API fora do ar: a padrão de sempre sai (nunca o aviso de fechada), anexo não', () => {
    assert.deepStrictEqual(enviados.textos, ['Olá! Bem-vindo.']);
    assert.deepStrictEqual(enviados.arquivos, []);
  });

  const antes = chamadasApi;
  await enviar('aberta'); await enviar('aberta');
  caso('cache de 60 s por sessionkey: repetir não bate na API', () => assert.strictEqual(chamadasApi, antes));

  servidor.close();
  console.log(falhas ? `\n${falhas} caso(s) quebrado(s)` : '\nanexos da mensagem padrão: tudo ok');
  process.exit(falhas ? 1 : 0);
});
