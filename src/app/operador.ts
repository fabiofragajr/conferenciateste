// operador.ts — app de bipagem. Duas telas até a câmera abrir, esse é o teto.
//
// Nada aqui espera rede: leitura e ocorrência gravam no IndexedDB e a fila de
// sincronização cuida do Supabase depois, em segundo plano.

import '../styles/base.css';
import '../styles/app.css';
import '../styles/relatorio.css';

import type {
  Leitura, Momento, Ocorrencia, PontoGeo, Rota, Sessao, StatusLeitura, Transportadora, Usuario
} from '../types.js';
import * as db from '../lib/db.js';
import { novoSync } from '../lib/db.js';
import * as auth from '../lib/auth.js';
import * as geo from '../lib/geo.js';
import * as sync from '../lib/sync.js';
import * as fb from '../lib/feedback.js';
import { criarScanner, type Scanner } from '../lib/scanner.js';
import {
  ETIQUETAS, STATUS_INFO, classificar, derivarGrave,
  etiquetasDoMomento, normalizar, pendenciasDaCarga, prefixoRota,
  type PrimeiraLeitura
} from '../lib/model.js';
import {
  $, agora, comprimirImagem, esc, hora, manterTelaAcesa
} from '../lib/util.js';
import {
  exportarCSV, exportarPDF, hidratarFotos, montarRelatorio, renderizarHTML,
  type DadosRelatorio
} from '../lib/relatorio.js';

/* ------------------------------------------------------------- estado ---- */

let usuario: Usuario | null = null;
let transportadoras: Transportadora[] = [];
let sessao: Sessao | null = null;
/** Cadastro de rotas em memória: a validação da bipagem não toca em disco nem em rede. */
let rotasPorCodigo = new Map<string, Rota>();
let nomePorTransportadora = new Map<string, string>();
let scanner: Scanner | null = null;
let telaAcesa: { liberar: () => void } | null = null;
let relatorioAtual: DadosRelatorio | null = null;

/** codigoVolume -> primeira leitura, para o duplicado dizer quem e quando. */
const codigosBipados = new Map<string, PrimeiraLeitura>();
const contadores = {
  total: 0, OK: 0, ROTA_DIVERGENTE: 0, DESTINO_NAO_MAPEADO: 0, DUPLICADO: 0, INVALIDO: 0
};
const ocorrenciasPorLeitura = new Map<string, number>();

/* ---------------------------------------------------------------- DOM ---- */

const views = {
  login: $('#view-login'),
  grupo: $('#view-grupo'),
  bipagem: $('#view-bipagem'),
  relatorio: $('#view-relatorio')
};

