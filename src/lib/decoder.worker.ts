// decoder.worker.ts — decodificação fora da thread principal.
//
// ZXing lê QR e código de barras 1D (Code128) na mesma lib: a etiqueta do
// operador logístico traz os dois formatos. A lib é empacotada junto com o app
// (nada de CDN), porque o galpão pode estar sem internet.

import {
  BarcodeFormat, BinaryBitmap, DecodeHintType,
  HybridBinarizer, MultiFormatReader, RGBLuminanceSource
} from '@zxing/library';

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

const hints = new Map<DecodeHintType, unknown>();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.CODE_128
]);

const leitor = new MultiFormatReader();
leitor.setHints(hints);

/** RGBA -> luminância (1 byte por pixel), aproximação inteira de BT.601. */
function paraLuminancia(rgba: Uint8ClampedArray, largura: number, altura: number): Uint8ClampedArray {
  const total = largura * altura;
  const lum = new Uint8ClampedArray(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    // 77/256, 150/256 e 29/256 evitam três operações de ponto flutuante por
    // pixel. Num quadro 640p são centenas de milhares de operações poupadas.
    lum[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >>> 8;
  }
  return lum;
}

self.onmessage = (ev: MessageEvent<PedidoDecodificar>) => {
  const { buffer, w, h, seq } = ev.data;
  let resposta: RespostaDecodificar = { seq, texto: null };

  try {
    const lum = paraLuminancia(new Uint8ClampedArray(buffer), w, h);
    const fonte = new RGBLuminanceSource(lum, w, h);
    const bitmap = new BinaryBitmap(new HybridBinarizer(fonte));
    resposta = { seq, texto: leitor.decode(bitmap, hints).getText() };
  } catch {
    // NotFoundException é o caso comum (quadro sem código). Nunca travar o loop.
  } finally {
    leitor.reset();
  }

  (self as unknown as Worker).postMessage(resposta);
};
