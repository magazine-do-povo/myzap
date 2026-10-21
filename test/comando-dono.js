/**
 * Comando do dono: a loja escreve no chat "Você" do próprio WhatsApp e o
 * agente abre ou fecha o site (28/09/2026).
 *
 * O que não pode quebrar:
 *  1. só o chat da loja com ela mesma vira comando — conversa com cliente,
 *     grupo e status seguem o caminho de sempre;
 *  2. a resposta do bot e o aviso "cliente pediu atendente" voltam como
 *     fromMe no MESMO chat: não podem virar comando (senão o bot conversa
 *     sozinho);
 *  3. loja sem o recurso ligado: o agente cala e nada muda;
 *  4. a nova mensagem padrão é gravada no DeviceCompany deste MyZap ANTES da
 *     resposta, e a resposta avisa se a gravação falhou.
 * Sem banco e sem WhatsApp: bordas por require.cache e agente num HTTP local.
 *
 * Uso: node test/comando-dono.js  (exit 0 = ok, 1 = quebrou)
 */
const http = require('http');
const path = require('path');
const assert = require('assert');

const raiz = path.join(__dirname, '..');
const resolver = (rel) => require.resolve(path.join(raiz, rel));
const stub = (rel, exports) => { const f = resolver(rel); require.cache[f] = { id: f, filename: f, loaded: true, exports }; };

const enviados = [];
stub('controllers/helper/events/messageSender.js', {
  sendText: async ({ to, text }) => { enviados.push({ to, text }); return true; },
});
stub('controllers/helper/events/mediaDecryptor.js', {
  decryptFile: async () => Buffer.from('OGGFALSO'),
});
stub('util/customLogger.js', new Proxy({}, { get: () => () => {} }));

const recebidos = [];
const agente = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (c) => (corpo += c));
  req.on('end', () => {
    const json = JSON.parse(corpo || '{}');
    recebidos.push(json);
    res.setHeader('Content-Type', 'application/json');
    if (json.texto === 'fechar') {
      res.end(JSON.stringify({ resposta: '✅ Site fechado.', mensagem_padrao: 'AVISO DE FECHADO', motivo: 'dono_fechar' }));
    } else if (json.audio_base64) {
      res.end(JSON.stringify({ resposta: '✅ Site aberto.', mensagem_padrao: 'MENSAGEM COM LINK', motivo: 'dono_abrir' }));
    } else if (json.texto === 'loja sem o recurso') {
      res.end(JSON.stringify({ silencio: true, motivo: 'dono_desligado' }));
    } else {
      res.end(JSON.stringify({ resposta: 'Por aqui eu só abro e fecho o site.' }));
    }
  });
});

const LOJA = '5544999990000@c.us';
const client = { info: { wid: { _serialized: LOJA, user: '5544999990000' } } };
const doDono = (extra) => ({ fromMe: true, from: LOJA, to: LOJA, type: 'chat', ...extra });
const novaEmpresa = (falhaAoGravar = false) => {
  const e = { api_url: null, mensagem_padrao: 'MENSAGEM COM LINK', gravacoes: [] };
  e.update = async (dados) => {
    if (falhaAoGravar) throw new Error('banco fora');
    e.gravacoes.push(dados);
    Object.assign(e, dados);
  };
  return e;
};

let falhas = 0;
const caso = (nome, fn) => Promise.resolve().then(fn).then(() => console.log(`ok   ${nome}`)).catch((e) => { falhas += 1; console.log(`FAIL ${nome}: ${e.message}`); });

