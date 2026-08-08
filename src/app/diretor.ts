// diretor.ts — mesma base do painel do gestor, leitura diferente.
//
// O gestor precisa agir hoje. O diretor precisa decidir: onde está vazando
// dinheiro, qual transportadora está pior, se melhorou ou piorou.
// Por isso: nada operacional, sem ranking de pessoas, e toda métrica com
// comparação no tempo.

import '../styles/base.css';
import '../styles/painel.css';
import '../styles/relatorio.css';

import type { Leitura, Ocorrencia, Sessao } from '../types.js';
import * as db from '../lib/db.js';
import * as auth from '../lib/auth.js';
import * as sync from '../lib/sync.js';
import { EMPRESA, FOREST, DIV, cabecalhoPDF, rodapePDF } from '../lib/marca.js';
import { etiquetaTexto, pedidosIncompletos, MOMENTO_ROTULO } from '../lib/model.js';
import { graficoMensal, mapaCalor, ranking } from '../lib/graficos.js';
import { cardOcorrencia, hidratarFotos } from '../lib/relatorio.js';
import { $, chaveMes, dataHora, esc, mesAnterior, pct, rotuloMes } from '../lib/util.js';

// Paleta dos gráficos: uma rampa de severidade, não cores decorativas.
// Verde = atividade (não é problema); âmbar = atenção; vermelho = alarme.
// A divergência mantém exatamente o vermelho de status do resto do app.
const COR_VOLUME = '#109976';      // --logdis-green
const COR_DIVERGENCIA = '#dc2626'; // --div
const COR_OCORRENCIA = '#d97706';  // --dup
const COR_GRAVE = '#991b1b';       // vermelho mais fechado: pior que divergência
const COR_CALOR = '#105945';       // --logdis-forest, rampa sequencial por opacidade

interface Base {
  sessoes: Sessao[];
  leituras: Leitura[];
  ocorrencias: Ocorrencia[];
}

let base: Base = { sessoes: [], leituras: [], ocorrencias: [] };
let mesSelecionado = chaveMes(new Date().toISOString());

/* --------------------------------------------------------------- dados --- */

async function carregar(): Promise<void> {
  const [sessoes, leituras, ocorrencias] = await Promise.all([
    db.todos('sessoes'), db.todos('leituras'), db.todos('ocorrencias')
  ]);
  base = { sessoes, leituras, ocorrencias };
}

interface Recorte {
  mes: string;
  sessoes: Sessao[];
  leituras: Leitura[];
  ocorrencias: Ocorrencia[];
}

function recortar(mes: string): Recorte {
  const sessoes = base.sessoes.filter((s) => chaveMes(s.inicio) === mes);
  const ids = new Set(sessoes.map((s) => s.id));
  return {
    mes,
    sessoes,
    leituras: base.leituras.filter((l) => ids.has(l.sessaoId)),
    ocorrencias: base.ocorrencias.filter((o) => ids.has(o.sessaoId))
  };
}

interface Indicadores {
  volumes: number;
  taxaDivergencia: number;
  taxaOcorrencia: number;
  taxaGrave: number;
  incompletos: number;
  conferencias: number;
}

function indicadores(r: Recorte): Indicadores {
  const volumes = r.leituras.length;
  const div = r.leituras.filter((l) => l.status === 'ROTA_DIVERGENTE').length;

  // Taxa = percentual de CONFERÊNCIAS afetadas, não ocorrências por conferência.
  // Um número que passa de 100% não sustenta comparação entre meses.
  const comOcorrencia = new Set(r.ocorrencias.map((o) => o.sessaoId)).size;
  const comGrave = new Set(r.ocorrencias.filter((o) => o.grave).map((o) => o.sessaoId)).size;

  return {
    volumes,
    taxaDivergencia: pct(div, volumes),
    taxaOcorrencia: pct(comOcorrencia, r.sessoes.length),
    taxaGrave: pct(comGrave, r.sessoes.length),
    incompletos: pedidosIncompletos(r.leituras).length,
    conferencias: r.sessoes.length
  };
}

