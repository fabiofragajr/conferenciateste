const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const statusMessage = document.getElementById("status-message");
const counter = document.getElementById("counter");

// Botões
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnReport = document.getElementById("btn-report");

const worker = new Worker("worker.js");
let isRunning = false;
let canSendFrame = false;
let lastCorners = null;

const scannedCodes = new Set();

// Carregar histórico
const saved = JSON.parse(localStorage.getItem("scannedCodes") || "[]");
saved.forEach(code => scannedCodes.add(code));
counter.textContent = scannedCodes.size;

function updateCounter() {
    counter.textContent = scannedCodes.size;
}

btnStart.onclick = startCamera;
btnStop.onclick = stopCamera;
btnReport.onclick = generateReport;


// === INICIAR ===
async function startCamera() {
    btnStart.style.display = "none";
    statusMessage.textContent = "Abrindo câmera...";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false
        });

        video.srcObject = stream;
        await video.play();

        video.style.display = "block";
        canvas.style.display = "block";
        btnStop.style.display = "block";
        btnReport.style.display = "block";

        isRunning = true;
        canSendFrame = true;
        statusMessage.textContent = "Aponte para o QR...";

        requestAnimationFrame(tick);

    } catch (e) {
        statusMessage.textContent = "Erro ao acessar câmera";
        btnStart.style.display = "block";
    }
}


// === PARAR ===
function stopCamera() {
    isRunning = false;
    canSendFrame = false;

    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());

    video.style.display = "none";
    canvas.style.display = "none";

    btnStart.style.display = "block";
    btnStop.style.display = "none";
    btnReport.style.display = "none";

    statusMessage.textContent = "Leitura parada";
}


// === RELATÓRIO ===
function generateReport() {
    const content = [...scannedCodes].join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "relatorio_qr.txt";
    a.click();

    URL.revokeObjectURL(url);
}


// === LOOP ===
function tick() {
    if (!isRunning) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (lastCorners) drawCorners(lastCorners.corners, lastCorners.color);

    if (canSendFrame) {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        worker.postMessage(
            { buffer: img.data.buffer, width: canvas.width, height: canvas.height },
            [img.data.buffer]
        );
    }

    requestAnimationFrame(tick);
}


// === DESENHO DOS CANTOS ===
function drawCorners(c, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(c.topLeftCorner.x, c.topLeftCorner.y);
    ctx.lineTo(c.topRightCorner.x, c.topRightCorner.y);
    ctx.lineTo(c.bottomRightCorner.x, c.bottomRightCorner.y);
    ctx.lineTo(c.bottomLeftCorner.x, c.bottomLeftCorner.y);
    ctx.closePath();
    ctx.stroke();
}


// === WORKER ===
worker.onmessage = (evt) => {
    if (!evt.data) return;

    const { code, corners } = evt.data;

    if (scannedCodes.has(code)) {
        lastCorners = { corners, color: "#ff0033" };
        return;
    }

    scannedCodes.add(code);
    localStorage.setItem("scannedCodes", JSON.stringify([...scannedCodes]));
    updateCounter();

    lastCorners = { corners, color: "#00ff44" };

    canSendFrame = false;
    setTimeout(() => canSendFrame = true, 700);
};
