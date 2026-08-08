// db.ts — IndexedDB é a FONTE DA VERDADE da operação.
//
// Nada na bipagem espera rede: a leitura grava local, marcada como PENDENTE,
// e o motor de sync leva para o Supabase depois. Se o galpão estiver sem sinal
// o dia inteiro, nenhuma caixa se perde.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  GrupoRota, Leitura, Ocorrencia, Sessao, Sincronizavel, StatusSync, Usuario
} from '../types.js';
import { agora, uid } from './util.js';

const DB_NOME = 'logdis';
const DB_VERSAO = 1;

interface LogDisDB extends DBSchema {
  usuarios: { key: string; value: Usuario; indexes: { login: string; sync: string } };
  grupos: { key: string; value: GrupoRota; indexes: { sync: string } };
  sessoes: { key: string; value: Sessao; indexes: { usuarioId: string; status: string; inicio: string; sync: string } };
  leituras: { key: string; value: Leitura; indexes: { sessaoId: string; timestamp: string; sync: string } };
  ocorrencias: { key: string; value: Ocorrencia; indexes: { sessaoId: string; leituraId: string; timestamp: string; sync: string } };
  config: { key: string; value: { chave: string; valor: unknown } };
}

export type NomeStore = 'usuarios' | 'grupos' | 'sessoes' | 'leituras' | 'ocorrencias';

/** Ordem de envio: respeita a dependência entre as tabelas no Supabase. */
export const STORES_SYNC: NomeStore[] = ['usuarios', 'grupos', 'sessoes', 'leituras', 'ocorrencias'];

let _db: Promise<IDBPDatabase<LogDisDB>> | null = null;

export function db(): Promise<IDBPDatabase<LogDisDB>> {
  if (!_db) {
    _db = openDB<LogDisDB>(DB_NOME, DB_VERSAO, {
      upgrade(banco) {
        const usuarios = banco.createObjectStore('usuarios', { keyPath: 'id' });
        usuarios.createIndex('login', 'login', { unique: true });
        usuarios.createIndex('sync', 'sync');

        const grupos = banco.createObjectStore('grupos', { keyPath: 'id' });
        grupos.createIndex('sync', 'sync');

        const sessoes = banco.createObjectStore('sessoes', { keyPath: 'id' });
        sessoes.createIndex('usuarioId', 'usuarioId');
        sessoes.createIndex('status', 'status');
        sessoes.createIndex('inicio', 'inicio');
        sessoes.createIndex('sync', 'sync');

        const leituras = banco.createObjectStore('leituras', { keyPath: 'id' });
        leituras.createIndex('sessaoId', 'sessaoId');
        leituras.createIndex('timestamp', 'timestamp');
        leituras.createIndex('sync', 'sync');

        const ocorrencias = banco.createObjectStore('ocorrencias', { keyPath: 'id' });
        ocorrencias.createIndex('sessaoId', 'sessaoId');
        ocorrencias.createIndex('leituraId', 'leituraId');
        ocorrencias.createIndex('timestamp', 'timestamp');
        ocorrencias.createIndex('sync', 'sync');

        banco.createObjectStore('config', { keyPath: 'chave' });
      }
    });
  }
  return _db;
}

/** Campos de sincronização de um registro recém-criado. */
export function novoSync(): Sincronizavel & { id: string } {
  return { id: uid(), sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: agora() };
}

type ValorDe<S extends NomeStore> = LogDisDB[S]['value'];
type ValorQualquer = Usuario | GrupoRota | Sessao | Leitura | Ocorrencia;

/**
 * Grava e marca como pendente de envio. Toda escrita passa por aqui — é o que
 * garante que nada fique fora da fila de sincronização.
 */
export async function salvar<S extends NomeStore>(store: S, obj: ValorDe<S>): Promise<ValorDe<S>> {
  const registro = { ...obj, sync: 'PENDENTE' as StatusSync, atualizadoEm: agora() };
  await (await db()).put(store, registro as ValorDe<S>);
  return registro as ValorDe<S>;
}

