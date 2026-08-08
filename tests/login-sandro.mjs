// Checagem do provisionamento do gestor nominal: o login entra, tem acesso aos
// painéis, e o bloco novo também alcança aparelho que já tinha rodado o seed
// antigo (o caso real — o app já está instalado).
import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
let falhou = false;

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

const novaPagina = async (viewport) => {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR' });
  return ctx.newPage();
};

const entrar = async (pagina, login, senha) => {
  await pagina.fill('#in-login', login);
  await pagina.fill('#in-senha', senha);
  await pagina.click('#form-login button[type=submit]');
};

await passo('sandro entra no painel do gestor', async () => {
  const p = await novaPagina({ width: 1440, height: 900 });
  await p.goto(`${BASE}/gestor.html`);
  await entrar(p, 'sandro', 'Lodis@123');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
  const quem = await p.textContent('#p-usuario');
  if (!/Sandro/.test(quem)) throw new Error(`usuário logado: ${quem}`);
});

await passo('senha errada não entra', async () => {
  const p = await novaPagina({ width: 1440, height: 900 });
  await p.goto(`${BASE}/gestor.html`);
  await entrar(p, 'sandro', 'lodis@123');
  await p.waitForSelector('#login-erro:not([hidden])', { timeout: 5000 });
  if (await p.isVisible('#conteudo:not([hidden])')) throw new Error('entrou com senha errada');
});

await passo('sandro abre o painel do diretor', async () => {
  const p = await novaPagina({ width: 1440, height: 900 });
  await p.goto(`${BASE}/diretor.html`);
  await entrar(p, 'sandro', 'Lodis@123');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
});

await passo('sandro bipa no app do operador', async () => {
  const ctx = await navegador.newContext({
    viewport: { width: 420, height: 900 },
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: -23.5505, longitude: -46.6333, accuracy: 18 },
    locale: 'pt-BR'
  });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/index.html`);
  await entrar(p, 'sandro', 'Lodis@123');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 5000 });
  await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 5000 });
});

// O aparelho do Sandro não é novo: já tem seed.v1 gravado de antes.
await passo('aparelho já provisionado antes também recebe o login', async () => {
  const p = await novaPagina({ width: 1440, height: 900 });
  await p.goto(`${BASE}/gestor.html`);
  await p.waitForSelector('#bloqueio:not([hidden]), #conteudo:not([hidden])', { timeout: 5000 });

  // simula a instalação antiga: só o seed original, sem o bloco do Sandro
  await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    await new Promise((ok) => {
      const tx = bd.transaction(['usuarios', 'config'], 'readwrite');
      tx.objectStore('config').put({ chave: 'seed.gestor-sandro', valor: false });
      const st = tx.objectStore('usuarios');
      st.getAll().onsuccess = (ev) => {
        for (const u of ev.target.result) if (u.login === 'sandro') st.delete(u.id);
      };
      tx.oncomplete = ok;
    });
    bd.close();
  });

  await p.reload();
  await entrar(p, 'sandro', 'Lodis@123');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSANDRO_OK');
