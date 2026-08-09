// gestor.ts — painel de supervisão. Tela de desktop: densa, com filtros
// persistentes. A divergência aparece antes de qualquer métrica agregada e
// nunca fica escondida atrás de filtro.

import '../styles/base.css';
import '../styles/painel.css';
import '../styles/relatorio.css';

import type {
  Dispositivo, Leitura, Ocorrencia, Sessao, StatusLeitura, Usuario
} from '../types.js';
import * as db from '../lib/db.js';
import { novoSync } from '../lib/db.js';
import * as auth from '../lib/auth.js';
import * as sync from '../lib/sync.js';
import { salvarConfig, obterConfig, testarConexao } from '../lib/supabase.js';
import { pendenciasDaCarga, prefixoRota } from '../lib/model.js';
import { renderMapa } from '../lib/mapa.js';
import { montarShell, type ItemMenu, type Shell } from '../lib/shell/index.js';
import { sinalSync } from '../lib/ui/index.js';
import type { Ambiente } from './ambiente.js';
import { baseVazia, dentro, type Base, type Contexto, type Modulo } from './painel/contexto.js';
import { montar as montarDivergencias } from './painel/divergencias.js';
import { montar as montarIncompletos } from './painel/incompletos.js';
import { montar as montarInicio } from './painel/inicio.js';
import { montar as montarOcorrencias } from './painel/ocorrencias.js';
import { cadastrarRota } from './painel/cadastro-rotas.js';
import {
  exportarPDF, exportarCSV, hidratarFotos, montarRelatorio, renderizarHTML,
  type DadosRelatorio
} from '../lib/relatorio.js';
import {
  $, baixarArquivo, dataHora, duracao, esc, limitesDoDia, minutosEntre,
  paraCSV, pct
} from '../lib/util.js';

/* --------------------------------------------------------------- dados --- */

let usuario: Usuario | null = null;
let base: Base = baseVazia();
let dispositivos: Dispositivo[] = [];
let relatorioAberto: DadosRelatorio | null = null;
let shell: Shell | null = null;
let ambiente: Ambiente | null = null;

const MENU: ItemMenu[] = [
  { id: 'inicio', rotulo: 'Início', grupo: 'Operação', href: '/painel' },
  { id: 'divergencias', rotulo: 'Divergências', grupo: 'Operação', href: '/painel/divergencias' },
  { id: 'incompletos', rotulo: 'Pedidos incompletos', grupo: 'Operação', href: '/painel/incompletos' },
  { id: 'conferencias', rotulo: 'Conferências', grupo: 'Operação', href: '/painel/conferencias' },
  { id: 'ocorrencias', rotulo: 'Ocorrências', grupo: 'Operação', href: '/painel/ocorrencias' },
  { id: 'desempenho', rotulo: 'Desempenho', grupo: 'Análise', href: '/painel/desempenho' },
  // Deixou de ser link para outra página: a leitura agregada virou seção deste
  // mesmo painel, e a palavra "diretor" some da interface.
  { id: 'indicadores', rotulo: 'Indicadores', grupo: 'Análise', href: '/painel/indicadores' },
  { id: 'mapa', rotulo: 'Mapa', grupo: 'Análise', href: '/painel/mapa' },
  { id: 'relatorios', rotulo: 'Relatórios', grupo: 'Análise', href: '/painel/relatorios' },
  { id: 'pessoas', rotulo: 'Pessoas', grupo: 'Cadastros', href: '/painel/pessoas' },
  { id: 'transportadoras', rotulo: 'Transportadoras', grupo: 'Cadastros', href: '/painel/transportadoras' },
  { id: 'rotas', rotulo: 'Códigos de rota', grupo: 'Cadastros', href: '/painel/rotas' },
  { id: 'sincronizacao', rotulo: 'Sincronização', grupo: 'Sistema', href: '/painel/sincronizacao' }
];

