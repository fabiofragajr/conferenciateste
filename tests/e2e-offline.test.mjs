import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, entrar as fazerLogin } from './cadastro.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
const ctx = await navegador.newContext({
  viewport: { width: 420, height: 900 },
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: -23.5505, longitude: -46.6333, accuracy: 18 }
});
const p = await ctx.newPage();
let falhou = false;
const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { falhou = true; console.log('FALHA -', nome, '\n     ', e.message); }
};

await prepararAparelho(p, BASE, 'index.html');
await fazerLogin(p, 'ana');
await p.waitForSelector('#view-grupo:not([hidden]), #view-bipagem:not([hidden])');

await passo('service worker registrado (precache do PWA)', async () => {
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
});

await passo('app abre sem rede nenhuma', async () => {
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#view-grupo:not([hidden]), #view-bipagem:not([hidden])', { timeout: 8000 });
});

await passo('bipagem completa offline', async () => {
  if (await p.isVisible('#view-grupo')) await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });
  for (let i = 1; i <= 25; i++) {
    await p.click('#btn-manual');
    await p.fill('#man-codigo', `EMB${String(i).padStart(10, '0')}`);
    // Tudo pela rota da própria transportadora: aqui o que se testa é a fila
    // segurando 25 volumes sem rede, não a divergência.
    await p.fill('#man-rota', 'FNOR 100');
    await p.fill('#man-pedido', `86945${String(i % 5).padStart(3, '0')}`);
    await p.fill('#man-volume', '0001/0002');
    await p.click('#man-confirmar');
  }
  await p.waitForTimeout(600);
  const total = Number(await p.textContent('#c-total'));
  if (total !== 25) throw new Error(`esperava 25 leituras, veio ${total}`);
  const separar = Number(await p.textContent('#c-div'));
  if (separar !== 0) throw new Error(`esperava nenhuma caixa para separar, veio ${separar}`);
});

await passo('fila local acumula tudo como pendente', async () => {
  // A recontagem tem folga proposital de 1,5 s para não custar uma contagem no
  // IndexedDB por leitura; o teste espera esse tempo, não instantaneidade.
  await p.waitForFunction(() => {
    const texto = document.querySelector('#chip-sync')?.textContent ?? '';
    const n = Number(texto.match(/\d+/)?.[0] ?? 0);
    return /na fila|no aparelho/.test(texto) && n >= 26;
  }, null, { timeout: 8000 });
});

await passo('recarregar no meio da conferência retoma a sessão aberta', async () => {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });
  const total = Number(await p.textContent('#c-total'));
  if (total !== 25) throw new Error(`após recarregar, contador veio ${total}`);
});

await passo('relatório offline com pedidos incompletos', async () => {
  await p.click('#btn-encerrar');
  await p.click('#enc-confirmar');
  await p.waitForSelector('#view-relatorio:not([hidden])', { timeout: 8000 });
  const html = await p.innerHTML('#relatorio-area');
  if (!/Pedidos com volume faltando \([1-9]/.test(html)) throw new Error('pedidos incompletos não listados');
  if (!/Guardado no aparelho|na fila de envio/.test(await p.textContent('#rel-sync'))) {
    throw new Error('estado da fila não informado no relatório');
  }
});

await passo('PDF é gerado offline (chunk no precache)', async () => {
  const baixa = p.waitForEvent('download', { timeout: 30000 });
  await p.click('#btn-pdf');
  const arq = await baixa;
  if (!/\.pdf$/.test(arq.suggestedFilename())) throw new Error(`arquivo: ${arq.suggestedFilename()}`);
});

await navegador.close();
servidor.parar();
console.log(falhou ? '\nFALHAS ACIMA' : '\nOFFLINE_OK');
process.exit(falhou ? 1 : 0);
