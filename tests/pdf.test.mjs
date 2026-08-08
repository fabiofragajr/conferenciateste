// pdf.test.mjs — o PDF é o entregável do sistema e roda inteiro no navegador
// (jsPDF sob demanda, logo lido de fetch, foto vinda do IndexedDB). Nada disso
// aparece no typecheck: só executando dá para saber que o arquivo sai.
//
// Verifica os dois caminhos de exportação: o da sessão (operador) e o do
// período (diretor). O teto de tamanho existe porque já houve regressão de
// 200 KB por embutir o símbolo em resolução de tela.
import { chromium } from 'playwright';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subirServidor, opcoesNavegador } from './servidor.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const erros = [];
const navegador = await chromium.launch(opcoesNavegador);

const MIN_BYTES = 3_000;    // menos que isso é PDF vazio
const MAX_BYTES = 120_000;  // mais que isso é imagem entrando sem redução

async function baixar(pagina, acao, rotulo) {
  const [dl] = await Promise.all([
    pagina.waitForEvent('download', { timeout: 20000 }),
    acao()
  ]);
  const caminho = join(tmpdir(), `logdis-pdf-${rotulo}.pdf`);
  await dl.saveAs(caminho);
  const { size } = await stat(caminho);
  const kb = (size / 1024).toFixed(1);
  if (size < MIN_BYTES) throw new Error(`PDF ${rotulo} veio vazio (${kb} KB)`);
  if (size > MAX_BYTES) throw new Error(`PDF ${rotulo} inflou para ${kb} KB — símbolo sem redução?`);
  console.log(`ok  - PDF ${rotulo}: ${dl.suggestedFilename()} (${kb} KB)`);
}

// ---- operador: bipa, encerra, baixa o PDF da sessão
const ctx = await navegador.newContext({
  viewport: { width: 420, height: 900 },
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: -23.5505, longitude: -46.6333, accuracy: 18 },
  locale: 'pt-BR',
  acceptDownloads: true
});
const p = await ctx.newPage();
// 401 do Supabase é ruído de ambiente: a exportação é 100% local.
const vigiar = (pagina, quem) => {
  pagina.on('pageerror', (e) => erros.push(`[pageerror ${quem}] ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) {
      erros.push(`[console ${quem}] ${m.text()}`);
    }
  });
};
vigiar(p, 'operador');

await p.goto(`${BASE}/index.html`);
await p.fill('#in-login', 'operador');
await p.fill('#in-senha', 'operador');
await p.click('#form-login button[type=submit]');
await p.waitForSelector('#view-grupo:not([hidden])');
await p.click('.grupo-btn >> nth=0');
await p.waitForSelector('#view-bipagem:not([hidden])');

for (const [cod, rota] of [['EMB0008314147', 'FNOR 100'], ['EMB0008399999', 'FSUL 200']]) {
  await p.click('#btn-manual');
  await p.fill('#man-codigo', cod);
  await p.fill('#man-rota', rota);
  await p.fill('#man-pedido', '86945574');
  await p.fill('#man-volume', '0001/0002');
  await p.click('#man-confirmar');
  await p.waitForTimeout(250);
}

await p.click('#btn-oc-entrega');
await p.fill('#oc-texto', 'Cheguei 7h, só me atenderam 9h20. Doca 3 fechada.');
await p.click('#oc-salvar');
await p.waitForTimeout(300);

await p.click('#btn-encerrar');
await p.click('#enc-confirmar');
await p.waitForSelector('#view-relatorio:not([hidden])');
await baixar(p, () => p.click('#btn-pdf'), 'sessao');

// ---- diretor: PDF do período
const ctx2 = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', acceptDownloads: true });
const d = await ctx2.newPage();
vigiar(d, 'diretor');
await d.goto(`${BASE}/diretor.html`);
await d.fill('#in-login', 'gestor');
await d.fill('#in-senha', 'gestor');
await d.click('#form-login button[type=submit]');
await d.waitForSelector('#conteudo:not([hidden])');
await baixar(d, () => d.click('#btn-pdf'), 'diretor');

await navegador.close();
servidor.parar();
if (erros.length) { console.log('ERROS:\n' + erros.join('\n')); process.exitCode = 1; }
else console.log('\nPDF_OK');
