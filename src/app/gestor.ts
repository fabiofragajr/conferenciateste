// gestor.ts — painel de supervisão. Tela de desktop: densa, com filtros
// persistentes. A divergência aparece antes de qualquer métrica agregada e
// nunca fica escondida atrás de filtro.

import '../styles/base.css';
import '../styles/painel.css';
import '../styles/relatorio.css';

import type { GrupoRota, Leitura, Momento, Ocorrencia, Sessao, StatusLeitura, Usuario } from '../types.js';
import * as db from '../lib/db.js';
import { novoSync } from '../lib/db.js';
import * as auth from '../lib/auth.js';
import * as sync from '../lib/sync.js';
import { salvarConfig, obterConfig, testarConexao } from '../lib/supabase.js';
import { ETIQUETAS, etiquetaTexto, pedidosIncompletos, prefixoRota } from '../lib/model.js';
import { renderMapa } from '../lib/mapa.js';
import {
  cardOcorrencia, exportarCSVOcorrencias, exportarPDF, exportarCSV,
  hidratarFotos, montarRelatorio, renderizarHTML, type DadosRelatorio
} from '../lib/relatorio.js';
import {
  $, baixarArquivo, dataHora, duracao, esc, limitesDoDia, minutosEntre,
  paraCSV, pct
} from '../lib/util.js';

/* --------------------------------------------------------------- dados --- */

interface Base {
  usuarios: Usuario[];
  grupos: GrupoRota[];
  sessoes: Sessao[];
  leituras: Leitura[];
  ocorrencias: Ocorrencia[];
  porSessao: Map<string, Leitura[]>;
  ocPorSessao: Map<string, Ocorrencia[]>;
}

let usuario: Usuario | null = null;
let base: Base = {
  usuarios: [], grupos: [], sessoes: [], leituras: [], ocorrencias: [],
  porSessao: new Map(), ocPorSessao: new Map()
};
let relatorioAberto: DadosRelatorio | null = null;

async function carregar(): Promise<void> {
  const [usuarios, grupos, sessoes, leituras, ocorrencias] = await Promise.all([
    db.todos('usuarios'), db.todos('grupos'), db.todos('sessoes'),
    db.todos('leituras'), db.todos('ocorrencias')
  ]);

  const porSessao = new Map<string, Leitura[]>();
  for (const l of leituras) {
    const lista = porSessao.get(l.sessaoId) ?? [];
    lista.push(l);
    porSessao.set(l.sessaoId, lista);
  }
  for (const lista of porSessao.values()) lista.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const ocPorSessao = new Map<string, Ocorrencia[]>();
  for (const o of ocorrencias) {
    const lista = ocPorSessao.get(o.sessaoId) ?? [];
    lista.push(o);
    ocPorSessao.set(o.sessaoId, lista);
  }

  base = {
    usuarios,
    grupos,
    sessoes: sessoes.sort((a, b) => b.inicio.localeCompare(a.inicio)),
    leituras,
    ocorrencias: ocorrencias.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    porSessao,
    ocPorSessao
  };
}

/* ----------------------------------------------------------- utilidades -- */

