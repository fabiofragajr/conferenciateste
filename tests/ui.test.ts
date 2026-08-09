import assert from 'node:assert/strict';
import { plural, vazio, badge, alerta, kpis, secao, pageHeader, status } from '../src/lib/ui/basico.ts';

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

console.log('UI_OK');
