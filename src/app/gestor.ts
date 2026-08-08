// gestor.ts — painel de supervisão. Tela de desktop: densa, com filtros
// persistentes. A divergência aparece antes de qualquer métrica agregada e
// nunca fica escondida atrás de filtro.

import '../styles/base.css';
import '../styles/painel.css';
import '../styles/relatorio.css';

import type {
  Dispositivo, Leitura, Momento, Ocorrencia, Rota, Sessao, StatusLeitura, Transportadora, Usuario
} from '../types.js';
import * as db from '../lib/db.js';
import { novoSync } from '../lib/db.js';
import * as auth from '../lib/auth.js';
import * as sync from '../lib/sync.js';
import { salvarConfig, obterConfig, testarConexao } from '../lib/supabase.js';
import {
  ETIQUETAS, etiquetaTexto, pedidosIncompletos, pendenciasDaCarga, prefixoRota
} from '../lib/model.js';
import { renderMapa } from '../lib/mapa.js';
import { montarShell, type ItemMenu, type Shell } from '../lib/painel-shell.js';
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
  transportadoras: Transportadora[];
  rotas: Rota[];
  sessoes: Sessao[];
  leituras: Leitura[];
  ocorrencias: Ocorrencia[];
  porSessao: Map<string, Leitura[]>;
  ocPorSessao: Map<string, Ocorrencia[]>;
}

let usuario: Usuario | null = null;
let base: Base = {
  usuarios: [], transportadoras: [], rotas: [], sessoes: [], leituras: [], ocorrencias: [],
  porSessao: new Map(), ocPorSessao: new Map()
};
let dispositivos: Dispositivo[] = [];
let relatorioAberto: DadosRelatorio | null = null;
let shell: Shell | null = null;

const MENU: ItemMenu[] = [
  { id: 'hoje', rotulo: 'Hoje', grupo: 'Operação' },
  { id: 'conferencias', rotulo: 'Conferências', grupo: 'Operação' },
  { id: 'ocorrencias', rotulo: 'Ocorrências', grupo: 'Operação' },
  { id: 'desempenho', rotulo: 'Desempenho', grupo: 'Análise' },
  { id: 'diretor', rotulo: 'Visão do diretor', grupo: 'Análise', href: 'diretor.html' },
  { id: 'pessoas', rotulo: 'Pessoas', grupo: 'Cadastros' },
  { id: 'transportadoras', rotulo: 'Transportadoras', grupo: 'Cadastros' },
  { id: 'rotas', rotulo: 'Códigos de rota', grupo: 'Cadastros' },
  { id: 'sincronizacao', rotulo: 'Sincronização', grupo: 'Sistema' }
];

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

const dentro = (iso: string, de: string, ate: string): boolean => iso >= de && iso <= ate;

/* --------------------------------------------------------------- login --- */

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
  if (!r.ok) {
    elLogin.erro.textContent = r.erro;
    elLogin.erro.hidden = false;
    return;
  }
  if (!r.usuario.gestor) {
    // Erro não é beco sem saída: quem não tem painel tem bipagem.
    location.href = 'index.html';
    return;
  }
  usuario = r.usuario;
  await iniciarPainel();
});

/* ---------------------------------------------------------------- boot --- */

async function boot(): Promise<void> {
  await sync.garantirCadastroLocal();
  sync.iniciarAuto();

  sync.aoMudarSync((estado) => {
    // O chip vive na barra do shell, que só nasce depois do login: antes disso
    // não há onde escrever, e sync não pode explodir por causa da tela.
    const chip = document.querySelector('#chip-sync');
    if (chip) {
      chip.textContent = !estado.configurado
        ? `${estado.pendentes} só no aparelho`
        : estado.pendentes === 0 ? 'Tudo sincronizado' : `${estado.pendentes} na fila`;
      chip.classList.toggle('sync-pendente', estado.pendentes > 0);
      chip.classList.toggle('sync-ok', estado.pendentes === 0 && estado.configurado);
    }
    pintarFila(estado.ultimoErro, estado.pendentes, estado.configurado, estado.ultimoEnvio);
  });

  usuario = await auth.usuarioLogado();
  if (!usuario) {
    elLogin.bloqueio.hidden = false;
    return;
  }
  if (!usuario.gestor) {
    location.href = 'index.html';
    return;
  }
  await iniciarPainel();
}

