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

await passo('a faixa fixa se cala em Divergências e fala nas demais', async () => {
  const { ctx, p } = await painelAberto(undefined, semearDivergencia);
  // O sinal de que a divergência já foi lida do banco é o badge — o cartão que
  // se esperava aqui virou a seção `divergencias` inteira.
  await p.waitForFunction(() => {
    const b = document.querySelector('[data-badge="divergencias"]');
    return b && !b.hidden && b.textContent.trim() !== '0';
  }, null, { timeout: 8000 });

  // A faixa fixa é para quem está LONGE do alarme. Divergências virou destino
  // próprio, e é lá que o gestor está diante dos volumes: repetir o aviso ali
  // ensina a ignorar a faixa nas seções onde ela é a única notícia do problema.
  await irParaSecao(p, 'divergencias');
  if (await p.isVisible('.p-alerta-fixo')) throw new Error('o alarme apareceu duas vezes em Divergências');

  for (const id of ['transportadoras', 'sincronizacao']) {
    await irParaSecao(p, id);
    if (!(await p.isVisible('.p-alerta-fixo'))) throw new Error(`${id}: longe do alarme, a faixa sumiu`);
  }
  await ctx.close();
});

await passo('o badge de divergência acompanha toda seção, inclusive Divergências', async () => {
  const { ctx, p } = await painelAberto(undefined, semearDivergencia);
  // O sinal de que a divergência já foi lida do banco é o badge — o cartão que
  // se esperava aqui virou a seção `divergencias` inteira.
  await p.waitForFunction(() => {
    const b = document.querySelector('[data-badge="divergencias"]');
    return b && !b.hidden && b.textContent.trim() !== '0';
  }, null, { timeout: 8000 });

  // O badge é a contagem, não a repetição do aviso: ele fica mesmo na seção que
  // já mostra o alarme inteiro, onde a faixa se cala.
  for (const id of ['divergencias', 'transportadoras', 'sincronizacao']) {
    await irParaSecao(p, id);
    if (!(await p.isVisible('[data-badge="divergencias"]'))) throw new Error(`${id}: badge escondido`);
    const n = (await p.textContent('[data-badge="divergencias"]')).trim();
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

await passo('no celular a navegação é a barra inferior, não gaveta', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  if (await p.isVisible('.p-lateral')) throw new Error('a lateral do desktop apareceu no celular');
  if (!(await p.isVisible('.sh-barra'))) throw new Error('não há barra inferior');
  const abas = await p.$$eval('.sh-aba', (ns) => ns.map((n) => n.dataset.aba));
  const esperado = ['inicio', 'divergencias', 'conferencias', 'mapa', 'mais'];
  if (JSON.stringify(abas) !== JSON.stringify(esperado)) throw new Error(`abas: ${JSON.stringify(abas)}`);
  await ctx.close();
});

await passo('a aba navega e marca a ativa', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.sh-aba[data-aba="conferencias"]');
  await p.waitForSelector('[data-secao="conferencias"]:not([hidden])', { timeout: 4000 });
  if (!p.url().endsWith('/painel/conferencias')) throw new Error(`URL: ${p.url()}`);
  const ativa = await p.getAttribute('.sh-aba.ativa', 'data-aba');
  if (ativa !== 'conferencias') throw new Error(`aba ativa: ${ativa}`);
  await ctx.close();
});

await passo('"Mais" abre a folha com os oito restantes e fecha ao escolher', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.sh-aba[data-aba="mais"]');
  await p.waitForSelector('.ui-folha.aberta', { timeout: 4000 });
  const n = await p.$$eval('.ui-folha .p-item', (ns) => ns.length);
  if (n !== 9) throw new Error(`a folha traz ${n} itens, não 9`);
  await p.click('.ui-folha .p-item[href="/painel/rotas"]');
  await p.waitForSelector('[data-secao="rotas"]:not([hidden])', { timeout: 4000 });
  if (await p.isVisible('.ui-folha.aberta')) throw new Error('a folha ficou aberta depois de escolher');
  await ctx.close();
});

await passo('o badge da divergência aparece na aba, sem abrir nada', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.evaluate(() => window.__shell.definirBadge('divergencias', 3));
  await p.click('.sh-aba[data-aba="conferencias"]');
  await p.waitForSelector('[data-secao="conferencias"]:not([hidden])', { timeout: 4000 });
  if (!(await p.isVisible('.sh-aba[data-aba="divergencias"] .ui-badge'))) {
    throw new Error('o badge sumiu da barra');
  }
  await ctx.close();
});

await passo('os itens da folha têm alvo de toque de 44 px', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.sh-aba[data-aba="mais"]');
  await p.waitForSelector('.ui-folha.aberta', { timeout: 4000 });
  const baixos = await p.$$eval('.ui-folha .p-item', (ns) => ns
    .map((n) => ({ t: n.textContent.trim(), h: Math.round(n.getBoundingClientRect().height) }))
    .filter((i) => i.h < 44));
  if (baixos.length) throw new Error(`itens abaixo de 44px: ${JSON.stringify(baixos)}`);
  await ctx.close();
});

/** Navega pela barra ou pela folha, conforme a aba exista ou não. */
const irNoCelular = async (p, id) => {
  const aba = `.sh-aba[data-aba="${id}"]`;
  if (await p.isVisible(aba)) {
    await p.click(aba);
  } else {
    await p.click('.sh-aba[data-aba="mais"]');
    await p.waitForSelector('.ui-folha.aberta', { timeout: 4000 });
    await p.click(`.ui-folha .p-item[href="${id === 'inicio' ? '/painel' : `/painel/${id}`}"]`);
  }
  await p.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 4000 });
};

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
      await irNoCelular(p, id);
      const sobra = await medir();
      if (sobra > 1) throw new Error(`${id}: sobram ${sobra}px de rolagem horizontal`);
    }
    await ctx.close();
  });

  await passo(`o topo cabe em 64 px em ${tela.nome}`, async () => {
    const { ctx, p } = await painelAberto({ width: tela.width, height: tela.height });
    const altura = await p.evaluate(() =>
      Math.round(document.querySelector('.sh-topo').getBoundingClientRect().height));
    if (altura > 64) throw new Error(`o topo voltou a crescer: ${altura}px`);
    await ctx.close();
  });

  await passo(`o chip de sincronização aparece sem abrir nada em ${tela.nome}`, async () => {
    const { ctx, p } = await painelAberto({ width: tela.width, height: tela.height });
    await p.evaluate(() => window.__shell.definirBadge('divergencias', 9));

    // O lugar do alarme: na barra e no topo, dentro da tela, sem nenhum toque.
    for (const sel of ['.sh-aba[data-aba="divergencias"] .ui-badge', '#chip-sync-painel']) {
      if (!(await p.isVisible(sel))) throw new Error(`${sel} invisível sem abrir nada`);
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
