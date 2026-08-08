// A regressão que motivou tudo isto: uma tabela recusada pelo servidor NÃO pode
// impedir as outras de subir.
//
// O caso real: o cadastro de exemplo criava um id novo de `FNOR` em cada
// aparelho, e `rotas.codigo` é único no servidor. Do segundo celular em diante o
// envio batia em 409 para sempre e, como a fila parava na primeira tabela que
// falhava — e `rotas` vem antes de `leituras` —, NENHUMA conferência daquele
// aparelho chegava ao servidor. O gestor via o painel vazio e a caixa bipada
// morria no celular.
//
// Aqui o 409 é provocado de propósito, por um servidor HTTP de verdade que fala
// o suficiente de PostgREST. Não dá para provocar isso com dado: é a resposta do
// servidor que precisa falhar. O cliente Supabase, a fila e o app são os reais.

import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, entrar as fazerLogin } from './cadastro.mjs';

const PORTA_BASE_FALSA = 4199;
const recebido = new Map();   // tabela -> nº de linhas que chegaram
let falhou = false;

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

// --------------------------------------------------------- base recusando ---
// Aceita tudo, menos `rotas`: nela devolve o mesmo 23505 que o Postgres devolve
// quando o código de rota já tem dona.
const baseFalsa = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Expose-Headers': '*'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const tabela = (req.url.split('/rest/v1/')[1] ?? '').split('?')[0];

  if (req.method === 'GET') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end('[]');
    return;
  }

  let corpo = '';
  req.on('data', (p) => { corpo += p; });
  req.on('end', () => {
    if (tabela === 'rotas') {
      res.writeHead(409, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: '23505', details: null, hint: null,
        message: 'duplicate key value violates unique constraint "rotas_codigo_key"'
      }));
      return;
    }
    let linhas = 0;
    try { linhas = JSON.parse(corpo || '[]').length ?? 0; } catch { linhas = 0; }
    recebido.set(tabela, (recebido.get(tabela) ?? 0) + linhas);
    res.writeHead(201, { ...cors, 'Content-Type': 'application/json' });
    res.end('[]');
  });
});

await new Promise((ok) => baseFalsa.listen(PORTA_BASE_FALSA, '127.0.0.1', ok));

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
const ctx = await navegador.newContext({
  viewport: { width: 420, height: 900 },
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: -23.5505, longitude: -46.6333, accuracy: 18 },
  locale: 'pt-BR'
});
const p = await ctx.newPage();

await prepararAparelho(p, BASE, 'index.html');

// Aponta o aparelho para a base que recusa, e deixa uma rota na fila para ser
// recusada — é ela que antes travava tudo o que vinha depois.
await p.evaluate(async (porta) => {
  const req = indexedDB.open('logdis');
  const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });

  await new Promise((ok) => {
    const tx = bd.transaction(['config', 'rotas'], 'readwrite');
    tx.objectStore('config').put({
      chave: 'supabase.config',
      valor: { url: `http://127.0.0.1:${porta}`, anonKey: 'chave-de-teste', bucket: 'ocorrencias' }
    });
    const loja = tx.objectStore('rotas');
    loja.getAll().onsuccess = (ev) => {
      for (const r of ev.target.result) {
        if (r.codigo === 'FNOR') loja.put({ ...r, sync: 'PENDENTE' });
      }
    };
    tx.oncomplete = ok;
  });

  bd.close();
}, PORTA_BASE_FALSA);

await p.reload();
await fazerLogin(p, 'ana');
await p.waitForSelector('#view-grupo:not([hidden]), #view-bipagem:not([hidden])', { timeout: 8000 });
if (await p.isVisible('#view-grupo')) await p.click('.grupo-btn >> nth=0');
await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });

for (let i = 1; i <= 3; i++) {
  await p.click('#btn-manual');
  await p.fill('#man-codigo', `EMB000000000${i}`);
  await p.fill('#man-rota', 'FNOR 100');
  await p.fill('#man-pedido', '86945574');
  await p.fill('#man-volume', `000${i}/0003`);
  await p.click('#man-confirmar');
  await p.waitForTimeout(200);
}

await p.click('#btn-encerrar');
await p.click('#enc-confirmar');
await p.waitForSelector('#view-relatorio:not([hidden])', { timeout: 8000 });

// Espera a fila drenar o que consegue drenar.
await p.waitForFunction(() => true);
const ateChegar = async (tabela, minimo, limiteMs = 20000) => {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if ((recebido.get(tabela) ?? 0) >= minimo) return;
    await new Promise((ok) => setTimeout(ok, 300));
  }
  throw new Error(`${tabela}: chegaram ${recebido.get(tabela) ?? 0}, esperava ${minimo}`);
};

await passo('rota recusada não impede a sessão de subir', () => ateChegar('sessoes', 1));
await passo('rota recusada não impede as LEITURAS de subir', () => ateChegar('leituras', 3));
await passo('a rota recusada de fato bateu no 409', async () => {
  if (recebido.has('rotas')) throw new Error('o servidor aceitou rotas — o teste não provou nada');
});
await passo('o aparelho continua se registrando apesar da recusa', () => ateChegar('dispositivos', 1));

await passo('o erro aparece para o gestor em vez de ficar escondido', async () => {
  const g = await ctx.newPage();
  await g.setViewportSize({ width: 1440, height: 900 });
  await g.goto(`${BASE}/gestor.html`);
  await fazerLogin(g, 'sandro');
  await g.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  await g.waitForFunction(
    () => /rotas_codigo_key|duplicate key/.test(document.querySelector('#fila-status')?.textContent ?? ''),
    null,
    { timeout: 20000 }
  );
});

await navegador.close();
servidor.parar();
baseFalsa.close();

console.log('\nrecebido pela base:', Object.fromEntries(recebido));
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSYNC_FILA_OK');
