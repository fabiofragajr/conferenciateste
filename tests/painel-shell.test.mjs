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
  // `#tela-painel` deixa de estar hidden ANTES de o shell montar: o roteador
  // troca a tela e só então importa o painel. Quem seguia daqui direto clicava
  // num menu que ainda não existia — e a falha aparecia num teste diferente a
  // cada rodada, conforme a máquina estivesse mais ou menos carregada.
  // `window.__shell` é a última coisa que `iniciarPainel` define.
  await p.waitForFunction(() => !!window.__shell, null, { timeout: 10000 });
  return { ctx, p };
};

const SECOES = [
  'conferencias', 'ocorrencias', 'desempenho', 'mapa', 'relatorios',
  'pessoas', 'transportadoras', 'rotas', 'sincronizacao'
];

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
      lat: -23.5505 + n * 0.0001,
      lng: -46.6333 + n * 0.0001,
      precisaoMetros: 12,
      geoStatus: 'OK'
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

await passo('Mapa mostra posições e cobertura em vez do placeholder', async () => {
  const { ctx, p } = await painelAberto(undefined, semearDivergencia);
  await irParaSecao(p, 'mapa');
  await p.waitForSelector('#mapa-resultado .p-mapa svg', { timeout: 4000 });
  const texto = await p.textContent('[data-secao="mapa"]');
  if (/Carregando/.test(texto)) throw new Error('o placeholder continuou na tela');
  if (!/Cobertura por conferência/.test(texto)) throw new Error('a cobertura não foi exibida');
  if (!/2 \(100%\)/.test(texto)) throw new Error(`a cobertura das duas leituras está errada: ${texto}`);
  await ctx.close();
});

