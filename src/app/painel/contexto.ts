// contexto.ts — o que as seções do painel compartilham.
//
// Os dados são carregados uma vez por `index.ts` e passados prontos: nenhuma
// seção abre o IndexedDB por conta própria, senão a mesma tela lê o banco treze
// vezes a cada ciclo de atualização.

import type {
  Dispositivo, Leitura, Ocorrencia, Rota, Sessao, Transportadora, Usuario
} from '../../types.js';
import type { Tela } from '../../lib/router.js';

export interface Base {
  usuarios: Usuario[];
  transportadoras: Transportadora[];
  rotas: Rota[];
  sessoes: Sessao[];
  leituras: Leitura[];
  ocorrencias: Ocorrencia[];
  porSessao: Map<string, Leitura[]>;
  ocPorSessao: Map<string, Ocorrencia[]>;
}

export interface Contexto {
  usuario: () => Usuario;
  base: () => Base;
  dispositivos: () => Dispositivo[];
  /** Recarrega tudo do IndexedDB e repinta a seção visível. */
  recarregar: () => Promise<void>;
  irPara: (t: Tela) => void;
}

/** Contrato de toda seção do painel. */
export interface Modulo {
  pintar: () => void;
}

export type Montar = (raiz: HTMLElement, ctx: Contexto) => Modulo;

export const dentro = (iso: string, de: string, ate: string): boolean => iso >= de && iso <= ate;

export const baseVazia = (): Base => ({
  usuarios: [], transportadoras: [], rotas: [], sessoes: [], leituras: [], ocorrencias: [],
  porSessao: new Map(), ocPorSessao: new Map()
});
