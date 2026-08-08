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

await p.goto(`${BASE}/index.html`);

await passo('login do operador', async () => {
  await p.fill('#in-login', 'operador');
  await p.fill('#in-senha', 'operador');
  await p.click('#form-login button[type=submit]');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 5000 });
});

await passo('escolher grupo abre a bipagem', async () => {
  await p.click('.grupo-btn >> nth=0');
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

await passo('rota de fora do grupo é divergente', async () => {
  await manual('EMB0008399999', 'FSUL 200');
  const st = (await p.textContent('#banner-status')).trim();
  if (st !== 'Volume de outra rota') throw new Error(`banner: ${st}`);
  if ((await p.textContent('#c-div')).trim() !== '1') throw new Error('contador divergente errado');
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

// ---- painel do gestor
const g = await ctx.newPage();
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
  await g.screenshot({ path: 'tests/saida/tela-gestor.png', fullPage: true });
  await g.click('#gaveta-fechar');
});

await passo('cadastro de grupo de rota', async () => {
  await g.fill('#g-nome', 'Carga Leste');
  await g.fill('#g-rotas', 'FLES, FNOR');
  await g.click('#form-grupo button[type=submit]');
  await g.waitForTimeout(400);
  if (!/Carga Leste/.test(await g.innerHTML('#lista-grupos'))) throw new Error('grupo não cadastrado');
});

// ---- painel do diretor
const d = await ctx.newPage();
d.on('console', (m) => { if (m.type() === 'error') erros.push(`[diretor] ${m.text()}`); });
d.on('pageerror', (e) => erros.push(`[diretor pageerror] ${e.message}`));
await d.goto(`${BASE}/diretor.html`);

await passo('painel do diretor mostra indicadores e tendência', async () => {
  await d.waitForSelector('#conteudo:not([hidden])', { timeout: 5000 });
  const kpis = await d.innerHTML('#kpis');
  if (!/Taxa de divergência de rota/.test(kpis)) throw new Error('KPI ausente');
  if (!/informe as cargas previstas/.test(kpis)) throw new Error('cobertura deveria pedir o número');
  if (!/svg/.test(await d.innerHTML('#tendencias'))) throw new Error('gráficos de tendência ausentes');
  await d.screenshot({ path: 'tests/saida/tela-diretor.png', fullPage: true });
});

await passo('sem erros de console', () => {
  const relevantes = erros.filter((e) => !/favicon|Failed to load resource.*404/.test(e));
  if (relevantes.length) throw new Error(relevantes.join('\n      '));
});

await navegador.close();
servidor.parar();
console.log(process.exitCode ? '\nFALHAS ACIMA' : '\nE2E_OK');
