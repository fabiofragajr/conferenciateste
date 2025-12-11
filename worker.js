// worker.js — import jsQR e filtrar falsos positivos
importScripts("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");

onmessage = function(ev) {
  try {
    const { buffer, w, h } = ev.data;
    const pixels = new Uint8ClampedArray(buffer);

    const qr = jsQR(pixels, w, h);
    if (!qr) return postMessage(null);

    // Filtro: área proporcional mínima (evita ruído)
    const loc = qr.location;
    const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
    const wbox = dist(loc.topLeftCorner, loc.topRightCorner);
    const hbox = dist(loc.topLeftCorner, loc.bottomLeftCorner);
    const area = wbox * hbox;

    if (area < (w * h * 0.001)) return postMessage(null);

    // Retorna um objeto consistente
    postMessage({ code: String(qr.data) });

  } catch (e) {
    // falha silenciosa — evita travar
    postMessage(null);
  }
};
