// scanner.ts — câmera + leitura contínua, sem confirmação por leitura.
//
// Caminho rápido: BarcodeDetector nativo (Chrome/Android).
// Fallback obrigatório: ZXing no worker — o iOS Safari não tem BarcodeDetector.

import type { PedidoDecodificar, RespostaDecodificar } from './decoder.worker.js';

const LARGURA_SCAN = 640;         // largura enviada ao decodificador
const INTERVALO_MS = 100;         // ~10 quadros por segundo
const PAUSA_APOS_LEITURA = 700;   // evita ler a mesma caixa duas vezes por engano
const IGNORAR_REPETICAO_MS = 1500;

interface DetectorNativo {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface DetectorCtor {
  new (opcoes: { formats: string[] }): DetectorNativo;
  getSupportedFormats(): Promise<string[]>;
}

export interface OpcoesScanner {
  video: HTMLVideoElement;
  onCodigo: (texto: string) => void;
}

export interface Scanner {
  iniciar: () => Promise<{ ok: true; motor: 'nativo' | 'zxing' } | { ok: false; erro: string }>;
  parar: () => void;
  temTocha: () => boolean;
  alternarTocha: (ligar: boolean) => Promise<boolean>;
}

export function criarScanner({ video, onCodigo }: OpcoesScanner): Scanner {
  const off = document.createElement('canvas');
  const offCtx = off.getContext('2d', { willReadFrequently: true });

  let worker: Worker | null = null;
  let detector: DetectorNativo | null = null;
  let stream: MediaStream | null = null;
  let rodando = false;
  let podeEnviar = true;
  let ultimoEnvio = 0;
  let seq = 0;
  let ultimoCodigo = '';
  let ultimoCodigoEm = 0;
  let rafId = 0;
  let pausaId: number | undefined;

  async function prepararDetector(): Promise<boolean> {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) return false;
    try {
      const suportados = await Ctor.getSupportedFormats();
      const formatos = ['qr_code', 'code_128', 'code_39', 'ean_13', 'itf', 'data_matrix']
        .filter((f) => suportados.includes(f));
      if (!formatos.includes('qr_code')) return false;
      detector = new Ctor({ formats: formatos });
      return true;
    } catch {
      return false;
    }
  }

  function prepararWorker(): void {
    worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<RespostaDecodificar>) => {
      if (ev.data.texto) entregar(ev.data.texto);
    };
  }

  function entregar(texto: string): void {
    const t = Date.now();
    // Segurar a câmera parada sobre a mesma caixa não pode virar leitura repetida.
    if (texto === ultimoCodigo && t - ultimoCodigoEm < IGNORAR_REPETICAO_MS) return;
    ultimoCodigo = texto;
    ultimoCodigoEm = t;

    podeEnviar = false;
    window.clearTimeout(pausaId);
    pausaId = window.setTimeout(() => { podeEnviar = true; }, PAUSA_APOS_LEITURA);

    onCodigo(texto);
  }

  async function passo(): Promise<void> {
    if (!rodando) return;
    const t = Date.now();

    if (podeEnviar && t - ultimoEnvio >= INTERVALO_MS && video.readyState >= 2 && video.videoWidth) {
      ultimoEnvio = t;

      if (detector) {
        try {
          const achados = await detector.detect(video);
          if (rodando && achados.length && achados[0].rawValue) entregar(achados[0].rawValue);
        } catch {
          // quadro isolado pode falhar; segue para o próximo
        }
      } else if (worker && offCtx) {
        const sw = Math.min(LARGURA_SCAN, video.videoWidth);
        const sh = Math.round((video.videoHeight * sw) / video.videoWidth);
        off.width = sw;
        off.height = sh;
        try {
          offCtx.drawImage(video, 0, 0, sw, sh);
          const img = offCtx.getImageData(0, 0, sw, sh);
          const msg: PedidoDecodificar = { buffer: img.data.buffer as ArrayBuffer, w: sw, h: sh, seq: ++seq };
          worker.postMessage(msg, [msg.buffer]);
        } catch {
          // getImageData falha em alguns aparelhos; tenta no próximo quadro
        }
      }
    }

    rafId = requestAnimationFrame(() => void passo());
  }

  async function iniciar(): ReturnType<Scanner['iniciar']> {
    if (rodando) return { ok: true, motor: detector ? 'nativo' : 'zxing' };

    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, erro: 'Este navegador não abre a câmera. Acesse por HTTPS num navegador atualizado.' };
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (e) {
      const nome = (e as DOMException)?.name;
      if (nome === 'NotAllowedError') {
        return { ok: false, erro: 'Câmera bloqueada. Libere a câmera para este site e toque em tentar de novo.' };
      }
      return { ok: false, erro: 'Não foi possível abrir a câmera. Você pode digitar o código.' };
    }

    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    try { await video.play(); } catch { /* autoplay pode reclamar; o loop segue */ }

    const nativo = await prepararDetector();
    if (!nativo) prepararWorker();

    rodando = true;
    podeEnviar = true;
    rafId = requestAnimationFrame(() => void passo());
    return { ok: true, motor: nativo ? 'nativo' : 'zxing' };
  }

  function parar(): void {
    rodando = false;
    cancelAnimationFrame(rafId);
    window.clearTimeout(pausaId);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    worker?.terminate();
    worker = null;
    detector = null;
    video.srcObject = null;
  }

  const trilha = (): MediaStreamTrack | null => stream?.getVideoTracks()[0] ?? null;

  function temTocha(): boolean {
    const t = trilha();
    if (!t?.getCapabilities) return false;
    return 'torch' in t.getCapabilities();
  }

  async function alternarTocha(ligar: boolean): Promise<boolean> {
    const t = trilha();
    if (!t) return false;
    try {
      await t.applyConstraints({ advanced: [{ torch: ligar } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }

  return { iniciar, parar, temTocha, alternarTocha };
}