/* ----------------------------------------------------------------- UI ---- */

function comparacao(atual: number, anterior: number, sufixo: string, menorEhMelhor = true): string {
  if (anterior === 0 && atual === 0) return '<span class="p-kpi-cmp p-neutro">igual ao mês anterior</span>';
  if (anterior === 0) return '<span class="p-kpi-cmp p-neutro">sem base no mês anterior</span>';
  const delta = atual - anterior;
  const variacao = (delta / anterior) * 100;
  if (Math.abs(variacao) < 1) return '<span class="p-kpi-cmp p-neutro">estável vs. mês anterior</span>';
  const piorou = menorEhMelhor ? delta > 0 : delta < 0;
  const classe = piorou ? 'p-sobe' : 'p-desce';
  const seta = delta > 0 ? '▲' : '▼';
  return `<span class="p-kpi-cmp ${classe}">${seta} ${Math.abs(variacao).toFixed(0)}% vs. mês anterior
    (${anterior.toFixed(sufixo === '%' ? 1 : 0)}${sufixo})</span>`;
}

function kpi(rotulo: string, valor: string, cmp: string, destaque = false): string {
  return `<div class="p-kpi ${destaque ? 'p-destaque' : ''}">
    <span class="p-kpi-rot">${esc(rotulo)}</span>
    <span class="p-kpi-val">${valor}</span>
    ${cmp}
  </div>`;
}

async function pintarKPIs(): Promise<void> {
  const atual = indicadores(recortar(mesSelecionado));
  const anterior = indicadores(recortar(mesAnterior(mesSelecionado)));

  $('#rot-comparacao').textContent =
    `— ${rotuloMes(mesSelecionado)} comparado com ${rotuloMes(mesAnterior(mesSelecionado))}`;

  // Cobertura vem primeiro: se ninguém usa o app, os outros números não valem nada.
  const previstas = await db.configGet<number | null>(`cobertura.${mesSelecionado}`, null);
  const previstasAnterior = await db.configGet<number | null>(`cobertura.${mesAnterior(mesSelecionado)}`, null);
  const cobertura = previstas ? pct(atual.conferencias, previstas) : null;
  const coberturaAnterior = previstasAnterior ? pct(anterior.conferencias, previstasAnterior) : 0;

  $('#kpis').innerHTML = [
    kpi(
      'Cobertura de conferência',
      cobertura === null ? '<span style="font-size:16px;color:var(--texto-2)">informe as cargas previstas</span>' : `${cobertura}%`,
      cobertura === null
        ? '<span class="p-kpi-cmp p-neutro">sem esse número os demais não se sustentam</span>'
        : comparacao(cobertura, coberturaAnterior, '%', false),
      true
    ),
    kpi('Volumes conferidos', String(atual.volumes), comparacao(atual.volumes, anterior.volumes, '', false)),
    kpi('Taxa de divergência de rota', `${atual.taxaDivergencia}%`, comparacao(atual.taxaDivergencia, anterior.taxaDivergencia, '%')),
    kpi('Conferências com ocorrência', `${atual.taxaOcorrencia}%`, comparacao(atual.taxaOcorrencia, anterior.taxaOcorrencia, '%')),
    kpi('Conferências com ocorrência grave', `${atual.taxaGrave}%`, comparacao(atual.taxaGrave, anterior.taxaGrave, '%')),
    kpi('Pedidos embarcados incompletos', String(atual.incompletos), comparacao(atual.incompletos, anterior.incompletos, ''))
  ].join('');

  $('#cobertura-form').innerHTML = `
    <h3>Cargas previstas em ${rotuloMes(mesSelecionado)}</h3>
    <p class="p-vazio" style="padding-top:0">
      Quantas cargas saíram no mês, segundo a expedição. Sem esse número não dá
      para dizer que percentual passou pelo app — e a v1 ainda não importa o manifesto.
    </p>
    <div class="p-filtros">
      <div class="p-campo">
        <label for="in-previstas">Cargas previstas</label>
        <input id="in-previstas" type="number" min="0" step="1" value="${previstas ?? ''}" />
      </div>
      <button id="btn-previstas" class="btn btn-secundario">Salvar</button>
      <span class="p-vazio">Conferências registradas no app: <b>${atual.conferencias}</b></span>
    </div>`;

  $('#btn-previstas').addEventListener('click', async () => {
    const v = Number($<HTMLInputElement>('#in-previstas').value);
    await db.configSet(`cobertura.${mesSelecionado}`, Number.isFinite(v) && v > 0 ? v : null);
    await pintarKPIs();
  });
}

