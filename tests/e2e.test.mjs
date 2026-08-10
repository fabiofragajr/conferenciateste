import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, isolarDaProducao, entrar as fazerLogin, SENHA as SENHA_ANTIGA, encerrarConferencia } from './cadastro.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const erros = [];

const navegador = await chromium.launch(opcoesNavegador);
const ctx = await navegador.newContext({
  viewport: { width: 420, height: 900 },
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: -23.5505, longitude: -46.6333, accuracy: 18 },
  locale: 'pt-BR'
});
const p = await ctx.newPage();

/**
 * A escuta de erro começa DEPOIS da preparação: o primeiro boot roda com o
 * caminho até a produção cortado, e o ruído de rede dessa janela é do arranjo
 * do teste, não do app. O que interessa é o app já com o cadastro na mão.
 */
const vigiarErros = (pagina, quem) => {
  pagina.on('console', (m) => { if (m.type() === 'error') erros.push(`[${quem}] ${m.text()}`); });
  pagina.on('pageerror', (e) => erros.push(`[${quem} pageerror] ${e.message}`));
};

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); process.exitCode = 1; }
};

// O aparelho recebe o cadastro da base — é assim que ele passa a existir, e
// FNOR/FSUL já nascem com donas diferentes. É essa diferença que o operador vai
// descobrir ao bipar uma caixa de FSUL na carga da LOGDIS.
await prepararAparelho(p, BASE, '/entrar');
vigiarErros(p, 'operador');

await passo('navegador sem cache orienta login normal quando está online', async () => {
  // Contexto próprio: IndexedDB vazio de verdade, e sem alcançar a base — é o
  // celular novo que ainda não conseguiu baixar o cadastro e por isso não tem
  // contra o que conferir a senha.
  const zerado = await navegador.newContext({ viewport: { width: 420, height: 900 }, locale: 'pt-BR' });
  await isolarDaProducao(zerado);
  const v = await zerado.newPage();
  await v.goto(`${BASE}/`);
  await v.waitForSelector('#dica-seed:not([hidden])', { timeout: 8000 });
  const dica = await v.textContent('#dica-seed');
  if (!/Entre normalmente.*automaticamente/.test(dica)) throw new Error(`dica: ${dica}`);
  await zerado.close();
});

await passo('login do operador', async () => {
  await p.click('#btn-sair-operacao').catch(() => {});
  await p.waitForTimeout(200);
  await fazerLogin(p, 'ana');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 5000 });
});

await passo('escolher transportadora abre a bipagem', async () => {
  // Com uma transportadora só o app pula a pergunta e já abre a câmera.
  if (await p.isVisible('#view-grupo')) await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 5000 });
});

const manual = async (codigo, rota, pedido = '86945574', volume = '0001/0002') => {
  await p.click('#btn-manual');
  await p.fill('#man-codigo', codigo);
  await p.fill('#man-rota', rota);
  await p.fill('#man-pedido', pedido);
  await p.fill('#man-volume', volume);
  await p.click('#man-confirmar');
  await p.waitForTimeout(250);
};

await passo('leitura da rota do grupo fica OK', async () => {
  await manual('EMB0008314147', 'FNOR 100');
  const st = await p.textContent('#banner-status');
  if (st.trim() !== 'Volume liberado') throw new Error(`banner: ${st}`);
  if ((await p.textContent('#c-ok')).trim() !== '1') throw new Error('contador OK errado');
});

await passo('mesmo volume de novo é duplicado', async () => {
  await manual('EMB0008314147', 'FNOR 100');
  const st = (await p.textContent('#banner-status')).trim();
  if (st !== 'Já bipado nesta conferência') throw new Error(`banner: ${st}`);
  // Duplicado e inválido somam em "Problemas": para quem está com a caixa na
  // mão a reação é a mesma, e a distinção continua a um toque, na lista.
  if ((await p.textContent('#c-prob')).trim() !== '1') throw new Error('contador de problemas errado');
});

await passo('rota de outra transportadora é divergente', async () => {
  // FSUL foi cadastrada para outra transportadora no bloco de preparação.
  await manual('EMB0008399999', 'FSUL 200');
  const st = (await p.textContent('#banner-status')).trim();
  if (st !== 'Volume de outra rota') throw new Error(`banner: ${st}`);
  const detalhe = (await p.textContent('#banner-codigo')).trim();
  if (!/Transportadora Sul/.test(detalhe)) {
    throw new Error(`a divergência precisa dizer de quem é a caixa: ${detalhe}`);
  }
});