await passo('Relatórios lista conferências e baixa CSV individual e consolidado', async () => {
  const { ctx, p } = await painelAberto(undefined, semearDivergencia);
  await irParaSecao(p, 'relatorios');
  await p.waitForSelector('.p-exportar summary', { timeout: 4000 });
  const texto = await p.textContent('[data-secao="relatorios"]');
  if (/Carregando/.test(texto)) throw new Error('o placeholder continuou na tela');
  if (!/Sandro|Ana Paula/.test(texto)) throw new Error('a conferência não apareceu na lista');

  await p.click('.p-exportar summary');
  const individual = p.waitForEvent('download');
  await p.click('button[data-rel-csv]');
  if (!(await individual).suggestedFilename().endsWith('.csv')) {
    throw new Error('o CSV individual não foi baixado');
  }

  const consolidado = p.waitForEvent('download');
  await p.click('#rel-csv-periodo');
  if ((await consolidado).suggestedFilename() !== 'conferencias_periodo.csv') {
    throw new Error('o CSV consolidado saiu com nome inesperado');
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
  const esperado = ['inicio', 'divergencias', 'bipagem', 'conferencias', 'mais'];
  if (JSON.stringify(abas) !== JSON.stringify(esperado)) throw new Error(`abas: ${JSON.stringify(abas)}`);
  const bipar = await p.$eval('.sh-aba-bipar', (n) => {
    const estilo = getComputedStyle(n);
    return { href: n.getAttribute('href'), fundo: estilo.backgroundColor, cor: estilo.color };
  });
  if (bipar.href !== '/bipagem') throw new Error(`atalho da bipagem aponta para ${bipar.href}`);
  if (bipar.fundo === 'rgba(0, 0, 0, 0)' || bipar.fundo === bipar.cor) {
    throw new Error('atalho da bipagem não está destacado');
  }
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

await passo('"Mais" abre a folha com as seções restantes e fecha ao escolher', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.sh-aba[data-aba="mais"]');
  await p.waitForSelector('.ui-folha.aberta', { timeout: 4000 });
  const n = await p.$$eval('.ui-folha .p-item', (ns) => ns.length);
  if (n !== 10) throw new Error(`a folha traz ${n} itens, não 10`);
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

await passo('filtros recolhidos no celular abrem e anunciam o estado', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await irNoCelular(p, 'mapa');
  const botao = '[data-secao="mapa"] .ui-filtros-abrir';
  if (await p.getAttribute(botao, 'aria-expanded') !== 'false') {
    throw new Error('o filtro não começou recolhido');
  }
  await p.click(botao);
  if (await p.getAttribute(botao, 'aria-expanded') !== 'true') {
    throw new Error('o botão não anunciou a abertura');
  }
  if (!await p.isVisible('[data-secao="mapa"] .ui-filtros-campos')) {
    throw new Error('os campos continuaram escondidos');
  }
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
      await irNoCelular(p, id);
      const sobra = await medir();
      if (sobra > 1) throw new Error(`${id}: sobram ${sobra}px de rolagem horizontal`);
    }
    await ctx.close();
  });

  await passo(`o topo cabe em 64 px em ${tela.nome}`, async () => {
    const { ctx, p } = await painelAberto({ width: tela.width, height: tela.height });
    // `#tela-painel` deixa de estar `hidden` antes de o shell montar: o roteador
    // troca a tela e só então importa o painel. Medir sem esperar a barra pegava
    // `null` de vez em quando.
    await p.waitForSelector('.sh-topo', { timeout: 8000 });
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

/* ------------------------------------------------- grupos recolhíveis --- */
/* O recolhimento abriu um buraco na regra mais dura do painel: item escondido
   leva o badge junto, e o alarme do dia sumiria da tela sem ninguém pedir. */

const GRUPO_OPERACAO = '.p-lateral [data-grupo-cab="Operação"]';

await passo('recolher o grupo sobe a contagem para o cabeçalho, em vez de apagá-la', async () => {
  const { ctx, p } = await painelAberto(undefined, semearDivergencia);
  await p.waitForFunction(() => {
    const b = document.querySelector('[data-badge="divergencias"]');
    return b && !b.hidden && b.textContent.trim() !== '0';
  }, null, { timeout: 8000 });

  // Aberto: o número está no item, e o cabeçalho se cala — o mesmo número duas
  // vezes na mesma coluna lê como dois problemas.
  if (await p.isVisible('.p-lateral [data-badge-grupo="Operação"]')) {
    throw new Error('grupo aberto repetiu a contagem no cabeçalho');
  }

  await p.click(GRUPO_OPERACAO);
  await p.waitForSelector('.p-lateral .p-item[data-item="divergencias"]', { state: 'hidden', timeout: 4000 });

  const badgeGrupo = '.p-lateral [data-badge-grupo="Operação"]';
  if (!(await p.isVisible(badgeGrupo))) {
    throw new Error('recolher Operação apagou o alarme do dia da tela');
  }
  const n = (await p.textContent(badgeGrupo)).trim();
  if (n !== String(DIVERGENCIAS)) throw new Error(`o cabeçalho diz ${n}, e são ${DIVERGENCIAS}`);

  // E a faixa fixa, a outra trava, continua de pé em qualquer seção.
  await irParaSecao(p, 'sincronizacao');
  if (!(await p.isVisible('.p-alerta-fixo'))) throw new Error('a faixa sumiu com o grupo recolhido');
  await ctx.close();
});

await passo('o cabeçalho diz se está aberto ou fechado, e responde ao teclado', async () => {
  const { ctx, p } = await painelAberto();
  const lido = () => p.getAttribute(GRUPO_OPERACAO, 'aria-expanded');
  if ((await lido()) !== 'true') throw new Error('o grupo nasceu fechado');

  await p.focus(GRUPO_OPERACAO);
  await p.keyboard.press('Space');
  if ((await lido()) !== 'false') throw new Error('Espaço não recolheu o grupo');
  await p.keyboard.press('Enter');
  if ((await lido()) !== 'true') throw new Error('Enter não reabriu o grupo');

  // `aria-controls` precisa apontar para a lista que o botão realmente abre.
  const ok = await p.evaluate((sel) => {
    const cab = document.querySelector(sel);
    const lista = document.getElementById(cab.getAttribute('aria-controls'));
    return !!lista && lista.classList.contains('p-grupo-itens') && cab.parentElement.contains(lista);
  }, GRUPO_OPERACAO);
  if (!ok) throw new Error('aria-controls não aponta para a lista do próprio grupo');
  await ctx.close();
});

await passo('o recolhimento sobrevive ao F5', async () => {
  const { ctx, p } = await painelAberto();
  await p.click('.p-lateral [data-grupo-cab="Cadastros"]');
  await p.waitForSelector('.p-lateral .p-item[data-item="rotas"]', { state: 'hidden', timeout: 4000 });
  await p.reload();
  await p.waitForSelector('.p-lateral [data-grupo-cab="Cadastros"]', { timeout: 8000 });
  const estado = await p.getAttribute('.p-lateral [data-grupo-cab="Cadastros"]', 'aria-expanded');
  if (estado !== 'false') throw new Error('o painel esqueceu o grupo recolhido');
  await ctx.close();
});

await passo('a seção aberta por URL nunca fica escondida no menu', async () => {
  const { ctx, p } = await painelAberto();
  await p.click('.p-lateral [data-grupo-cab="Cadastros"]');
  await p.waitForSelector('.p-lateral .p-item[data-item="rotas"]', { state: 'hidden', timeout: 4000 });

  // Link colado de um e-mail cai numa seção do grupo que a pessoa recolheu.
  await p.goto(`${BASE}/painel/rotas`);
  await p.waitForSelector('[data-secao="rotas"]:not([hidden])', { timeout: 8000 });
  if (!(await p.isVisible('.p-lateral .p-item[data-item="rotas"].ativo'))) {
    throw new Error('a página atual ficou invisível no menu');
  }
  await ctx.close();
});

await passo('cada item do menu tem ícone desenhado, e nenhum é texto', async () => {
  const { ctx, p } = await painelAberto();
  const itens = await p.$$eval('.p-lateral .p-item', (ns) => ns.map((n) => ({
    id: n.dataset.item,
    svgs: n.querySelectorAll('.p-item-icone svg').length,
    texto: n.querySelector('.p-item-icone').textContent.trim()
  })));
  if (itens.length !== 13) throw new Error(`${itens.length} itens na coluna, esperados 13`);
  for (const i of itens) {
    if (i.svgs !== 1) throw new Error(`${i.id}: ${i.svgs} ícones`);
    if (i.texto) throw new Error(`${i.id}: o ícone ainda é o caractere "${i.texto}"`);
  }
  // Desenhos diferentes: dois destinos com o mesmo `<path>` é ícone que não
  // distingue nada, e some na primeira olhada de relance. O botão "Abrir
  // bipagem" entra na conta — ele nasceu reusando a prancheta de Conferências,
  // que é o mesmo defeito dos glifos antigos com outra roupa. As setas de grupo
  // ficam de fora: ali a repetição é o ponto, as quatro fazem o mesmo gesto.
  const formas = await p.$$eval(
    '.p-lateral .p-item-icone svg, .p-lateral .p-lateral-rodape svg',
    (ns) => ns.map((n) => n.innerHTML)
  );
  if (formas.length !== 14) throw new Error(`${formas.length} desenhos na coluna, esperados 14`);
  if (new Set(formas).size !== formas.length) throw new Error('há destinos compartilhando o mesmo desenho');
  await ctx.close();
});

await passo('a trilha diz o grupo e a seção, sem repetir o título da página', async () => {
  const { ctx, p } = await painelAberto();
  await irParaSecao(p, 'rotas');
  const grupo = (await p.textContent('.sh-trilha-grupo')).trim();
  const secao = (await p.textContent('.sh-trilha-secao')).trim();
  if (grupo !== 'Cadastros') throw new Error(`trilha diz o grupo "${grupo}"`);
  if (secao !== 'Códigos de rota') throw new Error(`trilha diz a seção "${secao}"`);
  await ctx.close();
});

await passo('no celular a folha traz a mesma árvore, e o cabeçalho não a fecha', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.sh-aba[data-aba="mais"]');
  await p.waitForSelector('.ui-folha.aberta', { timeout: 4000 });

  // Cabeçalho de grupo é <button>, e a folha fecha em qualquer <button>. Sem a
  // exceção, pedir para recolher "Cadastros" fecharia o menu inteiro.
  await p.click('.ui-folha [data-grupo-cab="Cadastros"]');
  if (!(await p.isVisible('.ui-folha.aberta'))) throw new Error('recolher um grupo fechou a folha');
  if (await p.isVisible('.ui-folha .p-item[href="/painel/rotas"]')) {
    throw new Error('o grupo não recolheu na folha');
  }

  // E escolher um item continua fechando: ninguém toca duas vezes para navegar.
  await p.click('.ui-folha .p-item[href="/painel/ocorrencias"]');
  await p.waitForSelector('[data-secao="ocorrencias"]:not([hidden])', { timeout: 4000 });
  if (await p.isVisible('.ui-folha.aberta')) throw new Error('a folha ficou aberta depois de escolher');
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSHELL_OK');