/** Grava vários numa transação só — usado na importação de cadastro. */
export async function salvarVarios<S extends NomeStore>(store: S, objs: ValorDe<S>[]): Promise<void> {
  const banco = await db();
  const tx = banco.transaction(store, 'readwrite');
  const marcados = objs.map((o) => ({ ...o, sync: 'PENDENTE' as StatusSync, atualizadoEm: agora() }));
  await Promise.all([...marcados.map((o) => tx.store.put(o as ValorDe<S>)), tx.done]);
}

export async function obter<S extends NomeStore>(store: S, id: string): Promise<ValorDe<S> | undefined> {
  return (await db()).get(store, id) as Promise<ValorDe<S> | undefined>;
}

export async function todos<S extends NomeStore>(store: S): Promise<ValorDe<S>[]> {
  return (await db()).getAll(store) as Promise<ValorDe<S>[]>;
}

/**
 * O tipo gerado pelo `idb` amarra o nome do índice ao literal da store; aqui a
 * store é genérica, então acessamos os índices por esta visão mais frouxa.
 */
interface AcessoPorIndice {
  getAllFromIndex(store: string, indice: string, chave?: IDBValidKey, limite?: number): Promise<unknown[]>;
  countFromIndex(store: string, indice: string, chave?: IDBValidKey): Promise<number>;
}

const comIndice = async (): Promise<AcessoPorIndice> => (await db()) as unknown as AcessoPorIndice;

export async function porIndice<S extends NomeStore>(store: S, indice: string, valor: string): Promise<ValorDe<S>[]> {
  const banco = await comIndice();
  return (await banco.getAllFromIndex(store, indice, valor)) as ValorDe<S>[];
}

export async function remover(store: NomeStore, id: string): Promise<void> {
  await (await db()).delete(store, id);
}

export async function pendentes<S extends NomeStore>(store: S, limite = 500): Promise<ValorDe<S>[]> {
  const banco = await comIndice();
  return (await banco.getAllFromIndex(store, 'sync', 'PENDENTE', limite)) as ValorDe<S>[];
}

export async function contarPendentes(): Promise<number> {
  const banco = await comIndice();
  let total = 0;
  for (const store of STORES_SYNC) {
    total += await banco.countFromIndex(store, 'sync', 'PENDENTE');
  }
  return total;
}

/** Marca o resultado do envio sem mexer no conteúdo do registro. */
export async function marcarSync(
  store: NomeStore,
  ids: string[],
  status: StatusSync,
  erro: string | null = null,
  extras: Record<string, unknown> = {}
): Promise<void> {
  if (!ids.length) return;
  const banco = await db();
  const tx = banco.transaction(store, 'readwrite');
  await Promise.all(ids.map(async (id) => {
    const atual = await tx.store.get(id);
    if (!atual) return;
    // Se o registro foi alterado depois do envio, ele continua pendente.
    const alterado = status === 'ENVIADO' && atual.sync !== 'PENDENTE' && atual.sync !== 'ERRO';
    if (alterado) return;
    await tx.store.put({
      ...atual,
      ...extras,
      sync: status,
      syncErro: erro,
      syncTentativas: status === 'ERRO' ? (atual.syncTentativas ?? 0) + 1 : (atual.syncTentativas ?? 0)
    });
  }));
  await tx.done;
}

/** Reenfileira o que deu erro — botão "tentar de novo" do painel. */
export async function reenfileirarErros(): Promise<number> {
  const banco = await db();
  const indices = await comIndice();
  let total = 0;
  for (const store of STORES_SYNC) {
    const comErro = (await indices.getAllFromIndex(store, 'sync', 'ERRO')) as ValorQualquer[];
    if (!comErro.length) continue;
    const tx = banco.transaction(store, 'readwrite');
    await Promise.all([
      ...comErro.map((r) => tx.store.put({ ...r, sync: 'PENDENTE' as StatusSync, syncErro: null })),
      tx.done
    ]);
    total += comErro.length;
  }
  return total;
}

export async function configGet<T>(chave: string, padrao: T): Promise<T> {
  const r = await (await db()).get('config', chave);
  return r ? (r.valor as T) : padrao;
}

export async function configSet(chave: string, valor: unknown): Promise<void> {
  await (await db()).put('config', { chave, valor });
}