await passo('rota sem cadastro não vira divergência', async () => {
  await manual('EMB0008377777', 'RDESC 9');
  const st = (await p.textContent('#banner-status')).trim();
  if (st !== 'Rota não cadastrada') throw new Error(`banner: ${st}`);
  const detalhe = (await p.textContent('#banner-codigo')).trim();
  if (!/avise o gestor/.test(detalhe)) throw new Error(`sem instrução do que fazer: ${detalhe}`);
});

await passo('divergência diz de quem é a caixa', async () => {
  const detalhe = await p.evaluate(() => document.querySelector('#lista-leituras .leitura .leitura-meta')?.textContent ?? '');
  if (!detalhe.trim()) throw new Error('lista de leituras vazia');
});

await passo('câmera abre sem aviso de erro por cima', async () => {
  if (await p.isVisible('#camera-erro')) {
    throw new Error(`aviso de câmera visível: ${await p.textContent('#camera-erro-txt')}`);
  }
  const tocando = await p.evaluate(() => {
    const v = document.querySelector('video');
    return !!(v && v.srcObject && v.videoWidth > 0);
  });
  if (!tocando) throw new Error('vídeo não está tocando');
});

await passo('geolocalização entra na leitura', async () => {
  const chip = (await p.textContent('#chip-geo')).trim();
  if (!/GPS/.test(chip)) throw new Error(`chip geo: ${chip}`);
});

await passo('ocorrência da entrega grava sem travar a bipagem', async () => {
  await p.click('#btn-oc-entrega');
  await p.fill('#oc-texto', 'Cheguei 7h, só me atenderam 9h20. Doca 3 fechada.');
  await p.click('.et >> nth=0');
  await p.click('#oc-salvar');
  await p.waitForSelector('#modal-ocorrencia', { state: 'hidden', timeout: 3000 });
});

await passo('ocorrência no volume marca a leitura', async () => {
  await p.click('.leitura >> nth=0 >> .btn-oc');
  await p.fill('#oc-texto', 'Caixa amassada no canto, lacre intacto.');
  await p.click('#oc-salvar');
  await p.waitForSelector('#modal-ocorrencia', { state: 'hidden', timeout: 3000 });
  if (!(await p.isVisible('.leitura.tem-oc'))) throw new Error('marcador de ocorrência não apareceu');
});

/* ---------------------------------------------- a moldura da bipagem --- */
/* A tela é a que a pessoa usa de pé, com caixa na mão. O que se prova aqui não
   é o cálculo da conferência (isso está acima), é que ela não prende ninguém e
   que a câmera continua sendo a maior coisa da tela. */

await passo('o resultado da leitura fica SOBRE a câmera, sem faixa própria', async () => {
  // A faixa de status tinha 76px fixos acima dos contadores; virou um cartão
  // flutuante na base da câmera. O que não pode mudar: a leitura nunca fica
  // sem status na tela.
  const dentroDaCamera = await p.evaluate(() =>
    !!document.querySelector('#camera-area > #banner'));
  if (!dentroDaCamera) throw new Error('o banner saiu de dentro da câmera');
  if (!(await p.isVisible('#banner'))) throw new Error('o status da leitura não está visível');
});

await passo('a câmera é a maior coisa da tela', async () => {
  // O motivo do retrabalho: a câmera tinha fatia fixa de 32vh e o resto da tela
  // era topo, faixa de status e uma lista vazia. Numa tela de 568px isso deixava
  // a leitura com menos de um terço do aparelho.
  const parte = await p.evaluate(() => {
    const c = document.querySelector('#camera-area').getBoundingClientRect().height;
    return c / window.innerHeight;
  });
  if (parte < 0.4) throw new Error(`a câmera ficou com ${Math.round(parte * 100)}% da tela`);
});

await passo('tocar em Separar mostra só o que precisa sair do caminhão', async () => {
  await p.click('.cont[data-filtro="SEPARAR"]');
  const visiveis = await p.$$eval('#lista-leituras .leitura', (ns) => ns
    .filter((n) => !n.hidden)
    .map((n) => n.dataset.status));
  if (!visiveis.length) throw new Error('o filtro escondeu tudo');
  for (const st of visiveis) {
    if (st !== 'ROTA_DIVERGENTE' && st !== 'DESTINO_NAO_MAPEADO') {
      throw new Error(`"Separar" mostrou ${st}`);
    }
  }

  // Voltar a "Lidos" tem que devolver a lista inteira: filtro que não solta é
  // conferência com metade dos volumes escondidos.
  await p.click('.cont[data-filtro="TODOS"]');
  const todos = await p.$$eval('#lista-leituras .leitura', (ns) => ns.filter((n) => !n.hidden).length);
  if (todos !== 4) throw new Error(`depois de limpar o filtro sobraram ${todos} leituras, esperadas 4`);
});

