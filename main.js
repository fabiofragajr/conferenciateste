const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const statusMessage = document.getElementById("status-message");
const counter = document.getElementById("counter");

// Botões
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnReport = document.getElementById("btn-report");

const scannedCodes = new Set();
const worker = new Worker("worker.js");

let animationLoop = null;
let isRunning = false;
let canSendFrame = false;
let lastCorners = null;

// Carregar histórico
const saved = JSON.parse(localStorage.getItem("scannedCodes") || "[]");
saved.forEach(c => scannedCodes.add(c));
updateCounter();

function updateCounter() {
    counter.textContent = scannedCodes.size;
}

// Base64 beeps
const beepOK = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA...");
const beepError = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA...");

// ========= INICIAR CÂMERA =========
btnStart.onclick = () => startCamera();
btnStop.onclick = () => stopCamera();
btnReport.onclick = () => downloadReport();

async function startCamera() {
    statusMessage.textContent = "Abrindo câmera...";
    btnStart.style.display = "none";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        video.srcObject = stream;

        video.style.display = "block";
        canvas.style.display = "block";

        await video.play();

        btnStop.style.display = "block";
        btnReport.style.display = "block";

        canSendFrame = true;
        isRunning = true;

        statusMessage.textContent = "Aponte para o QR...";
        tick();

    } catch (err) {
        statusMessage.textContent = "Erro ao acessar câmera. Tente novamente.";
        btnStart.style.display = "block";
        console.error(err);
    }
}

// ========= PARAR A LEITURA =========
function stopCamera() {
    isRunning = false;
    canSendFrame = false;

    const stream = video.srcObject;
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
    }

    video.style.display = "none";
    canvas.style.display = "none";

    btnStart.style.display = "block";
    btnStop.style.display = "none";

    statusMessage.textContent = "Leitura parada";
}

// ========= GERAR RELATÓRIO =========
function downloadReport() {
    const list = [...scannedCodes].join("\n");

    const blob = new Blob([list], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "relatorio_qr.txt";
    a.click();

    URL.revokeObjectURL(url);
}

// ========= DESENHAR CONTORNO =========
function drawCorners(corners, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(corners.topLeftCorner.x, corners.topLeftCorner.y);
    ctx.lineTo(corners.topRightCorner.x, corners.topRightCorner.y);
    ctx.lineTo(corners.bottomRightCorner.x, corners.bottomRightCorner.y);
    ctx.lineTo(corners.bottomLeftCorner.x, corners.bottomLeftCorner.y);
    ctx.closePath();
    ctx.stroke();
}

// ========= FEEDBACK =========
function feedbackOK(c) {
    beepOK.play().catch(() => {});
    drawCorners(c, "#00ff44");
}

function feedbackDuplicate(c) {
    beepError.play().catch(() => {});
    drawCorners(c, "#ff0033");
}

// ========= LOOP =========
function tick() {
    if (!isRunning) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (lastCorners)
        drawCorners(lastCorners.corners, lastCorners.color);

    if (canSendFrame) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        worker.postMessage(
            {
                buffer: imgData.data.buffer,
                width: canvas.width,
                height: canvas.height
            },
            [imgData.data.buffer]
        );
    }

    animationLoop = requestAnimationFrame(tick);
}

// ========= WORKER RESPONDE =========
worker.onmessage = (evt) => {
    const { code, corners } = evt.data || {};
    if (!code) return;

    if (scannedCodes.has(code)) {
        lastCorners = { corners, color: "#ff0033" };
        feedbackDuplicate(corners);
        return;
    }

    scannedCodes.add(code);
    localStorage.setItem("scannedCodes", JSON.stringify([...scannedCodes]));
    updateCounter();

    lastCorners = { corners, color: "#00ff44" };
    feedbackOK(corners);

    canSendFrame = false;
    setTimeout(() => (canSendFrame = true), 700);
};