async function iniciarPainel(): Promise<void> {
  shell = montarShell(MENU, {
    titulo: 'Painel do gestor',
    usuario: usuario ? `${usuario.nome} • gestor` : '',
    inicial: 'hoje'
  });

  $('#btn-sair').addEventListener('click', () => {
    auth.sair();
    location.reload();
  });

  elLogin.bloqueio.hidden = true;
  elLogin.conteudo.hidden = false;

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

  pintarAtencao(leiturasHoje);

  // Com o painel em seções, a faixa abaixo deixa de estar sempre na tela. O
  // badge e a faixa do shell recolocam o alarme nas demais seções — inclusive em
  // Cadastros, onde ninguém iria procurar por ele. Em Hoje a faixa do shell se
  // cala: o alarme já está aqui, com os volumes na frente do gestor.
  shell?.definirBadge('hoje', divergentes.length);
  shell?.definirAlerta(divergentes.length
    ? `<b>${divergentes.length} volume(s) de outra rota hoje.</b>
       Não podem embarcar — <a href="#hoje">ver quais são</a>.`
    : null, { redundanteEm: 'hoje' });

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
               esc(s?.usuarioNome ?? '—'), esc(s ? `${s.transportadoraNome} (${s.rotas.join(', ')})` : '—'),
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
        esc(s.usuarioNome), esc(s.transportadoraNome), esc(s.rotas.join(', ')),
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

  pintarNaoMapeados(leiturasHoje);
  pintarOcorrencias();
  pintarRecorrentes();
}

/**
 * A primeira tela responde uma pergunta só: existe alguma carga que precisa da
 * minha atenção agora? Sem isso o gestor tem que caçar o problema pelo painel.
 */
function pintarAtencao(leiturasHoje: Leitura[]): void {
  const itens: { texto: string; alvo?: string }[] = [];

  const divergentes = leiturasHoje.filter((l) => l.status === 'ROTA_DIVERGENTE').length;
  if (divergentes) itens.push({ texto: `${divergentes} volume(s) de outra transportadora`, alvo: '#faixa-divergencia' });

  const naoMapeados = new Set(
    leiturasHoje.filter((l) => l.status === 'DESTINO_NAO_MAPEADO').map((l) => l.rotaPrefixo ?? '?')
  );
  if (naoMapeados.size) {
    itens.push({ texto: `${naoMapeados.size} código(s) de rota sem cadastro`, alvo: '#nao-mapeados' });
  }

  const incompletos = pedidosIncompletos(leiturasHoje).length;
  if (incompletos) itens.push({ texto: `${incompletos} pedido(s) com volume faltando`, alvo: '#incompletos-hoje' });

  const aguardando = base.sessoes.filter((s) => s.status === 'ENCERRADA' && !s.liberadaEm
    && dentro(s.inicio, limitesDoDia().inicio, limitesDoDia().fim)).length;
  // Aviso que mora em outra seção leva ao item de menu, não ao id do cartão:
  // rolar até um elemento escondido não mostra nada.
  if (aguardando) itens.push({ texto: `${aguardando} carga(s) aguardando liberação`, alvo: '#conferencias' });

  const paradas = dispositivos.filter((d) => d.pendentes > 0);
  if (paradas.length) {
    const total = paradas.reduce((n, d) => n + d.pendentes, 0);
    itens.push({ texto: `${total} leitura(s) ainda num aparelho sem sincronizar`, alvo: '#sincronizacao' });
  }

  $('#atencao').innerHTML = itens.length
    ? `<div class="p-atencao">
         <h3>Precisa de atenção</h3>
         <ul>${itens.map((i) => `<li><a href="${i.alvo ?? '#'}">${esc(i.texto)}</a></li>`).join('')}</ul>
       </div>`
    : '<div class="p-faixa-ok">Operação normal: nenhuma pendência hoje.</div>';
}

/**
 * Códigos que apareceram na doca e ninguém cadastrou. O operador não decide a
 * rota — a decisão é daqui, e em um clique.
 */