await passo('encerrar não é mais um botão fixo ao lado dos de uso diário', async () => {
  // Era um botão vermelho permanente entre "Digitar código" e "Ocorrência",
  // sendo a única ação irreversível da tela.
  const naBarra = await p.$$eval('.barra-inferior .btn', (ns) =>
    ns.map((n) => n.textContent.trim().toLowerCase()));
  if (naBarra.some((t) => t.includes('encerrar'))) throw new Error('Encerrar voltou para a barra fixa');
  if (naBarra.length !== 2) throw new Error(`a barra tem ${naBarra.length} botões, esperados 2`);
});

await p.screenshot({ path: 'tests/saida/tela-bipagem.png' });

await passo('encerrar gera relatório com alerta de divergência', async () => {
  await encerrarConferencia(p);
  await p.click('#enc-confirmar');
  await p.waitForSelector('#view-relatorio:not([hidden])', { timeout: 5000 });
  const html = await p.innerHTML('#relatorio-area');
  if (!/volume\(s\) de outra rota/.test(html)) throw new Error('alerta de divergência ausente');
  if (!/Cheguei 7h/.test(html)) throw new Error('texto da ocorrência ausente no relatório');
  if (!/0002/.test(html)) throw new Error('pedido incompleto não listado');
});

await p.screenshot({ path: 'tests/saida/tela-relatorio.png', fullPage: true });

// ---- painel do gestor (é tela de desktop, ao contrário do app de bipagem)
const g = await ctx.newPage();
await g.setViewportSize({ width: 1440, height: 900 });
vigiarErros(g, 'gestor');

// A ana (não-gestora) segue logada neste contexto, da bipagem lá em cima. Quem
// não é gestor não trava mais no painel — o boot manda pro app. Para testar o
// login do sandro, o teste precisa sair primeiro, senão nem chega no bloqueio.
await g.goto(`${BASE}/`);
await g.evaluate(() => localStorage.removeItem('logdis.usuarioLogado'));
await g.goto(`${BASE}/painel`);

/** O painel virou seções: chegar a um cartão é escolher o item do menu antes. */
const secao = async (pagina, id) => {
  await pagina.click(`.p-item[href="${id === 'inicio' ? '/painel' : `/painel/${id}`}"]`);
  await pagina.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 5000 });
};

await passo('painel do gestor exige gestor e mostra divergência do dia', async () => {
  await g.waitForSelector('#view-login:not([hidden])', { timeout: 5000 });
  await fazerLogin(g, 'sandro');
  await g.waitForSelector('#tela-painel:not([hidden])', { timeout: 5000 });
  // Espera a pintura, não a visibilidade: a seção de Pessoas nasce escondida.
  await g.waitForSelector('#lista-usuarios button[data-editar]', { state: 'attached', timeout: 10000 });
  // A divergência do dia virou seção própria — é para lá que o badge e a faixa
  // fixa apontam, e é lá que os volumes ficam.
  await secao(g, 'divergencias');
  const faixa = await g.innerHTML('[data-secao="divergencias"]');
  if (!/outra transportadora/.test(faixa)) throw new Error('divergência não apareceu na seção');
  // A lista só é montada quando a seção está visível: o painel repinta a seção
  // atual, não as treze.
  await secao(g, 'ocorrencias');
  const oc = await g.innerHTML('#oc-lista');
  if (!/Cheguei 7h/.test(oc)) throw new Error('ocorrência não listada no painel');
});

await passo('busca no texto livre da ocorrência', async () => {
  await secao(g, 'ocorrencias');
  await g.fill('#oc-busca', 'doca 3');
  await g.waitForTimeout(200);
  if (!/Cheguei 7h/.test(await g.innerHTML('#oc-lista'))) throw new Error('busca não encontrou');
  await g.fill('#oc-busca', 'zzzz');
  await g.waitForTimeout(200);
  if (!/Nenhuma ocorrência/.test(await g.innerHTML('#oc-lista'))) throw new Error('busca não filtrou');
  await g.fill('#oc-busca', '');
});