const el = {
  flash: $('#flash-overlay'),
  formLogin: $<HTMLFormElement>('#form-login'),
  inLogin: $<HTMLInputElement>('#in-login'),
  inSenha: $<HTMLInputElement>('#in-senha'),
  loginErro: $('#login-erro'),
  dicaSeed: $('#dica-seed'),

  grupoUsuario: $('#grupo-usuario'),
  listaGrupos: $('#lista-grupos'),
  grupoVazio: $('#grupo-vazio'),
  btnSair: $('#btn-sair'),
  linkPainel: $<HTMLAnchorElement>('#link-painel'),
  syncGrupo: $('#sync-grupo'),

  bipGrupo: $('#bip-grupo'),
  bipRotas: $('#bip-rotas'),
  btnTocha: $<HTMLButtonElement>('#btn-tocha'),
  chipGeo: $('#chip-geo'),
  chipSync: $('#chip-sync'),
  video: $<HTMLVideoElement>('#video'),
  cameraErro: $('#camera-erro'),
  cameraErroTxt: $('#camera-erro-txt'),
  btnRecamera: $('#btn-recamera'),
  banner: $('#banner'),
  bannerStatus: $('#banner-status'),
  bannerCodigo: $('#banner-codigo'),
  cTotal: $('#c-total'),
  cOk: $('#c-ok'),
  cDiv: $('#c-div'),
  cDup: $('#c-dup'),
  cInv: $('#c-inv'),
  listaLeituras: $('#lista-leituras'),
  btnManual: $('#btn-manual'),
  btnOcEntrega: $('#btn-oc-entrega'),
  btnEncerrar: $('#btn-encerrar'),

  relSync: $('#rel-sync'),
  btnNova: $('#btn-nova'),
  btnPdf: $<HTMLButtonElement>('#btn-pdf'),
  btnCsv: $('#btn-csv'),
  relatorioArea: $('#relatorio-area'),

  modalManual: $('#modal-manual'),
  manCodigo: $<HTMLInputElement>('#man-codigo'),
  manRota: $<HTMLInputElement>('#man-rota'),
  manPedido: $<HTMLInputElement>('#man-pedido'),
  manVolume: $<HTMLInputElement>('#man-volume'),
  manErro: $('#man-erro'),
  manCancelar: $('#man-cancelar'),
  manConfirmar: $('#man-confirmar'),

  modalOc: $('#modal-ocorrencia'),
  ocAlvo: $('#oc-alvo'),
  ocTexto: $<HTMLTextAreaElement>('#oc-texto'),
  ocEtiquetas: $('#oc-etiquetas'),
  ocAvisoGrave: $('#oc-aviso-grave'),
  ocFoto: $<HTMLInputElement>('#oc-foto'),
  ocFotosPreview: $('#oc-fotos-preview'),
  ocErro: $('#oc-erro'),
  ocCancelar: $('#oc-cancelar'),
  ocSalvar: $<HTMLButtonElement>('#oc-salvar'),

  modalEncerrar: $('#modal-encerrar'),
  encerrarResumo: $('#encerrar-resumo'),
  encCancelar: $('#enc-cancelar'),
  encConfirmar: $('#enc-confirmar')
};

fb.definirOverlay(el.flash);

function mostrarView(nome: keyof typeof views): void {
  for (const [chave, node] of Object.entries(views)) {
    node.hidden = chave !== nome;
  }
}

function erroEm(node: HTMLElement, msg: string | null): void {
  node.textContent = msg ?? '';
  node.hidden = !msg;
}

/* --------------------------------------------------------------- boot ---- */

async function boot(): Promise<void> {
  // Aparelho novo não tem cadastro: ele desce da base. Enquanto não descer, a
  // tela diz o que fazer em vez de ficar recusando a senha certa.
  if (!(await sync.garantirCadastroLocal())) {
    el.dicaSeed.hidden = false;
    el.dicaSeed.textContent =
      'Este aparelho ainda não recebeu o cadastro. Conecte-se à internet uma vez para baixá-lo.';
  }

  sync.iniciarAuto();
  sync.aoMudarSync((estado) => {
    const texto = !estado.configurado
      ? `${estado.pendentes} no aparelho`
      : estado.pendentes === 0
        ? 'Tudo sincronizado'
        : `${estado.pendentes} na fila${estado.online ? ' • enviando' : ' • offline'}`;
    el.chipSync.textContent = texto;
    el.syncGrupo.textContent = texto;
    el.chipSync.classList.toggle('sync-pendente', estado.pendentes > 0);
    el.chipSync.classList.toggle('sync-ok', estado.pendentes === 0 && estado.configurado);
  });

  geo.aoMudar((p) => {
    const classe = p.geoStatus === 'OK' ? 'geo-ok' : p.geoStatus === 'IMPRECISO' ? 'geo-impreciso' : 'geo-ruim';
    el.chipGeo.className = `chip chip-geo ${classe}`;
    el.chipGeo.textContent = p.geoStatus === 'OK'
      ? `GPS ±${p.precisaoMetros ?? '?'} m`
      : p.geoStatus === 'IMPRECISO'
        ? `GPS impreciso ±${p.precisaoMetros ?? '?'} m`
        : p.geoStatus === 'NEGADO' ? 'Sem permissão de local' : 'Sem sinal de GPS';
  });

  usuario = await auth.usuarioLogado();
  if (!usuario) {
    mostrarView('login');
    el.inLogin.focus();
    return;
  }

  // Conferência aberta no aparelho: volta direto para a bipagem.
  const abertas = (await db.porIndice('sessoes', 'usuarioId', usuario.id))
    .filter((s) => s.status === 'ABERTA')
    .sort((a, b) => b.inicio.localeCompare(a.inicio));

  if (abertas.length) {
    await retomarSessao(abertas[0]);
    return;
  }

  await irParaGrupos();
}