function pintarNaoMapeados(leiturasHoje: Leitura[]): void {
  const porCodigo = new Map<string, { codigo: string; volumes: number; ultima: string; transportadoras: Set<string> }>();

  for (const l of base.leituras) {
    if (l.status !== 'DESTINO_NAO_MAPEADO' || !l.rotaPrefixo) continue;
    const atual = porCodigo.get(l.rotaPrefixo)
      ?? { codigo: l.rotaPrefixo, volumes: 0, ultima: l.timestamp, transportadoras: new Set<string>() };
    atual.volumes++;
    if (l.timestamp > atual.ultima) atual.ultima = l.timestamp;
    const s = base.sessoes.find((x) => x.id === l.sessaoId);
    if (s) atual.transportadoras.add(s.transportadoraNome);
    porCodigo.set(l.rotaPrefixo, atual);
  }

  // Já cadastrado depois da leitura? Some da lista: o problema foi resolvido.
  const cadastrados = new Set(base.rotas.map((r) => r.codigo));
  const pendentes = [...porCodigo.values()]
    .filter((c) => !cadastrados.has(c.codigo))
    .sort((a, b) => b.volumes - a.volumes);

  const opcoes = base.transportadoras.filter((t) => t.ativo)
    .map((t) => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join('');

  $('#nao-mapeados').innerHTML = pendentes.length
    ? tabela(
        ['Código', 'Volumes', 'Apareceu conferindo', 'Última leitura', 'Cadastrar como rota de'],
        pendentes.map((c) => [
          `<code>${esc(c.codigo)}</code>`,
          `<span class="p-num-col">${c.volumes}</span>`,
          esc([...c.transportadoras].join(', ') || '—'),
          dataHora(c.ultima),
          `<span class="p-acao-inline">
             <select data-mapear="${esc(c.codigo)}">${opcoes}</select>
             <button class="btn btn-primario" data-cadastrar="${esc(c.codigo)}"
                     style="min-height:32px;font-size:12px">Cadastrar</button>
           </span>`
        ])
      )
    : '<p class="p-vazio">Nenhum código de rota pendente de cadastro.</p>';

  $('#nao-mapeados').querySelectorAll<HTMLButtonElement>('button[data-cadastrar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const codigo = btn.dataset.cadastrar as string;
      const select = $<HTMLSelectElement>(`select[data-mapear="${codigo}"]`);
      const r = await cadastrarRota({ codigo, nome: codigo, transportadoraId: select.value });
      if (!r.ok) {
        alert(r.erro);
        return;
      }
      await recarregarTudo();
    });
  });

  void leiturasHoje;
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
        const quem = s ? `${s.usuarioNome} • ${s.transportadoraNome}` : '';
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
    const chave = s?.transportadoraNome || 'Sem identificação';
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
    `${relatorioAberto.sessao.transportadoraNome} — ${relatorioAberto.sessao.usuarioNome}`;
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
  manter(rota, base.rotas.map((r) => [r.codigo, `${r.codigo} — ${r.nome}`]), 'Todas');
  manter(etiqueta, ETIQUETAS.map((e) => [e.id, e.texto]), 'Todas');

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
async function donoDoCodigo(codigo: string, ignorarId?: string): Promise<Rota | null> {
  const existente = await db.umPorIndice('rotas', 'codigo', codigo);
  if (!existente || existente.id === ignorarId) return null;
  return existente;
}

/** Cadastra um código de rota, recusando duplicidade com mensagem que explica. */
async function cadastrarRota(dados: {
  codigo: string; nome: string; transportadoraId: string; descricao?: string;
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const codigo = prefixoRota(dados.codigo);
  if (!codigo) return { ok: false, erro: 'O código precisa começar com letras (ex.: FNOR).' };
  if (!dados.transportadoraId) return { ok: false, erro: 'Escolha a transportadora dona do código.' };

  const conflito = await donoDoCodigo(codigo);
  if (conflito) {
    const dona = base.transportadoras.find((t) => t.id === conflito.transportadoraId)?.nome ?? 'outra transportadora';
    return { ok: false, erro: `O código ${codigo} já pertence à ${dona}. Um código de rota é de uma transportadora só.` };
  }

  await db.salvar('rotas', {
    ...novoSync(),
    codigo,
    nome: dados.nome.trim() || codigo,
    transportadoraId: dados.transportadoraId,
    descricao: (dados.descricao ?? '').trim(),
    ativo: true
  });
  return { ok: true };
}

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
  });

  if (!r.ok) {
    msg.textContent = r.erro;
    msg.hidden = false;
    return;
  }

  $<HTMLFormElement>('#form-rota').reset();
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

// O boot decide a tela inicial e demora (seed, IndexedDB, rede). Guardar a
// promessa deixa o login esperar por ele em vez de disputar a tela.
const bootPronto = boot().catch((e: unknown) => {
  console.error('boot', e);
});
