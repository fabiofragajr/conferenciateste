// Prova que o worker e o binário WASM reais do build carregam pelo cache do
// PWA e decodificam sem nenhuma conexão. O teste unitário cobre os formatos;
// este cobre empacotamento, URL do asset, service worker e execução no browser.
import { readdirSync } from 'node:fs';
import QRCode from 'qrcode';
import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';

const CONTEUDO = 'EMB0008314147;FNOR 100;0001/0002;86945574';
const worker = readdirSync(new URL('../dist/assets/', import.meta.url))
  .find((nome) => /^decoder\.worker-.*\.js$/.test(nome));
if (!worker) throw new Error('Worker de decodificação ausente no build.');

const qrDataUrl = `data:image/png;base64,${(
  await QRCode.toBuffer(CONTEUDO, { width: 480, margin: 3 })
).toString('base64')}`;

const servidor = await subirServidor();
const navegador = await chromium.launch(opcoesNavegador);
const contexto = await navegador.newContext();
const pagina = await contexto.newPage();

try {
  await pagina.goto(servidor.base);
  await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  await contexto.setOffline(true);

  const texto = await pagina.evaluate(async ({ workerUrl, imagemUrl }) => {
    const imagem = new Image();
    imagem.src = imagemUrl;
    await imagem.decode();
    const canvas = document.createElement('canvas');
    canvas.width = imagem.naturalWidth;
    canvas.height = imagem.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível.');
    ctx.drawImage(imagem, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);

    return new Promise((resolve, rejeitar) => {
      const leitor = new Worker(workerUrl, { type: 'module' });
      const limite = setTimeout(() => {
        leitor.terminate();
        rejeitar(new Error('Worker WASM não respondeu offline.'));
      }, 10_000);
      leitor.onerror = (evento) => {
        clearTimeout(limite);
        leitor.terminate();
        rejeitar(new Error(evento.message));
      };
      leitor.onmessage = (evento) => {
        clearTimeout(limite);
        leitor.terminate();
        resolve(evento.data.texto);
      };
      leitor.postMessage({
        buffer: pixels.data.buffer, w: pixels.width, h: pixels.height, seq: 1
      }, [pixels.data.buffer]);
    });
  }, {
    workerUrl: `${servidor.base}/assets/${worker}`,
    imagemUrl: qrDataUrl
  });

  if (texto !== CONTEUDO) throw new Error(`Leitura offline incorreta: ${texto ?? 'vazia'}`);
  console.log('DECODE_BROWSER_OK - worker WASM carregou do cache offline');
} finally {
  await navegador.close();
  servidor.parar();
}
