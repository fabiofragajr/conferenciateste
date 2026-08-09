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
import { prepararAparelho, entrar as fazerLogin } from './cadastro.mjs';

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
// A exportação é 100% local e o aparelho de teste roda sem projeto configurado,
// então qualquer erro de rede aqui é defeito de verdade, não ruído de ambiente.
// Por isso a escuta só começa depois da preparação, que corta a produção na mão.
const vigiar = (pagina, quem) => {
  pagina.on('pageerror', (e) => erros.push(`[pageerror ${quem}] ${e.message}`));
  pagina.on('console', (m) => {
    if (m.type() === 'error') erros.push(`[console ${quem}] ${m.text()}`);
  });
};
await prepararAparelho(p, BASE, '/entrar');
vigiar(p, 'operador');
await fazerLogin(p, 'ana');
await p.waitForSelector('#view-grupo:not([hidden]), #view-bipagem:not([hidden])');
if (await p.isVisible('#view-grupo')) await p.click('.grupo-btn >> nth=0');
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
await prepararAparelho(d, BASE, '/entrar');
vigiar(d, 'diretor');
await fazerLogin(d, 'sandro');
await d.waitForSelector('#tela-painel:not([hidden])');
// O painel do diretor virou uma seção do painel único: quem escolhe a seção é
// a URL. O login cai em `/painel` (Início), onde `#btn-pdf-periodo` está
// dentro de uma seção `hidden` — antes da Task 3 isto era uma página própria e
// o botão já estava na tela ao carregar.
await d.goto(`${BASE}/painel/indicadores`);
// O botão existe antes de os blocos pintarem; exportar aí geraria um PDF do
// período vazio. Espera o conteúdo, como faz o e2e.
await d.waitForFunction(
  () => (document.querySelector('#kpis')?.textContent ?? '').includes('Taxa de divergência'),
  null,
  { timeout: 10000 }
);
await baixar(d, () => d.click('#btn-pdf-periodo'), 'diretor');

await navegador.close();
servidor.parar();
if (erros.length) { console.log('ERROS:\n' + erros.join('\n')); process.exitCode = 1; }
else console.log('\nPDF_OK');
