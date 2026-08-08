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

// ------------------------------------------------- senha entre aparelhos ---
// A mesma pessoa em dois celulares. A senha vive no cadastro, então o segundo
// aparelho tem que aceitar a senha definida no primeiro — inclusive na primeira
// tentativa, sem esperar a sincronização de fundo passar.
await passo('a senha definida num aparelho vale no outro, já na 1ª tentativa', async () => {
  const cadastro = await import('./cadastro.mjs');

  // A base agora responde com o Sandro e um hash de senha de verdade, como o
  // servidor responderia depois que o gestor definiu a senha dele.
  const hashDaBase = await (async () => {
    const { pbkdf2Sync } = await import('node:crypto');
    const salt = 'abcd1234';
    return `${salt}$pbkdf2$210000$${pbkdf2Sync('senha-da-base', salt, 210000, 32, 'sha256').toString('hex')}`;
  })();

  // A base só entrega o Sandro depois que o teste liberar. Assim a descida
  // automática do boot volta vazia, o aparelho continua com a senha velha, e o
  // único caminho para o login dar certo é a segunda tentativa do `entrar`.
  let liberarUsuarios = false;

  baseFalsa.removeAllListeners('request');
  baseFalsa.on('request', (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const tabela = (req.url.split('/rest/v1/')[1] ?? '').split('?')[0];
    if (req.method === 'GET' && tabela === 'usuarios' && liberarUsuarios) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{
        id: '00000000-0000-4000-8000-000000000001',
        nome: 'Sandro', login: 'sandro', senha_hash: hashDaBase, gestor: true,
        funcao: 'Gestor de transporte', telefone: '', placa: '', ativo: true,
        atualizado_em: new Date().toISOString()
      }]));
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(201, { ...cors, 'Content-Type': 'application/json' }); res.end('[]'); });
  });

  // Hash da senha ANTIGA, a que este aparelho ainda tem gravada. Sem isto o
  // Sandro local ficaria sem senha, cairia no "primeiro acesso" e o teste
  // passaria mesmo com o app errado — não provaria nada.
  const hashAntigo = await (async () => {
    const { pbkdf2Sync } = await import('node:crypto');
    const salt = 'ffff0000';
    return `${salt}$pbkdf2$210000$${pbkdf2Sync('senha-antiga', salt, 210000, 32, 'sha256').toString('hex')}`;
  })();

  // Segundo aparelho: tem o Sandro com a senha velha e nunca ouviu falar da nova.
  const ctx2 = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const p2 = await ctx2.newPage();
  await cadastro.prepararAparelho(p2, BASE, 'gestor.html');
  await p2.evaluate(async ({ porta, hashAntigo }) => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    await new Promise((ok) => {
      const tx = bd.transaction(['config', 'usuarios'], 'readwrite');
      tx.objectStore('config').put({
        chave: 'supabase.config',
        valor: { url: `http://127.0.0.1:${porta}`, anonKey: 'chave-de-teste', bucket: 'ocorrencias' }
      });
      // Zera o marco da descida: o cadastro do servidor é "novo" para ele.
      tx.objectStore('config').put({ chave: 'sync.ultimaDescida', valor: '1970-01-01T00:00:00.000Z' });
      const loja = tx.objectStore('usuarios');
      loja.getAll().onsuccess = (ev) => {
        for (const u of ev.target.result) {
          if (u.login === 'sandro') loja.put({ ...u, senhaHash: hashAntigo, sync: 'ENVIADO' });
        }
      };
      tx.oncomplete = ok;
    });
    bd.close();
  }, { porta: PORTA_BASE_FALSA, hashAntigo });
  await p2.reload();

  // Confirma o ponto de partida: o aparelho tem a senha velha e não conhece a
  // nova. Sem esta checagem o teste passaria mesmo com o app errado.
  const partiuDaSenhaVelha = await p2.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const r = bd.transaction('usuarios').objectStore('usuarios').getAll();
    const todos = await new Promise((ok) => { r.onsuccess = () => ok(r.result); });
    bd.close();
    return todos.find((u) => u.login === 'sandro')?.senhaHash ?? '';
  });
  if (!partiuDaSenhaVelha.startsWith('ffff0000$')) {
    throw new Error('o aparelho já estava com a senha nova — o teste não provaria nada');
  }

  // A partir de agora a base responde. A pessoa digita a senha que só existe
  // lá, na primeira tentativa, sem esperar sincronização nenhuma.
  liberarUsuarios = true;
  await p2.fill('#in-login', 'sandro');
  await p2.fill('#in-senha', 'senha-da-base');
  await p2.click('#form-login button[type=submit]');
  await p2.waitForSelector('#conteudo:not([hidden])', { timeout: 15000 });
  await ctx2.close();
});

await navegador.close();
servidor.parar();
baseFalsa.close();

console.log('\nrecebido pela base:', Object.fromEntries(recebido));
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSYNC_FILA_OK');