/* -------------------------------------------------------------- login ---- */

el.formLogin.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  fb.prepararAudio(); // gesto do usuário: é aqui que o som fica liberado
  erroEm(el.loginErro, null);
  await bootPronto;

  const r = await auth.entrar(el.inLogin.value, el.inSenha.value);
  if (!r.ok) {
    erroEm(el.loginErro, r.erro);
    return;
  }
  usuario = r.usuario;
  el.inSenha.value = '';
  await irParaGrupos();
});

el.btnSair.addEventListener('click', () => {
  auth.sair();
  usuario = null;
  mostrarView('login');
});

/* ---------------------------------------------------- transportadora ----- */

/** Recarrega o cadastro para a memória. Chamado antes de cada conferência. */
async function carregarCadastro(): Promise<void> {
  const [listaT, listaR] = await Promise.all([db.todos('transportadoras'), db.todos('rotas')]);
  transportadoras = listaT.filter((t) => t.ativo).sort((a, b) => a.nome.localeCompare(b.nome));
  nomePorTransportadora = new Map(listaT.map((t) => [t.id, t.nome]));
  rotasPorCodigo = new Map(listaR.filter((r) => r.ativo).map((r) => [r.codigo, r]));
}

function rotasDe(transportadoraId: string): string[] {
  return [...rotasPorCodigo.values()]
    .filter((r) => r.transportadoraId === transportadoraId)
    .map((r) => r.codigo)
    .sort();
}

async function irParaGrupos(): Promise<void> {
  if (!usuario) return;

  el.grupoUsuario.textContent = `${usuario.nome}${usuario.funcao ? ` • ${usuario.funcao}` : ''}`;
  el.linkPainel.hidden = !usuario.gestor;

  await carregarCadastro();

  // Uma transportadora só? Não faz sentido perguntar: abre a câmera.
  if (transportadoras.length === 1) {
    await iniciarSessao(transportadoras[0]);
    return;
  }

  el.grupoVazio.hidden = transportadoras.length > 0;
  el.listaGrupos.innerHTML = transportadoras.map((t) => {
    const rotas = rotasDe(t.id);
    return `
    <button class="grupo-btn" data-id="${esc(t.id)}">
      <b>${esc(t.nome)}</b>
      <span>${rotas.length ? esc(rotas.join(' • ')) : 'sem rota cadastrada'}</span>
    </button>`;
  }).join('');

  el.listaGrupos.querySelectorAll<HTMLButtonElement>('.grupo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = transportadoras.find((x) => x.id === btn.dataset.id);
      if (t) void iniciarSessao(t);
    });
  });

  mostrarView('grupo');
}

/* ------------------------------------------------------------ sessão ----- */

function zerarContadores(): void {
  contadores.total = 0;
  contadores.OK = 0;
  contadores.ROTA_DIVERGENTE = 0;
  contadores.DESTINO_NAO_MAPEADO = 0;
  contadores.DUPLICADO = 0;
  contadores.INVALIDO = 0;
  codigosBipados.clear();
  ocorrenciasPorLeitura.clear();
  el.listaLeituras.innerHTML = '';
  pintarContadores();
}

function pintarContadores(): void {
  el.cTotal.textContent = String(contadores.total);
  el.cOk.textContent = String(contadores.OK);
  el.cDiv.textContent = String(contadores.ROTA_DIVERGENTE + contadores.DESTINO_NAO_MAPEADO);
  el.cDup.textContent = String(contadores.DUPLICADO);
  el.cInv.textContent = String(contadores.INVALIDO);
}

