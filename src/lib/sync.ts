// sync.ts — fila de saída (outbox) para o Supabase.
//
// Princípio: a bipagem grava local e segue. Este módulo é o único que fala com
// a rede, sempre depois do fato, sempre em lote, e nunca bloqueando a tela.
// São muitas caixas por carga — o envio acontece em blocos e pode ser
// interrompido a qualquer momento sem perder nada.

import type {
  Dispositivo, EstadoSync, Leitura, Ocorrencia, Rota, Sessao, Transportadora, Usuario
} from '../types.js';
import * as db from './db.js';
import { idsParaRemover } from './reconciliar.js';
import { agora } from './util.js';
import { obterCliente, obterConfig, estaConfigurado } from './supabase.js';

const LOTE = 200;
const INTERVALO_AUTO_MS = 60_000;
const MAX_TENTATIVAS = 8;

export const TABELAS: Record<db.NomeStore, string> = {
  usuarios: 'usuarios',
  transportadoras: 'transportadoras',
  rotas: 'rotas',
  sessoes: 'sessoes',
  leituras: 'leituras',
  ocorrencias: 'ocorrencias'
};

const CHAVE_ULTIMA_DESCIDA = 'sync.ultimaDescida';

let estado: EstadoSync = {
  pendentes: 0,
  online: navigator.onLine,
  configurado: false,
  enviando: false,
  ultimoEnvio: null,
  ultimaDescida: null,
  ultimoErro: null,
  usuarioAtual: ''
};

/** Quem está usando o aparelho — vai junto no registro do dispositivo. */
export function definirUsuarioAtual(nome: string): void {
  estado.usuarioAtual = nome;
}

const ouvintes = new Set<(e: EstadoSync) => void>();
let timerAuto: number | undefined;
let timerContagem: number | undefined;
let rodando = false;

function emitir(): void {
  const copia = { ...estado };
  for (const fn of ouvintes) {
    try { fn(copia); } catch { /* ouvinte quebrado não derruba o sync */ }
  }
}

export function aoMudarSync(fn: (e: EstadoSync) => void): () => void {
  ouvintes.add(fn);
  fn({ ...estado });
  return () => { ouvintes.delete(fn); };
}

export const estadoSync = (): EstadoSync => ({ ...estado });

export async function atualizarContagem(): Promise<number> {
  estado.pendentes = await db.contarPendentes();
  estado.configurado = await estaConfigurado();
  estado.online = navigator.onLine;
  emitir();
  return estado.pendentes;
}

/**
 * Recontar a fila depois de uma gravação, com folga de 1,5 s.
 * O número na tela é a promessa de que nada se perdeu: não pode ficar velho
 * enquanto a pessoa bipa 25 caixas — e também não pode custar uma contagem no
 * IndexedDB a cada leitura.
 */
export function agendarContagem(): void {
  if (timerContagem !== undefined) return;
  timerContagem = window.setTimeout(() => {
    timerContagem = undefined;
    void atualizarContagem();
  }, 1500);
}

/* ------------------------------------------------------- mapeamento ------ */
// Colunas em snake_case, como no schema de supabase/schema.sql.

const linhaUsuario = (u: Usuario): Record<string, unknown> => ({
  id: u.id,
  nome: u.nome,
  login: u.login,
  // O hash acompanha o cadastro: é o que faz a senha valer no celular da doca,
  // e não só no aparelho onde ela foi digitada. Ver a nota em schema.sql.
  senha_hash: u.senhaHash || null,
  gestor: u.gestor,
  funcao: u.funcao,
  telefone: u.telefone,
  placa: u.placa,
  ativo: u.ativo,
  atualizado_em: u.atualizadoEm
});

const linhaTransportadora = (t: Transportadora): Record<string, unknown> => ({
  id: t.id,
  nome: t.nome,
  cnpj: t.cnpj || null,
  responsavel: t.responsavel || null,
  telefone: t.telefone || null,
  email: t.email || null,
  ativo: t.ativo,
  atualizado_em: t.atualizadoEm
});

const linhaRota = (r: Rota): Record<string, unknown> => ({
  id: r.id,
  codigo: r.codigo,
  nome: r.nome,
  transportadora_id: r.transportadoraId,
  descricao: r.descricao || null,
  ativo: r.ativo,
  atualizado_em: r.atualizadoEm
});