function tabela(cabecalhos: string[], linhas: string[][], vazio = 'Nada aqui.'): string {
  if (!linhas.length) return `<p class="p-vazio">${vazio}</p>`;
  return `<table class="p-tab">
    <thead><tr>${cabecalhos.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

function barras(itens: { rotulo: string; valor: number; texto?: string; classe?: string }[]): string {
  if (!itens.length) return '<p class="p-vazio">Sem dados no período.</p>';
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return `<div class="p-barras">${itens.map((i) => `
    <div class="p-barra-linha">
      <span>${esc(i.rotulo)}</span>
      <span class="p-barra-trilho"><span class="p-barra-fill ${i.classe ?? ''}" style="width:${(i.valor / max) * 100}%"></span></span>
      <span class="p-barra-val">${esc(i.texto ?? String(i.valor))}</span>
    </div>`).join('')}</div>`;
}

const dentro = (iso: string, de: string, ate: string): boolean => iso >= de && iso <= ate;

/* --------------------------------------------------------------- login --- */

const elLogin = {
  bloqueio: $('#bloqueio'),
  conteudo: $('#conteudo'),
  form: $<HTMLFormElement>('#form-login'),
  login: $<HTMLInputElement>('#in-login'),
  senha: $<HTMLInputElement>('#in-senha'),
  erro: $('#login-erro'),
  usuario: $('#p-usuario')
};

elLogin.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const r = await auth.entrar(elLogin.login.value, elLogin.senha.value);
  if (!r.ok) {
    elLogin.erro.textContent = r.erro;
    elLogin.erro.hidden = false;
    return;
  }
  if (!r.usuario.gestor) {
    auth.sair();
    elLogin.erro.textContent = 'Este usuário não tem acesso ao painel.';
    elLogin.erro.hidden = false;
    return;
  }
  usuario = r.usuario;
  await iniciarPainel();
});

$('#btn-sair').addEventListener('click', () => {
  auth.sair();
  location.reload();
});

/* ---------------------------------------------------------------- boot --- */

async function boot(): Promise<void> {
  await auth.garantirSeed();
  sync.iniciarAuto();

  sync.aoMudarSync((estado) => {
    const chip = $('#chip-sync');
    chip.textContent = !estado.configurado
      ? `${estado.pendentes} só no aparelho`
      : estado.pendentes === 0 ? 'Tudo sincronizado' : `${estado.pendentes} na fila`;
    chip.classList.toggle('sync-pendente', estado.pendentes > 0);
    chip.classList.toggle('sync-ok', estado.pendentes === 0 && estado.configurado);
    pintarFila(estado.ultimoErro, estado.pendentes, estado.configurado, estado.ultimoEnvio);
  });

  usuario = await auth.usuarioLogado();
  if (!usuario?.gestor) {
    elLogin.bloqueio.hidden = false;
    return;
  }
  await iniciarPainel();
}

async function iniciarPainel(): Promise<void> {
  elLogin.bloqueio.hidden = true;
  elLogin.conteudo.hidden = false;
  elLogin.usuario.textContent = usuario ? `${usuario.nome} • gestor` : '';

  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 29 * 86400000);
  $<HTMLInputElement>('#f-de').value = trintaDias.toISOString().slice(0, 10);
  $<HTMLInputElement>('#f-ate').value = hoje.toISOString().slice(0, 10);

  await recarregarTudo();
  await preencherConfigSupabase();

  // Sessão aberta é informação viva: sem atualizar, o painel mente.
  window.setInterval(() => void atualizarAoVivo(), 15000);
}

async function recarregarTudo(): Promise<void> {
  await carregar();
  preencherSelects();
  pintarAgora();
  pintarHistorico();
  pintarCadastros();
  void sync.atualizarContagem();
}

async function atualizarAoVivo(): Promise<void> {
  await carregar();
  pintarAgora();
}

/* -------------------------------------------------- 1. tem algo errado? -- */

function pintarAgora(): void {
  const { inicio, fim } = limitesDoDia();
  const leiturasHoje = base.leituras.filter((l) => dentro(l.timestamp, inicio, fim));
  const divergentes = leiturasHoje.filter((l) => l.status === 'ROTA_DIVERGENTE');

  // A divergência vem antes de tudo, sem filtro, sem clique.
  $('#faixa-divergencia').innerHTML = divergentes.length
    ? `<div class="p-faixa-alerta">
         <span class="p-num">${divergentes.length}</span>
         <span class="p-txt"><b>volume(s) de outra rota hoje</b>
         Não podem embarcar. Confira antes de liberar a carga.</span>
       </div>
       <div class="p-cartao p-alerta" style="margin-bottom:18px">
         <div class="p-tab-wrap">${tabela(
           ['Código', 'Rota lida', 'Pedido', 'Conferente', 'Carga', 'Hora'],
           divergentes.map((l) => {
             const s = base.sessoes.find((x) => x.id === l.sessaoId);
             return [
               `<code>${esc(l.codigoVolume ?? '—')}</code>`, esc(l.rota ?? '—'), esc(l.pedido ?? '—'),
               esc(s?.usuarioNome ?? '—'), esc(s ? `${s.grupoNome} (${s.rotas.join(', ')})` : '—'),
               dataHora(l.timestamp)
             ];
           })
         )}</div>
       </div>`
    : '<div class="p-faixa-ok">Nenhum volume de outra rota hoje.</div>';

  const abertas = base.sessoes.filter((s) => s.status === 'ABERTA');
  $('#sessoes-abertas').innerHTML = tabela(
    ['Pessoa', 'Carga', 'Rotas', 'Volumes', 'Divergentes', 'Aberta há'],
    abertas.map((s) => {
      const ls = base.porSessao.get(s.id) ?? [];
      const div = ls.filter((l) => l.status === 'ROTA_DIVERGENTE').length;
      return [
        esc(s.usuarioNome), esc(s.grupoNome), esc(s.rotas.join(', ')),
        `<span class="p-num-col">${ls.length}</span>`,
        div ? `<b style="color:var(--div)">${div}</b>` : '0',
        duracao(s.inicio)
      ];
    }),
    'Nenhuma conferência aberta agora.'
  );

  const incompletos = pedidosIncompletos(leiturasHoje);
  $('#incompletos-hoje').innerHTML = tabela(
    ['Pedido', 'Rota', 'Bipados', 'Declarado', 'Faltando'],
    incompletos.map((p) => [
      esc(p.pedido), esc(p.rota), String(p.bipados), String(p.total), esc(p.faltando.join(', '))
    ]),
    'Nenhum pedido incompleto hoje.'
  );

  pintarOcorrencias();
  pintarRecorrentes();
}

/* ------------------------------------------------------- ocorrências ----- */

function ocorrenciasFiltradas(): Ocorrencia[] {
  const dias = Number($<HTMLSelectElement>('#oc-dias').value);
  const momento = $<HTMLSelectElement>('#oc-momento').value as Momento | '';
  const etiqueta = $<HTMLSelectElement>('#oc-etiqueta').value;
  const busca = $<HTMLInputElement>('#oc-busca').value.trim().toLowerCase();

  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - (dias - 1));
  const desdeIso = desde.toISOString();

  return base.ocorrencias
    .filter((o) => o.timestamp >= desdeIso)
    .filter((o) => !momento || o.momento === momento)
    .filter((o) => !etiqueta || o.etiquetas.includes(etiqueta))
    // Busca no texto livre: o gestor precisa achar "doca fechada" sem depender
    // de alguém ter marcado a etiqueta certa.
    .filter((o) => !busca || o.texto.toLowerCase().includes(busca))
    .sort((a, b) => Number(b.grave) - Number(a.grave) || b.timestamp.localeCompare(a.timestamp));
}

function pintarOcorrencias(): void {
  const lista = ocorrenciasFiltradas();
  const alvo = $('#oc-lista');
  alvo.innerHTML = lista.length
    ? lista.map((o) => {
        const s = base.sessoes.find((x) => x.id === o.sessaoId);
        const quem = s ? `${s.usuarioNome} • ${s.grupoNome}` : '';
        return cardOcorrencia(o, `<div class="rel-oc-local">${esc(quem)}</div>`);
      }).join('')
    : '<p class="p-vazio">Nenhuma ocorrência no filtro atual.</p>';
  hidratarFotos(alvo, lista);
}

for (const id of ['#oc-momento', '#oc-etiqueta', '#oc-dias']) {
  $<HTMLSelectElement>(id).addEventListener('change', pintarOcorrencias);
}
$<HTMLInputElement>('#oc-busca').addEventListener('input', pintarOcorrencias);
$('#btn-oc-csv').addEventListener('click', () => exportarCSVOcorrencias(ocorrenciasFiltradas()));

function pintarRecorrentes(): void {
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const contagem = new Map<string, { total: number; graves: number; etiquetas: Map<string, number> }>();

  for (const o of base.ocorrencias) {
    if (o.timestamp < desde || o.momento !== 'TRANSPORTADORA') continue;
    const s = base.sessoes.find((x) => x.id === o.sessaoId);
    const chave = s?.transportadora || s?.grupoNome || 'Sem identificação';
    const atual = contagem.get(chave) ?? { total: 0, graves: 0, etiquetas: new Map<string, number>() };
    atual.total++;
    if (o.grave) atual.graves++;
    for (const e of o.etiquetas) atual.etiquetas.set(e, (atual.etiquetas.get(e) ?? 0) + 1);
    contagem.set(chave, atual);
  }

  const linhas = [...contagem.entries()]
    .filter(([, v]) => v.total >= 2)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([nome, v]) => {
      const top = [...v.etiquetas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([e, n]) => `${etiquetaTexto(e)} (${n})`).join(', ');
      return [esc(nome), String(v.total), v.graves ? `<b style="color:var(--div)">${v.graves}</b>` : '0', esc(top || '—')];
    });

  $('#recorrentes').innerHTML = tabela(
    ['Transportadora / carga', 'Ocorrências (30 dias)', 'Graves', 'Etiquetas mais frequentes'],
    linhas,
    'Nenhuma repetição na transportadora nos últimos 30 dias.'
  );
}

/* ------------------------------------------------- 2. o que aconteceu? --- */

function filtroPeriodo(): { de: string; ate: string } {
  const de = new Date(`${$<HTMLInputElement>('#f-de').value || '2000-01-01'}T00:00:00`);
  const ate = new Date(`${$<HTMLInputElement>('#f-ate').value || '2100-01-01'}T23:59:59.999`);
  return { de: de.toISOString(), ate: ate.toISOString() };
}

function sessoesFiltradas(): Sessao[] {
  const { de, ate } = filtroPeriodo();
  const pessoa = $<HTMLSelectElement>('#f-pessoa').value;
  const rota = $<HTMLSelectElement>('#f-rota').value;
  const status = $<HTMLSelectElement>('#f-status').value as StatusLeitura | '';

  return base.sessoes.filter((s) => {
    if (!dentro(s.inicio, de, ate)) return false;
    if (pessoa && s.usuarioId !== pessoa) return false;
    if (rota && !s.rotas.some((r) => prefixoRota(r) === rota)) return false;
    if (status && !(base.porSessao.get(s.id) ?? []).some((l) => l.status === status)) return false;
    return true;
  });
}

function pintarHistorico(): void {
  const sessoes = sessoesFiltradas();

  $('#tabela-sessoes').innerHTML = tabela(
    ['Início', 'Pessoa', 'Carga', 'Rotas', 'Duração', 'Volumes', 'OK', 'Outra rota', 'Dupl.', 'Inv.', 'Ocorr.', 'Status', ''],
    sessoes.map((s) => {
      const ls = base.porSessao.get(s.id) ?? [];
      const conta = (st: StatusLeitura): number => ls.filter((l) => l.status === st).length;
      const div = conta('ROTA_DIVERGENTE');
      const ocs = base.ocPorSessao.get(s.id) ?? [];
      const graves = ocs.filter((o) => o.grave).length;
      return [
        dataHora(s.inicio), esc(s.usuarioNome), esc(s.grupoNome), esc(s.rotas.join(', ')),
        duracao(s.inicio, s.fim), `<span class="p-num-col">${ls.length}</span>`,
        String(conta('OK')),
        div ? `<b style="color:var(--div)">${div}</b>` : '0',
        String(conta('DUPLICADO')), String(conta('INVALIDO')),
        ocs.length ? `${ocs.length}${graves ? ` <b style="color:var(--div)">(${graves} graves)</b>` : ''}` : '0',
        s.status === 'ABERTA' ? '<span class="chip">aberta</span>' : 'encerrada',
        `<button class="btn btn-secundario" data-sessao="${esc(s.id)}" style="min-height:32px;font-size:12px">Detalhe</button>`
      ];
    }),
    'Nenhuma conferência no período.'
  );

  $('#tabela-sessoes').querySelectorAll<HTMLButtonElement>('button[data-sessao]').forEach((btn) => {
    btn.addEventListener('click', () => void abrirGaveta(btn.dataset.sessao as string));
  });

  pintarDesempenho(sessoes);
}

$('#btn-filtrar').addEventListener('click', pintarHistorico);

$('#btn-csv-periodo').addEventListener('click', () => {
  const sessoes = sessoesFiltradas();
  const ids = new Set(sessoes.map((s) => s.id));
  const linhas = base.leituras
    .filter((l) => ids.has(l.sessaoId))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((l) => {
      const s = base.sessoes.find((x) => x.id === l.sessaoId);
      const ocs = (base.ocPorSessao.get(l.sessaoId) ?? []).filter((o) => o.leituraId === l.id);
      return [
        s?.id ?? '', s?.inicio ?? '', s?.usuarioNome ?? '', s?.grupoNome ?? '', (s?.rotas ?? []).join('|'),
        l.codigoVolume ?? '', l.rota ?? '', l.pedido ?? '', l.volume ?? '', l.status, l.origem, l.timestamp,
        l.lat ?? '', l.lng ?? '', l.precisaoMetros ?? '', l.geoStatus,
        ocs.map((o) => o.texto).join(' | '), l.rawData
      ];
    });
  const cab = ['sessao', 'inicio_sessao', 'conferente', 'grupo_rota', 'rotas', 'codigo_volume', 'rota',
    'pedido', 'volume', 'status', 'origem', 'horario', 'lat', 'lng', 'precisao_m', 'geo_status',
    'ocorrencias', 'raw_qr'];
  baixarArquivo(paraCSV(cab, linhas), 'conferencias_periodo.csv', 'text/csv;charset=utf-8');
});

/* ------------------------------------------------- 3. desempenho --------- */

function pintarDesempenho(sessoes: Sessao[]): void {
  const ids = new Set(sessoes.map((s) => s.id));
  const leituras = base.leituras.filter((l) => ids.has(l.sessaoId));

  // por pessoa
  const porPessoa = new Map<string, { nome: string; sessoes: number; volumes: number; div: number; minutos: number }>();
  for (const s of sessoes) {
    const atual = porPessoa.get(s.usuarioId) ?? { nome: s.usuarioNome, sessoes: 0, volumes: 0, div: 0, minutos: 0 };
    const ls = base.porSessao.get(s.id) ?? [];
    atual.sessoes++;
    atual.volumes += ls.length;
    atual.div += ls.filter((l) => l.status === 'ROTA_DIVERGENTE').length;
    atual.minutos += minutosEntre(s.inicio, s.fim);
    porPessoa.set(s.usuarioId, atual);
  }

  $('#desempenho-pessoa').innerHTML = tabela(
    ['Pessoa', 'Conferências', 'Volumes', 'Outra rota', 'Taxa', 'Vol/min'],
    [...porPessoa.values()].sort((a, b) => b.volumes - a.volumes).map((p) => [
      esc(p.nome), String(p.sessoes), String(p.volumes),
      p.div ? `<b style="color:var(--div)">${p.div}</b>` : '0',
      `${pct(p.div, p.volumes)}%`,
      p.minutos > 0 ? (p.volumes / p.minutos).toFixed(1) : '—'
    ]),
    'Sem conferências no período.'
  );

  // por rota (prefixo lido)
  const porRota = new Map<string, { volumes: number; div: number }>();
  for (const l of leituras) {
    const chave = l.rotaPrefixo ?? 'sem rota';
    const atual = porRota.get(chave) ?? { volumes: 0, div: 0 };
    atual.volumes++;
    if (l.status === 'ROTA_DIVERGENTE') atual.div++;
    porRota.set(chave, atual);
  }

  const linhasRota = [...porRota.entries()].sort((a, b) => b[1].volumes - a[1].volumes);
  $('#desempenho-rota').innerHTML = tabela(
    ['Rota', 'Volumes', 'Outra rota', 'Taxa'],
    linhasRota.map(([rota, v]) => [
      esc(rota), String(v.volumes),
      v.div ? `<b style="color:var(--div)">${v.div}</b>` : '0',
      `${pct(v.div, v.volumes)}%`
    ]),
    'Sem leituras no período.'
  ) + barras(linhasRota.filter(([, v]) => v.div > 0).map(([rota, v]) => ({
    rotulo: `${rota} — divergências`,
    valor: v.div,
    texto: `${v.div} (${pct(v.div, v.volumes)}%)`,
    classe: 'st-div'
  })));
}

/* ---------------------------------------------------------- gaveta ------- */

const gaveta = $('#gaveta');

async function abrirGaveta(sessaoId: string): Promise<void> {
  relatorioAberto = await montarRelatorio(sessaoId);
  $('#gaveta-titulo').textContent =
    `${relatorioAberto.sessao.grupoNome} — ${relatorioAberto.sessao.usuarioNome}`;
  $('#gaveta-mapa').innerHTML = renderMapa(relatorioAberto.leituras);
  const conteudo = $('#gaveta-conteudo');
  conteudo.innerHTML = renderizarHTML(relatorioAberto);
  hidratarFotos(conteudo, relatorioAberto.ocorrencias);
  gaveta.hidden = false;
}

$('#gaveta-fechar').addEventListener('click', () => { gaveta.hidden = true; });
gaveta.addEventListener('click', (ev) => { if (ev.target === gaveta) gaveta.hidden = true; });
$('#gaveta-pdf').addEventListener('click', () => { if (relatorioAberto) void exportarPDF(relatorioAberto); });
$('#gaveta-csv').addEventListener('click', () => { if (relatorioAberto) exportarCSV(relatorioAberto); });

/* ------------------------------------------------------- 4. cadastros --- */

function preencherSelects(): void {
  const pessoa = $<HTMLSelectElement>('#f-pessoa');
  const rota = $<HTMLSelectElement>('#f-rota');
  const etiqueta = $<HTMLSelectElement>('#oc-etiqueta');

  const manter = (sel: HTMLSelectElement, opcoes: string[][], rotuloTodos: string): void => {
    const atual = sel.value;
    sel.innerHTML = `<option value="">${rotuloTodos}</option>`
      + opcoes.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    sel.value = atual;
  };

  manter(pessoa, base.usuarios.map((u) => [u.id, u.nome]), 'Todas');
  const rotas = [...new Set(base.grupos.flatMap((g) => g.rotas.map(prefixoRota)))].sort();
  manter(rota, rotas.map((r) => [r, r]), 'Todas');
  manter(etiqueta, ETIQUETAS.map((e) => [e.id, e.texto]), 'Todas');
}

function pintarCadastros(): void {
  $('#lista-usuarios').innerHTML = tabela(
    ['Nome', 'Login', 'Função', 'Placa', 'Painel', 'Situação', ''],
    base.usuarios.map((u) => [
      esc(u.nome), `<code>${esc(u.login)}</code>`, esc(u.funcao || '—'), esc(u.placa || '—'),
      u.gestor ? 'sim' : 'não',
      u.ativo ? 'ativo' : '<span style="color:var(--texto-2)">inativo</span>',
      `<button class="btn btn-fantasma" data-usuario="${esc(u.id)}" style="min-height:32px;font-size:12px">
         ${u.ativo ? 'Desativar' : 'Reativar'}</button>`
    ]),
    'Nenhuma pessoa cadastrada.'
  );

  $('#lista-usuarios').querySelectorAll<HTMLButtonElement>('button[data-usuario]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const u = base.usuarios.find((x) => x.id === btn.dataset.usuario);
      if (!u) return;
      await auth.atualizarUsuario(u.id, { ativo: !u.ativo });
      await recarregarTudo();
    });
  });

  $('#lista-grupos').innerHTML = tabela(
    ['Grupo', 'Rotas (prefixos)', 'Transportadora', 'Situação', ''],
    base.grupos.map((g) => [
      esc(g.nome), g.rotas.map((r) => `<code>${esc(r)}</code>`).join(' '), esc(g.transportadora || '—'),
      g.ativo ? 'ativo' : '<span style="color:var(--texto-2)">inativo</span>',
      `<button class="btn btn-fantasma" data-grupo="${esc(g.id)}" style="min-height:32px;font-size:12px">
         ${g.ativo ? 'Desativar' : 'Reativar'}</button>`
    ]),
    'Nenhum grupo cadastrado.'
  );

  $('#lista-grupos').querySelectorAll<HTMLButtonElement>('button[data-grupo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const g = base.grupos.find((x) => x.id === btn.dataset.grupo);
      if (!g) return;
      await db.salvar('grupos', { ...g, ativo: !g.ativo });
      await recarregarTudo();
    });
  });
}

$<HTMLFormElement>('#form-usuario').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#u-msg');
  try {
    await auth.criarUsuario({
      nome: $<HTMLInputElement>('#u-nome').value,
      login: $<HTMLInputElement>('#u-login').value,
      senha: $<HTMLInputElement>('#u-senha').value,
      funcao: $<HTMLInputElement>('#u-funcao').value,
      placa: $<HTMLInputElement>('#u-placa').value,
      telefone: $<HTMLInputElement>('#u-telefone').value,
      gestor: $<HTMLSelectElement>('#u-gestor').value === 'sim'
    });
    $<HTMLFormElement>('#form-usuario').reset();
    msg.hidden = true;
    await recarregarTudo();
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : 'Não foi possível cadastrar.';
    msg.hidden = false;
  }
});

$<HTMLFormElement>('#form-grupo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('#g-msg');
  const nome = $<HTMLInputElement>('#g-nome').value.trim();
  const rotas = $<HTMLInputElement>('#g-rotas').value.split(',')
    .map((r) => prefixoRota(r)).filter(Boolean);

  if (!nome || !rotas.length) {
    msg.textContent = 'Informe o nome e ao menos uma rota (ex.: FNOR).';
    msg.hidden = false;
    return;
  }

  const grupo: GrupoRota = {
    ...novoSync(),
    nome,
    rotas: [...new Set(rotas)],
    transportadora: $<HTMLInputElement>('#g-transp').value.trim(),
    ativo: true
  };
  await db.salvar('grupos', grupo);
  $<HTMLFormElement>('#form-grupo').reset();
  msg.hidden = true;
  await recarregarTudo();
});

/* --------------------------------------------------- 5. sincronização --- */

async function preencherConfigSupabase(): Promise<void> {
  const c = await obterConfig();
  $<HTMLInputElement>('#s-url').value = c.url;
  $<HTMLInputElement>('#s-key').value = c.anonKey;
  $<HTMLInputElement>('#s-bucket').value = c.bucket;
}

function pintarFila(erro: string | null, pendentes: number, configurado: boolean, ultimo: string | null): void {
  $('#fila-status').innerHTML = `
    <div class="p-kpis">
      <div class="p-kpi"><span class="p-kpi-rot">Registros na fila</span><span class="p-kpi-val">${pendentes}</span></div>
      <div class="p-kpi"><span class="p-kpi-rot">Conexão</span><span class="p-kpi-val" style="font-size:18px">${navigator.onLine ? 'online' : 'offline'}</span></div>
      <div class="p-kpi"><span class="p-kpi-rot">Supabase</span><span class="p-kpi-val" style="font-size:18px">${configurado ? 'configurado' : 'não configurado'}</span></div>
    </div>
    <p class="p-vazio">Último envio: ${ultimo ? dataHora(ultimo) : 'ainda não houve'}.</p>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}`;
}

$('#btn-sync').addEventListener('click', async () => {
  await sync.sincronizar();
  await recarregarTudo();
});

$('#btn-retry').addEventListener('click', async () => {
  await sync.tentarNovamente();
  await recarregarTudo();
});

$('#btn-salvar-sup').addEventListener('click', async () => {
  await salvarConfig({
    url: $<HTMLInputElement>('#s-url').value,
    anonKey: $<HTMLInputElement>('#s-key').value,
    bucket: $<HTMLInputElement>('#s-bucket').value
  });
  const msg = $('#s-msg');
  msg.className = 'sucesso';
  msg.textContent = 'Configuração salva neste aparelho.';
  msg.hidden = false;
  await sync.atualizarContagem();
});

$('#btn-testar-sup').addEventListener('click', async () => {
  const msg = $('#s-msg');
  msg.textContent = 'Testando…';
  msg.className = 'sucesso';
  msg.hidden = false;
  const r = await testarConexao();
  msg.className = r.ok ? 'sucesso' : 'erro';
  msg.textContent = r.mensagem;
});

void boot();
