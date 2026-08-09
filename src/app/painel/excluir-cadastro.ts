// excluir-cadastro.ts — apagar pessoa, transportadora ou código de rota.
//
// Existe porque "Desativar" não resolve tudo: cadastro criado errado, nome
// duplicado, teste que ficou na base. Desativado continua na lista e continua
// ocupando o código — e `rotas.codigo` é único no sistema inteiro, então uma
// rota errada e inativa impede a certa de existir.
//
// Duas regras, e as duas vêm do jeito como o sistema já funciona:
//
// 1. Apaga na BASE antes de apagar no aparelho. O cadastro desce do Supabase;
//    apagar só aqui faria o registro voltar na próxima descida, e a pessoa
//    ficaria olhando para algo que ela jurava ter excluído.
// 2. Recusa quando há histórico. Sessão e leitura guardam cópia congelada do
//    nome, então o relatório de ontem sobrevive — mas o vínculo por id não, e
//    "quem bipou esta caixa" é justamente o que o gestor precisa responder.
//    Nesse caso o caminho é Desativar.

import type { Base } from './contexto.js';
import * as db from '../../lib/db.js';
import { TABELAS } from '../../lib/sync.js';
import { obterCliente } from '../../lib/supabase.js';

export type TipoCadastro = 'usuarios' | 'transportadoras' | 'rotas';

/**
 * Por que este cadastro não pode ser apagado. Vazio = pode.
 *
 * A frase é a que vai para a tela, então diz o que existe e o que fazer — não
 * "violação de integridade referencial".
 */
export function impedimentos(tipo: TipoCadastro, id: string, base: Base): string[] {
  const motivos: string[] = [];

  if (tipo === 'usuarios') {
    const sessoes = base.sessoes.filter((s) => s.usuarioId === id).length;
    if (sessoes) motivos.push(`${sessoes} conferência(s) no nome desta pessoa`);
  }

  if (tipo === 'transportadoras') {
    const rotas = base.rotas.filter((r) => r.transportadoraId === id).length;
    if (rotas) motivos.push(`${rotas} código(s) de rota apontando para ela`);
    const sessoes = base.sessoes.filter((s) => s.transportadoraId === id).length;
    if (sessoes) motivos.push(`${sessoes} conferência(s) desta transportadora`);
  }

  if (tipo === 'rotas') {
    const leituras = base.leituras.filter((l) => l.rotaId === id).length;
    if (leituras) motivos.push(`${leituras} volume(s) já bipado(s) com este código`);
  }

  return motivos;
}

export type ResultadoExclusao = { ok: true } | { ok: false; erro: string };

/**
 * Apaga na base e depois no aparelho.
 *
 * A ordem não é detalhe: se a base recusar e o aparelho já tiver apagado, o
 * registro volta na próxima descida e a exclusão vira mentira. Sem projeto
 * configurado não há descida, e aí apagar local basta.
 */
export async function excluirCadastro(tipo: TipoCadastro, id: string): Promise<ResultadoExclusao> {
  const cliente = await obterCliente();

  if (cliente) {
    const { error } = await cliente.from(TABELAS[tipo]).delete().eq('id', id);
    if (error) {
      return {
        ok: false,
        erro: `A base recusou a exclusão: ${error.message}. Nada foi apagado neste aparelho.`
      };
    }
  }

  await db.remover(tipo, id);
  return { ok: true };
}
