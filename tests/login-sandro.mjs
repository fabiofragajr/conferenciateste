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
 * No desktop "Abrir bipagem" está no rodapé da lateral. No celular não há
 * lateral: a navegação é a barra inferior, e o botão mora no rodapé da folha
 * "Mais" — sem id, para não repetir o `#btn-bipar` da lateral.
 */
const abrirBipagem = async (p) => {
  if (await p.isVisible('#btn-bipar')) {
    await p.click('#btn-bipar');
    return;
  }
  await p.click('.sh-aba[data-aba="mais"]');
  await p.waitForSelector('.ui-folha.aberta', { timeout: 8000 });
  await p.click('.ui-folha a[href="/bipagem"]');
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

await passo('sandro também bipa, e volta ao painel pelo ←', async () => {
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
  //
  // A saída da bipagem é o `←` do topo, e não mais um botão "Painel": quem não
  // é gestor não tinha saída nenhuma além de "Encerrar", que é irreversível. O
  // destino do `←` muda com a pessoa — painel para quem tem painel — e o
  // rótulo acessível é o que diz para onde ele aponta.
  const destino = await p.getAttribute('#btn-voltar-bip', 'aria-label');
  if (destino !== 'Voltar ao painel') throw new Error(`o ← do gestor diz: ${destino}`);
  await p.click('#btn-voltar-bip');
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

  // A sessão continua ABERTA: o boot precisa devolver o caminho de volta, não
  // só a câmera — senão a única saída visível vira "Encerrar", que é
  // irreversível. Agora o `←` está sempre lá; o que o boot tem de acertar é
  // para ONDE ele aponta, e isso depende de quem entrou.
  await abrirBipagem(p);
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });
  if (!(await p.isVisible('#btn-voltar-bip'))) throw new Error('gestor voltou pra bipagem sem caminho de volta');
  const destino2 = await p.getAttribute('#btn-voltar-bip', 'aria-label');
  if (destino2 !== 'Voltar ao painel') throw new Error(`depois de retomar, o ← diz: ${destino2}`);
  await ctx.close();
});

await passo('quem não é gestor também tem saída, e ela não encerra a carga', async () => {
  // Antes, a única saída da bipagem para quem não é gestor era "Encerrar" — a
  // ação irreversível. Quem entrasse na carga errada tinha que encerrar uma
  // conferência de verdade para escapar.
  const { ctx, p } = await novoAparelho('/entrar');
  await entrar(p, 'ana');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });
  await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });

  const destino = await p.getAttribute('#btn-voltar-bip', 'aria-label');
  if (destino !== 'Voltar para a escolha da transportadora') {
    throw new Error(`o ← de quem não é gestor diz: ${destino}`);
  }

  await p.click('#btn-voltar-bip');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });

  // A conferência continua ABERTA: voltar é sair da tela, não encerrar a carga.
  const abertas = await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const todas = await new Promise((ok) => {
      const q = bd.transaction('sessoes', 'readonly').objectStore('sessoes').getAll();
      q.onsuccess = () => ok(q.result);
    });
    bd.close();
    return todas.filter((s) => s.status === 'ABERTA').length;
  });
  if (abertas !== 1) throw new Error(`voltar mexeu na conferência: ${abertas} abertas`);
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