const linhaSessao = (s: Sessao): Record<string, unknown> => ({
  id: s.id,
  transportadora_id: s.transportadoraId,
  usuario_id: s.usuarioId,
  inicio: s.inicio,
  fim: s.fim,
  status: s.status,
  transportadora_nome: s.transportadoraNome,
  rotas: s.rotas,
  usuario_nome: s.usuarioNome,
  geo_inicio: s.geoInicio,
  geo_fim: s.geoFim,
  liberada_em: s.liberadaEm,
  liberada_por: s.liberadaPor,
  liberada_com_pendencias: s.liberadaComPendencias,
  atualizado_em: s.atualizadoEm
});

const linhaLeitura = (l: Leitura): Record<string, unknown> => ({
  id: l.id,
  sessao_id: l.sessaoId,
  codigo_volume: l.codigoVolume,
  rota: l.rota,
  rota_prefixo: l.rotaPrefixo,
  rota_id: l.rotaId,
  transportadora_dona_id: l.transportadoraDonaId,
  transportadora_dona_nome: l.transportadoraDonaNome,
  volume: l.volume,
  volume_atual: l.volumeAtual,
  volume_total: l.volumeTotal,
  pedido: l.pedido,
  status: l.status,
  lido_em: l.timestamp,
  raw_data: l.rawData,
  origem: l.origem,
  motivo_invalido: l.motivoInvalido,
  dispositivo_id: l.dispositivoId,
  lat: l.lat,
  lng: l.lng,
  precisao_metros: l.precisaoMetros,
  geo_status: l.geoStatus,
  atualizado_em: l.atualizadoEm
});

const linhaOcorrencia = (o: Ocorrencia): Record<string, unknown> => ({
  id: o.id,
  sessao_id: o.sessaoId,
  leitura_id: o.leituraId,
  codigo_volume: o.codigoVolume,
  usuario_id: o.usuarioId,
  momento: o.momento,
  texto: o.texto,
  etiquetas: o.etiquetas,
  grave: o.grave,
  fotos: o.fotosRemotas,
  registrado_em: o.timestamp,
  lat: o.lat,
  lng: o.lng,
  precisao_metros: o.precisaoMetros,
  geo_status: o.geoStatus,
  atualizado_em: o.atualizadoEm
});

/* ------------------------------------------------------------ fotos ------ */

/**
 * Sobe as fotos da ocorrência para o Storage e devolve os caminhos.
 * Falha de foto não impede o envio do texto — o texto é a informação principal.
 */
async function subirFotos(o: Ocorrencia): Promise<string[]> {
  if (!o.fotos?.length) return o.fotosRemotas ?? [];
  if ((o.fotosRemotas?.length ?? 0) >= o.fotos.length) return o.fotosRemotas;

  const cliente = await obterCliente();
  if (!cliente) return o.fotosRemotas ?? [];
  const { bucket } = await obterConfig();

  const caminhos = [...(o.fotosRemotas ?? [])];
  for (let i = caminhos.length; i < o.fotos.length; i++) {
    const caminho = `${o.sessaoId}/${o.id}-${i}.jpg`;
    const { error } = await cliente.storage
      .from(bucket)
      .upload(caminho, o.fotos[i], { contentType: 'image/jpeg', upsert: true });
    if (error) break;
    caminhos.push(caminho);
  }
  return caminhos;
}

/* ---------------------------------------------------------- descida ------ */
// O aparelho precisa RECEBER o cadastro, não só enviar leitura. Sem isto, a
// transportadora que o gestor cadastrou no desktop nunca chega ao celular da
// doca — e a validação local não teria contra o que comparar.

interface LinhaTransportadora {
  id: string; nome: string; cnpj: string | null; responsavel: string | null;
  telefone: string | null; email: string | null; ativo: boolean; atualizado_em: string;
}
interface LinhaRota {
  id: string; codigo: string; nome: string; transportadora_id: string;
  descricao: string | null; ativo: boolean; atualizado_em: string;
}
interface LinhaUsuario {
  id: string; nome: string; login: string; senha_hash: string | null; gestor: boolean;
  funcao: string | null; telefone: string | null; placa: string | null;
  ativo: boolean; atualizado_em: string;
}

