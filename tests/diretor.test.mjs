// O painel do diretor ficou para trás quando o do gestor ganhou menu lateral:
// continuou com o cabeçalho de nove itens em flex-wrap, que media 268 px de
// altura e vazava 72 px para o lado num aparelho de 320 px. Ele abre o painel no
// celular entre uma reunião e outra — meia tela de moldura não é detalhe.
//
// As medidas entram como asserção pelo mesmo motivo de `painel-shell.test.mjs`:
// conferência visual não pega de volta o próximo botão que alguém puser no topo.
//
// O que o CLAUDE.md §10 fixa e este teste guarda: UMA tela, sem navegação
// profunda. O menu existe para sair daqui, não para dividir o painel do diretor.
import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, entrar } from './cadastro.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
let falhou = false;

/** Os dois aparelhos que a operação usa: o comum e o menor deles. */
const CELULARES = [
  { nome: '390x844', width: 390, height: 844 },
  { nome: '320x568', width: 320, height: 568 }
];

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

const diretorAberto = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, 'diretor.html');
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  // `#conteudo` aparece antes de os blocos pintarem, e é o conteúdo pintado que
  // empurra a página para o lado. Medir a caixa vazia não mede nada.
  await p.waitForSelector('#tendencias svg', { timeout: 10000 });
  return { ctx, p };
};

await passo('o diretor abre logado e cai na única tela dele', async () => {
  const { ctx, p } = await diretorAberto();
  await p.waitForSelector('[data-secao="diretor"]:not([hidden])', { timeout: 8000 });
  if (!(await p.isVisible('.p-item[data-item="diretor"].ativo'))) {
    throw new Error('o menu não marcou "Visão do diretor" como a seção aberta');
  }
  // Controle da tela mora na tela, não na moldura.
  for (const sel of ['#f-mes', '#btn-pdf-periodo']) {
    const dentro = await p.$eval(sel, (n) => !!n.closest('[data-secao="diretor"]'));
    if (!dentro) throw new Error(`${sel} ficou fora da seção do diretor`);
  }
  await ctx.close();
});

for (const tela of CELULARES) {
  await passo(`o topo cabe em 64 px em ${tela.nome}`, async () => {
    const { ctx, p } = await diretorAberto({ width: tela.width, height: tela.height });
    const altura = await p.evaluate(() =>
      Math.round(document.querySelector('.p-topo').getBoundingClientRect().height));
    if (altura > 64) throw new Error(`o topo voltou a crescer: ${altura}px`);
    await ctx.close();
  });

  await passo(`o painel do diretor não rola na horizontal em ${tela.nome}`, async () => {
    const { ctx, p } = await diretorAberto({ width: tela.width, height: tela.height });
    const sobra = await p.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });
    if (sobra > 1) throw new Error(`sobram ${sobra}px de rolagem horizontal`);
    await ctx.close();
  });
}

await passo('no celular a lateral é gaveta, e ela abre e fecha', async () => {
  const { ctx, p } = await diretorAberto({ width: 390, height: 844 });
  if (await p.isVisible('.p-lateral')) throw new Error('gaveta já nasce aberta no celular');
  await p.click('.p-hamburguer');
  await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
  // Quem abriu o menu por engano sai dele pelo caminho mais óbvio: tocar fora.
  await p.click('.p-fundo-gaveta', { position: { x: 370, y: 700 } });
  await p.waitForSelector('.p-lateral:not(.aberta)', { timeout: 4000 });
  if (await p.isVisible('.p-fundo-gaveta')) throw new Error('o fundo escurecido continuou por cima do conteúdo');
  await ctx.close();
});

await passo('o menu do diretor é o mesmo do gestor, e leva até lá', async () => {
  const { ctx, p } = await diretorAberto();
  await p.click('.p-item[href="gestor.html#hoje"]');
  await p.waitForURL(/gestor\.html/, { timeout: 8000 });
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nDIRETOR_OK');
