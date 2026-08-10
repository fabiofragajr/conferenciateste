import assert from 'node:assert/strict';
import { plural, vazio, badge, alerta, kpis, secao, pageHeader, status } from '../src/lib/ui/basico.ts';
import { tabela } from '../src/lib/ui/tabela.ts';
import { botao, campo, selecao, filtros } from '../src/lib/ui/forma.ts';
import { sinalSync } from '../src/lib/ui/sinal-sync.ts';

/* ----------------------------------------------------------- plural ------ */
// "1 volume(s)" é texto de sistema. A tela é de produto.
assert.equal(plural(1, 'volume', 'volumes'), '1 volume');
assert.equal(plural(0, 'volume', 'volumes'), 'nenhum volume');
assert.equal(plural(3, 'volume', 'volumes'), '3 volumes');
assert.equal(plural(2, 'pedido incompleto', 'pedidos incompletos'), '2 pedidos incompletos');

/* ------------------------------------------------------------ vazio ------ */
// Estado vazio é uma linha, nunca um cartão com título.
const v = vazio('Nenhuma conferência aberta.');
assert.ok(v.includes('Nenhuma conferência aberta.'));
assert.ok(!/<h[1-6]/.test(v), 'estado vazio não tem título próprio');
assert.ok(v.includes('ui-vazio'));

// Com ação, o vazio vira saída: erro nunca é beco sem saída.
const v2 = vazio('Cobertura indisponível.', { rotulo: 'Configurar', href: '/painel/sincronizacao' });
assert.ok(v2.includes('Configurar') && v2.includes('/painel/sincronizacao'));

/* ------------------------------------------------------------ badge ------ */
assert.equal(badge(0, 'alarme'), '', 'badge zerado não desenha nada');
assert.ok(badge(3, 'alarme').includes('3'));

/* ----------------------------------------------------------- status ------ */
// Cor nunca sozinha: verde e vermelho são o pior par para daltonismo, e o
// gestor lê isto numa tabela densa. Texto sempre; forma além da cor.
const st = status('ROTA_DIVERGENTE');
assert.ok(st.includes('Divergente'), 'status carrega o texto');
assert.ok(st.includes('#dc2626'), 'status carrega a cor de STATUS_INFO');
assert.ok(/aria-label="[^"]+"/.test(st), 'status tem rótulo acessível');
// A forma vem do mesmo dicionário do mapa: triângulo é divergência nos dois.
assert.notEqual(status('OK'), status('ROTA_DIVERGENTE'));
assert.ok(!status('OK').includes('Divergente'));

/* ----------------------------------------------------------- alerta ------ */
const a = alerta({ tom: 'alarme', titulo: '1 volume de outra transportadora',
                   texto: 'Não pode embarcar.', acao: { rotulo: 'Ver volume', href: '/painel/divergencias' } });
assert.ok(a.includes('ui-alerta') && a.includes('alarme'));
assert.ok(a.includes('1 volume de outra transportadora'));
assert.ok(a.includes('/painel/divergencias'));

/* -------------------------------------------------------------- kpis ----- */
const k = kpis([
  { rotulo: 'Volumes', valor: 4315 },
  { rotulo: 'Divergências', valor: 3, tom: 'alarme' }
]);
assert.ok(k.includes('4.315') || k.includes('4315'));
assert.ok(k.includes('Divergências'));

/* ------------------------------------------------------- escape --------- */
// Tudo aqui recebe texto de cadastro, e cadastro tem aspas e sinal de maior.
assert.ok(!vazio('<b>x</b>').includes('<b>x</b>'));
assert.ok(!kpis([{ rotulo: '<b>x</b>', valor: 1 }]).includes('<b>x</b>'));
assert.ok(!secao({ titulo: '<b>x</b>', corpo: '<p>ok</p>' }).includes('<b>x</b>'));
// O corpo é HTML montado por nós, e não pode ser escapado — senão a tabela some.
assert.ok(secao({ titulo: 'T', corpo: '<p>ok</p>' }).includes('<p>ok</p>'));

