importScripts("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");

onmessage = evt => {
    const { buffer, width, height } = evt.data;

    const img = new Uint8ClampedArray(buffer);
    const qr = jsQR(img, width, height);

    if (!qr) return postMessage(null);

    const loc = qr.location;

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const area = dist(loc.topLeftCorner, loc.topRightCorner) *
                 dist(loc.topLeftCorner, loc.bottomLeftCorner);

    if (area < width * height * 0.002)
        return postMessage(null);

    postMessage({ code: qr.data });
};
