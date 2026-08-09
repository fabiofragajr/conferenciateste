// sinal-sync.ts — o único lugar do sistema que transforma o estado da
// sincronização em texto de tela.
//
// Antes eram quatro textos diferentes para o mesmo dado, e nenhum dizia o que
// eram os números. O operador não sabe o que é uma fila; ele sabe o que é uma
// leitura que ainda não chegou ao servidor.

import type { EstadoSync } from '../../types.ts';
import { plural } from './basico.ts';

export type TomSync = 'ok' | 'enviando' | 'offline' | 'pendente' | 'falha';

export interface SinalSync {
  tom: TomSync;
  /** Emoji de apoio. A cor nunca carrega a informação sozinha. */
  icone: string;
  texto: string;
}

export function sinalSync(e: EstadoSync): SinalSync {
  // Falha ganha de tudo: erro silencioso é pior que fila cheia, porque ninguém
  // vai atrás do que não apareceu.
  if (e.ultimoErro) return { tom: 'falha', icone: '🔴', texto: 'Falha ao sincronizar' };

  if (e.pendentes === 0) {
    // Aparelho sem projeto configurado nunca fica "sincronizado": não há para
    // onde sincronizar, e dizer que está sincronizado seria mentira.
    return e.configurado
      ? { tom: 'ok', icone: '🟢', texto: 'Sincronizado' }
      : { tom: 'pendente', icone: '🟠', texto: 'Nada pendente' };
  }

  if (!e.online) return { tom: 'offline', icone: '🟠', texto: 'Offline' };
  if (e.enviando) return { tom: 'enviando', icone: '🔵', texto: 'Sincronizando' };

  return {
    tom: 'pendente',
    icone: '🟠',
    texto: plural(e.pendentes, 'leitura pendente', 'leituras pendentes')
  };
}

/** Chip pronto para a barra do topo, nos dois modos. */
export function chipSync(e: EstadoSync): string {
  const s = sinalSync(e);
  return `<span class="ui-chip-sync ui-sync-${s.tom}">${s.icone} ${s.texto}</span>`;
}