async function iniciarSessao(transportadora: Transportadora): Promise<void> {
  if (!usuario) return;

  fb.prepararAudio();
  geo.iniciar();
  zerarContadores();

  const nova: Sessao = {
    ...novoSync(),
    transportadoraId: transportadora.id,
    usuarioId: usuario.id,
    inicio: agora(),
    fim: null,
    status: 'ABERTA',
    transportadoraNome: transportadora.nome,
    rotas: rotasDe(transportadora.id),
    usuarioNome: usuario.nome,
    geoInicio: null,
    geoFim: null,
    liberadaEm: null,
    liberadaPor: null,
    liberadaComPendencias: false
  };
  sessao = await db.salvar('sessoes', nova);
  sync.agendarContagem();

  // O ponto de abertura costuma ser mais confiável que os pontos individuais;
  // damos um tempo para o GPS pegar sinal, sem segurar a tela.
  window.setTimeout(() => void carimbarAbertura(), 8000);

  await entrarNaBipagem();
}

async function carimbarAbertura(): Promise<void> {
  if (!sessao || sessao.geoInicio) return;
  const p = geo.snapshot();
  if (p.geoStatus === 'INDISPONIVEL') return;
  sessao = await db.salvar('sessoes', { ...sessao, geoInicio: p });
}

async function retomarSessao(s: Sessao): Promise<void> {
  sessao = s;
  fb.prepararAudio();
  geo.iniciar();
  zerarContadores();
  await carregarCadastro();

  const leituras = (await db.porIndice('leituras', 'sessaoId', s.id))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  for (const l of leituras) {
    contadores.total++;
    contadores[l.status]++;
    if (l.status === 'OK' && l.codigoVolume) {
      codigosBipados.set(l.codigoVolume, { timestamp: l.timestamp, usuarioNome: s.usuarioNome });
    }
  }
  for (const o of await db.porIndice('ocorrencias', 'sessaoId', s.id)) {
    if (o.leituraId) ocorrenciasPorLeitura.set(o.leituraId, (ocorrenciasPorLeitura.get(o.leituraId) ?? 0) + 1);
  }

  pintarContadores();
  for (const l of leituras.slice(-40)) adicionarNaLista(l);

  await entrarNaBipagem();
}

async function entrarNaBipagem(): Promise<void> {
  if (!sessao) return;

  el.bipGrupo.textContent = sessao.transportadoraNome;
  el.bipRotas.textContent = sessao.rotas.length
    ? `Rotas ${sessao.rotas.join(' • ')}`
    : 'Sem rota cadastrada para esta transportadora';
  el.banner.className = 'banner st-neutro';
  el.bannerStatus.textContent = 'Aponte para a etiqueta';
  el.bannerCodigo.textContent = '';
  mostrarView('bipagem');

  telaAcesa = await manterTelaAcesa();
  await abrirCamera();
}

async function abrirCamera(): Promise<void> {
  scanner?.parar();
  scanner = criarScanner({ video: el.video, onCodigo: (texto) => void registrarLeitura(texto, 'CAMERA') });

  const r = await scanner.iniciar();
  if (!r.ok) {
    el.cameraErro.hidden = false;
    el.cameraErroTxt.textContent = r.erro;
    return;
  }
  el.cameraErro.hidden = true;

  if (scanner.temTocha()) {
    el.btnTocha.hidden = false;
    el.btnTocha.setAttribute('aria-pressed', 'false');
  } else {
    el.btnTocha.hidden = true;
  }
}

el.btnRecamera.addEventListener('click', () => void abrirCamera());

el.btnTocha.addEventListener('click', async () => {
  if (!scanner) return;
  const ligar = el.btnTocha.getAttribute('aria-pressed') !== 'true';
  const ok = await scanner.alternarTocha(ligar);
  if (ok) el.btnTocha.setAttribute('aria-pressed', String(ligar));
});

/* ------------------------------------------------------------ leitura ---- */

