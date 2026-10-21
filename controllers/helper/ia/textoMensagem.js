'use strict';
// Imagem/vídeo/figurinha: no whatsapp-web.js o `body` de mídia é o THUMBNAIL em
// base64 — 3,4 KB de "/9j/4AAQ..." chegaram ao agente como texto do cliente
// (Capucho, 08/09 23:16). O agente recebe a legenda ou um marcador.
const MARCADOR_MIDIA = { image: '[imagem]', video: '[vídeo]', sticker: '[figurinha]' };
function textoDaMensagem(message) {
  const tipo = String(message?.type || '').toLowerCase();
  const marcador = MARCADOR_MIDIA[tipo];
  if (marcador) {
    const legenda = String(message?.caption || '').trim();
    return legenda ? `${marcador} ${legenda}` : marcador;
  }
  const body = String(message?.body || '');
  // cinto e suspensório: base64 de JPEG/PNG com cara de thumbnail, sem espaço, longo
  if (/^(\/9j\/|iVBORw0KGgo)[A-Za-z0-9+/=]{200,}$/.test(body)) return '[imagem]';
  return body;
}


module.exports = { textoDaMensagem, MARCADOR_MIDIA };
