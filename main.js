// ELEMENTOS
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusMessage = document.getElementById("status-message");
const counter = document.getElementById("counter");

const scannedCodes = new Set();
const worker = new Worker("worker.js");
let canSendFrame = true;

// Carregar sessão salva
const saved = JSON.parse(localStorage.getItem("scannedCodes") || "[]");
saved.forEach(c => scannedCodes.add(c));
updateCounter();

// Sons base64 (curtos)
const successSound = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA...");
const errorSound   = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEA...");

function updateCounter() {
  counter.textContent = scannedCodes.size;
}

function feedbackSuccess() {
  successSound.play().catch(() => {});
  canvas.classList.add("status-success");
  setTimeout(() => canvas.classList.remove("status-success"), 500);
}

function feedbackDuplicate() {
  errorSound.play().catch(() => {});
  canvas.classList.add("status-duplicate");
  setTimeout(() => canvas.classList.remove("status-duplicate"), 500);
}

function simulateBackendCall(code) {
  console.log("Enviando código →", code);
  return new Promise(res => setTimeout(res, 200));
}

// Iniciar câmera
async function startCamera() {

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 120 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    statusMessage.textContent = "Lendo QR...";
    requestAnimationFrame(tick);

  } catch (err) {
    statusMessage.textContent = "Erro ao acessar câmera";
    console.error(err);
  }
}

// Loop principal
function tick() {
  if (video.readyState >= 2) {

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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
  }

  requestAnimationFrame(tick);
}

worker.onmessage = async (evt) => {
  const code = evt.data;

  // Se não existe código, ignore (nada de contagem)
  if (!code) return;

  // Se já existe → duplicado
  if (scannedCodes.has(code)) {
    feedbackDuplicate();
    return;
  }

  // NOVO QR REAL
  scannedCodes.add(code);

  // Salva no navegador
  localStorage.setItem("scannedCodes", JSON.stringify([...scannedCodes]));

  updateCounter();
  feedbackSuccess();

  // Pausa para evitar múltiplas leituras sequenciais
  canSendFrame = false;
  setTimeout(() => (canSendFrame = true), 500);

  simulateBackendCall(code);
};


  // Novo QR
  scannedCodes.add(code);

  // Salvar persistente
  localStorage.setItem("scannedCodes", JSON.stringify([...scannedCodes]));

  updateCounter();
  feedbackSuccess();

  canSendFrame = false;
  setTimeout(() => (canSendFrame = true), 500);

  simulateBackendCall(code);
};

// Baixar relatório CSV
document.getElementById("download-report").onclick = () => {
  const arr = [...scannedCodes];
  if (arr.length === 0) return alert("Nenhum QR lido.");

  const csv = "data:text/csv;charset=utf-8,QRCode\n" + arr.join("\n");
  const link = document.createElement("a");
  link.href = encodeURI(csv);
  link.download = "relatorio_qrcodes.csv";
  link.click();
};

startCamera();
