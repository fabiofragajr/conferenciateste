// reconciliar.ts — o que sai do aparelho quando some do servidor.
//
// Mora fora de `sync.ts` para poder ser provado em Node: `sync.ts` arrasta o
// IndexedDB e o cliente do Supabase, e nenhum dos dois existe num teste de
// unidade. É o mesmo corte de `router.ts` e `grupos.ts` — a decisão é pura, a
// beirada é que toca no mundo.
//
// Por que a varredura existe: a descida de cadastro é incremental
// (`atualizado_em > desde`), e uma linha apagada não ganha carimbo novo — ela
// simplesmente deixa de vir. Sem isto, o aparelho guarda para sempre o que o
// gestor excluiu, e a tela do operador oferece transportadora que não existe
// mais. Não é só feio: `sessoes.transportadora_id` tem chave estrangeira no
// servidor, então uma conferência aberta sobre uma dessas fantasmas bate em
// violação no envio e fica presa no celular — a carga foi conferida e a base
// nunca fica sabendo.

import type { StatusSync } from '../types.js';

/**
 * Os ids que este aparelho deve esquecer.
 *
 * O custo de errar aqui é assimétrico, e as duas travas vêm disso: deixar sobra
 * é feio, apagar demais é perder trabalho de alguém ou trancar o aparelho fora
 * do app.
 *
 * 1. **Só o que já subiu.** Registro `PENDENTE` ou `ERRO` não está no servidor
 *    porque ainda não CHEGOU lá, não porque foi excluído — é o cadastro criado
 *    offline, no galpão sem sinal, que ainda espera a fila. Apagar seria
 *    destruir o que a pessoa acabou de fazer.
 * 2. **Lista vazia não apaga nada.** "O servidor não tem nenhum" é
 *    indistinguível de "a consulta voltou vazia por política de acesso", e
 *    obedecer no segundo caso limparia o cadastro inteiro — inclusive os
 *    usuários, deixando ninguém capaz de entrar neste aparelho. Esvaziar uma
 *    tabela de propósito continua possível pelo painel, item a item, que apaga
 *    na base e no aparelho.
 */
export function idsParaRemover(
  locais: { id: string; sync: StatusSync }[],
  idsNoServidor: Set<string>
): string[] {
  if (!idsNoServidor.size) return [];
  return locais
    .filter((r) => r.sync === 'ENVIADO' && !idsNoServidor.has(r.id))
    .map((r) => r.id);
}
