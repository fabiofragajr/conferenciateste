// ambiente.ts — o que `main.ts` entrega para cada tela.
//
// Mora num arquivo próprio, e não dentro de `main.ts`, para as telas não
// importarem quem as importa: o ciclo funcionaria com `import type` (que é
// apagado na compilação), mas basta alguém precisar de um valor de lá para o
// ciclo virar real.

import type { Usuario } from '../types.js';
import type { Tela } from '../lib/router.js';

export interface Ambiente {
  /** Quem está logado. A tela não busca isso: recebe pronto. */
  usuario: Usuario;
  /** Navega sem recarregar. */
  irPara: (t: Tela) => void;
  /** Encerra a sessão e volta ao login. */
  sair: () => void;
}