/* -------------------------------------------------------- pageHeader ----- */
const ph = pageHeader({ titulo: 'Início', sub: 'sábado, 8 de agosto' });
assert.ok(ph.includes('Início') && ph.includes('sábado'));

/* ------------------------------------------------------------ tabela ---- */
const t = tabela({
  colunas: [
    { chave: 'codigo', rotulo: 'Código' },
    { chave: 'rota', rotulo: 'Rota lida' },
    { chave: 'hora', rotulo: 'Hora', alinhar: 'direita' }
  ],
  linhas: [
    { codigo: 'EMB0008399999', rota: 'FSUL 200', hora: '19:05' }
  ],
  vazio: 'Nenhum volume divergente hoje.'
});
assert.ok(t.includes('<table'));
assert.ok(t.includes('EMB0008399999'));
// O rótulo viaja em cada célula: é ele que vira o rótulo da linha empilhada no
// celular, sem o CSS precisar de um segundo HTML.
assert.ok(t.includes('data-rotulo="Rota lida"'));
assert.ok(t.includes('ui-dir'), 'coluna à direita marca a célula');

// Tabela sem linha não desenha cabeçalho de coluna nenhuma: cabeçalho vazio é
// promessa de dado que não veio.
const tv = tabela({ colunas: [{ chave: 'a', rotulo: 'A' }], linhas: [], vazio: 'Nada aqui.' });
assert.ok(!tv.includes('<table'));
assert.ok(tv.includes('Nada aqui.'));

// Escape na célula e no rótulo.
const te = tabela({
  colunas: [{ chave: 'a', rotulo: '<b>R</b>' }],
  linhas: [{ a: '<b>x</b>' }],
  vazio: '—'
});
assert.ok(!te.includes('<b>x</b>') && !te.includes('<b>R</b>'));

// Célula pode ser HTML nosso quando marcada — é como o status entra com cor,
// texto e forma sem a tabela conhecer status.
const th = tabela({
  colunas: [{ chave: 'a', rotulo: 'A', html: true }],
  linhas: [{ a: '<span class="st">ok</span>' }],
  vazio: '—'
});
assert.ok(th.includes('<span class="st">ok</span>'));

/* ------------------------------------------------------------- forma ---- */
assert.ok(botao({ rotulo: 'Liberar carga', tipo: 'primario' }).includes('btn-primario'));
assert.ok(botao({ rotulo: 'x' }).includes('type="button"'), 'botão não vira submit por acidente');
assert.ok(botao({ rotulo: 'x', enviar: true }).includes('type="submit"'));

// Campo sempre tem label ligado por for/id: sem isso o leitor de tela anuncia
// "caixa de edição" e nada mais.
const c = campo({ id: 'f-de', rotulo: 'De' });
assert.ok(c.includes('for="f-de"') && c.includes('id="f-de"'));

const s2 = selecao({ id: 'f-mes', rotulo: 'Mês', opcoes: [{ valor: '2026-08', rotulo: 'Agosto' }], valor: '2026-08' });
assert.ok(s2.includes('selected'));

assert.ok(filtros([c], '30 dias').includes('30 dias'));
assert.ok(filtros([c]).includes('ui-filtros-abrir'), 'filtro sempre oferece abertura no celular');
assert.ok(filtros([c]).includes('aria-expanded="false"'), 'botão de filtro anuncia o estado fechado');

// Escape em tudo que vem do cadastro.
assert.ok(!botao({ rotulo: '<b>x</b>' }).includes('<b>x</b>'));
assert.ok(!selecao({ id: 'a', rotulo: 'A', opcoes: [{ valor: '<b>', rotulo: '<b>x</b>' }] }).includes('<b>x</b>'));

