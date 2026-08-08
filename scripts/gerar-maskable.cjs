// Gera o ícone maskable: o Android corta o ícone na forma dele (círculo,
// squircle...) e só garante a área central de 80%. O tile arredondado atual
// perde os cantos nesse corte. Aqui a arte é achatada sobre branco, reduzida
// para caber na zona segura e colada sobre um fundo branco de sangria total.
const { PNG } = require('pngjs');
const fs = require('fs');

const LADO = 512;
const OCUPACAO = 0.76; // arte dentro da zona segura de 80%

const origem = PNG.sync.read(fs.readFileSync(process.argv[2]));

// 1. achata sobre branco (o tile tem sombra e cantos transparentes)
const plano = Buffer.alloc(origem.width * origem.height * 3);
for (let i = 0; i < origem.width * origem.height; i++) {
  const a = origem.data[i * 4 + 3] / 255;
  for (let c = 0; c < 3; c++) {
    plano[i * 3 + c] = Math.round(origem.data[i * 4 + c] * a + 255 * (1 - a));
  }
}

// 2. reduz por média de área (box filter): sem serrilhado nas bordas retas
const destino = Math.round(LADO * OCUPACAO);
const escala = origem.width / destino;
const arte = Buffer.alloc(destino * destino * 3);
for (let y = 0; y < destino; y++) {
  const y0 = Math.floor(y * escala);
  const y1 = Math.min(origem.height, Math.ceil((y + 1) * escala));
  for (let x = 0; x < destino; x++) {
    const x0 = Math.floor(x * escala);
    const x1 = Math.min(origem.width, Math.ceil((x + 1) * escala));
    const soma = [0, 0, 0];
    let n = 0;
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const i = (sy * origem.width + sx) * 3;
        soma[0] += plano[i]; soma[1] += plano[i + 1]; soma[2] += plano[i + 2];
        n++;
      }
    }
    const i = (y * destino + x) * 3;
    for (let c = 0; c < 3; c++) arte[i + c] = Math.round(soma[c] / n);
  }
}

// 3. cola centralizado num quadrado branco de 512
const saida = new PNG({ width: LADO, height: LADO });
saida.data.fill(255);
const off = Math.round((LADO - destino) / 2);
for (let y = 0; y < destino; y++) {
  for (let x = 0; x < destino; x++) {
    const de = (y * destino + x) * 3;
    const para = ((y + off) * LADO + (x + off)) * 4;
    saida.data[para] = arte[de];
    saida.data[para + 1] = arte[de + 1];
    saida.data[para + 2] = arte[de + 2];
    saida.data[para + 3] = 255;
  }
}

fs.writeFileSync(process.argv[3], PNG.sync.write(saida, { deflateLevel: 9 }));
console.log('gerado', process.argv[3]);
