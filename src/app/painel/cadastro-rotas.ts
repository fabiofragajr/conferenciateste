// cadastro-rotas.ts — cadastrar um código de rota, com a regra de unicidade.
//
// Mora fora de `gestor.ts` porque tem dois chamadores em telas diferentes: a
// fila de decisão em Início (o código que apareceu na doca e ninguém cadastrou)
// e a seção Cadastros. Se ficasse em `gestor.ts`, o módulo de Início teria de
// importar de volta quem o importa — e o ciclo é o tipo de coisa que só quebra
// depois, no navegador.

import type { Rota, Transportadora } from '../../types.js';
import * as db from '../../lib/db.js';
import { criarRota } from '../../lib/cadastros.js';
import { prefixoRota } from '../../lib/model.js';

export type ResultadoCadastro = { ok: true } | { ok: false; erro: string };

export async function donoDoCodigo(codigo: string, ignorarId?: string): Promise<Rota | null> {
  const existente = await db.umPorIndice('rotas', 'codigo', codigo);
  if (!existente || existente.id === ignorarId) return null;
  return existente;
}

/** Cadastra um código de rota, recusando duplicidade com mensagem que explica. */
export async function cadastrarRota(
  dados: { codigo: string; nome: string; transportadoraId: string; descricao?: string },
  transportadoras: Transportadora[]
): Promise<ResultadoCadastro> {
  const codigo = prefixoRota(dados.codigo);
  if (!codigo) return { ok: false, erro: 'O código precisa começar com letras (ex.: FNOR).' };
  if (!dados.transportadoraId) return { ok: false, erro: 'Escolha a transportadora dona do código.' };

  const conflito = await donoDoCodigo(codigo);
  if (conflito) {
    const dona = transportadoras.find((t) => t.id === conflito.transportadoraId)?.nome ?? 'outra transportadora';
    return { ok: false, erro: `O código ${codigo} já pertence à ${dona}. Um código de rota é de uma transportadora só.` };
  }

  return criarRota({ ...dados, codigo });
}
