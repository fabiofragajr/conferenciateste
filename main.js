const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const statusMessage = document.getElementById("status-message");
const counter = document.getElementById("counter");
const btnStart = document.getElementById("start-scan");

const scannedCodes = new Set();
const worker = new Worker("worker.js");

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

// Start camera button
btnStart.onclick = () => startCamera();

async function startCamera() {
    btnStart.style.display = "none";
    statusMessage.textContent = "Abrindo câmera...";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });

        video.srcObject = stream;
        await video.play();

        canSendFrame = true;
        statusMessage.textContent = "Aponte para o QR...";
        requestAnimationFrame(tick);

    } catch (err) {
        statusMessage.textContent = "Erro ao acessar câmera";
        console.error(err);
    }
}

// ===== DESENHAR CONTORNO =====
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

function feedbackOK(c) {
    beepOK.play().catch(() => {});
    drawCorners(c, "#00ff44");
}

function feedbackDuplicate(c) {
    beepError.play().catch(() => {});
    drawCorners(c, "#ff0033");
}

// ===== LOOP =====
function tick() {
    if (video.readyState >= 2) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (lastCorners) drawCorners(lastCorners.corners, lastCorners.color);

        if (canSendFrame) {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            worker.postMessage({
                buffer: imgData.data.buffer,
                width: canvas.width,
                height: canvas.height
            }, [imgData.data.buffer]);
        }
    }

    requestAnimationFrame(tick);
}

// ===== RESPOSTA DO WORKER =====
worker.onmessage = (evt) => {
    const { code, corners } = evt.data || {};

    if (!code) return;

    // Já lido
    if (scannedCodes.has(code)) {
        lastCorners = { corners, color: "#ff0033" };
        feedbackDuplicate(corners);
        return;
    }

    // Novo QR
    scannedCodes.add(code);
    localStorage.setItem("scannedCodes", JSON.stringify([...scannedCodes]));
    updateCounter();

    lastCorners = { corners, color: "#00ff44" };
    feedbackOK(corners);

    canSendFrame = false;
    setTimeout(() => (canSendFrame = true), 500);
};
