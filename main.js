let video = document.getElementById("video");
let canvas = document.getElementById("canvas");
let ctx = canvas.getContext("2d");

let statusMsg = document.getElementById("status-message");
let counter = document.getElementById("counter");

let btnStart = document.getElementById("btn-start");
let btnStop = document.getElementById("btn-stop");
let btnReport = document.getElementById("btn-report");

let scanning = false;
let scannedCodes = new Set(JSON.parse(localStorage.getItem("scannedCodes") || "[]"));
let worker = new Worker("worker.js");

counter.textContent = scannedCodes.size;

// Sons em Base64 (super leves)
const beepSuccess = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZF...");
const beepError   = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZF...");

function updateCounter() {
  counter.textContent = scannedCodes.size;
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    scanning = true;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    statusMsg.textContent = "Lendo...";
    tick();

  } catch (err) {
    statusMsg.textContent = "Erro ao abrir câmera.";
  }
}

function stopCamera() {
  scanning = false;
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
  }
  statusMsg.textContent = "Parado.";
}

function tick() {
  if (!scanning) return;

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  worker.postMessage(
    { buffer: frame.data.buffer, w: canvas.width, h: canvas.height },
    [frame.data.buffer]
  );

  requestAnimationFrame(tick);
}

worker.onmessage = function(evt) {
  const code = evt.data;

  if (!code) return;

  // DUPLICADO
  if (scannedCodes.has(code)) {
    flashError();
    return;
  }

  // NOVO QR
  scannedCodes.add(code);
  localStorage.setItem("scannedCodes", JSON.stringify([...scannedCodes]));

  flashSuccess();
  updateCounter();
};

function flashSuccess() {
  canvas.classList.add("success");
  beepSuccess.play().catch(()=>{});
  setTimeout(() => canvas.classList.remove("success"), 150);
}

function flashError() {
  canvas.classList.add("error");
  beepError.play().catch(()=>{});
  setTimeout(() => canvas.classList.remove("error"), 150);
}

/* BOTÕES */
btnStart.onclick = startCamera;
btnStop.onclick = stopCamera;
btnReport.onclick = downloadReport;

function downloadReport() {
  const arr = [...scannedCodes];
  if (!arr.length) {
    alert("Nenhum código lido.");
    return;
  }

  const blob = new Blob([arr.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "relatorio_qr.txt";
  a.click();

  URL.revokeObjectURL(url);
}
