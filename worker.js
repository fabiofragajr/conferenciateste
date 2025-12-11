importScripts("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");

onmessage = function (evt) {
  const { buffer, width, height } = evt.data;

  const data = new Uint8ClampedArray(buffer);
  const result = jsQR(data, width, height);

  postMessage(result ? result.data : null);
};