async function registrarLeitura(texto: string, origem: 'CAMERA' | 'MANUAL'): Promise<void> {
  if (!sessao || sessao.status !== 'ABERTA') return;

  const { status, dados, rota, primeira } = classificar(texto, {
    transportadoraId: sessao.transportadoraId,
    rotasPorCodigo,
    jaBipados: codigosBipados
  });
  const ponto: PontoGeo = geo.snapshot();

  const leitura: Leitura = {
    ...novoSync(),
    sessaoId: sessao.id,
    codigoVolume: dados.codigoVolume ?? null,
    rota: dados.rota ?? null,
    rotaPrefixo: dados.rotaPrefixo ?? null,
    rotaId: rota?.id ?? null,
    transportadoraDonaId: rota?.transportadoraId ?? null,
    transportadoraDonaNome: rota ? (nomePorTransportadora.get(rota.transportadoraId) ?? null) : null,
    volume: dados.volume ?? null,
    volumeAtual: dados.volumeAtual ?? null,
    volumeTotal: dados.volumeTotal ?? null,
    pedido: dados.pedido ?? null,
    status,
    timestamp: agora(),
    rawData: dados.rawData,
    origem,
    motivoInvalido: dados.motivo ?? null,
    dispositivoId: db.dispositivoId(),
    lat: ponto.lat,
    lng: ponto.lng,
    precisaoMetros: ponto.precisaoMetros,
    geoStatus: ponto.geoStatus
  };

  // Só o volume aceito entra na lista de deduplicação: rebipar um divergente
  // tem que continuar dando vermelho.
  if (status === 'OK' && leitura.codigoVolume) {
    codigosBipados.set(leitura.codigoVolume, {
      timestamp: leitura.timestamp,
      usuarioNome: usuario?.nome ?? sessao.usuarioNome
    });
  }

  contadores.total++;
  contadores[status]++;
  pintarContadores();
  pintarBanner(status, leitura, primeira);
  fb.sinalizar(status);
  adicionarNaLista(leitura);

  await db.salvar('leituras', leitura);
  sync.agendarContagem();
}

/**
 * O banner tem que responder três coisas sem obrigar ninguém a interpretar:
 * o que aconteceu, por que aconteceu e o que fazer com a caixa que está na mão.
 */
function pintarBanner(status: StatusLeitura, l: Leitura, primeira?: PrimeiraLeitura): void {
  const info = STATUS_INFO[status];
  el.banner.className = `banner ${info.classe}`;
  el.bannerStatus.textContent = info.rotulo;

  const identificacao = l.codigoVolume
    ? `${l.codigoVolume}${l.rota ? ` • ${l.rota}` : ''}`
    : l.rawData.slice(0, 48);

  let explicacao = '';
  if (status === 'ROTA_DIVERGENTE') {
    explicacao = l.transportadoraDonaNome
      ? `A rota ${l.rotaPrefixo} é da ${l.transportadoraDonaNome}. Você está conferindo a ${sessao?.transportadoraNome}. Separe a caixa.`
      : 'Separe a caixa: ela não é desta transportadora.';
  } else if (status === 'DESTINO_NAO_MAPEADO') {
    explicacao = `Ninguém cadastrou a rota ${l.rotaPrefixo}. Separe a caixa e avise o gestor.`;
  } else if (status === 'DUPLICADO' && primeira) {
    explicacao = `Já bipado por ${primeira.usuarioNome} às ${hora(primeira.timestamp)}. Não conta de novo, pode seguir.`;
  } else if (status === 'INVALIDO') {
    explicacao = 'Etiqueta não reconhecida. Tente de novo ou digite o código.';
  }

  el.bannerCodigo.textContent = explicacao ? `${identificacao} — ${explicacao}` : identificacao;
}

