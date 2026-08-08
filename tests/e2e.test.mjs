import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';

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
p.on('console', (m) => { if (m.type() === 'error') erros.push(`[console] ${m.text()}`); });
p.on('pageerror', (e) => erros.push(`[pageerror] ${e.message}`));

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); process.exitCode = 1; }
};

// Preparação: o cadastro é do gestor, e é ele que dá sentido à divergência.
// FSUL passa a ser de outra transportadora — é isso que o operador vai
// descobrir ao bipar uma caixa dela na carga errada.
await p.goto(`${BASE}/gestor.html`);
await passo('preparar cadastro (gestor)', async () => {
  await p.waitForSelector('#bloqueio:not([hidden])', { timeout: 8000 });
  await p.fill('#in-login', 'gestor');
  await p.fill('#in-senha', 'gestor');
  await p.click('#form-login button[type=submit]');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });

  await p.fill('#t-nome', 'Transportadora Sul');
  await p.click('#form-transportadora button[type=submit]');
  await p.waitForTimeout(400);

  const opcoes = await p.$$eval('#r-transportadora option', (os) => os.map((o) => [o.value, o.textContent.trim()]));
  const sul = opcoes.find(([, t]) => t === 'Transportadora Sul');
  if (!sul) throw new Error('transportadora não entrou no select');

  // FSUL nasceu do seed na transportadora LOGDIS: desativa e recadastra na Sul.
  await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const banco = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const tx = banco.transaction('rotas', 'readwrite');
    const todas = await new Promise((ok) => {
      const r = tx.objectStore('rotas').getAll();
      r.onsuccess = () => ok(r.result);
    });
    for (const rota of todas) {
      if (rota.codigo === 'FSUL') tx.objectStore('rotas').delete(rota.id);
    }
  });
  await p.waitForTimeout(200);

  await p.selectOption('#r-transportadora', sul[0]);
  await p.fill('#r-codigo', 'FSUL');
  await p.fill('#r-nome', 'Carga Sul');
  await p.click('#form-rota button[type=submit]');
  await p.waitForTimeout(400);
  if (!/Transportadora Sul/.test(await p.innerHTML('#lista-rotas'))) {
    throw new Error('FSUL não ficou com a Transportadora Sul');
  }
});

await p.goto(`${BASE}/index.html`);

await passo('login do operador', async () => {
  await p.click('#btn-sair').catch(() => {});
  await p.waitForTimeout(200);
  await p.fill('#in-login', 'operador');
  await p.fill('#in-senha', 'operador');
  await p.click('#form-login button[type=submit]');
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
g.on('console', (m) => { if (m.type() === 'error') erros.push(`[gestor] ${m.text()}`); });
g.on('pageerror', (e) => erros.push(`[gestor pageerror] ${e.message}`));
await g.goto(`${BASE}/gestor.html`);

await passo('painel do gestor exige gestor e mostra divergência do dia', async () => {
  await g.waitForSelector('#bloqueio:not([hidden])', { timeout: 5000 });
  await g.fill('#in-login', 'gestor');
  await g.fill('#in-senha', 'gestor');
  await g.click('#form-login button[type=submit]');
  await g.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
  const faixa = await g.innerHTML('#faixa-divergencia');
  if (!/outra rota hoje/.test(faixa)) throw new Error('faixa de divergência não apareceu');
  const oc = await g.innerHTML('#oc-lista');
  if (!/Cheguei 7h/.test(oc)) throw new Error('ocorrência não listada no painel');
});

await passo('busca no texto livre da ocorrência', async () => {
  await g.fill('#oc-busca', 'doca 3');
  await g.waitForTimeout(200);
  if (!/Cheguei 7h/.test(await g.innerHTML('#oc-lista'))) throw new Error('busca não encontrou');
  await g.fill('#oc-busca', 'zzzz');
  await g.waitForTimeout(200);
  if (!/Nenhuma ocorrência/.test(await g.innerHTML('#oc-lista'))) throw new Error('busca não filtrou');
  await g.fill('#oc-busca', '');
});

await passo('detalhe da sessão abre com mapa', async () => {
  await g.click('#tabela-sessoes button[data-sessao]');
  await g.waitForSelector('#gaveta:not([hidden])', { timeout: 5000 });
  if (!/Dispersão das bipagens/.test(await g.innerHTML('#gaveta-mapa'))) throw new Error('mapa ausente');
  await g.screenshot({ path: 'tests/saida/tela-sessao.png', fullPage: true });
  await g.click('#gaveta-fechar');
  await g.waitForTimeout(200);
  await g.screenshot({ path: 'tests/saida/tela-gestor.png', fullPage: true });
});

await passo('cadastro de transportadora e código de rota', async () => {
  await g.fill('#t-nome', 'Transportadora Beta');
  await g.click('#form-transportadora button[type=submit]');
  await g.waitForTimeout(400);
  if (!/Transportadora Beta/.test(await g.innerHTML('#lista-transportadoras'))) {
    throw new Error('transportadora não cadastrada');
  }

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
d.on('console', (m) => { if (m.type() === 'error') erros.push(`[diretor] ${m.text()}`); });
d.on('pageerror', (e) => erros.push(`[diretor pageerror] ${e.message}`));
await d.goto(`${BASE}/diretor.html`);

await passo('painel do diretor mostra indicadores e tendência', async () => {
  await d.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
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
