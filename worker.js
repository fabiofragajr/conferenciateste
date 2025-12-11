// worker.js — roda em background thread
// importa jsQR (CDN)
importScripts('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');

// worker recebe mensagens com { buffer: ArrayBuffer, width, height }
self.onmessage = function(ev){
  const data = ev.data;
  if(!data || !data.buffer) {
    self.postMessage({ text: null });
    return;
  }

  // Reconstruir Uint8ClampedArray a partir do buffer
  // jsQR espera um Uint8ClampedArray (rgba values)
  try {
    const u8 = new Uint8ClampedArray(data.buffer);
    const width = data.width;
    const height = data.height;

    // jsQR expects grayscale & rgb values in a Uint8ClampedArray (RGBA)
    // Aqui passamos diretamente (u8) — jsQR extrai luminance.
    const code = jsQR(u8, width, height);

    if(code && code.data){
      // devolve texto decodificado
      self.postMessage({ text: code.data });
    } else {
      self.postMessage({ text: null });
    }
  } catch (err){
    // Em caso de erro, garantir resposta
    self.postMessage({ text: null });
  }
};
