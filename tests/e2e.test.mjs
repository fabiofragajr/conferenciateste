import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, isolarDaProducao, entrar as fazerLogin, SENHA as SENHA_ANTIGA } from './cadastro.mjs';

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
await prepararAparelho(p, BASE, 'index.html');
vigiarErros(p, 'operador');

await passo('aparelho sem cadastro avisa em vez de recusar a senha certa', async () => {
  // Contexto próprio: IndexedDB vazio de verdade, e sem alcançar a base — é o
  // celular novo que ainda não conseguiu baixar o cadastro e por isso não tem
  // contra o que conferir a senha.
  const zerado = await navegador.newContext({ viewport: { width: 420, height: 900 }, locale: 'pt-BR' });
  await isolarDaProducao(zerado);
  const v = await zerado.newPage();
  await v.goto(`${BASE}/index.html`);
  await v.waitForSelector('#dica-seed:not([hidden])', { timeout: 8000 });
  const dica = await v.textContent('#dica-seed');
  if (!/ainda não recebeu o cadastro/.test(dica)) throw new Error(`dica: ${dica}`);
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
  if ((await p.textContent('#c-dup')).trim() !== '1') throw new Error('contador duplicado errado');
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

await p.screenshot({ path: 'tests/saida/tela-bipagem.png' });

await passo('encerrar gera relatório com alerta de divergência', async () => {
  await p.click('#btn-encerrar');
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
await g.goto(`${BASE}/index.html`);
await g.evaluate(() => localStorage.removeItem('logdis.usuarioLogado'));
await g.goto(`${BASE}/gestor.html`);

/** O painel virou seções: chegar a um cartão é escolher o item do menu antes. */
const secao = async (pagina, id) => {
  await pagina.click(`.p-item[href="#${id}"]`);
  await pagina.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 5000 });
};

await passo('painel do gestor exige gestor e mostra divergência do dia', async () => {
  await g.waitForSelector('#bloqueio:not([hidden])', { timeout: 5000 });
  await fazerLogin(g, 'sandro');
  await g.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
  // Espera a pintura, não a visibilidade: a seção de Pessoas nasce escondida.
  await g.waitForSelector('#lista-usuarios button[data-editar]', { state: 'attached', timeout: 10000 });
  const faixa = await g.innerHTML('#faixa-divergencia');
  if (!/outra rota hoje/.test(faixa)) throw new Error('faixa de divergência não apareceu');
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
  await secao(g, 'hoje');
  await g.screenshot({ path: 'tests/saida/tela-gestor.png', fullPage: true });
});

await passo('cadastro de transportadora e código de rota', async () => {
  await secao(g, 'transportadoras');
  await g.fill('#t-nome', 'Transportadora Beta');
  await g.click('#form-transportadora button[type=submit]');
  await g.waitForTimeout(400);
  if (!/Transportadora Beta/.test(await g.innerHTML('#lista-transportadoras'))) {
    throw new Error('transportadora não cadastrada');
  }

  await secao(g, 'rotas');
  const opcoes = await g.$$eval('#r-transportadora option', (os) => os.map((o) => [o.value, o.textContent.trim()]));
  const beta = opcoes.find(([, t]) => t === 'Transportadora Beta');
  await g.selectOption('#r-transportadora', beta[0]);
  await g.fill('#r-codigo', 'FLES');
  await g.fill('#r-nome', 'Carga Leste');
  await g.click('#form-rota button[type=submit]');
  await g.waitForTimeout(400);
  if (!/FLES/.test(await g.innerHTML('#lista-rotas'))) throw new Error('rota não cadastrada');
});

await passo('código de rota não pode ter dois donos', async () => {
  await secao(g, 'rotas');
  const opcoes = await g.$$eval('#r-transportadora option', (os) => os.map((o) => [o.value, o.textContent.trim()]));
  const beta = opcoes.find(([, t]) => t === 'Transportadora Beta');
  await g.selectOption('#r-transportadora', beta[0]);
  await g.fill('#r-codigo', 'FNOR');
  await g.fill('#r-nome', 'Tentativa duplicada');
  await g.click('#form-rota button[type=submit]');
  await g.waitForTimeout(300);
  const msg = await g.textContent('#r-msg');
  if (!/já pertence/.test(msg ?? '')) throw new Error(`esperava recusa por duplicidade, veio: ${msg}`);
});

// ---- acessos: o gestor cria e administra quem entra, sem e-mail no caminho
await passo('gestor cria acesso sem senha e sem e-mail', async () => {
  await secao(g, 'pessoas');
  await g.fill('#u-nome', 'Marcos Ajudante');
  await g.fill('#u-login', 'marcos');
  await g.fill('#u-funcao', 'Ajudante');
  await g.click('#u-salvar');
  await g.waitForTimeout(400);
  const lista = await g.innerHTML('#lista-usuarios');
  if (!/marcos/.test(lista)) throw new Error('acesso não apareceu na lista');
  if (!/escolhe na 1ª entrada/.test(lista)) throw new Error('deveria indicar senha pendente');
});

await passo('quem foi cadastrado hoje entra hoje', async () => {
  const ctxMarcos = await navegador.newContext({ viewport: { width: 420, height: 900 }, locale: 'pt-BR' });
  const m = await ctxMarcos.newPage();
  await prepararAparelho(m, BASE, 'index.html');
  // O aparelho do Marcos não conhece o login novo: entrega como a base entregaria.
  await m.evaluate(async (novo) => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    await new Promise((ok) => {
      const tx = bd.transaction('usuarios', 'readwrite');
      tx.objectStore('usuarios').put(novo);
      tx.oncomplete = ok;
    });
    bd.close();
  }, {
    id: '00000000-0000-4000-8000-000000000003', nome: 'Marcos Ajudante', login: 'marcos',
    senhaHash: '', gestor: false, funcao: 'Ajudante', telefone: '', placa: '', ativo: true,
    sync: 'ENVIADO', syncTentativas: 0, syncErro: null, atualizadoEm: '2026-01-01T00:00:00.000Z'
  });
  await m.reload();
  await fazerLogin(m, 'marcos', 'senha-do-marcos');
  await m.waitForSelector('#view-grupo:not([hidden])', { timeout: 5000 });
  await ctxMarcos.close();
});

await passo('editar acesso pelo mesmo formulário', async () => {
  await secao(g, 'pessoas');
  await g.click('#lista-usuarios button[data-editar]>>nth=0');
  await g.waitForTimeout(200);
  if ((await g.textContent('#u-salvar')).trim() !== 'Salvar') throw new Error('form não entrou em edição');
  await g.fill('#u-funcao', 'Conferente sênior');
  await g.click('#u-salvar');
  await g.waitForTimeout(400);
  if (!/Conferente sênior/.test(await g.innerHTML('#lista-usuarios'))) {
    throw new Error('edição não gravou');
  }
  if ((await g.textContent('#u-salvar')).trim() !== 'Cadastrar') throw new Error('form não voltou ao modo cadastro');
});

await passo('redefinir senha devolve a escolha para a pessoa', async () => {
  await secao(g, 'pessoas');
  const linhas = await g.$$('#lista-usuarios tbody tr');
  let alvo = null;
  for (const linha of linhas) {
    if (/marcos/.test(await linha.innerHTML())) alvo = linha;
  }
  if (!alvo) throw new Error('linha do marcos não encontrada');
  await (await alvo.$('button[data-senha]')).click();
  await g.waitForTimeout(400);
  if (!/escolhe a nova senha/.test(await g.textContent('#u-ok'))) {
    throw new Error('sem confirmação do que acontece agora');
  }
});

await passo('gestor troca a própria senha na tela', async () => {
  // O acesso nasce com uma senha provisória que alguém entregou na mão. Trocar
  // sozinho, sem pedir nada a ninguém, é o que faz essa senha deixar de rodar
  // pela operação.
  await secao(g, 'pessoas');
  const linhas = await g.$$('#lista-usuarios tbody tr');
  let minha = null;
  for (const linha of linhas) {
    if (/sandro/.test(await linha.innerHTML())) minha = linha;
  }
  if (!minha) throw new Error('o gestor não se encontra na lista');
  await (await minha.$('button[data-editar]')).click();
  await g.waitForTimeout(200);

  await g.fill('#u-senha', 'nova-senha-do-sandro');
  await g.click('#u-salvar');
  await g.waitForTimeout(500);

  await g.click('#btn-sair');
  await g.waitForSelector('#bloqueio:not([hidden])', { timeout: 5000 });

  await fazerLogin(g, 'sandro', SENHA_ANTIGA);
  await g.waitForSelector('#login-erro:not([hidden])', { timeout: 5000 });
  if (await g.isVisible('#conteudo:not([hidden])')) throw new Error('a senha antiga ainda entra');

  await fazerLogin(g, 'sandro', 'nova-senha-do-sandro');
  await g.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
});

await passo('gestor não consegue tirar o próprio acesso', async () => {
  await secao(g, 'pessoas');
  const linhas = await g.$$('#lista-usuarios tbody tr');
  let alvo = null;
  for (const linha of linhas) {
    if (/sandro/.test(await linha.innerHTML())) alvo = linha;
  }
  await (await alvo.$('button[data-usuario]')).click();
  await g.waitForTimeout(300);
  if (!/não pode desativar o próprio acesso/.test(await g.textContent('#u-msg'))) {
    throw new Error('deixou o gestor se trancar para fora');
  }
});

await passo('rota lida sem cadastro vira fila de decisão do gestor', async () => {
  const html = await g.innerHTML('#nao-mapeados');
  if (!/RDESC/.test(html)) throw new Error('código não cadastrado não apareceu para o gestor');
  if (!/Precisa de atenção/.test(await g.innerHTML('#atencao'))) {
    throw new Error('bloco de atenção não destacou a pendência');
  }
});

// ---- painel do diretor
const d = await ctx.newPage();
await d.setViewportSize({ width: 1440, height: 900 });
vigiarErros(d, 'diretor');
await d.goto(`${BASE}/diretor.html`);

await passo('painel do diretor mostra indicadores e tendência', async () => {
  await d.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
  // `#conteudo` aparece antes de os blocos pintarem: espera o conteúdo, não a
  // caixa vazia. Sem isto o teste falha uma vez a cada tantas rodadas.
  await d.waitForFunction(
    () => (document.querySelector('#kpis')?.textContent ?? '').includes('Taxa de divergência'),
    null,
    { timeout: 10000 }
  );
  const kpis = await d.innerHTML('#kpis');
  if (!/Taxa de divergência de rota/.test(kpis)) throw new Error('KPI ausente');
  if (!/informe as cargas previstas/.test(kpis)) throw new Error('cobertura deveria pedir o número');
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