const daLinhaTransportadora = (l: LinhaTransportadora): Transportadora => ({
  id: l.id,
  nome: l.nome,
  cnpj: l.cnpj ?? '',
  responsavel: l.responsavel ?? '',
  telefone: l.telefone ?? '',
  email: l.email ?? '',
  ativo: l.ativo,
  sync: 'ENVIADO',
  syncTentativas: 0,
  syncErro: null,
  atualizadoEm: l.atualizado_em
});

const daLinhaRota = (l: LinhaRota): Rota => ({
  id: l.id,
  codigo: l.codigo,
  nome: l.nome,
  transportadoraId: l.transportadora_id,
  descricao: l.descricao ?? '',
  ativo: l.ativo,
  sync: 'ENVIADO',
  syncTentativas: 0,
  syncErro: null,
  atualizadoEm: l.atualizado_em
});

/** As três tabelas de cadastro — as que descem do servidor para o aparelho. */
type StoreCadastro = 'usuarios' | 'transportadoras' | 'rotas';

/**
 * Apaga do aparelho o cadastro que não existe mais no servidor.
 *
 * A descida é incremental (`atualizado_em > desde`), e uma linha apagada não
 * tem `atualizado_em` novo — ela simplesmente deixa de vir. Sem esta varredura
 * o aparelho guarda para sempre o que o gestor excluiu, e a tela do operador
 * mostra transportadora que não existe mais. Não é só feio: `sessoes.
 * transportadora_id` tem chave estrangeira no servidor, então uma conferência
 * aberta sobre uma dessas fantasmas bate em violação de FK no envio e fica
 * presa no celular — a carga foi conferida e a base nunca fica sabendo.
 *
 * Duas travas, e as duas existem porque o custo de errar aqui é alto:
 *
 * 1. **Só remove o que já subiu.** Registro `PENDENTE` é coisa criada ou
 *    editada neste aparelho que o servidor ainda não viu — ele não está lá
 *    porque ainda não chegou, não porque foi excluído. Apagar seria destruir o
 *    trabalho de alguém.
 * 2. **Lista vazia não apaga nada.** "O servidor não tem nenhum" é
 *    indistinguível de "a consulta foi filtrada por uma política de acesso", e
 *    o segundo caso limparia o cadastro inteiro de um aparelho que estava
 *    funcionando — inclusive os usuários, deixando ninguém capaz de entrar.
 *    Esvaziar uma tabela de propósito continua possível pelo painel, item a
 *    item, que apaga na base e no aparelho.
 */
async function reconciliarCadastro(store: StoreCadastro, idsNoServidor: Set<string>): Promise<number> {
  const remover = idsParaRemover(await db.todos(store), idsNoServidor);
  for (const id of remover) await db.remover(store, id);
  return remover.length;
}

/**
 * Baixa o cadastro alterado desde a última descida, e tira o que foi excluído.
 *
 * A senha NUNCA desce (nem sobe): o hash fica só no aparelho onde a pessoa o
 * definiu. Um usuário criado pelo gestor chega aqui sem senha e a define no
 * primeiro acesso deste aparelho — ver `auth.entrar`.
 */
