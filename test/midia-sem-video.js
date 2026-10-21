/**
 * Mídia do webhook (VPS, 11/10/2026): vídeo era baixado inteiro em base64 e jogado fora — é o
 * que inchava o Chrome e o disco (CapuchoLanches: 14 GB em blob_storage, +2 GB/dia). Agora vídeo
 * não baixa por padrão e nada acima de MIDIA_MAX_MB (8 MB) baixa; o payload segue com os
 * metadados e `base64` null, para quem busca depois por /downloadMedia.
 *
 * Uso: node test/midia-sem-video.js  (exit 0 = ok, 1 = quebrou)
 */
const path = require('path');
const assert = require('assert');

const events = require(path.join(__dirname, '..', 'controllers/helper/events/events.js'));
const MB = 1024 * 1024;
process.exitCode = 1; // o loop esvaziar no meio não pode passar por "ok"

// Mensagem do whatsapp-web.js: o tamanho vem em `_data.size`; o download conta as chamadas.
const msg = (type, size, extra = {}) => {
  const m = {
    type, from: '5511999999999@c.us', to: '5511888888888@c.us', fromMe: false, timestamp: 1760000000,
    id: { _serialized: `false_x_${type}` }, mimetype: `${type === 'ptt' ? 'audio' : type}/x`, body: '',
    _data: { size, filename: `arquivo.${type}` }, baixou: 0, ...extra,
  };
  m.downloadMedia = async () => { m.baixou++; return { data: 'BASE64' }; };
  return m;
};

(async () => {
  // 1) vídeo pequeno: NÃO baixa; metadados e id continuam, base64 null
  let m = msg('video', 1 * MB);
  let p = await events.montarPayload(m, 's', {});
  assert.equal(m.baixou, 0, 'vídeo não é baixado por padrão');
  assert.deepEqual([p.type, p.base64, p.mimetype, p.filename, p.id._serialized], ['video', null, 'video/x', 'arquivo.video', 'false_x_video']);
  console.log('ok   vídeo: não baixa; o payload sai com type, mimetype, filename e id, base64 null');

  // 2) MIDIA_BAIXAR_VIDEO=1 religa
  process.env.MIDIA_BAIXAR_VIDEO = '1';
  m = msg('video', 1 * MB);
  p = await events.montarPayload(m, 's', {});
  delete process.env.MIDIA_BAIXAR_VIDEO;
  assert.deepEqual([m.baixou, p.base64], [1, 'BASE64']);
  console.log('ok   MIDIA_BAIXAR_VIDEO=1: vídeo volta a baixar');

  // 3) imagem de 1 MB baixa; de 9 MB não (teto padrão 8 MB)
  m = msg('image', 1 * MB);
  p = await events.montarPayload(m, 's', {});
  assert.deepEqual([m.baixou, p.base64], [1, 'BASE64']);
  m = msg('image', 9 * MB);
  p = await events.montarPayload(m, 's', {});
  assert.deepEqual([m.baixou, p.base64, p.mimetype], [0, null, 'image/x']);
  console.log('ok   imagem: 1 MB baixa, 9 MB não (teto de 8 MB)');

  // 4) MIDIA_MAX_MB sobe o teto
  process.env.MIDIA_MAX_MB = '10';
  m = msg('image', 9 * MB);
  p = await events.montarPayload(m, 's', {});
  delete process.env.MIDIA_MAX_MB;
  assert.deepEqual([m.baixou, p.base64], [1, 'BASE64']);
  console.log('ok   MIDIA_MAX_MB=10: a imagem de 9 MB baixa');

  // 5) documento de 20 MB: fica o nome do arquivo para quem baixa depois
  m = msg('document', 20 * MB);
  p = await events.montarPayload(m, 's', {});
  assert.deepEqual([m.baixou, p.base64, p.filename], [0, null, 'arquivo.document']);
  console.log('ok   documento de 20 MB: não baixa, filename no payload');

  // 6) sem tamanho informado (outro motor): baixa como sempre; `size` no topo também vale
  m = msg('ptt', undefined);
  p = await events.montarPayload(m, 's', {});
  assert.deepEqual([m.baixou, p.base64], [1, 'BASE64']);
  m = msg('ptt', undefined, { _data: {}, size: 30 * MB });
  p = await events.montarPayload(m, 's', {});
  assert.deepEqual([m.baixou, p.base64], [0, null]);
  console.log('ok   sem tamanho baixa; `size` no topo (wppconnect/venom) respeita o teto');

  console.log('midia-sem-video: tudo ok');
  process.exit(0);
})().catch((e) => { console.error('QUEBROU:', e); process.exit(1); });
