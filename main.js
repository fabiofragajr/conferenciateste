// main.js — overlay flash, downscale, throttle, persistência, relatório

// DOM
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const status = document.getElementById("status-message");
const counterEl = document.getElementById("counter");
const overlay = document.getElementById("flash-overlay");

const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnReport = document.getElementById("btn-report");

// Worker
const worker = new Worker("worker.js");

// Performance settings
const SCAN_WIDTH = 640;       // largura enviada ao worker
const THROTTLE_MS = 100;      // 100ms => ~10 FPS
const PAUSE_AFTER_READ = 700; // ms

// Offscreen canvas to downscale before sending
const off = document.createElement("canvas");
const offCtx = off.getContext("2d");

// State
let scanning = false;
let allowSend = false;
let lastSent = 0;
const scanned = new Set(JSON.parse(localStorage.getItem("scannedCodes") || "[]"));
counterEl.textContent = scanned.size;

// Audio (WebAudio + fallback)
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {
      audioCtx = null;
    }
  }
}

// simple beep via WebAudio (guaranteed after user gesture)
function playBeep(freq=880, duration=0.12) {
  ensureAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(()=>{});
  }
  if (audioCtx) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    g.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    o.start(now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    o.stop(now + duration + 0.02);
    return;
  }
  // fallback silent (could use data URI Audio but user gesture needed)
}

// visual flash overlay: 'new' => green, 'dup' => red
function flashOverlay(kind) {
  if (!overlay) return;
  if (kind === 'new') {
    overlay.style.backgroundColor = "rgba(0,255,120,0.28)";
    overlay.style.opacity = "1";
    playBeep(1000, 0.10);
  } else if (kind === 'dup') {
    overlay.style.backgroundColor = "rgba(255,50,80,0.28)";
    overlay.style.opacity = "1";
    playBeep(220, 0.14);
  }
  // fade out
  setTimeout(()=> {
    overlay.style.opacity = "0";
    // keep backgroundColor to allow quick next flash; it doesn't hurt
  }, 180);
}

// add new code to Set and persist
function storeCode(code) {
  scanned.add(code);
  localStorage.setItem("scannedCodes", JSON.stringify([...scanned]));
  counterEl.textContent = scanned.size;
}

// generate plain text report
function downloadReport() {
  const arr = [...scanned];
  if (arr.length === 0) {
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

// START camera (user gesture) — unlocks audioCtx
async function startCamera() {
  playBeep(880, 0.04); // small unlock gesture beep
  btnStart.style.display = "none";
  btnStop.style.display = "inline-block";
  btnReport.style.display = "inline-block";
  status.textContent = "Abrindo câmera...";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    // set canvas sizes
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    scanning = true;
    allowSend = true;
    requestAnimationFrame(loop);
    status.textContent = "Aponte para o QR";

  } catch (e) {
    console.error(e);
    status.textContent = "Erro ao acessar câmera";
    btnStart.style.display = "inline-block";
  }
}

// STOP camera
function stopCamera() {
  scanning = false;
  allowSend = false;
  const s = video.srcObject;
  if (s) s.getTracks().forEach(t => t.stop());
  btnStart.style.display = "inline-block";
  btnStop.style.display = "none";
  btnReport.style.display = "none";
  status.textContent = "Leitura parada";
}

// main loop: draw preview and throttle sends (downscale)
function loop() {
  if (!scanning) return;

  // draw preview to visible canvas
  if (video.videoWidth && video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  const now = Date.now();
  if (allowSend && (now - lastSent) >= THROTTLE_MS && video.readyState >= 2) {
    lastSent = now;

    // compute scale preserving aspect ratio
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const sw = Math.min(SCAN_WIDTH, vw);
    const sh = Math.round((vh * sw) / vw);

    off.width = sw;
    off.height = sh;
    try {
      offCtx.drawImage(video, 0, 0, sw, sh);
      const img = offCtx.getImageData(0, 0, sw, sh);
      // send transferable buffer
      worker.postMessage({ buffer: img.data.buffer, w: sw, h: sh }, [img.data.buffer]);
    } catch (err) {
      // getImageData might throw on some devices; ignore and try next frame
      console.warn("getImageData error", err);
    }
  }

  requestAnimationFrame(loop);
}

// worker returns { code } or null
worker.onmessage = (ev) => {
  const payload = ev.data;
  if (!payload || !payload.code) return;

  const code = String(payload.code);

  // duplicate?
  if (scanned.has(code)) {
    flashOverlay('dup');
    status.textContent = 'QR repetido';
    return;
  }

  // new code
  storeCode(code);
  flashOverlay('new');
  status.textContent = 'Lido com sucesso';

  // pause sends briefly to avoid multiple reads of same target
  allowSend = false;
  setTimeout(()=> allowSend = true, PAUSE_AFTER_READ);
};

// buttons
btnStart.addEventListener('click', () => {
  ensureAudio();
  startCamera();
});
btnStop.addEventListener('click', stopCamera);
btnReport.addEventListener('click', downloadReport);

// expose for debugging
window._quickscan = { scanned, stopCamera, startCamera };