await passo('detalhe da sessão abre com mapa', async () => {
  await secao(g, 'conferencias');
  await g.click('#tabela-sessoes button[data-sessao]');
  await g.waitForSelector('#gaveta:not([hidden])', { timeout: 5000 });
  if (!/Dispersão das bipagens/.test(await g.innerHTML('#gaveta-mapa'))) throw new Error('mapa ausente');
  await g.screenshot({ path: 'tests/saida/tela-sessao.png', fullPage: true });
  await g.click('#gaveta-fechar');
  await g.waitForTimeout(200);
  // A foto do painel é a de Hoje: é a tela que o gestor abre de manhã.
  await secao(g, 'inicio');
  await g.screenshot({ path: 'tests/saida/tela-gestor.png', fullPage: true });
});

await passo('cadastro não nasce local quando o Supabase não está configurado', async () => {
  await secao(g, 'transportadoras');
  const antes = await g.innerHTML('#lista-transportadoras');
  await g.fill('#t-nome', 'Transportadora que não pode ficar local');
  await g.click('#form-transportadora button[type=submit]');
  await g.waitForTimeout(300);
  const mensagem = await g.textContent('#t-msg');
  if (!/Configure o Supabase/i.test(mensagem ?? '')) throw new Error(`mensagem: ${mensagem}`);
  if ((await g.innerHTML('#lista-transportadoras')) !== antes) throw new Error('cadastro foi alterado localmente');
});

await passo('usuário exige senha e administração autenticada', async () => {
  await secao(g, 'pessoas');
  await g.fill('#u-nome', 'Marcos Ajudante');
  await g.fill('#u-login', 'marcos');
  await g.click('#u-salvar');
  await g.waitForTimeout(200);
  if (!/senha precisa ter/i.test(await g.textContent('#u-msg') ?? '')) throw new Error('senha inicial não foi exigida');
  if (/marcos/.test(await g.innerHTML('#lista-usuarios'))) throw new Error('usuário nasceu apenas no cache');
});

await passo('rota lida sem cadastro vira fila de decisão do gestor', async () => {
  // `#nao-mapeados` e `#atencao` deixaram de ser ids do HTML: Início virou
  // módulo e monta o próprio conteúdo.
  await secao(g, 'inicio');
  const html = await g.innerHTML('[data-secao="inicio"]');
  if (!/RDESC/.test(html)) throw new Error('código não cadastrado não apareceu para o gestor');
  if (!/Precisa de atenção/.test(html)) throw new Error('bloco de atenção não destacou a pendência');
});

// ---- painel do diretor
const d = await ctx.newPage();
await d.setViewportSize({ width: 1440, height: 900 });
vigiarErros(d, 'indicadores');
await d.goto(`${BASE}/painel/indicadores`);

await passo('painel do diretor mostra indicadores e tendência', async () => {
  await d.waitForSelector('#tela-painel:not([hidden])', { timeout: 5000 });
  // `#tela-painel` aparece antes de os blocos pintarem: espera o conteúdo, não a
  // caixa vazia. Sem isto o teste falha uma vez a cada tantas rodadas.
  await d.waitForFunction(
    () => (document.querySelector('#kpis')?.textContent ?? '').includes('Taxa de divergência'),
    null,
    { timeout: 10000 }
  );
  const kpis = await d.innerHTML('#kpis');
  if (!/Taxa de divergência de rota/.test(kpis)) throw new Error('KPI ausente');
  if (!/informe as cargas previstas/i.test(kpis)) throw new Error('cobertura deveria pedir o número');
  if (!/svg/.test(await d.innerHTML('#tendencias'))) throw new Error('gráficos de tendência ausentes');
  // painel largo não pode ter barra de rolagem horizontal no corpo
  const estoura = await d.evaluate(() => document.body.scrollWidth > window.innerWidth + 1);
  if (estoura) throw new Error('corpo do painel rola na horizontal');
  await d.screenshot({ path: 'tests/saida/tela-diretor.png', fullPage: true });
});

await passo('sem erros de console', () => {
  const relevantes = erros.filter((e) => !/favicon|Failed to load resource.*404/.test(e));
  if (relevantes.length) throw new Error(relevantes.join('\n      '));
});

await navegador.close();
servidor.parar();
console.log(process.exitCode ? '\nFALHAS ACIMA' : '\nE2E_OK');
