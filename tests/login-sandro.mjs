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

/**
 * No celular o menu do painel é gaveta, e "Abrir bipagem" mora no rodapé dela:
 * o caminho até a câmera passa por abrir o menu.
 */
const abrirBipagem = async (p) => {
  if (!(await p.isVisible('#btn-bipar'))) {
    await p.click('.p-hamburguer');
    await p.waitForSelector('.p-lateral.aberta', { timeout: 8000 });
  }
  await p.click('#btn-bipar');
};

await passo('sandro entra no painel do gestor', async () => {
  const { ctx, p } = await novoAparelho('/entrar');
  await entrar(p, 'sandro');
  await p.waitForSelector('#tela-painel:not([hidden])', { timeout: 8000 });
  const quem = await p.textContent('#p-usuario');
  if (!/Sandro/.test(quem)) throw new Error(`usuário logado: ${quem}`);
  await ctx.close();
});

await passo('a senha do primeiro acesso passa a valer', async () => {
  const { ctx, p } = await novoAparelho('/entrar');
  await entrar(p, 'sandro');
  await p.waitForSelector('#tela-painel:not([hidden])', { timeout: 8000 });

  await p.click('#btn-sair');
  await p.waitForSelector('#view-login:not([hidden])', { timeout: 8000 });
  await entrar(p, 'sandro', `${SENHA}-errada`);
  await p.waitForSelector('#login-erro:not([hidden])', { timeout: 8000 });
  if (await p.isVisible('#tela-painel:not([hidden])')) throw new Error('entrou com senha errada');

  await entrar(p, 'sandro');
  await p.waitForSelector('#tela-painel:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await passo('sandro abre o painel do diretor', async () => {
  const { ctx, p } = await novoAparelho('/entrar');
  await entrar(p, 'sandro');
  await p.waitForSelector('#tela-painel:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await passo('sandro entra pelo app e cai no painel, não na tela de transportadora', async () => {
  const { ctx, p } = await novoAparelho('/entrar', { width: 420, height: 900 });
  await entrar(p, 'sandro');
  await p.waitForURL(/\/painel$/, { timeout: 8000 });
  await ctx.close();
});

await passo('ana entra pelo app e vai bipar', async () => {
  const { ctx, p } = await novoAparelho('/entrar', { width: 420, height: 900 });
  await entrar(p, 'ana');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });
  if (/gestor\.html/.test(p.url())) throw new Error('conferente foi parar no painel');
  if (await p.isVisible('#btn-painel')) throw new Error('conferente vê o botão do painel');
  await ctx.close();
});

await passo('sandro também bipa, e volta ao painel pelo botão', async () => {
  const { ctx, p } = await novoAparelho('/entrar', { width: 420, height: 900 });
  await entrar(p, 'sandro');
  await p.waitForURL(/\/painel$/, { timeout: 8000 });

  await abrirBipagem(p);
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });
  await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });

  // O chip da fila da bipagem tem que ser o da bipagem. O shell do painel
  // injetava outro `#chip-sync` no <body>, antes de #tela-operacao na ordem do
  // documento: para quem é gestor, o `$('#chip-sync')` do operador pegava o do
  // painel, e a fila parava de aparecer na tela em que ela importa.
  const donoDoChip = await p.evaluate(
    () => document.querySelector('#chip-sync')?.closest('.view')?.id ?? null
  );
  if (donoDoChip !== 'view-bipagem') throw new Error(`#chip-sync resolveu para: ${donoDoChip}`);

  // Conferência aberta: voltar ao painel não pode encerrar nada.
  // (o botão da tela de bipagem é #btn-painel-bip; #btn-painel vive na tela
  // de transportadora e fica hidden enquanto a câmera está aberta)
  await p.click('#btn-painel-bip');
  await p.waitForURL(/\/painel$/, { timeout: 8000 });
  const abertas = await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok, falhou) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falhou(req.error);
    });
    const tx = bd.transaction('sessoes', 'readonly');
    const todas = await new Promise((ok) => {
      const q = tx.objectStore('sessoes').getAll();
      q.onsuccess = () => ok(q.result);
    });
    bd.close();
    return todas.filter((s) => s.status === 'ABERTA').length;
  });
  if (abertas !== 1) throw new Error(`sessões abertas depois de voltar: ${abertas}`);

  // A sessão continua ABERTA: o boot precisa devolver o caminho de volta ao
  // painel, não só a câmera — senão a única saída visível vira "Encerrar".
  await abrirBipagem(p);
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });
  if (!(await p.isVisible('#btn-painel-bip'))) throw new Error('gestor voltou pra bipagem sem caminho de volta');
  await ctx.close();
});

await passo('quem não é gestor pede /painel e é mandado para a bipagem', async () => {
  const { ctx, p } = await novoAparelho('/entrar');
  await entrar(p, 'ana');
  await p.waitForURL(/\/bipagem$/, { timeout: 8000 });
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSANDRO_OK');