/** Seções já migradas, por id do menu. Cresce nas Tasks 11 a 13. */
const secoes = new Map<string, Modulo>();

const contexto: Contexto = {
  usuario: () => usuario as Usuario,
  base: () => base,
  dispositivos: () => dispositivos,
  recarregar: () => recarregarTudo(),
  irPara: (r) => ambiente?.irPara(r)
};

/**
 * Repinta só a seção visível.
 *
 * Antes as cinco seções eram redesenhadas a cada 15 segundos, inclusive as que
 * ninguém estava vendo — e cada repintura reconstrói tabela inteira em innerHTML.
 */
function pintarSecaoVisivel(): void {
  if (!shell) return;
  secoes.get(shell.secaoAtual())?.pintar();
}

async function carregar(): Promise<void> {
  const [usuarios, transportadoras, rotas, sessoes, leituras, ocorrencias] = await Promise.all([
    db.todos('usuarios'), db.todos('transportadoras'), db.todos('rotas'),
    db.todos('sessoes'), db.todos('leituras'), db.todos('ocorrencias')
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
    transportadoras: transportadoras.sort((a, b) => a.nome.localeCompare(b.nome)),
    rotas: rotas.sort((a, b) => a.codigo.localeCompare(b.codigo)),
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


/* --------------------------------------------------------------- login --- */


/* ---------------------------------------------------------------- boot --- */

async function boot(): Promise<void> {
  // Cadastro local, sincronização e login são do `main.ts`. Aqui fica só o que
  // é do painel: o chip da barra e a caixa de estado da fila.
  sync.aoMudarSync((estado) => {
    const chip = document.querySelector<HTMLElement>('#chip-sync-painel');
    if (chip) {
      const s = sinalSync(estado);
      chip.textContent = `${s.icone} ${s.texto}`;
      chip.className = `chip chip-sync ui-sync-${s.tom}`;
    }
    pintarFila(estado.ultimoErro, estado.pendentes, estado.configurado, estado.ultimoEnvio);
  });

  await iniciarPainel();
}

async function iniciarPainel(): Promise<void> {
  shell = montarShell({
    modo: 'painel',
    itens: MENU,
    usuario: usuario ? `${usuario.nome} • gestor` : '',
    raiz: $('#tela-painel')
  });
  // O teste de ponta a ponta precisa de um jeito de forçar o badge sem inventar
  // divergência no banco. É a única superfície pública do shell.
  (window as unknown as { __shell: Shell }).__shell = shell;
  shell.aoTrocarSecao(() => pintarSecaoVisivel());

  secoes.set('divergencias', montarDivergencias($('[data-secao="divergencias"]'), contexto));
  secoes.set('incompletos', montarIncompletos($('[data-secao="incompletos"]'), contexto));
  secoes.set('inicio', montarInicio($('[data-secao="inicio"]'), contexto));
  secoes.set('ocorrencias', montarOcorrencias($('[data-secao="ocorrencias"]'), contexto));

  // Delegação, e não um listener no `#btn-sair`: no celular o "Sair" vive na
  // folha "Mais", que é remontada a cada abertura — um listener preso ao
  // elemento morreria junto com o HTML anterior.
  document.addEventListener('click', (ev) => {
    if (!(ev.target as HTMLElement).closest('#btn-sair, [data-sair]')) return;
    ambiente?.sair();
  });


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
  dispositivos = await sync.listarDispositivos();
  pintarDispositivos();
  preencherSelects();
  pintarAgora();
  pintarHistorico();
  pintarCadastros();
  pintarSecaoVisivel();
  void sync.atualizarContagem();
}

async function atualizarAoVivo(): Promise<void> {
  await carregar();
  pintarAgora();
  pintarSecaoVisivel();
}

/* -------------------------------------------------- 1. tem algo errado? -- */

function pintarAgora(): void {
  const { inicio, fim } = limitesDoDia();
  const divergentes = base.leituras.filter(
    (l) => dentro(l.timestamp, inicio, fim) && l.status === 'ROTA_DIVERGENTE'
  );

  // O que sobrou aqui é do shell, não de uma seção: o badge e a faixa precisam
  // valer em TODAS as telas, então quem os atualiza não pode ser um módulo que
  // só pinta quando está visível.
  shell?.definirBadge('divergencias', divergentes.length);
  shell?.definirAlerta(divergentes.length
    ? `<b>${divergentes.length} volume(s) de outra rota hoje.</b>
       Não podem embarcar — <a href="/painel/divergencias">ver quais são</a>.`
    : null, { redundanteEm: 'divergencias' });

}

/** Aparelho com fila pendente significa que o número desta tela está incompleto. */
function pintarDispositivos(): void {
  $('#dispositivos').innerHTML = tabela(
    ['Aparelho', 'Última pessoa', 'Última sincronização', 'Pendentes'],
    dispositivos.map((d) => [
      esc(d.apelido.slice(0, 48)),
      esc(d.ultimoUsuario || '—'),
      d.ultimaSync ? dataHora(d.ultimaSync) : 'nunca',
      d.pendentes > 0
        ? `<b style="color:var(--dup)">${d.pendentes}</b>`
        : '0'
    ]),
    'Nenhum aparelho sincronizou ainda — ou o Supabase não está configurado.'
  );
}

/* ------------------------------------------------------- ocorrências ----- */

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
    ['Início', 'Pessoa', 'Transportadora', 'Rotas', 'Duração', 'Volumes', 'OK', 'Outra rota', 'Não mapeado', 'Dupl.', 'Inv.', 'Ocorr.', 'Carga', ''],
    sessoes.map((s) => {
      const ls = base.porSessao.get(s.id) ?? [];
      const conta = (st: StatusLeitura): number => ls.filter((l) => l.status === st).length;
      const div = conta('ROTA_DIVERGENTE');
      const ocs = base.ocPorSessao.get(s.id) ?? [];
      const graves = ocs.filter((o) => o.grave).length;
      const naoMapeado = conta('DESTINO_NAO_MAPEADO');
      return [
        dataHora(s.inicio), esc(s.usuarioNome), esc(s.transportadoraNome), esc(s.rotas.join(', ')),
        duracao(s.inicio, s.fim), `<span class="p-num-col">${ls.length}</span>`,
        String(conta('OK')),
        div ? `<b style="color:var(--div)">${div}</b>` : '0',
        naoMapeado ? `<b style="color:var(--mapa, #ea580c)">${naoMapeado}</b>` : '0',
        String(conta('DUPLICADO')), String(conta('INVALIDO')),
        ocs.length ? `${ocs.length}${graves ? ` <b style="color:var(--div)">(${graves} graves)</b>` : ''}` : '0',
        estadoDaCarga(s, ls),
        `<button class="btn btn-secundario" data-sessao="${esc(s.id)}" style="min-height:32px;font-size:12px">Detalhe</button>`
      ];
    }),
    'Nenhuma conferência no período.'
  );

  $('#tabela-sessoes').querySelectorAll<HTMLButtonElement>('button[data-sessao]').forEach((btn) => {
    btn.addEventListener('click', () => void abrirGaveta(btn.dataset.sessao as string));
  });

  $('#tabela-sessoes').querySelectorAll<HTMLButtonElement>('button[data-liberar]').forEach((btn) => {
    btn.addEventListener('click', () => void liberarCarga(btn.dataset.liberar as string));
  });

  pintarDesempenho(sessoes);
}

/**
 * Estado da carga: conferindo, com pendência, pronta ou liberada.
 * Liberar é ação do gestor — o sistema avisa, mas não decide sozinho parar
 * um caminhão.
 */
function estadoDaCarga(s: Sessao, leituras: Leitura[]): string {
  if (s.status === 'ABERTA') return '<span class="chip">em conferência</span>';

  if (s.liberadaEm) {
    return s.liberadaComPendencias
      ? `<span class="chip chip-atencao" title="Liberada mesmo com pendência">liberada com ressalva</span>`
      : '<span class="chip chip-ok">liberada</span>';
  }

  const pendencias = pendenciasDaCarga(leituras);
  const rotulo = pendencias.length
    ? `<span class="chip chip-alerta" title="${esc(pendencias.map((p) => p.descricao).join(' • '))}">${pendencias.length} pendência(s)</span>`
    : '<span class="chip chip-ok">sem pendência</span>';

  return `${rotulo}
    <button class="btn btn-fantasma" data-liberar="${esc(s.id)}"
            style="min-height:28px;font-size:11px;margin-left:6px">Liberar</button>`;
}

async function liberarCarga(sessaoId: string): Promise<void> {
  const sessao = base.sessoes.find((s) => s.id === sessaoId);
  if (!sessao || !usuario) return;

  const pendencias = pendenciasDaCarga(base.porSessao.get(sessaoId) ?? []);
  if (pendencias.length) {
    const lista = pendencias.map((p) => `• ${p.descricao}`).join('\n');
    const segue = confirm(
      `Esta carga tem pendência:\n\n${lista}\n\n`
      + 'Liberar assim mesmo? A liberação fica registrada como "com ressalva".'
    );
    if (!segue) return;
  }

  await db.salvar('sessoes', {
    ...sessao,
    liberadaEm: new Date().toISOString(),
    liberadaPor: usuario.nome,
    liberadaComPendencias: pendencias.length > 0
  });
  await recarregarTudo();
}



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

let gaveta!: HTMLElement;

async function abrirGaveta(sessaoId: string): Promise<void> {
  relatorioAberto = await montarRelatorio(sessaoId);
  $('#gaveta-titulo').textContent =
    `${relatorioAberto.sessao.transportadoraNome} — ${relatorioAberto.sessao.usuarioNome}`;
  $('#gaveta-mapa').innerHTML = renderMapa(relatorioAberto.leituras);
  const conteudo = $('#gaveta-conteudo');
  conteudo.innerHTML = renderizarHTML(relatorioAberto);
  hidratarFotos(conteudo, relatorioAberto.ocorrencias);
  gaveta.hidden = false;
}


/* ------------------------------------------------------- 4. cadastros --- */

function preencherSelects(): void {
  const pessoa = $<HTMLSelectElement>('#f-pessoa');
  const rota = $<HTMLSelectElement>('#f-rota');

  const manter = (sel: HTMLSelectElement, opcoes: string[][], rotuloTodos: string): void => {
    const atual = sel.value;
    sel.innerHTML = `<option value="">${rotuloTodos}</option>`
      + opcoes.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    sel.value = atual;
  };

  manter(pessoa, base.usuarios.map((u) => [u.id, u.nome]), 'Todas');
  manter(rota, base.rotas.map((r) => [r.codigo, `${r.codigo} — ${r.nome}`]), 'Todas');

  // O select do cadastro de rota não é filtro: sem "Todas".
  const selTransp = $<HTMLSelectElement>('#r-transportadora');
  const escolhida = selTransp.value;
  selTransp.innerHTML = base.transportadoras
    .filter((t) => t.ativo)
    .map((t) => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`)
    .join('');
  selTransp.value = escolhida;
}

function pintarCadastros(): void {
  const acao = (attr: string, id: string, texto: string): string =>
    `<button class="btn btn-fantasma" ${attr}="${esc(id)}"
       style="min-height:32px;font-size:12px">${texto}</button>`;

  $('#lista-usuarios').innerHTML = tabela(
    ['Nome', 'Login', 'Função', 'Placa', 'Painel', 'Senha', 'Situação', ''],
    base.usuarios.map((u) => [
      esc(u.nome), `<code>${esc(u.login)}</code>`, esc(u.funcao || '—'), esc(u.placa || '—'),
      u.gestor ? 'sim' : 'não',
      u.senhaHash
        ? 'definida'
        : '<span style="color:var(--texto-2)">escolhe na 1ª entrada</span>',
      u.ativo ? 'ativo' : '<span style="color:var(--texto-2)">inativo</span>',
      acao('data-editar', u.id, 'Editar')
        + ' ' + acao('data-senha', u.id, 'Redefinir senha')
        + ' ' + acao('data-usuario', u.id, u.ativo ? 'Desativar' : 'Reativar')
    ]),
    'Nenhuma pessoa cadastrada.'
  );

  $('#lista-usuarios').querySelectorAll<HTMLButtonElement>('button[data-usuario]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const u = base.usuarios.find((x) => x.id === btn.dataset.usuario);
      if (!u) return;
      // Desativar a si mesmo tranca o painel sem ninguém do outro lado.
      if (u.id === usuario?.id && u.ativo) {
        avisoUsuario('Você não pode desativar o próprio acesso.', true);
        return;
      }
      await auth.atualizarUsuario(u.id, { ativo: !u.ativo });
      await recarregarTudo();
    });
  });

  $('#lista-usuarios').querySelectorAll<HTMLButtonElement>('button[data-editar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const u = base.usuarios.find((x) => x.id === btn.dataset.editar);
      if (u) entrarEmEdicao(u);
    });
  });

  $('#lista-usuarios').querySelectorAll<HTMLButtonElement>('button[data-senha]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const u = base.usuarios.find((x) => x.id === btn.dataset.senha);
      if (!u) return;
      await auth.redefinirSenha(u.id);
      await recarregarTudo();
      avisoUsuario(`Senha de ${u.nome} liberada. Na próxima entrada, ela escolhe a nova senha no aparelho dela.`);
    });
  });

  const nomeTransp = (id: string): string =>
    base.transportadoras.find((t) => t.id === id)?.nome ?? 'transportadora removida';

  $('#lista-transportadoras').innerHTML = tabela(
    ['Transportadora', 'Rotas', 'Responsável', 'Situação', ''],
    base.transportadoras.map((t) => {
      const rotas = base.rotas.filter((r) => r.transportadoraId === t.id && r.ativo);
      return [
        esc(t.nome),
        rotas.length ? rotas.map((r) => `<code>${esc(r.codigo)}</code>`).join(' ') : '<span class="p-vazio">sem rota</span>',
        esc(t.responsavel || '—'),
        t.ativo ? 'ativa' : '<span style="color:var(--texto-2)">inativa</span>',
        `<button class="btn btn-fantasma" data-transp="${esc(t.id)}" style="min-height:32px;font-size:12px">
           ${t.ativo ? 'Desativar' : 'Reativar'}</button>`
      ];
    }),
    'Nenhuma transportadora cadastrada. Cadastre a primeira para o operador ter o que escolher.'
  );

  $('#lista-transportadoras').querySelectorAll<HTMLButtonElement>('button[data-transp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const t = base.transportadoras.find((x) => x.id === btn.dataset.transp);
      if (!t) return;
      await db.salvar('transportadoras', { ...t, ativo: !t.ativo });
      await recarregarTudo();
    });
  });

  $('#lista-rotas').innerHTML = tabela(
    ['Código', 'Rota', 'Transportadora', 'Situação', ''],
    base.rotas.map((r) => [
      `<code>${esc(r.codigo)}</code>`,
      esc(r.nome),
      esc(nomeTransp(r.transportadoraId)),
      r.ativo ? 'ativa' : '<span style="color:var(--texto-2)">inativa</span>',
      `<button class="btn btn-fantasma" data-rota="${esc(r.id)}" style="min-height:32px;font-size:12px">
         ${r.ativo ? 'Desativar' : 'Reativar'}</button>`
    ]),
    'Nenhum código de rota cadastrado. Sem isso, toda leitura cai como rota não cadastrada.'
  );

  $('#lista-rotas').querySelectorAll<HTMLButtonElement>('button[data-rota]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const r = base.rotas.find((x) => x.id === btn.dataset.rota);
      if (!r) return;
      await db.salvar('rotas', { ...r, ativo: !r.ativo });
      await recarregarTudo();
    });
  });
}

/** O código é único no sistema: é isso que permite achar o dono pela etiqueta. */
/* ------------------------------------------------------------ acessos --- */
// Um formulário só, dois modos: em branco cadastra, carregado edita. Duas telas
// para a mesma coisa é o que faz o gestor errar de campo.

/** id em edição; vazio = cadastrando alguém novo. */
let editando = '';

function avisoUsuario(texto: string, erro = false): void {
  const msg = $('#u-msg');
  const ok = $('#u-ok');
  msg.hidden = !erro;
  ok.hidden = erro;
  (erro ? msg : ok).textContent = texto;
}

function limparFormUsuario(): void {
  editando = '';
  $<HTMLFormElement>('#form-usuario').reset();
  $('#u-titulo').textContent = 'Acessos';
  $('#u-salvar').textContent = 'Cadastrar';
  $('#u-cancelar').hidden = true;
  $<HTMLInputElement>('#u-senha').placeholder = 'a pessoa escolhe na 1ª entrada';
}

function entrarEmEdicao(u: Usuario): void {
  editando = u.id;
  $<HTMLInputElement>('#u-nome').value = u.nome;
  $<HTMLInputElement>('#u-login').value = u.login;
  $<HTMLInputElement>('#u-senha').value = '';
  $<HTMLInputElement>('#u-senha').placeholder = 'em branco = não mexe na senha';
  $<HTMLInputElement>('#u-funcao').value = u.funcao;
  $<HTMLInputElement>('#u-placa').value = u.placa;
  $<HTMLInputElement>('#u-telefone').value = u.telefone;
  $<HTMLSelectElement>('#u-gestor').value = u.gestor ? 'sim' : 'nao';
  $('#u-titulo').textContent = `Acessos — editando ${u.nome}`;
  $('#u-salvar').textContent = 'Salvar';
  $('#u-cancelar').hidden = false;
  $('#u-msg').hidden = true;
  $('#u-ok').hidden = true;
  $<HTMLInputElement>('#u-nome').focus();
}





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





// O boot decide a tela inicial e demora (seed, IndexedDB, rede). Guardar a
// promessa deixa o login esperar por ele em vez de disputar a tela.
/**
 * Registra tudo que antes rodava no `import`.
 *
 * Precisa de `elLogin` e `gaveta` já resolvidos: `$()` lança quando não acha
 * (util.ts), e no app único este módulo passa a ser importado antes de a
 * região do painel existir no DOM.
 */
function ligarEventos(): void {

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
          s?.id ?? '', s?.inicio ?? '', s?.usuarioNome ?? '', s?.transportadoraNome ?? '', (s?.rotas ?? []).join('|'),
          l.codigoVolume ?? '', l.rota ?? '', l.pedido ?? '', l.volume ?? '', l.status, l.origem, l.timestamp,
          l.lat ?? '', l.lng ?? '', l.precisaoMetros ?? '', l.geoStatus,
          ocs.map((o) => o.texto).join(' | '), l.rawData
        ];
      });
    const cab = ['sessao', 'inicio_sessao', 'conferente', 'transportadora', 'rotas', 'codigo_volume', 'rota',
      'pedido', 'volume', 'status', 'origem', 'horario', 'lat', 'lng', 'precisao_m', 'geo_status',
      'ocorrencias', 'raw_qr'];
    baixarArquivo(paraCSV(cab, linhas), 'conferencias_periodo.csv', 'text/csv;charset=utf-8');
  });

  $('#gaveta-fechar').addEventListener('click', () => { gaveta.hidden = true; });

  gaveta.addEventListener('click', (ev) => { if (ev.target === gaveta) gaveta.hidden = true; });

  $('#gaveta-pdf').addEventListener('click', () => { if (relatorioAberto) void exportarPDF(relatorioAberto); });

  $('#gaveta-csv').addEventListener('click', () => { if (relatorioAberto) exportarCSV(relatorioAberto); });

  $('#u-cancelar').addEventListener('click', () => limparFormUsuario());

  $<HTMLFormElement>('#form-usuario').addEventListener('submit', async (ev) => {
    ev.preventDefault();

    const campos = {
      nome: $<HTMLInputElement>('#u-nome').value,
      login: $<HTMLInputElement>('#u-login').value,
      funcao: $<HTMLInputElement>('#u-funcao').value,
      placa: $<HTMLInputElement>('#u-placa').value,
      telefone: $<HTMLInputElement>('#u-telefone').value,
      gestor: $<HTMLSelectElement>('#u-gestor').value === 'sim'
    };
    const senha = $<HTMLInputElement>('#u-senha').value;

    try {
      if (editando) {
        // Tirar o próprio acesso ao painel deixa o gestor do lado de fora.
        if (editando === usuario?.id && !campos.gestor) {
          throw new Error('Você não pode tirar o próprio acesso ao painel.');
        }
        const salvo = await auth.atualizarUsuario(editando, campos, senha || undefined);
        limparFormUsuario();
        await recarregarTudo();
        avisoUsuario(`${salvo.nome} atualizado.`);
      } else {
        const novo = await auth.criarUsuario({ ...campos, senha: senha || undefined });
        limparFormUsuario();
        await recarregarTudo();
        avisoUsuario(senha
          ? `${novo.nome} cadastrado. Passe a senha para a pessoa; ela já pode entrar.`
          : `${novo.nome} cadastrado. Na primeira entrada, ela escolhe a própria senha.`);
      }
    } catch (e) {
      avisoUsuario(e instanceof Error ? e.message : 'Não foi possível salvar.', true);
    }
  });

  $<HTMLFormElement>('#form-transportadora').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('#t-msg');
    const nome = $<HTMLInputElement>('#t-nome').value.trim();
    if (!nome) {
      msg.textContent = 'Informe o nome da transportadora.';
      msg.hidden = false;
      return;
    }

    await db.salvar('transportadoras', {
      ...novoSync(),
      nome,
      cnpj: $<HTMLInputElement>('#t-cnpj').value.trim(),
      responsavel: $<HTMLInputElement>('#t-resp').value.trim(),
      telefone: $<HTMLInputElement>('#t-tel').value.trim(),
      email: '',
      ativo: true
    });

    $<HTMLFormElement>('#form-transportadora').reset();
    msg.hidden = true;
    await recarregarTudo();
  });

  $<HTMLFormElement>('#form-rota').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('#r-msg');

    const r = await cadastrarRota({
      codigo: $<HTMLInputElement>('#r-codigo').value,
      nome: $<HTMLInputElement>('#r-nome').value,
      transportadoraId: $<HTMLSelectElement>('#r-transportadora').value,
      descricao: $<HTMLInputElement>('#r-descricao').value
    }, base.transportadoras);

    if (!r.ok) {
      msg.textContent = r.erro;
      msg.hidden = false;
      return;
    }

    $<HTMLFormElement>('#form-rota').reset();
    msg.hidden = true;
    await recarregarTudo();
  });

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
}

let montado = false;

/**
 * Ponto de entrada do painel. Quem chama é o `main.ts`, que já resolveu quem
 * está logado e se essa pessoa tem acesso — aqui não se decide papel.
 */
export async function montar(amb: Ambiente): Promise<void> {
  ambiente = amb;
  usuario = amb.usuario;
  if (montado) return;
  montado = true;
  gaveta = $('#gaveta');
  ligarEventos();
  await boot().catch((e: unknown) => {
    console.error('painel', e);
  });
}

/** Mostra uma seção do painel. Chamado pelo roteador a cada navegação. */
export function mostrarSecao(id: string): void {
  shell?.mostrar(id);
}
