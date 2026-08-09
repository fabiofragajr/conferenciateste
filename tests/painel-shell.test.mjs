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

const painelAberto = async (viewport = { width: 1440, height: 900 }, semear = null) => {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, '/entrar');
  if (semear) await semear(p);
  await entrar(p, 'sandro');
  await p.waitForSelector('#tela-painel:not([hidden])', { timeout: 8000 });
  return { ctx, p };
};

const SECOES = ['conferencias', 'ocorrencias', 'desempenho', 'pessoas', 'transportadoras', 'rotas', 'sincronizacao'];

/** Duas, e não uma: badge com "2" não passa por acaso, badge com "1" passaria. */
const DIVERGENCIAS = 2;

/**
 * Divergência de hoje gravada direto na base do aparelho.
 *
 * Aqui se prova a moldura, não a conferência — essa já tem teste próprio em
 * `e2e`. Bipar pela câmera só para acender o badge custaria meio minuto de
 * teste e traria a tela do operador junto.
 */
const semearDivergencia = async (pagina) => {
  await pagina.evaluate(async (quantas) => {
    const agora = new Date().toISOString();
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok, falhou) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falhou(req.error);
    });

    const sincronizavel = { sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: agora };
    const sessao = {
      ...sincronizavel,
      id: 'sessao-com-divergencia',
      transportadoraId: '00000000-0000-4000-8000-000000000010',
      usuarioId: '00000000-0000-4000-8000-000000000002',
      inicio: agora,
      fim: agora,
      status: 'ENCERRADA',
      transportadoraNome: 'LOGDIS',
      rotas: ['FNOR'],
      usuarioNome: 'Ana Paula',
      geoInicio: null,
      geoFim: null,
      liberadaEm: null,
      liberadaPor: null,
      liberadaComPendencias: false
    };

    // Caixa da Transportadora Sul na carga da LOGDIS: é a divergência que o
    // painel precisa gritar de qualquer seção.
    const leitura = (n) => ({
      ...sincronizavel,
      id: `leitura-divergente-${n}`,
      sessaoId: sessao.id,
      codigoVolume: `EMB000839999${n}`,
      rota: 'FSUL 200',
      rotaPrefixo: 'FSUL',
      rotaId: '00000000-0000-4000-8000-000000000021',
      transportadoraDonaId: '00000000-0000-4000-8000-000000000011',
      transportadoraDonaNome: 'Transportadora Sul',
      volume: '0001/0001',
      volumeAtual: 1,
      volumeTotal: 1,
      pedido: `8694557${n}`,
      status: 'ROTA_DIVERGENTE',
      timestamp: agora,
      rawData: `EMB000839999${n};FSUL 200;0001/0001;8694557${n}`,
      origem: 'MANUAL',
      motivoInvalido: null,
      dispositivoId: 'aparelho-de-teste',
      lat: null,
      lng: null,
      precisaoMetros: null,
      geoStatus: 'INDISPONIVEL'
    });

    await new Promise((ok, falhou) => {
      const tx = bd.transaction(['sessoes', 'leituras'], 'readwrite');
      tx.objectStore('sessoes').put(sessao);
      for (let n = 1; n <= quantas; n++) tx.objectStore('leituras').put(leitura(n));
      tx.oncomplete = ok;
      tx.onerror = () => falhou(tx.error);
    });

    bd.close();
  }, DIVERGENCIAS);
};

const irParaSecao = async (p, id) => {
  await p.click(`.p-item[href="${id === 'inicio' ? '/painel' : `/painel/${id}`}"]`);
  await p.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 4000 });
};

await passo('em Hoje o alarme não aparece duas vezes', async () => {
  const { ctx, p } = await painelAberto(undefined, semearDivergencia);
  await p.waitForSelector('#faixa-divergencia .p-faixa-alerta', { timeout: 8000 });

  // A faixa fixa é para quem está longe do alarme. Em Hoje o gestor está nele,
  // com a tabela dos volumes divergentes na frente: repetir o aviso aqui ensina
  // a ignorar a faixa nas seções onde ela é a única notícia do problema.
  if (await p.isVisible('.p-alerta-fixo')) throw new Error('o alarme apareceu duas vezes em Hoje');
  if (!(await p.isVisible('#faixa-divergencia'))) throw new Error('a divergência sumiu da própria seção Hoje');

  for (const id of ['transportadoras', 'sincronizacao']) {
    await irParaSecao(p, id);
    if (!(await p.isVisible('.p-alerta-fixo'))) throw new Error(`${id}: longe de Hoje, o alarme sumiu`);
  }
  await ctx.close();
});

await passo('o badge de divergência acompanha toda seção, inclusive Hoje', async () => {
  const { ctx, p } = await painelAberto(undefined, semearDivergencia);
  await p.waitForSelector('#faixa-divergencia .p-faixa-alerta', { timeout: 8000 });

  // O badge é a contagem, não a repetição do aviso: ele fica mesmo em Hoje.
  for (const id of ['inicio', 'transportadoras', 'sincronizacao']) {
    await irParaSecao(p, id);
    if (!(await p.isVisible('[data-badge="inicio"]'))) throw new Error(`${id}: badge escondido`);
    const n = (await p.textContent('[data-badge="inicio"]')).trim();
    if (n !== String(DIVERGENCIAS)) throw new Error(`${id}: badge diz ${n}, e são ${DIVERGENCIAS}`);
  }
  await ctx.close();
});

await passo('cada item do menu mostra sua seção e escreve o caminho', async () => {
  const { ctx, p } = await painelAberto();
  for (const id of SECOES) {
    await p.click(`.p-item[href="${id === 'inicio' ? '/painel' : `/painel/${id}`}"]`);
    await p.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 4000 });
    // O caminho é que acompanha, não o hash: quem é dono da URL agora é o
    // roteador. Duas coisas escrevendo o endereço se desfaziam mutuamente.
    const esperado = id === 'inicio' ? '/painel' : `/painel/${id}`;
    if (!p.url().endsWith(esperado)) throw new Error(`caminho não acompanhou: ${p.url()}`);
    const visiveis = await p.$$eval('[data-secao]', (ns) => ns.filter((n) => !n.hidden).length);
    if (visiveis !== 1) throw new Error(`${visiveis} seções visíveis ao mesmo tempo`);
  }
  await ctx.close();
});

await passo('recarregar a página cai na mesma seção', async () => {
  const { ctx, p } = await painelAberto();
  await p.click('.p-item[href="/painel/transportadoras"]');
  await p.waitForSelector('[data-secao="transportadoras"]:not([hidden])', { timeout: 4000 });
  await p.reload();
  await p.waitForSelector('[data-secao="transportadoras"]:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await passo('sem hash, abre em Hoje', async () => {
  const { ctx, p } = await painelAberto();
  await p.waitForSelector('[data-secao="inicio"]:not([hidden])', { timeout: 4000 });
  await ctx.close();
});

await passo('no celular a lateral é gaveta, e ela abre e fecha ao escolher', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  if (await p.isVisible('.p-lateral')) throw new Error('gaveta já nasce aberta no celular');
  await p.click('.p-hamburguer');
  await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
  await p.click('.p-item[href="/painel/sincronizacao"]');
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
    for (const id of ['inicio', ...SECOES]) {
      await p.click(`.p-hamburguer`);
      await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
      await p.click(`.p-item[href="${id === 'inicio' ? '/painel' : `/painel/${id}`}"]`);
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

    for (const sel of ['[data-badge-topo]', '#chip-sync-painel']) {
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
