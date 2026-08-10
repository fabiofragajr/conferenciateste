// db.ts — IndexedDB é a FONTE DA VERDADE da operação.
//
// Nada na bipagem espera rede: a leitura grava local, marcada como PENDENTE,
// e o motor de sync leva para o Supabase depois. Se o galpão estiver sem sinal
// o dia inteiro, nenhuma caixa se perde.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Leitura, Ocorrencia, Rota, Sessao, Sincronizavel, StatusSync, Transportadora, Usuario
} from '../types.js';
import { agora, uid } from './util.js';

const DB_NOME = 'logdis';
const DB_VERSAO = 4;

interface LogDisDB extends DBSchema {
  usuarios: { key: string; value: Usuario; indexes: { login: string; sync: string } };
  transportadoras: { key: string; value: Transportadora; indexes: { nome: string; sync: string } };
  rotas: { key: string; value: Rota; indexes: { codigo: string; transportadoraId: string; sync: string } };
  sessoes: { key: string; value: Sessao; indexes: { usuarioId: string; status: string; inicio: string; sync: string } };
  leituras: { key: string; value: Leitura; indexes: { sessaoId: string; timestamp: string; sync: string } };
  ocorrencias: { key: string; value: Ocorrencia; indexes: { sessaoId: string; leituraId: string; timestamp: string; sync: string } };
  config: { key: string; value: { chave: string; valor: unknown } };
}

export type NomeStore = 'usuarios' | 'transportadoras' | 'rotas' | 'sessoes' | 'leituras' | 'ocorrencias';

/** Dados mestres são cache de mão única: Supabase -> aparelho. */
export const STORES_MESTRES: NomeStore[] = ['usuarios', 'transportadoras', 'rotas'];
/** Somente acontecimentos da operação entram na fila de saída. */
export const STORES_SYNC: NomeStore[] = ['sessoes', 'leituras', 'ocorrencias'];

/** Formato v1: o grupo carregava a lista de rotas e o nome solto da transportadora. */
interface GrupoRotaV1 extends Sincronizavel {
  id: string;
  nome: string;
  rotas: string[];
  transportadora: string;
  ativo: boolean;
}

let _db: Promise<IDBPDatabase<LogDisDB>> | null = null;

