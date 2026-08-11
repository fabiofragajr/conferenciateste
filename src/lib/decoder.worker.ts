// decoder.worker.ts — decodificação fora da thread principal.
//
// O fallback usa o ZXing-C++ compilado para WebAssembly: lê QR e Code 128 sem
// ocupar a interface e sem depender de rede. O binário é emitido pelo Vite e
// entra no precache do PWA junto com este worker.

import {
  prepareZXingModule, readBarcodes, type ReaderOptions
} from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export interface PedidoDecodificar {
  buffer: ArrayBuffer;
  w: number;
  h: number;
  seq: number;
}

export interface RespostaDecodificar {
  seq: number;
  texto: string | null;
}

const OPCOES_RAPIDAS: ReaderOptions = {
  formats: ['QRCode', 'Code128'],
  maxNumberOfSymbols: 1,
  tryHarder: false,
  tryRotate: true,
  tryInvert: false,
  // O quadro já chega reduzido para 640 px; uma segunda redução só apagaria
  // módulos pequenos do QR e barras finas do Code 128.
  tryDownscale: false
};

const OPCOES_DIFICEIS: ReaderOptions = {
  ...OPCOES_RAPIDAS,
  tryHarder: true
};

// Começa a compilar o WASM assim que o worker nasce, antes do primeiro quadro.
// locateFile local é obrigatório: o padrão da biblioteca aponta para CDN, o
// que quebraria justamente no galpão sem sinal.
const moduloPronto = prepareZXingModule({
  overrides: {
    locateFile: (arquivo: string, prefixo: string) => arquivo.endsWith('.wasm') ? wasmUrl : prefixo + arquivo
  },
  fireImmediately: true
});

self.onmessage = async (ev: MessageEvent<PedidoDecodificar>) => {
  const { buffer, w, h, seq } = ev.data;
  let resposta: RespostaDecodificar = { seq, texto: null };

  try {
    await moduloPronto;
    const imagem = new ImageData(new Uint8ClampedArray(buffer), w, h);
    // Quatro quadros rápidos para cada busca mais profunda. Assim etiquetas
    // nítidas respondem logo e, algumas vezes por segundo, o motor aumenta a
    // procura para recuperar código pequeno, inclinado ou com foco ruim.
    const opcoes = seq % 5 === 0 ? OPCOES_DIFICEIS : OPCOES_RAPIDAS;
    const achados = await readBarcodes(imagem, opcoes);
    resposta = { seq, texto: achados[0]?.text || null };
  } catch {
    // Quadro sem código e falha isolada nunca derrubam o fluxo da câmera.
  }

  self.postMessage(resposta);
};
