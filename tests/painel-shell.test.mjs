// O shell é a moldura do painel: menu lateral no desktop, gaveta no celular,
// hash na URL e — a parte que não pode falhar — a informação de alerta visível
// de qualquer seção, sem abrir menu.
//
// As medidas de celular entram como asserção porque foram o motivo da mudança:
// o cabeçalho de nove itens media 223 px em 390 px de largura e 268 px em
// 320 px, e a página vazava 72 px para o lado. Conferência visual não pega isso
// de volta quando alguém acrescentar o próximo botão no topo.
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

const painelAberto = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, 'gestor.html');
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  return { ctx, p };
};

const SECOES = ['conferencias', 'ocorrencias', 'desempenho', 'pessoas', 'transportadoras', 'rotas', 'sincronizacao'];

await passo('cada item do menu mostra sua seção e escreve o hash', async () => {
  const { ctx, p } = await painelAberto();
  for (const id of SECOES) {
    await p.click(`.p-item[href="#${id}"]`);
    await p.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 4000 });
    if (!p.url().endsWith(`#${id}`)) throw new Error(`hash não acompanhou: ${p.url()}`);
    const visiveis = await p.$$eval('[data-secao]', (ns) => ns.filter((n) => !n.hidden).length);
    if (visiveis !== 1) throw new Error(`${visiveis} seções visíveis ao mesmo tempo`);
  }
  await ctx.close();
});

await passo('recarregar a página cai na mesma seção', async () => {
  const { ctx, p } = await painelAberto();
  await p.click('.p-item[href="#transportadoras"]');
  await p.waitForSelector('[data-secao="transportadoras"]:not([hidden])', { timeout: 4000 });
  await p.reload();
  await p.waitForSelector('[data-secao="transportadoras"]:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await passo('sem hash, abre em Hoje', async () => {
  const { ctx, p } = await painelAberto();
  await p.waitForSelector('[data-secao="hoje"]:not([hidden])', { timeout: 4000 });
  await ctx.close();
});

await passo('no celular a lateral é gaveta, e ela abre e fecha ao escolher', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  if (await p.isVisible('.p-lateral')) throw new Error('gaveta já nasce aberta no celular');
  await p.click('.p-hamburguer');
  await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
  await p.click('.p-item[href="#sincronizacao"]');
  await p.waitForSelector('[data-secao="sincronizacao"]:not([hidden])', { timeout: 4000 });
  // Escolher um item fecha a gaveta: ninguém quer tocar duas vezes.
  if (await p.isVisible('.p-lateral.aberta')) throw new Error('a gaveta ficou aberta depois de escolher');
  await ctx.close();
});

await passo('tocar no fundo escurecido fecha a gaveta', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.p-hamburguer');
  await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
  // Quem abriu o menu por engano sai dele pelo caminho mais óbvio: tocar fora.
  await p.click('.p-fundo-gaveta', { position: { x: 370, y: 700 } });
  await p.waitForSelector('.p-lateral:not(.aberta)', { timeout: 4000 });
  if (await p.isVisible('.p-fundo-gaveta')) throw new Error('o fundo escurecido continuou por cima do conteúdo');
  await ctx.close();
});

await passo('os itens do menu têm alvo de toque de 44 px', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.p-hamburguer');
  await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
  const baixos = await p.$$eval('.p-item', (ns) => ns
    .map((n) => ({ t: n.textContent.trim(), h: Math.round(n.getBoundingClientRect().height) }))
    .filter((i) => i.h < 44));
  if (baixos.length) throw new Error(`itens abaixo de 44px: ${JSON.stringify(baixos)}`);
  await ctx.close();
});

for (const tela of CELULARES) {
  await passo(`o painel não rola na horizontal em ${tela.nome}`, async () => {
    const { ctx, p } = await painelAberto({ width: tela.width, height: tela.height });
    const medir = () => p.evaluate(() => {
      const d = document.documentElement;
      return d.scrollWidth - d.clientWidth;
    });

    // Toda seção precisa passar: a tabela densa de Conferências é a mais larga,
    // e é ela que costuma empurrar a página inteira.
    for (const id of ['hoje', ...SECOES]) {
      await p.click(`.p-hamburguer`);
      await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
      await p.click(`.p-item[href="#${id}"]`);
      await p.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 4000 });
      const sobra = await medir();
      if (sobra > 1) throw new Error(`${id}: sobram ${sobra}px de rolagem horizontal`);
    }
    await ctx.close();
  });

  await passo(`o topo cabe em 64 px em ${tela.nome}`, async () => {
    const { ctx, p } = await painelAberto({ width: tela.width, height: tela.height });
    const altura = await p.evaluate(() =>
      Math.round(document.querySelector('.p-topo').getBoundingClientRect().height));
    if (altura > 64) throw new Error(`o topo voltou a crescer: ${altura}px`);
    await ctx.close();
  });

  await passo(`badge e chip de sincronização aparecem com a gaveta fechada em ${tela.nome}`, async () => {
    const { ctx, p } = await painelAberto({ width: tela.width, height: tela.height });

    // Quem preenche o badge com a contagem de divergências é a seção Hoje, ainda
    // por vir. O que se prova aqui é o lugar dele: no topo, fora da gaveta, e
    // dentro da tela — senão a divergência só existiria para quem abre o menu.
    await p.evaluate(() => {
      const b = document.querySelector('[data-badge-topo]');
      b.textContent = '9';
      b.hidden = false;
    });

    for (const sel of ['[data-badge-topo]', '#chip-sync']) {
      if (!(await p.isVisible(sel))) throw new Error(`${sel} invisível com a gaveta fechada`);
      const dentro = await p.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return r.left >= 0 && r.right <= window.innerWidth + 1 && r.width > 0;
      }, sel);
      if (!dentro) throw new Error(`${sel} está fora da tela`);
    }
    await ctx.close();
  });
}

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSHELL_OK');