async function baixarCadastro(): Promise<{ baixados: number; removidos: number; erro: string | null }> {
  const cliente = await obterCliente();
  if (!cliente) return { baixados: 0, removidos: 0, erro: 'Supabase não configurado.' };

  const desde = await db.configGet<string>(CHAVE_ULTIMA_DESCIDA, '1970-01-01T00:00:00.000Z');
  const marcoNovo = agora();
  let baixados = 0;
  let removidos = 0;

  /**
   * Os ids que o servidor tem AGORA, para a varredura de exclusão.
   *
   * Vem em consulta própria porque a outra é incremental e traz só o que mudou.
   * Custa pouco: cadastro é pequeno por natureza (pessoas, transportadoras e
   * códigos de rota de uma operação), e só o `id` desce.
   */
  const idsDe = async (tabela: string): Promise<{ ids: Set<string> } | { erro: string }> => {
    const r = await cliente.from(tabela).select('id');
    if (r.error) return { erro: `${tabela}: ${r.error.message}` };
    return { ids: new Set(((r.data ?? []) as { id: string }[]).map((x) => x.id)) };
  };

  const transp = await cliente.from(TABELAS.transportadoras).select('*').gt('atualizado_em', desde);
  if (transp.error) return { baixados, removidos, erro: `transportadoras: ${transp.error.message}` };
  const listaTransp = (transp.data ?? []) as LinhaTransportadora[];
  await db.salvarDoServidor('transportadoras', listaTransp.map(daLinhaTransportadora));
  baixados += listaTransp.length;

  const rotas = await cliente.from(TABELAS.rotas).select('*').gt('atualizado_em', desde);
  if (rotas.error) return { baixados, removidos, erro: `rotas: ${rotas.error.message}` };
  const listaRotas = (rotas.data ?? []) as LinhaRota[];
  await db.salvarDoServidor('rotas', listaRotas.map(daLinhaRota));
  baixados += listaRotas.length;

  const usuarios = await cliente.from(TABELAS.usuarios).select('*').gt('atualizado_em', desde);
  if (usuarios.error) return { baixados, removidos, erro: `usuarios: ${usuarios.error.message}` };
  baixados += await aplicarUsuarios((usuarios.data ?? []) as LinhaUsuario[]);

  // A varredura vem DEPOIS de gravar o que desceu: fazê-la antes apagaria uma
  // linha que a mesma sincronização estava trazendo de volta com id novo.
  //
  // `rotas` antes de `transportadoras` só por clareza de leitura no painel —
  // o IndexedDB não tem chave estrangeira, então a ordem não muda o resultado.
  for (const [store, tabela] of [
    ['rotas', TABELAS.rotas],
    ['transportadoras', TABELAS.transportadoras],
    ['usuarios', TABELAS.usuarios]
  ] as [StoreCadastro, string][]) {
    const r = await idsDe(tabela);
    // Falha ao listar não apaga nada: sem a lista completa não há como saber o
    // que sumiu, e chutar aqui é apagar cadastro bom.
    if ('erro' in r) return { baixados, removidos, erro: r.erro };
    removidos += await reconciliarCadastro(store, r.ids);
  }

  await db.configSet(CHAVE_ULTIMA_DESCIDA, marcoNovo);
  return { baixados, removidos, erro: null };
}

/**
 * Atualiza o cadastro do usuário.
 *
 * A senha vem do servidor — é assim que a senha definida pelo gestor no desktop
 * passa a valer no celular, e que "redefinir senha" (hash nulo) chega ao
 * aparelho da pessoa. A exceção é o registro que ainda não subiu: aí a senha
 * digitada aqui agora é mais nova que a do servidor e não pode ser perdida.
 */
async function aplicarUsuarios(linhas: LinhaUsuario[]): Promise<number> {
  const novos: Usuario[] = [];
  for (const l of linhas) {
    // Por login também: um aparelho pode ter a mesma pessoa com outro id, de
    // quando o cadastro nascia local. A senha ainda não enviada é dela.
    const local = (await db.obter('usuarios', l.id))
      ?? (await db.umPorIndice('usuarios', 'login', l.login));
    const naoSubiu = local?.sync === 'PENDENTE' && Boolean(local.senhaHash);
    novos.push({
      id: l.id,
      nome: l.nome,
      login: l.login,
      // '' = sem senha; a pessoa define na primeira entrada.
      senhaHash: naoSubiu ? local!.senhaHash : (l.senha_hash ?? ''),
      gestor: l.gestor,
      funcao: l.funcao ?? '',
      telefone: l.telefone ?? '',
      placa: l.placa ?? '',
      ativo: l.ativo,
      sync: 'ENVIADO',
      syncTentativas: 0,
      syncErro: null,
      atualizadoEm: l.atualizado_em
    });
  }
  await db.salvarDoServidor('usuarios', novos);
  return novos.length;
}

/* ----------------------------------------------------- dispositivos ------ */

/**
 * Registra este aparelho no servidor. O gestor precisa saber se o número do
 * painel está completo ou se ainda há leitura presa num celular sem sinal.
 */
async function registrarDispositivo(pendentesAgora: number, usuarioNome: string): Promise<void> {
  const cliente = await obterCliente();
  if (!cliente) return;
  await cliente.from('dispositivos').upsert([{
    id: db.dispositivoId(),
    apelido: navigator.userAgent.slice(0, 120),
    ultima_sync: agora(),
    pendentes: pendentesAgora,
    ultimo_usuario: usuarioNome || null,
    atualizado_em: agora()
  }], { onConflict: 'id' });
}

