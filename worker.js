importScripts("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");

onmessage = function(evt) {
  const { buffer, w, h } = evt.data;
  const img = new Uint8ClampedArray(buffer);

  const qr = jsQR(img, w, h);

  if (!qr) {
    postMessage(null);
    return;
  }

  // FILTRO DE QUALIDADE – evita falsos positivos
  const loc = qr.location;

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  const top = dist(loc.topLeftCorner, loc.topRightCorner);
  const side = dist(loc.topLeftCorner, loc.bottomLeftCorner);

  const area = top * side;
  const frame = w * h;

  if (area / frame < 0.001) {
    postMessage(null);
    return;
  }

  postMessage(qr.data);
};
