// scanner.ts — câmera + leitura contínua, sem confirmação por leitura.
//
// Caminho rápido: BarcodeDetector nativo (Chrome/Android).
// Fallback obrigatório: ZXing no worker — o iOS Safari não tem BarcodeDetector.

import type { PedidoDecodificar, RespostaDecodificar } from './decoder.worker.js';

const LARGURA_SCAN = 640;         // largura enviada ao decodificador
const INTERVALO_MS = 80;          // até ~12 quadros por segundo
// O bloqueio longo limitava fisicamente a operação a ~1,4 caixa/s. A repetição
// da mesma etiqueta já tem uma trava própria de 1,5 s logo abaixo, então caixas
// diferentes podem seguir em ritmo maior sem transformar uma câmera parada em
// dezenas de duplicados.
const PAUSA_APOS_LEITURA = 180;
const IGNORAR_REPETICAO_MS = 1500;

// A etiqueta operacional tem QR e Code 128. Pedir ao motor que procure EAN,
// ITF, Data Matrix e Code 39 em todo quadro dobrava trabalho sem acrescentar
// nenhum código válido ao fluxo da conferência.
const FORMATOS_NATIVOS = ['qr_code', 'code_128'];

interface DetectorNativo {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface DetectorCtor {
  new (opcoes: { formats: string[] }): DetectorNativo;
  getSupportedFormats(): Promise<string[]>;
}

interface CapacidadesCamera extends MediaTrackCapabilities {
  focusMode?: string[];
}

interface RestricoesCamera extends MediaTrackConstraintSet {
  focusMode?: string;
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
  let workerOcupado = false;
  let podeEnviar = true;
  let ultimoEnvio = 0;
  let seq = 0;
  let ultimoCodigo = '';
  let ultimoCodigoEm = 0;
  let frameId = 0;
  let callbackDeVideo = false;
  let pausaId: number | undefined;

  async function prepararDetector(): Promise<boolean> {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor) return false;
    try {
      const suportados = await Ctor.getSupportedFormats();
      const formatos = FORMATOS_NATIVOS
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
      workerOcupado = false;
      if (ev.data.texto) entregar(ev.data.texto);
    };
    // Um erro de quadro não pode deixar o leitor bloqueado para sempre.
    worker.onerror = () => { workerOcupado = false; };
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

  /**
   * Usa o relógio da própria câmera quando existe. requestAnimationFrame pode
   * acordar a tela duas ou três vezes para o mesmo quadro em aparelhos de 60/
   * 120 Hz; o callback de vídeo só acorda quando chegou imagem nova.
   */
  function agendarPasso(): void {
    if (!rodando) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      callbackDeVideo = true;
      frameId = video.requestVideoFrameCallback(() => void passo());
      return;
    }
    callbackDeVideo = false;
    frameId = requestAnimationFrame(() => void passo());
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
      } else if (worker && offCtx && !workerOcupado) {
        const sw = Math.min(LARGURA_SCAN, video.videoWidth);
        const sh = Math.round((video.videoHeight * sw) / video.videoWidth);
        // Alterar width/height limpa e realoca o canvas. Só faça isso quando a
        // câmera realmente mudar de dimensão (inclusive depois de girar o
        // celular), não dez vezes por segundo.
        if (off.width !== sw) off.width = sw;
        if (off.height !== sh) off.height = sh;
        try {
          offCtx.drawImage(video, 0, 0, sw, sh);
          const img = offCtx.getImageData(0, 0, sw, sh);
          const msg: PedidoDecodificar = { buffer: img.data.buffer as ArrayBuffer, w: sw, h: sh, seq: ++seq };
          // ZXing pode levar mais de 100 ms num celular simples. Sem esta trava,
          // novos quadros se acumulam na fila do worker durante horas de
          // conferência, consumindo memória e devolvendo imagens antigas.
          workerOcupado = true;
          worker.postMessage(msg, [msg.buffer]);
        } catch {
          workerOcupado = false;
          // getImageData falha em alguns aparelhos; tenta no próximo quadro
        }
      }
    }

    agendarPasso();
  }

  async function ativarFocoContinuo(): Promise<void> {
    const trilha = stream?.getVideoTracks()[0];
    if (!trilha?.getCapabilities) return;
    const capacidades = trilha.getCapabilities() as CapacidadesCamera;
    if (!capacidades.focusMode?.includes('continuous')) return;
    try {
      await trilha.applyConstraints({
        advanced: [{ focusMode: 'continuous' } as RestricoesCamera]
      });
    } catch {
      // Alguns navegadores anunciam a capacidade, mas recusam a restrição.
    }
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
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 }
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
    await ativarFocoContinuo();
    try { await video.play(); } catch { /* autoplay pode reclamar; o loop segue */ }

    const nativo = await prepararDetector();
    if (!nativo) prepararWorker();

    rodando = true;
    podeEnviar = true;
    agendarPasso();
    return { ok: true, motor: nativo ? 'nativo' : 'zxing' };
  }

  function parar(): void {
    rodando = false;
    if (callbackDeVideo && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(frameId);
    }
    else cancelAnimationFrame(frameId);
    window.clearTimeout(pausaId);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    worker?.terminate();
    worker = null;
    workerOcupado = false;
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
