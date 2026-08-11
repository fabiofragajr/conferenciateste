// Valida o mesmo motor do fallback de produção em QR e Code 128.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import {
  prepareZXingModule as prepararLeitor, readBarcodes
} from 'zxing-wasm/reader';
import {
  prepareZXingModule as prepararEscritor, writeBarcode
} from 'zxing-wasm/writer';

const CONTEUDO = 'EMB0008314147;FNOR 100;0001/0002;86945574';
const opcoes = {
  formats: ['QRCode', 'Code128'],
  maxNumberOfSymbols: 1,
  tryHarder: false,
  tryRotate: true,
  tryInvert: false,
  tryDownscale: false
};

const binario = (modulo) => readFileSync(fileURLToPath(import.meta.resolve(modulo)));

await Promise.all([
  prepararLeitor({
    overrides: { wasmBinary: binario('zxing-wasm/reader/zxing_reader.wasm') },
    fireImmediately: true
  }),
  prepararEscritor({
    overrides: { wasmBinary: binario('zxing-wasm/writer/zxing_writer.wasm') },
    fireImmediately: true
  })
]);

const lerPng = async (bytes) => {
  const png = PNG.sync.read(Buffer.from(bytes));
  return readBarcodes({
    data: new Uint8ClampedArray(png.data), width: png.width, height: png.height
  }, opcoes);
};

const qr = await QRCode.toBuffer(CONTEUDO, { width: 480, margin: 3 });
const qrLido = await lerPng(qr);
if (qrLido[0]?.text !== CONTEUDO || qrLido[0]?.format !== 'QRCode') {
  throw new Error('Fallback WASM não leu o QR da etiqueta.');
}

const code128 = await writeBarcode(CONTEUDO, {
  format: 'Code128', scale: 2, addQuietZones: true
});
if (!code128.image) throw new Error('Não foi possível gerar o Code 128 de teste.');
const barrasLidas = await lerPng(new Uint8Array(await code128.image.arrayBuffer()));
if (barrasLidas[0]?.text !== CONTEUDO || barrasLidas[0]?.format !== 'Code128') {
  throw new Error('Fallback WASM não leu o Code 128 da etiqueta.');
}

console.log('DECODE_WASM_OK - QR Code e Code 128');
