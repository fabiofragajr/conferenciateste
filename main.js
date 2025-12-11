// main.js (module)
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const statusMessage = document.getElementById('status-message');
const counterEl = document.getElementById('counter');

const ctx = canvas.getContext('2d', { willReadFrequently: true });

// Estado
const scannedCodes = new Set();
let pausedUntil = 0; // timestamp until frames are paused (ms)
let worker;
let rafId = null;
let stream = null;

// --- Base64 audio (embutido) ---
// Nota: incluí strings base64 como solicitado. Também uso WebAudio para gerar tons
// caso o navegador não reproduza data URIs.
const successBase64 = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
const errorBase64   = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

// WebAudio para garantia de feedback sonoro
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSuccessTone() {
  // curto, agudo
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.value = 1000;
  g.gain.value = 0.0001;
  o.connect(g);
  g.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
  o.start(now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  o.stop(now + 0.2);
}

function playErrorTone() {
  // buzz curto
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.value = 120;
  g.gain.value = 0.0001;
  o.connect(g);
  g.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
  o.start(now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  o.stop(now + 0.26);
}

// Fallback para tocar via Data URI (se desejar)
function playDataUri(uri){
  const a = new Audio(uri);
  a.play().catch(()=>{/* ignore */});
}

// updateCounter
function updateCounter(){
  counterEl.textContent = String(scannedCodes.size);
}

// visual feedback helper
function flashStatus(type, text){
  statusMessage.textContent = text || '';
  if(type === 'success'){
    statusMessage.classList.remove('status-duplicate');
    statusMessage.classList.add('status-success');
    // play success
    try { playSuccessTone(); } catch(e){ playDataUri(successBase64); }
  } else if(type === 'duplicate'){
    statusMessage.classList.remove('status-success');
    statusMessage.classList.add('status-duplicate');
    try { playErrorTone(); } catch(e){ playDataUri(errorBase64); }
  } else {
    statusMessage.classList.remove('status-success','status-duplicate');
  }
  // clear after 500ms
  setTimeout(()=> {
    statusMessage.classList.remove('status-success','status-duplicate');
    statusMessage.textContent = 'Pronto';
  }, 500);
}

// Simula chamada ao backend
function simulateBackendCall(code){
  console.log('[simulateBackendCall] enviando...', code);
  // simulando fetch POST assíncrono (não necessário pra demo)
  // fetch('/api/scan', { method:'POST', body: JSON.stringify({code}) })
  //   .then(()=>console.log('sent'))
  //   .catch(()=>console.log('failed'));
}

// Init worker
function initWorker(){
  if(window.Worker){
    worker = new Worker('worker.js');
    worker.onmessage = (ev) => {
      const payload = ev.data;
      // payload: { text: string|null }
      if(!payload) return;
      if(payload.text){
        handleDecodedText(payload.text);
      }
    };
  } else {
    statusMessage.textContent = 'Seu navegador não suporta Web Workers.';
  }
}

// Handle decoded QR result from worker
function handleDecodedText(text){
  if(!text) return;
  const now = Date.now();
  // Duplicate?
  if(scannedCodes.has(text)){
    flashStatus('duplicate', 'Duplicado');
    // no pause for duplicates
    return;
  }
  // New code
  scannedCodes.add(text);
  updateCounter();
  flashStatus('success', 'Lido com sucesso');
  simulateBackendCall(text);

  // Debounce: pausa envio de frames por 500ms
  pausedUntil = now + 500;
}

// Resize canvas to match display size (device pixels)
function resizeCanvas(){
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if(canvas.width !== Math.floor(w * ratio) || canvas.height !== Math.floor(h * ratio)){
    canvas.width = Math.floor(w * ratio);
    canvas.height = Math.floor(h * ratio);
    // scale context so drawImage works with CSS pixels
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

// Tick loop: captura frame, envia para worker (como Transferable ArrayBuffer)
function tick(){
  rafId = requestAnimationFrame(tick);

  // Se pausado por debounce, não enviar frames ao worker
  if(Date.now() < pausedUntil) return;

  if(video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

  resizeCanvas();

  // Desenhar vídeo espelhado no canvas (compensa transform)
  ctx.save();
  // já aplicamos transform para dpi, e o canvas é mirror via CSS; desenhar normalmente
  ctx.drawImage(video, 0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.restore();

  try {
    const imgData = ctx.getImageData(0, 0, canvas.clientWidth, canvas.clientHeight);
    // enviar buffer (Transferable) para worker
    // IMPORTANT: pass the underlying ArrayBuffer to avoid copy
    worker.postMessage({
      buffer: imgData.data.buffer,
      width: imgData.width,
      height: imgData.height
    }, [imgData.data.buffer]); // transfer ownership

    // After transferring, imgData.data.buffer is neutered — recreate a new ImageData
    // (Not necessary here because we immediately discard imgData)
  } catch (err) {
    // leitura pode falhar em alguns casos por CORS ou segurança
    console.warn('Erro ao obter ImageData:', err);
  }
}

// Start camera
async function startCamera(){
  try {
    const constraints = {
      audio: false,
      video: {
        facingMode: { exact: "environment" }, // solicitar câmera traseira estrita
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch(err){
    // Se exact falhar (alguns browsers/ambientes), tentar fallback sem exact
    console.warn('facingMode exact failed, tentando fallback', err);
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width:{ideal:1280}, height:{ideal:720} },
        audio: false
      });
    } catch(e){
      statusMessage.textContent = 'Erro ao acessar câmera: ' + (e.message || e.name);
      throw e;
    }
  }

  video.srcObject = stream;
  await video.play();

  // Ajustar canvas CSS para preencher viewport
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  statusMessage.textContent = 'Câmera ativa — apontar para QR';
}

// Stop camera (not used by default)
function stopCamera(){
  if(stream){
    for(const t of stream.getTracks()){
      t.stop();
    }
  }
  if(rafId) cancelAnimationFrame(rafId);
  if(worker) worker.terminate();
}

// Start app
async function start(){
  statusMessage.textContent = 'Iniciando QuickScan...';
  initWorker();
  try {
    await startCamera();
    // permitir que user gesture desbloqueie audio context
    document.addEventListener('click', ()=> {
      if(audioCtx.state === 'suspended') audioCtx.resume();
    }, { once:true });

    // inicial counter
    updateCounter();
    // iniciar loop
    tick();
    statusMessage.textContent = 'Pronto';
  } catch(err){
    console.error(err);
  }
}

// Inicializar
start();

// limpeza ao sair
window.addEventListener('pagehide', ()=> {
  stopCamera();
});