/* --------------------------------------------------------- sinalSync ---- */
const e = (p = {}) => ({
  pendentes: 0, online: true, configurado: true, enviando: false,
  ultimoEnvio: null, ultimaDescida: null, ultimoErro: null, usuarioAtual: '', ...p
});

assert.equal(sinalSync(e()).texto, 'Sincronizado');
assert.equal(sinalSync(e()).tom, 'ok');

assert.equal(sinalSync(e({ enviando: true, pendentes: 3 })).texto, 'Sincronizando');
assert.equal(sinalSync(e({ online: false, pendentes: 3 })).texto, 'Offline • salvo no aparelho');
assert.equal(sinalSync(e({ pendentes: 8 })).texto, '8 leituras pendentes');
assert.equal(sinalSync(e({ pendentes: 1 })).texto, '1 leitura pendente');

// Erro ganha de tudo: falha silenciosa é pior que fila cheia.
assert.equal(sinalSync(e({ ultimoErro: 'timeout', pendentes: 3 })).texto, 'Falha ao sincronizar');
assert.equal(sinalSync(e({ ultimoErro: 'timeout', online: false })).tom, 'falha');

// Aparelho sem projeto configurado guarda tudo local, e isso não é falha.
assert.equal(sinalSync(e({ configurado: false, pendentes: 5 })).texto, '5 leituras pendentes');
assert.equal(sinalSync(e({ configurado: false, pendentes: 0 })).texto, 'Nada pendente');

// Nunca vocabulário de sistema na tela.
for (const p of [{}, { pendentes: 8 }, { online: false }, { ultimoErro: 'x' }, { configurado: false }]) {
  const t2 = sinalSync(e(p)).texto.toLowerCase();
  for (const proibido of ['fila', 'indexeddb', 'queue', 'payload', 'sync']) {
    assert.ok(!t2.includes(proibido), `"${t2}" usa vocabulário de sistema: ${proibido}`);
  }
}

/* ----------------------------------------------------------- ícones ------ */
// Um item de menu sem desenho próprio cai no ponto neutro do fallback. Isso
// evita o buraco na coluna, mas não é o que se quer entregar: a seção nova sai
// indistinguível das outras. O teste falha quando alguém acrescenta uma seção
// e esquece o ícone — que é exatamente quando o esquecimento é barato.
const { icone, temIcone } = await import('../src/lib/shell/icones.ts');
const { SECOES } = await import('../src/lib/router.ts');

for (const s of SECOES) {
  assert.ok(temIcone(s), `a seção "${s}" entrou no menu sem ícone desenhado`);
}
for (const extra of ['mais', 'seta']) {
  assert.ok(temIcone(extra), `falta o ícone de moldura "${extra}"`);
}

// Monocromático de verdade: a cor vem do item que o contém, nunca do desenho.
// Um `#hex` aqui é um ícone que ignora o estado ativo e o fundo verde da coluna.
for (const s of [...SECOES, 'mais', 'seta']) {
  const svg = icone(s);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(svg), `${s}: cor fixa no desenho`);
  assert.ok(svg.includes('stroke="currentColor"'), `${s}: não herda a cor do item`);
  assert.ok(svg.includes('aria-hidden="true"'), `${s}: o leitor de tela vai lê-lo além do rótulo`);
  assert.ok(svg.includes('viewBox="0 0 24 24"'), `${s}: fora do quadro comum`);
}

// Tamanho e traço acompanham a tela: 18px na coluna, 22px e traço mais grosso
// na barra do celular.
assert.ok(icone('mapa', { tamanho: 22, traco: 1.75 }).includes('width="22"'));
assert.ok(icone('mapa', { tamanho: 22, traco: 1.75 }).includes('stroke-width="1.75"'));

// Id desconhecido não devolve string vazia: buraco na coluna desalinha os treze.
assert.ok(icone('secao-que-nao-existe').includes('<svg'));

console.log('UI_OK');
