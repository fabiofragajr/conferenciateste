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
import { prepararAparelho, entrar as fazerLogin, encerrarConferencia } from './cadastro.mjs';

const PORTA_BASE_FALSA = 4199;
const recebido = new Map();   // tabela -> nº de linhas que chegaram
const codigosRecebidos = new Set();
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
    try {
      const registros = JSON.parse(corpo || '[]');
      linhas = registros.length ?? 0;
      for (const registro of registros) {
        if (registro.codigo_volume) codigosRecebidos.add(registro.codigo_volume);
      }
    } catch { linhas = 0; }
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

await prepararAparelho(p, BASE, '/entrar');

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

  // Sessão Supabase Auth persistida: a fila só pode sair acompanhada de JWT.
  const agora = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    sub: '10000000-0000-4000-8000-000000000001', role: 'authenticated', aud: 'authenticated',
    exp: agora + 3600, iat: agora,
    app_metadata: { tenant_id: '00000000-0000-4000-8000-000000000001' }
  })).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
  const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.assinatura-de-teste`;
  localStorage.setItem('sb-127-auth-token', JSON.stringify({
    access_token: token, refresh_token: 'refresh-de-teste', token_type: 'bearer',
    expires_in: 3600, expires_at: agora + 3600,
    user: {
      id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
      email: 'ana@usuarios.logdis.local', is_anonymous: false,
      app_metadata: { tenant_id: '00000000-0000-4000-8000-000000000001' },
      user_metadata: {}, identities: [], created_at: new Date().toISOString()
    }
  }));
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

await encerrarConferencia(p);
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
await passo('cadastro local legado NÃO é enviado para o servidor', async () => {
  if (recebido.has('rotas')) throw new Error('uma rota local entrou na fila de saída');
  const estado = await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const q = bd.transaction('rotas').objectStore('rotas').index('sync').count('ERRO');
    const n = await new Promise((ok) => { q.onsuccess = () => ok(q.result); });
    bd.close();
    return n;
  });
  if (estado < 1) throw new Error('o cadastro legado não foi separado para revisão');
});
await passo('o aparelho continua se registrando apesar da recusa', () => ateChegar('dispositivos', 1));

await passo('o cadastro legado separado aparece para o gestor', async () => {
  const g = await ctx.newPage();
  await g.setViewportSize({ width: 1440, height: 900 });
  // A ana (não-gestora) segue logada neste contexto. Quem não é gestor não
  // trava mais no painel — o boot manda pro app; o teste precisa sair antes
  // de logar como sandro, senão nunca chega no formulário de login.
  await g.goto(`${BASE}/`);
  await g.evaluate(() => localStorage.removeItem('logdis.usuarioLogado'));
  await g.goto(`${BASE}/painel`);
  await fazerLogin(g, 'sandro');
  await g.waitForSelector('#tela-painel:not([hidden])', { timeout: 8000 });
  await g.waitForFunction(
    () => /Cadastros legados\s*[1-9]/.test(document.querySelector('#fila-status')?.textContent ?? ''),
    null,
    { timeout: 20000 }
  );
});

await passo('sem sessão Auth a fila operacional fica protegida no aparelho', async () => {
  // Contexto novo: nenhum cliente Supabase em memória e nenhum token
  // persistido. Remover apenas o localStorage de uma página já autenticada não
  // simula logout, pois a sessão válida continua em memória até signOut.
  const contextoSemAuth = await navegador.newContext({ viewport: { width: 420, height: 900 }, locale: 'pt-BR' });
  const semAuth = await contextoSemAuth.newPage();
  await prepararAparelho(semAuth, BASE, '/entrar');
  await semAuth.evaluate(async (porta) => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    await new Promise((ok, erro) => {
      const tx = bd.transaction(['leituras', 'config'], 'readwrite');
      tx.objectStore('config').put({
        chave: 'supabase.config',
        valor: { url: `http://127.0.0.1:${porta}`, anonKey: 'chave-de-teste', bucket: 'ocorrencias' }
      });
      tx.objectStore('leituras').put({
        id: '90000000-0000-4000-8000-000000000001',
        codigoVolume: 'EMB-SEM-AUTH', rawData: 'EMB-SEM-AUTH;FNOR 100;0001/0001;999',
        sync: 'PENDENTE', syncErro: null, syncTentativas: 0,
        atualizadoEm: new Date().toISOString()
      });
      tx.oncomplete = ok;
      tx.onerror = () => erro(tx.error);
    });
    bd.close();
  }, PORTA_BASE_FALSA);

  await semAuth.reload();
  await semAuth.waitForTimeout(2500);
  if (codigosRecebidos.has('EMB-SEM-AUTH')) {
    throw new Error('a leitura saiu sem JWT autenticado');
  }
  const pendente = await semAuth.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const q = bd.transaction('leituras').objectStore('leituras').get('90000000-0000-4000-8000-000000000001');
    const leitura = await new Promise((ok) => { q.onsuccess = () => ok(q.result); });
    bd.close();
    return leitura?.sync;
  });
  if (pendente !== 'PENDENTE') throw new Error(`estado local: ${pendente}`);
  await contextoSemAuth.close();
});

await navegador.close();
servidor.parar();
baseFalsa.close();

console.log('\nrecebido pela base:', Object.fromEntries(recebido));
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSYNC_FILA_OK');
