// auth.ts — autenticação pelo Supabase Auth.
//
// Depois da primeira entrada online, a sessão e o perfil operacional ficam no
// aparelho para a bipagem continuar sem rede. Senhas e hashes nunca entram no
// IndexedDB.
//
// Quem está logado é quem bipa, e é isso que fica gravado na leitura.
// `funcao` é texto descritivo para o relatório — nunca libera nem bloqueia nada.
// A única regra de acesso do sistema é `gestor: true` (abre os painéis).

import type { Usuario } from '../types.js';
import * as db from './db.js';
import { entrarNoSupabase, estaConfigurado, obterCliente, sairDoSupabase, sessaoAutenticada } from './supabase.js';

const CHAVE_SESSAO = 'logdis.usuarioLogado';

export const normalizarLogin = (login: string): string => String(login ?? '').trim().toLowerCase();

export async function buscarPorLogin(login: string): Promise<Usuario | null> {
  const lista = await db.porIndice('usuarios', 'login', normalizarLogin(login));
  return lista[0] ?? null;
}

export interface DadosUsuario {
  nome: string;
  login: string;
  senha?: string;
  gestor?: boolean;
  funcao?: string;
  telefone?: string;
  placa?: string;
  ativo?: boolean;
}

export const SENHA_MINIMA = 4;

/** Cadastro administrativo online, com credencial criada no Supabase Auth. */
export async function criarUsuario(dados: DadosUsuario): Promise<Usuario> {
  if (!dados.nome?.trim()) throw new Error('Informe o nome.');
  if (!dados.login?.trim()) throw new Error('Informe o login.');
  if (!dados.senha || dados.senha.length < SENHA_MINIMA) {
    throw new Error(`A senha precisa ter ${SENHA_MINIMA} ou mais caracteres.`);
  }
  const cliente = await exigirAdministracaoOnline();
  const { data, error } = await cliente.functions.invoke('admin-users', {
    body: { acao: 'criar', dados: { ...dados, login: normalizarLogin(dados.login) } }
  });
  if (error) throw new Error(error.message);
  const id = String((data as { id?: string } | null)?.id ?? '');
  const sync = await import('./sync.js');
  await sync.baixarCadastroAgora();
  const usuario = (id ? await db.obter('usuarios', id) : undefined) ?? await buscarPorLogin(dados.login);
  if (!usuario) throw new Error('Usuário criado, mas o perfil ainda não desceu para este aparelho. Sincronize novamente.');
  return usuario;
}

export async function atualizarUsuario(
  id: string,
  campos: Partial<DadosUsuario>,
  novaSenha?: string
): Promise<Usuario> {
  const atual = await db.obter('usuarios', id);
  if (!atual) throw new Error('Usuário não encontrado.');
  if (novaSenha && novaSenha.length < SENHA_MINIMA) {
    throw new Error(`A senha precisa ter ${SENHA_MINIMA} ou mais caracteres.`);
  }

  const cliente = await exigirAdministracaoOnline();
  const { error } = await cliente.functions.invoke('admin-users', {
    body: {
      acao: 'atualizar', id,
      dados: {
        ...campos,
        ...(campos.login ? { login: normalizarLogin(campos.login) } : {}),
        ...(novaSenha ? { senha: novaSenha } : {})
      }
    }
  });
  if (error) throw new Error(error.message);
  const sync = await import('./sync.js');
  await sync.baixarCadastroAgora();
  return (await db.obter('usuarios', id)) ?? atual;
}

/** Redefine a credencial diretamente no Supabase Auth. */
export async function redefinirSenha(id: string, novaSenha: string): Promise<Usuario> {
  if (novaSenha.length < SENHA_MINIMA) throw new Error(`A senha precisa ter ${SENHA_MINIMA} ou mais caracteres.`);
  return atualizarUsuario(id, {}, novaSenha);
}

async function exigirAdministracaoOnline() {
  if (!navigator.onLine) throw new Error('Para cadastrar ou alterar usuários é necessário estar conectado à internet.');
  const cliente = await obterCliente();
  if (!cliente) throw new Error('Configure o Supabase antes de alterar usuários.');
  if (!(await sessaoAutenticada())) throw new Error('Entre novamente com internet para alterar usuários.');
  return cliente;
}

type Resultado =
  | { ok: true; usuario: Usuario }
  | { ok: false; erro: string };

/** Novo login exige rede; a operação offline reutiliza a sessão já aberta. */
export async function entrar(login: string, senha: string): Promise<Resultado> {
  if (!navigator.onLine) {
    return { ok: false, erro: 'Conecte-se à internet para entrar. Depois, a bipagem continuará funcionando offline.' };
  }
  if (!(await estaConfigurado())) return { ok: false, erro: 'Configure o Supabase antes de entrar.' };
  const remoto = await entrarNoSupabase(login, senha);
  if (!remoto.ok) return remoto;
  const sync = await import('./sync.js');
  if (!(await sync.baixarCadastroAgora())) {
    await sairDoSupabase();
    return { ok: false, erro: 'Não foi possível baixar o perfil deste usuário.' };
  }
  const normalizado = normalizarLogin(login);
  const cadastrado = (await db.todos('usuarios')).find(
    (u) => u.authUserId === remoto.authUserId || u.login === normalizado
  );
  if (!cadastrado) {
    await sairDoSupabase();
    return { ok: false, erro: 'A conta autenticou, mas não possui perfil neste tenant.' };
  }
  if (!cadastrado.ativo) {
    await sairDoSupabase();
    return { ok: false, erro: 'Usuário inativo. Procure o gestor.' };
  }
  localStorage.setItem(CHAVE_SESSAO, cadastrado.id);
  return { ok: true, usuario: cadastrado };
}

export function sair(): void {
  localStorage.removeItem(CHAVE_SESSAO);
  void sairDoSupabase();
}

/** A sessão fica logada no aparelho: ninguém digita senha toda manhã. */
export async function usuarioLogado(): Promise<Usuario | null> {
  const id = localStorage.getItem(CHAVE_SESSAO);
  if (!id) return null;
  const u = await db.obter('usuarios', id);
  if (!u || !u.ativo) {
    sair();
    return null;
  }
  return u;
}

/**
 * O aparelho já conhece alguém?
 *
 * NÃO existe cadastro de exemplo. Pessoas, transportadoras e códigos de rota
 * vêm da base — o gestor cadastra uma vez, no painel, e o cadastro desce para
 * os aparelhos. Inventar um `gestor/gestor` local só criava conta de mentira em
 * todo celular, duplicava o cadastro no servidor e travava a fila de envio.
 *
 * Sem cadastro e sem rede, a tela de login diz isso em vez de recusar a senha:
 * o aparelho não tem contra o que conferir, e fingir "senha incorreta" manda a
 * pessoa procurar um erro que não existe.
 */
export async function temCadastro(): Promise<boolean> {
  return (await db.todos('usuarios')).length > 0;
}