/** Lista de aparelhos para o painel do gestor. */
export async function listarDispositivos(): Promise<Dispositivo[]> {
  const cliente = await obterCliente();
  if (!cliente) return [];
  const { data, error } = await cliente
    .from('dispositivos')
    .select('*')
    .order('ultima_sync', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as {
    id: string; apelido: string | null; ultima_sync: string | null;
    pendentes: number | null; ultimo_usuario: string | null; atualizado_em: string;
  }[]).map((d) => ({
    id: d.id,
    apelido: d.apelido ?? 'aparelho',
    ultimaSync: d.ultima_sync,
    pendentes: d.pendentes ?? 0,
    ultimoUsuario: d.ultimo_usuario ?? '',
    atualizadoEm: d.atualizado_em
  }));
}

/* ------------------------------------------------------------ envio ------ */

async function enviarStore(store: db.NomeStore): Promise<{ enviados: number; erro: string | null }> {
  const cliente = await obterCliente();
  if (!cliente) return { enviados: 0, erro: 'Supabase não configurado.' };

  let enviados = 0;

  for (;;) {
    const lote = await db.pendentes(store, LOTE);
    if (!lote.length) return { enviados, erro: null };

    let linhas: Record<string, unknown>[];
    const extrasPorId = new Map<string, Record<string, unknown>>();

    if (store === 'ocorrencias') {
      const ocorrencias = lote as Ocorrencia[];
      linhas = [];
      for (const o of ocorrencias) {
        const fotosRemotas = await subirFotos(o);
        if (fotosRemotas.length !== (o.fotosRemotas?.length ?? 0)) {
          extrasPorId.set(o.id, { fotosRemotas });
        }
        linhas.push(linhaOcorrencia({ ...o, fotosRemotas }));
      }
    } else if (store === 'usuarios') {
      linhas = (lote as Usuario[]).map(linhaUsuario);
    } else if (store === 'transportadoras') {
      linhas = (lote as Transportadora[]).map(linhaTransportadora);
    } else if (store === 'rotas') {
      linhas = (lote as Rota[]).map(linhaRota);
    } else if (store === 'sessoes') {
      linhas = (lote as Sessao[]).map(linhaSessao);
    } else {
      linhas = (lote as Leitura[]).map(linhaLeitura);
    }

    const { error } = await cliente.from(TABELAS[store]).upsert(linhas, { onConflict: 'id' });

    const ids = lote.map((r) => r.id);
    if (error) {
      // Mantém pendente para tentar de novo; só vira ERRO depois de insistir.
      await marcarFalha(store, lote as { id: string; syncTentativas: number }[], error.message);
      return { enviados, erro: `${TABELAS[store]}: ${error.message}` };
    }

    for (const id of ids) {
      await db.marcarSync(store, [id], 'ENVIADO', null, extrasPorId.get(id) ?? {});
    }
    enviados += ids.length;

    if (lote.length < LOTE) return { enviados, erro: null };
  }
}

async function marcarFalha(
  store: db.NomeStore,
  lote: { id: string; syncTentativas: number }[],
  mensagem: string
): Promise<void> {
  const desistir = lote.filter((r) => (r.syncTentativas ?? 0) + 1 >= MAX_TENTATIVAS).map((r) => r.id);
  const insistir = lote.filter((r) => (r.syncTentativas ?? 0) + 1 < MAX_TENTATIVAS).map((r) => r.id);
  if (insistir.length) await db.marcarSync(store, insistir, 'PENDENTE', mensagem);
  if (desistir.length) await db.marcarSync(store, desistir, 'ERRO', mensagem);
}

/**
 * Drena a fila. Sempre resolve — falha de rede é estado, não exceção.
 * A ordem das stores respeita as chaves estrangeiras do schema.
 */
