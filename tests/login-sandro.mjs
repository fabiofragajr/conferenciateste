// Acesso do gestor nominal da operação.
//
// O app não cria mais usuário nenhum: o Sandro vem da base, provisionado pelo
// SQL (`supabase/migracao-v2-para-v3.sql`). Aqui se confere o que depende do
// app: que um gestor que desceu do cadastro entra nos dois painéis, define a
// senha na primeira entrada, que a senha passa a valer, e que ele também bipa —
// `gestor` abre painel, não fecha a câmera.
import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, entrar, SENHA } from './cadastro.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
let falhou = false;

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

/** Cada passo num contexto próprio: aparelho diferente, IndexedDB diferente. */
const novoAparelho = async (arquivo, viewport = { width: 1440, height: 900 }) => {
  const ctx = await navegador.newContext({
    viewport,
    permissions: ['camera', 'geolocation'],
    geolocation: { latitude: -23.5505, longitude: -46.6333, accuracy: 18 },
    locale: 'pt-BR'
  });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, arquivo);
  return { ctx, p };
};

await passo('sandro entra no painel do gestor', async () => {
  const { ctx, p } = await novoAparelho('gestor.html');
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  const quem = await p.textContent('#p-usuario');
  if (!/Sandro/.test(quem)) throw new Error(`usuário logado: ${quem}`);
  await ctx.close();
});

await passo('a senha do primeiro acesso passa a valer', async () => {
  const { ctx, p } = await novoAparelho('gestor.html');
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });

  await p.click('#btn-sair');
  await p.waitForSelector('#bloqueio:not([hidden])', { timeout: 8000 });
  await entrar(p, 'sandro', `${SENHA}-errada`);
  await p.waitForSelector('#login-erro:not([hidden])', { timeout: 8000 });
  if (await p.isVisible('#conteudo:not([hidden])')) throw new Error('entrou com senha errada');

  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await passo('quem não é gestor não abre o painel', async () => {
  const { ctx, p } = await novoAparelho('gestor.html');
  await entrar(p, 'ana');
  await p.waitForTimeout(600);
  if (await p.isVisible('#conteudo:not([hidden])')) throw new Error('conferente entrou no painel');
  await ctx.close();
});

await passo('sandro abre o painel do diretor', async () => {
  const { ctx, p } = await novoAparelho('diretor.html');
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await passo('sandro bipa no app do operador', async () => {
  const { ctx, p } = await novoAparelho('index.html', { width: 420, height: 900 });
  await entrar(p, 'sandro');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });
  await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSANDRO_OK');
