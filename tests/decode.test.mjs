// Valida o caminho de decodificação do worker: PNG -> luminância -> ZXing.
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { createRequire } from 'node:module';

// O build UMD é o único que o Node importa direto (o ESM da lib usa import de
// diretório). No navegador o Vite empacota o ESM normalmente.
const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const {
  BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer,
  MultiFormatReader, RGBLuminanceSource
} = require('@zxing/library/umd/index.min.js');

const CONTEUDO = 'EMB0008314147;FNOR 100;0001/0002;86945574';
const buf = await QRCode.toBuffer(CONTEUDO, { width: 480, margin: 3 });
const png = PNG.sync.read(buf);

const total = png.width * png.height;
const lum = new Uint8ClampedArray(total);
for (let i = 0, p = 0; i < total; i++, p += 4) {
  lum[i] = (png.data[p] * 0.299 + png.data[p + 1] * 0.587 + png.data[p + 2] * 0.114) | 0;
}

const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]);
const leitor = new MultiFormatReader();
leitor.setHints(hints);

const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, png.width, png.height)));
const texto = leitor.decode(bitmap, hints).getText();

console.log('lido:', texto);
if (texto !== CONTEUDO) { console.error('FALHOU'); process.exit(1); }
console.log('DECODE_OK');