function adicionarNaLista(l: Leitura): void {
  const info = STATUS_INFO[l.status];
  const item = document.createElement('div');
  item.className = `leitura ${info.classe}`;
  item.dataset.id = l.id;
  item.innerHTML = `
    <div class="leitura-dados">
      <div class="leitura-cod">${esc(l.codigoVolume ?? (l.rawData.slice(0, 24) || 'sem código'))}</div>
      <div class="leitura-meta">
        <b>${info.curto}</b>${l.status === 'ROTA_DIVERGENTE' && l.transportadoraDonaNome ? ` (${esc(l.transportadoraDonaNome)})` : ''} • ${esc(l.rota ?? 'rota ?')} • ${esc(l.volume ?? '—')} • ${hora(l.timestamp)}
        <span class="selo-oc" hidden>ocorrência</span>
      </div>
    </div>
    <button class="btn-oc" type="button">Ocorrência</button>`;

  item.querySelector<HTMLButtonElement>('.btn-oc')?.addEventListener('click', () => abrirOcorrencia(l));

  const qtdOc = ocorrenciasPorLeitura.get(l.id) ?? 0;
  if (qtdOc > 0) marcarComOcorrencia(item, qtdOc);

  el.listaLeituras.prepend(item);

  // A lista é rolável, mas não precisa carregar o dia inteiro no DOM.
  while (el.listaLeituras.children.length > 60) el.listaLeituras.lastElementChild?.remove();
}

function marcarComOcorrencia(item: HTMLElement, qtd: number): void {
  item.classList.add('tem-oc');
  const selo = item.querySelector<HTMLElement>('.selo-oc');
  if (selo) {
    selo.hidden = false;
    selo.textContent = qtd > 1 ? `${qtd} ocorrências` : 'ocorrência';
  }
}

/* ------------------------------------------------------ entrada manual --- */

function abrirModal(node: HTMLElement): void {
  node.hidden = false;
}
function fecharModal(node: HTMLElement): void {
  node.hidden = true;
}

el.btnManual.addEventListener('click', () => {
  el.manCodigo.value = '';
  el.manRota.value = '';
  el.manPedido.value = '';
  el.manVolume.value = '';
  erroEm(el.manErro, null);
  abrirModal(el.modalManual);
  el.manCodigo.focus();
});

el.manCancelar.addEventListener('click', () => fecharModal(el.modalManual));

el.manConfirmar.addEventListener('click', async () => {
  const codigo = normalizar(el.manCodigo.value);
  const rota = normalizar(el.manRota.value);
  if (!codigo) return erroEm(el.manErro, 'Informe o código do volume.');
  if (!prefixoRota(rota)) return erroEm(el.manErro, 'Informe a rota como está na etiqueta (ex.: FNOR 100).');

  const pedido = normalizar(el.manPedido.value) || '000000';
  const volume = normalizar(el.manVolume.value) || '0001/0001';

  fecharModal(el.modalManual);
  // Passa pelo mesmo classificador da câmera: uma regra só para os dois caminhos.
  await registrarLeitura(`${codigo};${rota};${volume};${pedido}`, 'MANUAL');
});

/* -------------------------------------------------------- ocorrências ---- */

let ocLeitura: Leitura | null = null;
let ocMomento: Momento = 'EXPEDICAO';
const ocEtiquetasMarcadas = new Set<string>();
let ocFotos: Blob[] = [];

function abrirOcorrencia(leitura: Leitura | null): void {
  ocLeitura = leitura;
  ocMomento = leitura ? 'EXPEDICAO' : 'TRANSPORTADORA';
  ocEtiquetasMarcadas.clear();
  ocFotos = [];
  el.ocTexto.value = '';
  el.ocFoto.value = '';
  el.ocFotosPreview.innerHTML = '';
  el.ocAvisoGrave.hidden = true;
  erroEm(el.ocErro, null);

  el.ocAlvo.textContent = leitura
    ? `Volume ${leitura.codigoVolume ?? 'sem código'}${leitura.rota ? ` • rota ${leitura.rota}` : ''}`
    : 'Ocorrência da entrega inteira (sem volume específico)';

  pintarMomento();
  abrirModal(el.modalOc);
  el.ocTexto.focus();
}