(async () => {
  await new Promise((r) => agente.listen(0, '127.0.0.1', r));
  process.env.AGENT_URL = `http://127.0.0.1:${agente.address().port}`;
  process.env.AGENT_AUTH_TOKEN = 'teste';

  const { ehChatDoDono, processar } = require(resolver('controllers/helper/ia/comandoDono.js'));
  const { registerIAResponse } = require(resolver('controllers/helper/ia/iaResponseCache.js'));
  const rodar = (message, empresa) => processar({ message, client, session: 's', sessionkey: 'k', empresa });

  await caso('chat da loja com ela mesma é do dono', () => {
    assert.strictEqual(ehChatDoDono(doDono(), client), true);
  });
  await caso('chat próprio por @lid (from igual a to) também é do dono', () => {
    assert.strictEqual(ehChatDoDono(doDono({ from: '123456789@lid', to: '123456789@lid' }), client), true);
  });
  await caso('loja falando com cliente NÃO é do dono', () => {
    assert.strictEqual(ehChatDoDono(doDono({ to: '5544988887777@c.us' }), client), false);
    assert.strictEqual(ehChatDoDono(doDono({ to: '999888777@lid' }), client), false);
  });
  await caso('loja de OUTRO produto não entra no modo dono (o agente dela não conhece)', () => {
    assert.strictEqual(ehChatDoDono(doDono(), client, { api_url: 'https://api.outroproduto.com.br/ia/7' }), false);
    assert.strictEqual(ehChatDoDono(doDono(), client, { api_url: 'https://api-clickexpress.jztech.com.br/public/api/pedido-venda-ia/8' }), true);
  });
  await caso('mensagem antiga que a reconexão sincroniza NÃO vira comando', async () => {
    const antes = recebidos.length;
    const ontem = Math.floor(Date.now() / 1000) - 24 * 3600;
    await rodar(doDono({ body: 'fechar', timestamp: ontem }), novaEmpresa());
    assert.strictEqual(recebidos.length, antes);
  });
  await caso('grupo, status e mensagem recebida NÃO são do dono', () => {
    assert.strictEqual(ehChatDoDono(doDono({ to: '120363@g.us' }), client), false);
    assert.strictEqual(ehChatDoDono(doDono({ to: 'status@broadcast' }), client), false);
    assert.strictEqual(ehChatDoDono({ fromMe: false, from: LOJA, to: LOJA }, client), false);
  });

  await caso('"fechar": agente com origem dono, mensagem gravada, resposta no chat "Você"', async () => {
    const empresa = novaEmpresa();
    await rodar(doDono({ body: 'fechar' }), empresa);
    const pedido = recebidos.at(-1);
    assert.strictEqual(pedido.origem, 'dono');
    assert.strictEqual(pedido.numero, '5544999990000');
    assert.deepStrictEqual(empresa.gravacoes, [{ mensagem_padrao: 'AVISO DE FECHADO' }]);
    assert.deepStrictEqual(enviados.at(-1), { to: LOJA, text: '✅ Site fechado.' });
  });

  await caso('a resposta do bot voltando como fromMe NÃO vira comando', async () => {
    const antes = recebidos.length;
    await rodar(doDono({ body: '✅ Site fechado.' }), novaEmpresa());
    assert.strictEqual(recebidos.length, antes);
  });

  await caso('o aviso "cliente pediu atendente" NÃO vira comando', async () => {
    const aviso = '🔔 *Cliente pediu atendimento humano!*\n📱 wa.me/5544911112222';
    registerIAResponse(aviso); // o decisionEngine registra antes de mandar
    const antes = recebidos.length;
    await rodar(doDono({ body: aviso }), novaEmpresa());
    assert.strictEqual(recebidos.length, antes);
  });

  await caso('loja sem o recurso: agente cala, nada é gravado nem enviado', async () => {
    const empresa = novaEmpresa();
    const antes = enviados.length;
    await rodar(doDono({ body: 'loja sem o recurso' }), empresa);
    assert.strictEqual(enviados.length, antes);
    assert.deepStrictEqual(empresa.gravacoes, []);
  });

  await caso('áudio do dono vai ao agente como áudio', async () => {
    const empresa = novaEmpresa();
    await rodar(doDono({ type: 'ptt', body: '', mimetype: 'audio/ogg; codecs=opus' }), empresa);
    const pedido = recebidos.at(-1);
    assert.strictEqual(pedido.audio_base64, Buffer.from('OGGFALSO').toString('base64'));
    assert.strictEqual(pedido.origem, 'dono');
    assert.deepStrictEqual(empresa.gravacoes, [{ mensagem_padrao: 'MENSAGEM COM LINK' }]);
  });

  await caso('gravação da mensagem falhou: o dono fica sabendo', async () => {
    await rodar(doDono({ body: 'fechar' }), novaEmpresa(true));
    assert.match(enviados.at(-1).text, /não consegui trocar a mensagem automática/);
  });

  await caso('foto no chat "Você" é ignorada', async () => {
    const antes = recebidos.length;
    await rodar(doDono({ type: 'image', body: '/9j/AAAA' }), novaEmpresa());
    assert.strictEqual(recebidos.length, antes);
  });

  agente.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
