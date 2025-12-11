importScripts("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");

onmessage = function (evt) {
  const { buffer, width, height } = evt.data;
  const data = new Uint8ClampedArray(buffer);

  const qr = jsQR(data, width, height);

  if (!qr) {
    postMessage(null);
    return;
  }

  // --- FILTRO DE QUALIDADE DO QR ---
  const loc = qr.location;

  // calcula tamanho das bordas
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  const top = dist(loc.topLeftCorner, loc.topRightCorner);
  const left = dist(loc.topLeftCorner, loc.bottomLeftCorner);

  const qrArea = top * left;
  const frameArea = width * height;

  const percent = qrArea / frameArea;

  // QR muito pequeno = FALSO POSITIVO
  if (percent < 0.001) {
    postMessage(null);
    return;
  }

  postMessage(qr.data);
};