function pintarMomento(): void {
  el.modalOc.querySelectorAll<HTMLButtonElement>('.mom').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.momento === ocMomento));
  });

  el.ocEtiquetas.innerHTML = etiquetasDoMomento(ocMomento).map((e) => `
    <button type="button" class="et ${e.grave ? 'grave' : ''}" data-id="${esc(e.id)}"
            aria-pressed="${ocEtiquetasMarcadas.has(e.id)}">
      ${esc(e.texto)}
      ${e.grave ? '<span class="marca-grave">grave</span>' : ''}
    </button>`).join('');

  el.ocEtiquetas.querySelectorAll<HTMLButtonElement>('.et').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id as string;
      if (ocEtiquetasMarcadas.has(id)) ocEtiquetasMarcadas.delete(id);
      else ocEtiquetasMarcadas.add(id);
      btn.setAttribute('aria-pressed', String(ocEtiquetasMarcadas.has(id)));
      el.ocAvisoGrave.hidden = !derivarGrave([...ocEtiquetasMarcadas]);
    });
  });
}

el.modalOc.querySelectorAll<HTMLButtonElement>('.mom').forEach((btn) => {
  btn.addEventListener('click', () => {
    const novo = btn.dataset.momento as Momento;
    if (novo === ocMomento) return;
    ocMomento = novo;
    // Etiqueta pertence a um momento; trocar de momento limpa o que não vale mais.
    for (const id of [...ocEtiquetasMarcadas]) {
      const et = ETIQUETAS.find((e) => e.id === id);
      if (et && et.momento !== novo) ocEtiquetasMarcadas.delete(id);
    }
    el.ocAvisoGrave.hidden = !derivarGrave([...ocEtiquetasMarcadas]);
    pintarMomento();
  });
});

el.btnOcEntrega.addEventListener('click', () => abrirOcorrencia(null));
el.ocCancelar.addEventListener('click', () => fecharModal(el.modalOc));

el.ocFoto.addEventListener('change', async () => {
  const arquivos = Array.from(el.ocFoto.files ?? []);
  for (const arq of arquivos) {
    if (ocFotos.length >= 3) break;
    ocFotos.push(await comprimirImagem(arq));
  }
  el.ocFoto.value = '';
  pintarFotos();
});

function pintarFotos(): void {
  el.ocFotosPreview.innerHTML = '';
  ocFotos.forEach((blob, i) => {
    const url = URL.createObjectURL(blob);
    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${url}" alt="Foto ${i + 1}"><button type="button" aria-label="Remover foto">×</button>`;
    fig.querySelector('button')?.addEventListener('click', () => {
      URL.revokeObjectURL(url);
      ocFotos.splice(i, 1);
      pintarFotos();
    });
    el.ocFotosPreview.append(fig);
  });
}

el.ocSalvar.addEventListener('click', async () => {
  if (!sessao || !usuario) return;

  const texto = el.ocTexto.value.trim();
  if (!texto && ocEtiquetasMarcadas.size === 0) {
    return erroEm(el.ocErro, 'Escreva o que aconteceu ou marque ao menos uma etiqueta.');
  }

  const etiquetas = [...ocEtiquetasMarcadas];
  const ponto = geo.snapshot(); // hora e local do registro, não da leitura

  const ocorrencia: Ocorrencia = {
    ...novoSync(),
    sessaoId: sessao.id,
    leituraId: ocLeitura?.id ?? null,
    codigoVolume: ocLeitura?.codigoVolume ?? null,
    usuarioId: usuario.id,
    momento: ocMomento,
    texto,
    etiquetas,
    grave: derivarGrave(etiquetas),
    fotos: [...ocFotos],
    fotosRemotas: [],
    timestamp: agora(),
    lat: ponto.lat,
    lng: ponto.lng,
    precisaoMetros: ponto.precisaoMetros,
    geoStatus: ponto.geoStatus
  };

  await db.salvar('ocorrencias', ocorrencia);

  if (ocLeitura) {
    const qtd = (ocorrenciasPorLeitura.get(ocLeitura.id) ?? 0) + 1;
    ocorrenciasPorLeitura.set(ocLeitura.id, qtd);
    const item = el.listaLeituras.querySelector<HTMLElement>(`.leitura[data-id="${ocLeitura.id}"]`);
    if (item) marcarComOcorrencia(item, qtd);
  }

  fecharModal(el.modalOc);
  fb.sinalizarAcao();
  sync.agendarContagem();
});