function ultimosMeses(qtd = 6): string[] {
  const meses: string[] = [];
  for (let i = qtd - 1; i >= 0; i--) meses.push(mesAnterior(mesSelecionado, i));
  return meses;
}

function pintarTendencias(): void {
  const meses = ultimosMeses();
  const dados = meses.map((m) => ({ mes: m, ind: indicadores(recortar(m)) }));
  const serie = (pegar: (i: Indicadores) => number) =>
    dados.map((d) => ({ rotulo: rotuloMes(d.mes), valor: pegar(d.ind) }));

  // Uma série por gráfico: escalas diferentes nunca dividem o mesmo eixo.
  $('#tendencias').innerHTML = [
    graficoMensal(serie((i) => i.volumes), {
      titulo: 'Volumes conferidos', cor: COR_VOLUME, subtitulo: 'total bipado no mês'
    }),
    graficoMensal(serie((i) => i.taxaDivergencia), {
      titulo: 'Taxa de divergência de rota', cor: COR_DIVERGENCIA, sufixo: '%', casas: 1,
      subtitulo: 'volume que quase embarcou errado'
    }),
    graficoMensal(serie((i) => i.taxaOcorrencia), {
      titulo: 'Conferências com ocorrência', cor: COR_OCORRENCIA, sufixo: '%', casas: 0,
      subtitulo: '% das cargas que tiveram algum problema registrado'
    }),
    graficoMensal(serie((i) => i.taxaGrave), {
      titulo: 'Conferências com ocorrência grave', cor: COR_GRAVE, sufixo: '%', casas: 0,
      subtitulo: 'avaria, violação de lacre e cadeia fria'
    })
  ].join('');
}