export async function sincronizar(): Promise<EstadoSync> {
  if (rodando) return estadoSync();
  rodando = true;
  estado.enviando = true;
  emitir();

  try {
    estado.configurado = await estaConfigurado();
    estado.online = navigator.onLine;

    if (!estado.configurado) {
      estado.ultimoErro = 'Supabase não configurado — dados guardados no aparelho.';
      return estadoSync();
    }
    if (!estado.online) {
      estado.ultimoErro = 'Sem conexão — a fila sobe assim que a rede voltar.';
      return estadoSync();
    }

    // Sobe primeiro o que foi feito aqui, depois desce o que mudou lá: assim
    // uma alteração de cadastro nunca sobrescreve leitura que ainda não subiu.
    //
    // Cada store segue mesmo que a anterior falhe. Isto não é zelo: `rotas` vem
    // antes de `leituras`, e um código de rota recusado pelo servidor (dois
    // donos para o mesmo prefixo) já foi suficiente para segurar TODA a
    // conferência do aparelho, indefinidamente. Cadastro emperrado não pode
    // prender caixa bipada — a leitura é o dado que não pode se perder.
    const falhas: string[] = [];
    let enviados = 0;
    for (const store of db.STORES_SYNC) {
      const r = await enviarStore(store);
      enviados += r.enviados;
      if (r.erro) falhas.push(r.erro);
    }

    // A descida também roda sempre: é ela que cura o aparelho: o cadastro certo
    // desce e substitui o registro local que o servidor está recusando.
    const descida = await baixarCadastro();
    if (descida.erro) falhas.push(descida.erro);
    else estado.ultimaDescida = agora();

    const erro = falhas.length ? falhas.join(' | ') : null;
    estado.ultimoErro = erro;
    if (enviados > 0) estado.ultimoEnvio = agora();

    await registrarDispositivo(await db.contarPendentes(), estado.usuarioAtual);
    return estadoSync();
  } catch (e) {
    estado.ultimoErro = e instanceof Error ? e.message : 'Falha inesperada na sincronização.';
    return estadoSync();
  } finally {
    rodando = false;
    estado.enviando = false;
    await atualizarContagem();
  }
}

/** Empurra a fila sem travar quem chamou. */
export function sincronizarEmSegundoPlano(): void {
  void sincronizar();
}

/**
 * Busca o cadastro agora, sem esperar o ciclo automático.
 *
 * Serve ao login: a mesma pessoa usa mais de um aparelho, e a senha pode ter
 * sido definida ou trocada em outro — ou pelo gestor, no desktop. Sem isto, o
 * celular recusaria a senha certa até a sincronização de fundo passar.
 *
 * Devolve `true` se conseguiu falar com a base, para quem chamou saber se vale
 * tentar de novo.
 */
export async function baixarCadastroAgora(): Promise<boolean> {
  if (!navigator.onLine || !(await estaConfigurado())) return false;
  const r = await baixarCadastro();
  if (!r.erro) estado.ultimaDescida = agora();
  return !r.erro;
}

/**
 * Garante que este aparelho conhece o cadastro antes de pedir a senha.
 *
 * Não existe cadastro de exemplo: aparelho novo começa vazio e recebe pessoas,
 * transportadoras e rotas da base. Sem esta espera, a tela de login recusaria a
 * senha certa só porque a descida ainda não terminou — e a pessoa procuraria um
 * erro que não existe. Roda uma vez, no boot, e só quando não há nada local.
 */
export async function garantirCadastroLocal(): Promise<boolean> {
  if ((await db.todos('usuarios')).length > 0) return true;
  if (!navigator.onLine || !(await estaConfigurado())) return false;
  await sincronizar();
  return (await db.todos('usuarios')).length > 0;
}

export async function tentarNovamente(): Promise<EstadoSync> {
  await db.reenfileirarErros();
  return sincronizar();
}

/** Liga o envio automático: ao voltar a rede, ao voltar para a tela e a cada minuto. */
export function iniciarAuto(): void {
  if (timerAuto !== undefined) return;

  window.addEventListener('online', () => {
    estado.online = true;
    emitir();
    sincronizarEmSegundoPlano();
  });
  window.addEventListener('offline', () => {
    estado.online = false;
    emitir();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizarEmSegundoPlano();
  });

  timerAuto = window.setInterval(() => {
    if (navigator.onLine) sincronizarEmSegundoPlano();
  }, INTERVALO_AUTO_MS);

  void atualizarContagem().then(() => {
    if (navigator.onLine) sincronizarEmSegundoPlano();
  });
}
