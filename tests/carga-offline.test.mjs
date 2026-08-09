// Prova de capacidade da operação: 3 mil caixas ficam no aparelho, a sessão
// retoma sem rede e a tela continua renderizando só as últimas leituras.

import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, entrar as fazerLogin } from './cadastro.mjs';

const TOTAL = 3_000;
const servidor = await subirServidor();
const navegador = await chromium.launch(opcoesNavegador);
const contexto = await navegador.newContext({
  viewport: { width: 420, height: 900 },
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: -23.5505, longitude: -46.6333, accuracy: 18 }
});
const pagina = await contexto.newPage();

try {
  await prepararAparelho(pagina, servidor.base, '/entrar');
  await fazerLogin(pagina, 'ana');
  await pagina.waitForSelector('#view-grupo:not([hidden]), #view-bipagem:not([hidden])');
  if (await pagina.isVisible('#view-grupo')) await pagina.click('.grupo-btn >> nth=0');
  await pagina.waitForSelector('#view-bipagem:not([hidden])');

  // A primeira passa pelo caminho real da interface. As demais repetem o
  // formato exato gravado pelo app numa única transação de preparação; clicar
  // três mil vezes testaria o Playwright e o teclado virtual, não a capacidade
  // do produto de manter e retomar uma carga grande.
  await pagina.click('#btn-manual');
  await pagina.fill('#man-codigo', 'EMB0000000001');
  await pagina.fill('#man-rota', 'FNOR 100');
  await pagina.fill('#man-pedido', '86000001');
  await pagina.fill('#man-volume', '0001/0001');
  await pagina.click('#man-confirmar');
  await pagina.waitForFunction(() => document.querySelector('#c-total')?.textContent === '1');

  await pagina.evaluate(async (total) => {
    const requisicao = indexedDB.open('logdis');
    const banco = await new Promise((resolve, reject) => {
      requisicao.onsuccess = () => resolve(requisicao.result);
      requisicao.onerror = () => reject(requisicao.error);
    });

    const primeira = await new Promise((resolve, reject) => {
      const tx = banco.transaction('leituras', 'readonly');
      const req = tx.objectStore('leituras').getAll();
      req.onsuccess = () => resolve(req.result[0]);
      req.onerror = () => reject(req.error);
    });
    if (!primeira) throw new Error('a primeira leitura não chegou ao IndexedDB');

    await new Promise((resolve, reject) => {
      const tx = banco.transaction('leituras', 'readwrite');
      const loja = tx.objectStore('leituras');
      const inicio = Date.parse(primeira.timestamp);
      for (let i = 2; i <= total; i++) {
        const sufixo = String(i).padStart(10, '0');
        loja.put({
          ...primeira,
          id: `carga-offline-${sufixo}`,
          codigoVolume: `EMB${sufixo}`,
          pedido: `86${String(i).padStart(6, '0')}`,
          rawData: `EMB${sufixo};FNOR 100;0001/0001;86${String(i).padStart(6, '0')}`,
          timestamp: new Date(inicio + i).toISOString(),
          atualizadoEm: new Date(inicio + i).toISOString(),
          sync: 'PENDENTE'
        });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    banco.close();
  }, TOTAL);

  await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  await contexto.setOffline(true);

  const inicioRetomada = Date.now();
  await pagina.reload({ waitUntil: 'domcontentloaded' });
  await pagina.waitForSelector('#view-bipagem:not([hidden])', { timeout: 10_000 });
  await pagina.waitForFunction(
    (total) => document.querySelector('#c-total')?.textContent === String(total),
    TOTAL,
    { timeout: 10_000 }
  );
  const retomadaMs = Date.now() - inicioRetomada;

  const resultado = await pagina.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const banco = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const leituras = await new Promise((resolve, reject) => {
      const q = banco.transaction('leituras', 'readonly').objectStore('leituras').count();
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    banco.close();
    return {
      leituras,
      total: Number(document.querySelector('#c-total')?.textContent),
      liberados: Number(document.querySelector('#c-ok')?.textContent),
      linhasNoDom: document.querySelectorAll('#lista-leituras .leitura').length,
      sync: document.querySelector('#chip-sync')?.textContent ?? ''
    };
  });

  if (resultado.leituras !== TOTAL) throw new Error(`IndexedDB: ${resultado.leituras}/${TOTAL}`);
  if (resultado.total !== TOTAL || resultado.liberados !== TOTAL) {
    throw new Error(`contadores: total=${resultado.total}, liberados=${resultado.liberados}`);
  }
  if (resultado.linhasNoDom > 60) throw new Error(`DOM cresceu para ${resultado.linhasNoDom} linhas`);
  if (!/Offline.+salvo no aparelho/i.test(resultado.sync)) throw new Error(`estado offline: ${resultado.sync}`);
  if (retomadaMs > 8_000) throw new Error(`retomada levou ${retomadaMs} ms`);

  console.log(`CARGA_OK - ${TOTAL} leituras, retomada em ${retomadaMs} ms, ${resultado.linhasNoDom} linhas no DOM`);
} finally {
  await navegador.close();
  servidor.parar();
}