export function db(): Promise<IDBPDatabase<LogDisDB>> {
  if (!_db) {
    _db = openDB<LogDisDB>(DB_NOME, DB_VERSAO, {
      async upgrade(banco, versaoAnterior, _versaoNova, tx) {
        if (versaoAnterior < 1) {
          const usuarios = banco.createObjectStore('usuarios', { keyPath: 'id' });
          usuarios.createIndex('login', 'login', { unique: true });
          usuarios.createIndex('sync', 'sync');

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

        if (versaoAnterior < 2) {
          const transportadoras = banco.createObjectStore('transportadoras', { keyPath: 'id' });
          transportadoras.createIndex('sync', 'sync');

          const rotas = banco.createObjectStore('rotas', { keyPath: 'id' });
          // Único no sistema inteiro: é essa restrição que permite descobrir o
          // dono do volume só a partir da etiqueta.
          rotas.createIndex('codigo', 'codigo', { unique: true });
          rotas.createIndex('transportadoraId', 'transportadoraId');
          rotas.createIndex('sync', 'sync');

          await migrarGruposParaTransportadoras(banco, tx);
        }

        if (versaoAnterior < 3) {
          const transportadoras = tx.objectStore('transportadoras');
          if (!transportadoras.indexNames.contains('nome')) {
            // O servidor garante unicidade por tenant. Localmente basta o
            // índice para reconciliar UUID legado pelo nome sem apagar fila.
            transportadoras.createIndex('nome', 'nome');
          }
        }

        if (versaoAnterior < 4) {
          // Credenciais legadas não pertencem ao cache offline. Preserva o
          // perfil operacional e remove somente o campo de hash antigo.
          const usuarios = tx.objectStore('usuarios');
          for (const registro of await usuarios.getAll() as Array<Usuario & { senhaHash?: string }>) {
            const { senhaHash: _removida, ...perfil } = registro;
            await usuarios.put(perfil as Usuario);
          }
        }
      }
    });
  }
  return _db;
}

type TxUpgrade = {
  objectStore(nome: string): {
    getAll(): Promise<unknown[]>;
    put(valor: unknown): Promise<unknown>;
  };
};

/**
 * Migração v1 -> v2: cada grupo de rota vira uma transportadora, e cada prefixo
 * do grupo vira um código de rota dela. As sessões antigas guardavam o id do
 * grupo, que agora é o id da transportadora — o histórico continua de pé.
 *
 * Código repetido em grupos diferentes fica com o primeiro: o índice é único, e
 * cadastro ambíguo era justamente o problema que a v2 veio resolver.
 */
async function migrarGruposParaTransportadoras(
  banco: IDBPDatabase<LogDisDB>,
  tx: unknown
): Promise<void> {
  if (!banco.objectStoreNames.contains('grupos' as never)) return;

  const transacao = tx as TxUpgrade;
  const grupos = (await transacao.objectStore('grupos').getAll()) as GrupoRotaV1[];
  const lojaTransp = transacao.objectStore('transportadoras');
  const lojaRotas = transacao.objectStore('rotas');
  const usados = new Set<string>();

  for (const g of grupos) {
    await lojaTransp.put({
      id: g.id,
      nome: g.transportadora?.trim() || g.nome,
      cnpj: '',
      responsavel: '',
      telefone: '',
      email: '',
      ativo: g.ativo,
      sync: 'PENDENTE',
      syncTentativas: 0,
      syncErro: null,
      atualizadoEm: agora()
    } satisfies Transportadora);

    for (const codigo of g.rotas ?? []) {
      const limpo = String(codigo).trim().toUpperCase();
      if (!limpo || usados.has(limpo)) continue;
      usados.add(limpo);
      await lojaRotas.put({
        id: uid(),
        codigo: limpo,
        nome: g.nome,
        transportadoraId: g.id,
        descricao: '',
        ativo: g.ativo,
        sync: 'PENDENTE',
        syncTentativas: 0,
        syncErro: null,
        atualizadoEm: agora()
      } satisfies Rota);
    }
  }

  banco.deleteObjectStore('grupos' as never);
}

/** Campos de sincronização de um registro recém-criado. */
export function novoSync(): Sincronizavel & { id: string } {
  return { id: uid(), sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: agora() };
}

type ValorDe<S extends NomeStore> = LogDisDB[S]['value'];
type ValorQualquer = Usuario | Transportadora | Rota | Sessao | Leitura | Ocorrencia;

/**
 * Grava e marca como pendente de envio. Toda escrita passa por aqui — é o que
 * garante que nada fique fora da fila de sincronização.
 */
export async function salvar<S extends NomeStore>(store: S, obj: ValorDe<S>): Promise<ValorDe<S>> {
  const registro = { ...obj, sync: 'PENDENTE' as StatusSync, atualizadoEm: agora() };
  await (await db()).put(store, registro as ValorDe<S>);
  return registro as ValorDe<S>;
}

/** Grava vários numa transação só. */
export async function salvarVarios<S extends NomeStore>(store: S, objs: ValorDe<S>[]): Promise<void> {
  const banco = await db();
  const tx = banco.transaction(store, 'readwrite');
  const marcados = objs.map((o) => ({ ...o, sync: 'PENDENTE' as StatusSync, atualizadoEm: agora() }));
  await Promise.all([...marcados.map((o) => tx.store.put(o as ValorDe<S>)), tx.done]);
}

/**
 * Índices únicos do cadastro. Quando o valor colide, quem manda é o servidor:
 * é lá que o gestor cadastra, e `codigo` só tem valor porque tem um dono só.
 */
const INDICE_UNICO: Partial<Record<NomeStore, string>> = {
  usuarios: 'login',
  transportadoras: 'nome',
  rotas: 'codigo'
};

/** Visão frouxa da store: o tipo do `idb` amarra o índice ao literal da store. */
interface LojaFrouxa {
  index(nome: string): { getKey(valor: IDBValidKey): Promise<IDBValidKey | undefined> };
  put(valor: unknown): Promise<unknown>;
  delete(chave: IDBValidKey): Promise<void>;
}

/**
 * Grava o que desceu do servidor SEM reenfileirar: o registro já está lá.
 * Sem isso, cada sincronização de descida devolveria tudo para a fila de subida.
 *
 * Antes de gravar, resolve colisão de índice único. O caso real: o servidor tem
 * FNOR com um id e o aparelho tem FNOR com outro. O `put` cru era recusado pelo
 * índice, a transação inteira abortava e o aparelho NUNCA mais recebia cadastro
 * nenhum — nem as rotas novas que o gestor tinha acabado de cadastrar. Some com
 * o registro local conflitante e aceita o do servidor.
 */
export async function salvarDoServidor<S extends NomeStore>(store: S, objs: ValorDe<S>[]): Promise<void> {
  if (!objs.length) return;
  const banco = await db();
  const indice = INDICE_UNICO[store];

  // Resolve primeiro os ids legados nas referências operacionais. Apenas
  // apagar o cadastro conflitante faria uma sessão ainda pendente apontar para
  // um UUID que não existe no servidor e trocar o 409 por violação de FK.
  if (indice) {
    const acesso = banco as unknown as AcessoPorIndice;
    for (const o of objs) {
      const valor = (o as unknown as Record<string, unknown>)[indice];
      if (typeof valor !== 'string' || !valor) continue;
      const chave = await acesso.getKeyFromIndex(store, indice, valor);
      if (chave !== undefined && chave !== o.id) {
        await remapearCadastro(store as StoreCadastro, String(chave), o.id);
      }
    }
  }

  const tx = banco.transaction(store, 'readwrite');
  const loja = tx.store as unknown as LojaFrouxa;

  for (const o of objs) {
    const registro = { ...o, sync: 'ENVIADO' as StatusSync, syncErro: null, syncTentativas: 0 };

    if (indice) {
      const valor = (registro as unknown as Record<string, unknown>)[indice];
      if (typeof valor === 'string' && valor) {
        const chaveEmUso = await loja.index(indice).getKey(valor);
        if (chaveEmUso !== undefined && chaveEmUso !== registro.id) {
          await loja.delete(chaveEmUso);
        }
      }
    }

    await loja.put(registro);
  }

  await tx.done;
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
  getFromIndex(store: string, indice: string, chave: IDBValidKey): Promise<unknown>;
  getKeyFromIndex(store: string, indice: string, chave: IDBValidKey): Promise<IDBValidKey | undefined>;
  countFromIndex(store: string, indice: string, chave?: IDBValidKey): Promise<number>;
}

const comIndice = async (): Promise<AcessoPorIndice> => (await db()) as unknown as AcessoPorIndice;

type StoreCadastro = 'usuarios' | 'transportadoras' | 'rotas';

/** Troca UUID local legado pelo UUID canônico que desceu do servidor. */
async function remapearCadastro(store: StoreCadastro, antigo: string, novo: string): Promise<void> {
  if (antigo === novo) return;
  const banco = await db();
  const afetadas: NomeStore[] = store === 'usuarios'
    ? ['sessoes', 'ocorrencias']
    : store === 'transportadoras'
      ? ['rotas', 'sessoes', 'leituras']
      : ['leituras'];
  const tx = banco.transaction(afetadas, 'readwrite');

  for (const nome of afetadas) {
    const loja = tx.objectStore(nome);
    const todos = await loja.getAll() as ValorQualquer[];
    for (const item of todos) {
      let alterado: ValorQualquer | null = null;
      if (store === 'usuarios' && nome === 'sessoes' && (item as Sessao).usuarioId === antigo) {
        alterado = { ...item, usuarioId: novo } as Sessao;
      } else if (store === 'usuarios' && nome === 'ocorrencias' && (item as Ocorrencia).usuarioId === antigo) {
        alterado = { ...item, usuarioId: novo } as Ocorrencia;
      } else if (store === 'transportadoras' && nome === 'rotas' && (item as Rota).transportadoraId === antigo) {
        alterado = { ...item, transportadoraId: novo } as Rota;
      } else if (store === 'transportadoras' && nome === 'sessoes' && (item as Sessao).transportadoraId === antigo) {
        alterado = { ...item, transportadoraId: novo } as Sessao;
      } else if (store === 'transportadoras' && nome === 'leituras' && (item as Leitura).transportadoraDonaId === antigo) {
        alterado = { ...item, transportadoraDonaId: novo } as Leitura;
      } else if (store === 'rotas' && nome === 'leituras' && (item as Leitura).rotaId === antigo) {
        alterado = { ...item, rotaId: novo } as Leitura;
      }
      if (alterado) await loja.put(alterado);
    }
  }
  await tx.done;
  if (store === 'usuarios' && localStorage.getItem('logdis.usuarioLogado') === antigo) {
    localStorage.setItem('logdis.usuarioLogado', novo);
  }
}

export async function porIndice<S extends NomeStore>(store: S, indice: string, valor: string): Promise<ValorDe<S>[]> {
  const banco = await comIndice();
  return (await banco.getAllFromIndex(store, indice, valor)) as ValorDe<S>[];
}

export async function umPorIndice<S extends NomeStore>(store: S, indice: string, valor: string): Promise<ValorDe<S> | undefined> {
  const banco = await comIndice();
  return (await banco.getFromIndex(store, indice, valor)) as ValorDe<S> | undefined;
}

export async function remover(store: NomeStore, id: string): Promise<void> {
  await (await db()).delete(store, id);
}

export async function pendentes<S extends NomeStore>(store: S, limite = 500): Promise<ValorDe<S>[]> {
  const banco = await comIndice();
  return (await banco.getAllFromIndex(store, 'sync', 'PENDENTE', limite)) as ValorDe<S>[];
}

export async function contarPendentesOperacionais(): Promise<number> {
  const banco = await comIndice();
  let total = 0;
  for (const store of STORES_SYNC) total += await banco.countFromIndex(store, 'sync', 'PENDENTE');
  return total;
}

/** Cadastros pendentes de versões antigas: preservados, mas nunca reenviados pela fila normal. */
export async function contarCadastrosLegados(): Promise<number> {
  const banco = await comIndice();
  let total = 0;
  for (const store of STORES_MESTRES) {
    total += await banco.countFromIndex(store, 'sync', 'PENDENTE');
    total += await banco.countFromIndex(store, 'sync', 'ERRO');
  }
  return total;
}

/** Marca o resultado do envio sem mexer no conteúdo do registro. */
export async function marcarSync(
  store: NomeStore,
  ids: string[],
  status: StatusSync,
  erro: string | null = null,
  extras: Record<string, unknown> = {},
  versoesEnviadas?: ReadonlyMap<string, string>
): Promise<void> {
  if (!ids.length) return;
  const banco = await db();
  const tx = banco.transaction(store, 'readwrite');
  await Promise.all(ids.map(async (id) => {
    const atual = await tx.store.get(id);
    if (!atual) return;
    const versaoEnviada = versoesEnviadas?.get(id);
    if (status === 'ENVIADO' && versaoEnviada && atual.atualizadoEm !== versaoEnviada) {
      // O registro mudou enquanto a requisição estava em trânsito. A resposta
      // confirma a versão antiga; a nova continua PENDENTE para o próximo lote.
      return;
    }
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

/**
 * Identificador deste aparelho. Não identifica pessoa: serve para o gestor
 * saber de qual celular ainda faltam leituras chegando.
 */
export function dispositivoId(): string {
  let id = localStorage.getItem('logdis.dispositivo');
  if (!id) {
    id = uid();
    localStorage.setItem('logdis.dispositivo', id);
  }
  return id;
}