/* ------------------------------------------------------------ encerrar --- */

el.btnEncerrar.addEventListener('click', async () => {
  if (!sessao) return;

  // A conta das pendências é a mesma do relatório e do painel — uma regra só,
  // para os três não discordarem na frente do motorista.
  const leituras = await db.porIndice('leituras', 'sessaoId', sessao.id);
  const pendencias = pendenciasDaCarga(leituras);

  el.encerrarResumo.innerHTML = `
    <b>${contadores.total} volumes bipados</b> na ${esc(sessao.transportadoraNome)}.
    ${pendencias.length
      ? `<span class="enc-pendencias">A carga fica <b>com pendência</b>:<br>${
          pendencias.map((p) => `• ${esc(p.descricao)}`).join('<br>')}</span>`
      : '<span class="enc-ok">Sem pendências: carga pronta para sair.</span>'}`;

  abrirModal(el.modalEncerrar);
});

el.encCancelar.addEventListener('click', () => fecharModal(el.modalEncerrar));

el.encConfirmar.addEventListener('click', async () => {
  if (!sessao) return;
  fecharModal(el.modalEncerrar);

  scanner?.parar();
  scanner = null;

  const geoFim = geo.snapshot();
  sessao = await db.salvar('sessoes', {
    ...sessao,
    status: 'ENCERRADA',
    fim: agora(),
    geoFim: geoFim.geoStatus === 'INDISPONIVEL' ? sessao.geoFim : geoFim
  });

  geo.parar();
  telaAcesa?.liberar();
  telaAcesa = null;
  fb.sinalizarAcao();

  await mostrarRelatorio(sessao.id);
  sync.sincronizarEmSegundoPlano();
});

/* ----------------------------------------------------------- relatório --- */

async function mostrarRelatorio(sessaoId: string): Promise<void> {
  relatorioAtual = await montarRelatorio(sessaoId);
  el.relatorioArea.innerHTML = renderizarHTML(relatorioAtual);
  hidratarFotos(el.relatorioArea, relatorioAtual.ocorrencias);

  const estado = sync.estadoSync();
  el.relSync.textContent = estado.configurado
    ? (estado.pendentes ? `${estado.pendentes} registro(s) na fila de envio` : 'Tudo sincronizado com o Supabase')
    : 'Guardado no aparelho (Supabase não configurado)';

  mostrarView('relatorio');
}

el.btnPdf.addEventListener('click', async () => {
  if (!relatorioAtual) return;
  el.btnPdf.disabled = true;
  el.btnPdf.textContent = 'Gerando…';
  try {
    await exportarPDF(relatorioAtual);
  } finally {
    el.btnPdf.disabled = false;
    el.btnPdf.textContent = 'Baixar PDF';
  }
});

el.btnCsv.addEventListener('click', () => {
  if (relatorioAtual) exportarCSV(relatorioAtual);
});

el.btnNova.addEventListener('click', () => {
  sessao = null;
  relatorioAtual = null;
  void irParaGrupos();
});

/* -------------------------------------------------------------- extras --- */

// Fechar modal tocando fora da caixa — saída óbvia, sem beco sem saída.
for (const modal of [el.modalManual, el.modalOc, el.modalEncerrar]) {
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) modal.hidden = true;
  });
}

window.addEventListener('beforeunload', () => {
  scanner?.parar();
  telaAcesa?.liberar();
});

// O boot é quem decide a tela inicial, e ele demora (seed, IndexedDB, GPS).
// Se alguém logar antes dele terminar, o boot ainda acha que não há usuário e
// joga a pessoa de volta para o login já autenticada. Guardar a promessa deixa
// o submit esperar o boot em vez de disputar a tela com ele.
const bootPronto = boot().catch((e: unknown) => {
  console.error('boot', e);
});
