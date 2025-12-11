const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const statusMessage = document.getElementById("status-message");
const counterEl = document.getElementById("counter");

const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnReport = document.getElementById("btn-report");

const worker = new Worker("worker.js");

let running = false;
let allowFrame = false;

const scannedCodes = new Set();

// carrega histórico
const saved = JSON.parse(localStorage.getItem("qrHistory") || "[]");
saved.forEach(code => scannedCodes.add(code));
counterEl.textContent = scannedCodes.size;

// ================= START CAMERA =================
btnStart.onclick = async () => {
    btnStart.style.display = "none";
    btnStop.style.display = "block";
    btnReport.style.display = "block";

    statusMessage.textContent = "Abrindo câmera...";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });

        video.srcObject = stream;
        await video.play();

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        running = true;
        allowFrame = true;

        statusMessage.textContent = "Aponte para o QR";

        requestAnimationFrame(loop);

    } catch (e) {
        statusMessage.textContent = "Erro ao acessar câmera";
        btnStart.style.display = "block";
    }
};

// ================= STOP CAMERA =================
btnStop.onclick = () => {
    running = false;
    allowFrame = false;

    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());

    statusMessage.textContent = "Leitura parada";
    btnStart.style.display = "block";
    btnStop.style.display = "none";
    btnReport.style.display = "none";
};

// ================= REPORT =================
btnReport.onclick = () => {
    const txt = [...scannedCodes].join("\n");
    const blob = new Blob([txt], { type: "text/plain" });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "relatorio_qr.txt";
    a.click();
};

// ================= LOOP ULTRA-RÁPIDO =================
function loop() {
    if (!running) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (allowFrame) {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        worker.postMessage(
            { buffer: img.data.buffer, width: canvas.width, height: canvas.height },
            [img.data.buffer]
        );
    }

    requestAnimationFrame(loop);
}

// ================= WORKER =================
worker.onmessage = evt => {
    if (!evt.data) return;

    const { code } = evt.data;

    if (scannedCodes.has(code)) {
        statusMessage.textContent = "QR repetido";
        statusMessage.style.color = "#ff4444";
        return;
    }

    scannedCodes.add(code);
    localStorage.setItem("qrHistory", JSON.stringify([...scannedCodes]));

    counterEl.textContent = scannedCodes.size;
    statusMessage.textContent = "Lido!";
    statusMessage.style.color = "#00ff77";

    allowFrame = false;
    setTimeout(() => allowFrame = true, 500);
};
