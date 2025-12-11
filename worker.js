importScripts("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");

onmessage = function (evt) {
    const { buffer, width, height } = evt.data;
    const data = new Uint8ClampedArray(buffer);

    const qr = jsQR(data, width, height);

    if (!qr) {
        postMessage(null);
        return;
    }

    const loc = qr.location;

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const top = dist(loc.topLeftCorner, loc.topRightCorner);
    const left = dist(loc.topLeftCorner, loc.bottomLeftCorner);
    const area = top * left;
    const frameArea = width * height;

    if (area / frameArea < 0.0015) {
        postMessage(null);
        return;
    }

    postMessage({
        code: qr.data,
        corners: qr.location
    });
};
