// -------- CONFIG GERAL --------
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusMessage = document.getElementById("status-message");
const counter = document.getElementById("counter");

// Contador e Set para evitar duplicados
const scannedCodes = new Set();

// Worker
const worker = new Worker("worker.js");

// Controle de envio para o worker
let canSendFrame = true;

// Sons base64
const successSound = new Audio("data:audio/mp3;base64,//uQx...");
const errorSound   = new Audio("data:audio/mp3;base64,//uQx...");


// -------- FUNÇÃO: Atualiza contador --------
function updateCounter() {
  counter.textContent = scannedCodes.size;
}


// -------- FEEDBACK VISUAL / SONORO --------
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


// -------- SIMULA CHAMADA DE API (FAKE) --------
function simulateBackendCall(code) {
  console.log("Enviando código →", code);
  return new Promise(res => setTimeout(res, 200));
}


// -------- INICIA CÂMERA EM MODO TURBO --------
async function startCamera() {
  statusMessage.textContent = "Iniciando câmera...";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, max: 120 },
        focusMode: "continuous"
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    statusMessage.textContent = "Lendo QR...";

    requestAnimationFrame(tick);

  } catch (err) {
    statusMessage.textContent = "Erro ao acessar câmera.";
    console.error(err);
  }
}


// -------- LOOP ULTRA-RÁPIDO --------
function tick() {
  if (video.readyState >= 2) {

    // Ajusta canvas para video em tempo real
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Desenha frame bruto
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Envia para worker
    if (canSendFrame) {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      worker.postMessage(
        {
          buffer: imgData.data.buffer,
          width: canvas.width,
          height: canvas.height
        },
        [imgData.data.buffer]  // Transferable Object (sem cópia)
      );
    }
  }

  requestAnimationFrame(tick);
}


// -------- RECEBENDO RESULTADO DO WORKER --------
worker.onmessage = async (evt) => {
  const code = evt.data;

  if (!code) return;

  // Duplicado?
  if (scannedCodes.has(code)) {
    feedbackDuplicate();
    return;
  }

  // Novo código!
  scannedCodes.add(code);
  updateCounter();
  feedbackSuccess();

  // Pausa 500ms (tempo do motorista virar caixa)
  canSendFrame = false;
  setTimeout(() => (canSendFrame = true), 500);

  simulateBackendCall(code);
};


// -------- INICIAR --------
startCamera();