function pintarConcentracao(): void {
  const r = recortar(mesSelecionado);

  // por rota
  const porRota = new Map<string, { volumes: number; div: number }>();
  for (const l of r.leituras) {
    const chave = l.rotaPrefixo ?? 'sem rota';
    const a = porRota.get(chave) ?? { volumes: 0, div: 0 };
    a.volumes++;
    if (l.status === 'ROTA_DIVERGENTE') a.div++;
    porRota.set(chave, a);
  }
  $('#rank-rota').innerHTML = ranking(
    [...porRota.entries()]
      .filter(([, v]) => v.div > 0)
      .sort((a, b) => b[1].div - a[1].div)
      .slice(0, 8)
      .map(([rota, v]) => ({
        rotulo: rota,
        valor: v.div,
        detalhe: `${v.div} de ${v.volumes} (${pct(v.div, v.volumes)}%)`
      })),
    COR_DIVERGENCIA,
    'Nenhuma divergência de rota no mês.'
  );

  // por transportadora (nome do grupo quando não houver transportadora cadastrada)
  const porSessao = new Map(r.sessoes.map((s) => [s.id, s]));
  const porTransp = new Map<string, { total: number; graves: number; conferencias: Set<string> }>();
  for (const o of r.ocorrencias) {
    const s = porSessao.get(o.sessaoId);
    const chave = s?.transportadoraNome || 'Sem identificação';
    const a = porTransp.get(chave) ?? { total: 0, graves: 0, conferencias: new Set<string>() };
    a.total++;
    if (o.grave) a.graves++;
    a.conferencias.add(o.sessaoId);
    porTransp.set(chave, a);
  }
  $('#rank-transportadora').innerHTML = ranking(
    [...porTransp.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
      .map(([nome, v]) => ({
        rotulo: nome,
        valor: v.total,
        detalhe: `${v.total} ocorr. • ${v.graves} graves`
      })),
    COR_OCORRENCIA,
    'Nenhuma ocorrência no mês.'
  );

  // por etiqueta
  const porEtiqueta = new Map<string, number>();
  for (const o of r.ocorrencias) {
    for (const e of o.etiquetas) porEtiqueta.set(e, (porEtiqueta.get(e) ?? 0) + 1);
  }
  $('#rank-etiqueta').innerHTML = ranking(
    [...porEtiqueta.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([e, n]) => ({ rotulo: etiquetaTexto(e), valor: n, detalhe: String(n) })),
    COR_GRAVE,
    'Nenhuma etiqueta marcada no mês.'
  );

  // por momento — é a separação que muda a decisão
  const expedicao = r.ocorrencias.filter((o) => o.momento === 'EXPEDICAO').length;
  const transportadora = r.ocorrencias.filter((o) => o.momento === 'TRANSPORTADORA').length;
  $('#rank-momento').innerHTML = ranking(
    [
      { rotulo: MOMENTO_ROTULO.EXPEDICAO, valor: expedicao, detalhe: `${expedicao} (${pct(expedicao, r.ocorrencias.length)}%)` },
      { rotulo: MOMENTO_ROTULO.TRANSPORTADORA, valor: transportadora, detalhe: `${transportadora} (${pct(transportadora, r.ocorrencias.length)}%)` }
    ].filter((i) => i.valor > 0),
    COR_OCORRENCIA,
    'Nenhuma ocorrência no mês.'
  );
}

function pintarGraves(): void {
  const r = recortar(mesSelecionado);
  const graves = r.ocorrencias
    .filter((o) => o.grave || o.texto.length > 0)
    .sort((a, b) => Number(b.grave) - Number(a.grave) || b.timestamp.localeCompare(a.timestamp))
    .slice(0, 12);

  const alvo = $('#graves-texto');
  alvo.innerHTML = graves.length
    ? graves.map((o) => {
        const s = r.sessoes.find((x) => x.id === o.sessaoId);
        const onde = s?.transportadoraNome ?? '';
        return cardOcorrencia(o, `<div class="rel-oc-local">${esc(onde)}</div>`);
      }).join('')
    : '<p class="p-vazio">Nenhuma ocorrência registrada no mês.</p>';
  hidratarFotos(alvo, graves);
}

function pintarCalor(): void {
  const r = recortar(mesSelecionado);
  const pontos = r.leituras
    .filter((l) => l.lat !== null && l.lng !== null && l.geoStatus === 'OK')
    .map((l) => ({ lat: l.lat as number, lng: l.lng as number }));
  $('#calor').innerHTML = mapaCalor(pontos, COR_CALOR);
}

/* ----------------------------------------------------------------- PDF --- */

async function exportarPDFPeriodo(): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);

  const r = recortar(mesSelecionado);
  const atual = indicadores(r);
  const anterior = indicadores(recortar(mesAnterior(mesSelecionado)));
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const larg = doc.internal.pageSize.getWidth();

  const y0 = await cabecalhoPDF(
    doc,
    'Visão da diretoria',
    `${EMPRESA} • ${rotuloMes(mesSelecionado)} (comparado com ${rotuloMes(mesAnterior(mesSelecionado))})`
  );

  autoTable(doc, {
    startY: y0,
    head: [['Indicador', rotuloMes(mesSelecionado), rotuloMes(mesAnterior(mesSelecionado))]],
    body: [
      ['Conferências registradas', atual.conferencias, anterior.conferencias],
      ['Volumes conferidos', atual.volumes, anterior.volumes],
      ['Taxa de divergência de rota', `${atual.taxaDivergencia}%`, `${anterior.taxaDivergencia}%`],
      ['Conferências com ocorrência', `${atual.taxaOcorrencia}%`, `${anterior.taxaOcorrencia}%`],
      ['Conferências com ocorrência grave', `${atual.taxaGrave}%`, `${anterior.taxaGrave}%`],
      ['Pedidos embarcados incompletos', atual.incompletos, anterior.incompletos]
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: FOREST }
  });

  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40) + 8;

  const graves = r.ocorrencias.filter((o) => o.grave);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Ocorrências graves do período (${graves.length})`, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 6;

  // O texto de quem estava na doca é o que explica a métrica. Vai na íntegra.
  for (const o of graves.slice(0, 25)) {
    if (y > 255) { doc.addPage(); y = 16; }
    const s = r.sessoes.find((x) => x.id === o.sessaoId);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DIV);
    doc.text(`${MOMENTO_ROTULO[o.momento]} — ${s?.transportadoraNome ?? ''} — ${dataHora(o.timestamp)}`, 14, y);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    y += 4.4;
    const linhas = doc.splitTextToSize(o.texto || '(sem descrição)', larg - 32) as string[];
    doc.text(linhas, 18, y);
    y += linhas.length * 4.2 + 3;
  }

  if (!graves.length) doc.text('Nenhuma ocorrência grave registrada no período.', 14, y);

  rodapePDF(doc, rotuloMes(mesSelecionado));

  doc.save(`diretoria_${mesSelecionado}.pdf`);
}

/* ---------------------------------------------------------------- boot --- */

async function pintarTudo(): Promise<void> {
  await pintarKPIs();
  pintarTendencias();
  pintarConcentracao();
  pintarGraves();
  pintarCalor();
}

function preencherMeses(): void {
  const sel = $<HTMLSelectElement>('#f-mes');
  const meses = new Set<string>([chaveMes(new Date().toISOString())]);
  for (const s of base.sessoes) meses.add(chaveMes(s.inicio));
  const ordenados = [...meses].sort().reverse();
  sel.innerHTML = ordenados.map((m) => `<option value="${m}">${rotuloMes(m)}</option>`).join('');
  if (!ordenados.includes(mesSelecionado)) mesSelecionado = ordenados[0];
  sel.value = mesSelecionado;
}

$<HTMLSelectElement>('#f-mes').addEventListener('change', async (ev) => {
  mesSelecionado = (ev.target as HTMLSelectElement).value;
  await pintarTudo();
});

$('#btn-pdf').addEventListener('click', () => void exportarPDFPeriodo());

const elLogin = {
  bloqueio: $('#bloqueio'),
  conteudo: $('#conteudo'),
  form: $<HTMLFormElement>('#form-login'),
  login: $<HTMLInputElement>('#in-login'),
  senha: $<HTMLInputElement>('#in-senha'),
  erro: $('#login-erro')
};

elLogin.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await bootPronto; // senão o boot termina depois e rebloqueia quem acabou de entrar
  const r = await auth.entrar(elLogin.login.value, elLogin.senha.value);
  if (!r.ok || !r.usuario.gestor) {
    if (r.ok) auth.sair();
    elLogin.erro.textContent = r.ok ? 'Este usuário não tem acesso ao painel.' : r.erro;
    elLogin.erro.hidden = false;
    return;
  }
  await abrir(r.usuario.nome);
});

async function abrir(nome: string): Promise<void> {
  elLogin.bloqueio.hidden = true;
  elLogin.conteudo.hidden = false;
  $('#p-usuario').textContent = nome;
  await carregar();
  preencherMeses();
  await pintarTudo();
}

async function boot(): Promise<void> {
  await auth.garantirSeed();
  sync.iniciarAuto();
  const u = await auth.usuarioLogado();
  if (!u?.gestor) {
    elLogin.bloqueio.hidden = false;
    return;
  }
  await abrir(u.nome);
}

// O boot decide a tela inicial e demora (seed, IndexedDB, rede). Guardar a
// promessa deixa o login esperar por ele em vez de disputar a tela.
const bootPronto = boot().catch((e: unknown) => {
  console.error('boot', e);
});
