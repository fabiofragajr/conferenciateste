// sync.ts — fila de saída (outbox) para o Supabase.
//
// Princípio: a bipagem grava local e segue. Este módulo é o único que fala com
// a rede, sempre depois do fato, sempre em lote, e nunca bloqueando a tela.
// São muitas caixas por carga — o envio acontece em blocos e pode ser
// interrompido a qualquer momento sem perder nada.

import type {
  EstadoSync, GrupoRota, Leitura, Ocorrencia, Sessao, Usuario
} from '../types.js';
import * as db from './db.js';
import { agora } from './util.js';
import { obterCliente, obterConfig, estaConfigurado } from './supabase.js';

const LOTE = 200;
const INTERVALO_AUTO_MS = 60_000;
const MAX_TENTATIVAS = 8;

export const TABELAS: Record<db.NomeStore, string> = {
  usuarios: 'usuarios',
  grupos: 'grupos_rota',
  sessoes: 'sessoes',
  leituras: 'leituras',
  ocorrencias: 'ocorrencias'
};

let estado: EstadoSync = {
  pendentes: 0,
  online: navigator.onLine,
  configurado: false,
  enviando: false,
  ultimoEnvio: null,
  ultimoErro: null
};

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
  // senhaHash NUNCA sai do aparelho: autenticação é local nesta versão.
  gestor: u.gestor,
  funcao: u.funcao,
  telefone: u.telefone,
  placa: u.placa,
  ativo: u.ativo,
  atualizado_em: u.atualizadoEm
});

const linhaGrupo = (g: GrupoRota): Record<string, unknown> => ({
  id: g.id,
  nome: g.nome,
  rotas: g.rotas,
  transportadora: g.transportadora || null,
  ativo: g.ativo,
  atualizado_em: g.atualizadoEm
});

const linhaSessao = (s: Sessao): Record<string, unknown> => ({
  id: s.id,
  grupo_rota_id: s.grupoRotaId,
  usuario_id: s.usuarioId,
  inicio: s.inicio,
  fim: s.fim,
  status: s.status,
  grupo_nome: s.grupoNome,
  rotas: s.rotas,
  transportadora: s.transportadora || null,
  usuario_nome: s.usuarioNome,
  geo_inicio: s.geoInicio,
  geo_fim: s.geoFim,
  atualizado_em: s.atualizadoEm
});

const linhaLeitura = (l: Leitura): Record<string, unknown> => ({
  id: l.id,
  sessao_id: l.sessaoId,
  codigo_volume: l.codigoVolume,
  rota: l.rota,
  rota_prefixo: l.rotaPrefixo,
  volume: l.volume,
  volume_atual: l.volumeAtual,
  volume_total: l.volumeTotal,
  pedido: l.pedido,
  status: l.status,
  lido_em: l.timestamp,
  raw_data: l.rawData,
  origem: l.origem,
  motivo_invalido: l.motivoInvalido,
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
    } else if (store === 'grupos') {
      linhas = (lote as GrupoRota[]).map(linhaGrupo);
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

    let erro: string | null = null;
    let enviados = 0;
    for (const store of db.STORES_SYNC) {
      const r = await enviarStore(store);
      enviados += r.enviados;
      if (r.erro) { erro = r.erro; break; }
    }

    estado.ultimoErro = erro;
    if (!erro && enviados > 0) estado.ultimoEnvio = agora();
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
