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
import { obterCliente, obterConfig, estaConfigurado, sessaoAutenticada } from './supabase.js';

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
  estado.pendentes = await db.contarPendentesOperacionais();
  estado.cadastrosLegados = await db.contarCadastrosLegados();
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

const linhaSessao = (s: Sessao): Record<string, unknown> => ({
  id: s.id,
  tenant_id: s.tenantId,
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
  tenant_id: l.tenantId,
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
  tenant_id: o.tenantId,
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
    const caminho = `${o.tenantId ?? 'legado'}/${o.sessaoId}/${o.id}-${i}.jpg`;
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
  tenant_id?: string;
}
interface LinhaRota {
  id: string; codigo: string; nome: string; transportadora_id: string;
  descricao: string | null; ativo: boolean; atualizado_em: string; tenant_id?: string;
}
interface LinhaUsuario {
  id: string; auth_user_id?: string | null; tenant_id?: string; nome: string; login: string; gestor: boolean;
  funcao: string | null; telefone: string | null; placa: string | null;
  ativo: boolean; atualizado_em: string;
}

const daLinhaTransportadora = (l: LinhaTransportadora): Transportadora => ({
  id: l.id,
  tenantId: l.tenant_id,
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
  tenantId: l.tenant_id,
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
 * A trava existe porque o custo de apagar trabalho local é alto:
 *
 * 1. **Só remove o que já subiu.** Registro `PENDENTE` é coisa criada ou
 *    editada neste aparelho que o servidor ainda não viu — ele não está lá
 *    porque ainda não chegou, não porque foi excluído. Apagar seria destruir o
 *    trabalho de alguém.
 * A consulta completa roda depois do Auth e qualquer falha de RLS/rede aborta
 * antes daqui. Assim, uma resposta vazia bem-sucedida limpa os registros
 * ENVIADO do cache; cadastros legados PENDENTE/ERRO continuam preservados para
 * revisão, mas não voltam à fila operacional.
 */
async function reconciliarCadastro(store: StoreCadastro, idsNoServidor: Set<string>): Promise<number> {
  const remover = idsParaRemover(await db.todos(store), idsNoServidor);
  for (const id of remover) await db.remover(store, id);
  return remover.length;
}

/**
 * Baixa o cadastro alterado desde a última descida, e tira o que foi excluído.
 *
 * Senha não faz parte do cache. O aparelho recebe somente perfil e permissões;
 * a credencial fica no Supabase Auth.
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
 * Atualiza somente o perfil operacional. Nunca baixa hash ou senha.
 */
async function aplicarUsuarios(linhas: LinhaUsuario[]): Promise<number> {
  const novos: Usuario[] = linhas.map((l) => ({
      id: l.id,
      authUserId: l.auth_user_id ?? undefined,
      tenantId: l.tenant_id,
      nome: l.nome,
      login: l.login,
      gestor: l.gestor,
      funcao: l.funcao ?? '',
      telefone: l.telefone ?? '',
      placa: l.placa ?? '',
      ativo: l.ativo,
      sync: 'ENVIADO',
      syncTentativas: 0,
      syncErro: null,
      atualizadoEm: l.atualizado_em
    }));
  await db.salvarDoServidor('usuarios', novos);
  return novos.length;
}

/**
 * Versões antigas podiam criar cadastros locais. Eles são preservados para
 * auditoria, mas saem da fila automática: reenviá-los é justamente o que
 * produz conflito de código/nome. Se o mesmo cadastro existir no servidor, a
 * descida acima já o reconciliou pelo índice natural.
 */
async function separarCadastrosLegados(): Promise<number> {
  let total = 0;
  for (const store of db.STORES_MESTRES) {
    const pendentes = await db.pendentes(store, 10_000);
    if (!pendentes.length) continue;
    await db.marcarSync(
      store,
      pendentes.map((r) => r.id),
      'ERRO',
      'Cadastro local legado preservado. Recrie ou confirme este cadastro online no painel.'
    );
    total += pendentes.length;
  }
  return total;
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
    } else if (store === 'sessoes') {
      linhas = (lote as Sessao[]).map(linhaSessao);
    } else {
      linhas = (lote as Leitura[]).map(linhaLeitura);
    }

    const { error } = await cliente.from(TABELAS[store]).upsert(linhas, { onConflict: 'id' });

    const ids = lote.map((r) => r.id);
    const versoes = new Map(lote.map((r) => [r.id, r.atualizadoEm]));
    if (error) {
      const mensagem = error.message;
      // Falha de autorização atinge o lote inteiro; repetir item por item só
      // faria centenas de requisições iguais. Erro de dado/FK pode ser isolado:
      // tenta cada registro, confirma os válidos e mantém apenas os recusados.
      if (/row-level security|jwt|not authenticated|permission denied/i.test(mensagem)) {
        await marcarFalha(store, lote as { id: string; syncTentativas: number }[], mensagem);
        return { enviados, erro: `${TABELAS[store]}: ${mensagem}` };
      }

      const falhas: string[] = [];
      for (let i = 0; i < lote.length; i++) {
        const registro = lote[i];
        const tentativa = await cliente.from(TABELAS[store]).upsert([linhas[i]], { onConflict: 'id' });
        if (tentativa.error) {
          await marcarFalha(store, [registro] as { id: string; syncTentativas: number }[], tentativa.error.message);
          falhas.push(`${registro.id}: ${tentativa.error.message}`);
        } else {
          await db.marcarSync(
            store, [registro.id], 'ENVIADO', null,
            extrasPorId.get(registro.id) ?? {}, versoes
          );
          enviados++;
        }
      }
      return {
        enviados,
        erro: falhas.length ? `${TABELAS[store]}: ${falhas.length} registro(s) recusado(s)` : null
      };
    }

    // Um lote de 200 leituras precisa virar UMA transação local, não 200.
    // Numa carga de 3 mil caixas, marcar uma a uma abria milhares de
    // transações no IndexedDB depois do upload e disputava o aparelho com a
    // câmera. Fotos são a única exceção porque cada ocorrência pode receber um
    // caminho remoto diferente; leitura, sessão e cadastro não têm extras.
    if (extrasPorId.size === 0) {
      await db.marcarSync(store, ids, 'ENVIADO', null, {}, versoes);
    } else {
      for (const id of ids) {
        await db.marcarSync(store, [id], 'ENVIADO', null, extrasPorId.get(id) ?? {}, versoes);
      }
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

    if (!(await sessaoAutenticada())) {
      estado.ultimoErro = 'Entre novamente com internet para autorizar o envio protegido.';
      return estadoSync();
    }

    // Dados mestres descem antes. Cadastro nunca sobe pela fila automática.
    const descida = await baixarCadastro();
    if (descida.erro) {
      estado.ultimoErro = descida.erro;
      return estadoSync();
    }
    estado.ultimaDescida = agora();
    const legados = await separarCadastrosLegados();
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

    if (legados) falhas.push(`${legados} cadastro(s) local(is) legado(s) separado(s) da fila operacional`);

    const erro = falhas.length ? falhas.join(' | ') : null;
    estado.ultimoErro = erro;
    if (enviados > 0) estado.ultimoEnvio = agora();

    await registrarDispositivo(await db.contarPendentesOperacionais(), estado.usuarioAtual);
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
 * Serve ao login: depois que o Supabase Auth valida a credencial, o perfil e
 * as permissões daquele tenant precisam descer antes de abrir a operação.
 *
 * Devolve `true` se conseguiu falar com a base, para quem chamou saber se vale
 * tentar de novo.
 */
export async function baixarCadastroAgora(): Promise<boolean> {
  if (!navigator.onLine || !(await estaConfigurado())) return false;
  if (!(await sessaoAutenticada())) return false;
  const r = await baixarCadastro();
  if (!r.erro) estado.ultimaDescida = agora();
  return !r.erro;
}

/**
 * Tenta restaurar o cadastro durante o boot quando já existe sessão Auth.
 *
 * Não existe cadastro de exemplo: aparelho novo começa vazio e recebe pessoas,
 * transportadoras e rotas da base. Roda uma vez no boot, só quando não há nada
 * local; sem sessão autenticada, apenas mantém a tela de entrada.
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
