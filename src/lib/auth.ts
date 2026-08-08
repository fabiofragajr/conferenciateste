// auth.ts — login local. Sem OAuth e sem backend: no galpão o app precisa
// abrir e logar mesmo sem rede nenhuma.
//
// Quem está logado é quem bipa, e é isso que fica gravado na leitura.
// `funcao` é texto descritivo para o relatório — nunca libera nem bloqueia nada.
// A única regra de acesso do sistema é `gestor: true` (abre os painéis).

import type { Rota, Transportadora, Usuario } from '../types.js';
import * as db from './db.js';
import { novoSync } from './db.js';

const CHAVE_SESSAO = 'logdis.usuarioLogado';

const paraHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

/** Fallback para contexto não seguro (dev em http puro). Produção é HTTPS + WebCrypto. */
function hashSimples(txt: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < txt.length; i++) {
    h1 = Math.imul(h1 ^ txt.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + txt.charCodeAt(i) + 7, 2246822519) >>> 0;
  }
  return `f${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

async function digerir(salt: string, senha: string): Promise<string> {
  const txt = `${salt}:${senha}`;
  if (crypto?.subtle) {
    try {
      return paraHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)));
    } catch {
      /* cai no fallback */
    }
  }
  return hashSimples(txt);
}

export async function gerarSenhaHash(senha: string): Promise<string> {
  const salt = crypto.randomUUID().slice(0, 8);
  return `${salt}$${await digerir(salt, senha)}`;
}

export async function conferirSenha(senha: string, senhaHash: string): Promise<boolean> {
  const [salt, esperado] = String(senhaHash ?? '').split('$');
  if (!salt || !esperado) return false;
  return (await digerir(salt, senha)) === esperado;
}

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

/** Cadastro mínimo para alguém começar a bipar hoje: nome, login e senha. */
export async function criarUsuario(dados: DadosUsuario): Promise<Usuario> {
  if (!dados.nome?.trim()) throw new Error('Informe o nome.');
  if (!dados.login?.trim()) throw new Error('Informe o login.');
  if (!dados.senha) throw new Error('Informe a senha.');
  if (await buscarPorLogin(dados.login)) throw new Error('Já existe um usuário com este login.');

  const usuario: Usuario = {
    ...novoSync(),
    nome: dados.nome.trim(),
    login: normalizarLogin(dados.login),
    senhaHash: await gerarSenhaHash(dados.senha),
    gestor: dados.gestor === true,
    funcao: (dados.funcao ?? '').trim(),
    telefone: (dados.telefone ?? '').trim(),
    placa: (dados.placa ?? '').trim().toUpperCase(),
    ativo: dados.ativo !== false
  };
  await db.salvar('usuarios', usuario);
  return usuario;
}

export async function atualizarUsuario(
  id: string,
  campos: Partial<DadosUsuario>,
  novaSenha?: string
): Promise<Usuario> {
  const atual = await db.obter('usuarios', id);
  if (!atual) throw new Error('Usuário não encontrado.');

  let login = atual.login;
  if (campos.login && normalizarLogin(campos.login) !== atual.login) {
    if (await buscarPorLogin(campos.login)) throw new Error('Já existe um usuário com este login.');
    login = normalizarLogin(campos.login);
  }

  const novo: Usuario = {
    ...atual,
    nome: campos.nome?.trim() ?? atual.nome,
    login,
    gestor: campos.gestor ?? atual.gestor,
    funcao: campos.funcao?.trim() ?? atual.funcao,
    telefone: campos.telefone?.trim() ?? atual.telefone,
    placa: campos.placa?.trim().toUpperCase() ?? atual.placa,
    ativo: campos.ativo ?? atual.ativo,
    senhaHash: novaSenha ? await gerarSenhaHash(novaSenha) : atual.senhaHash
  };
  await db.salvar('usuarios', novo);
  return novo;
}

export async function entrar(
  login: string,
  senha: string
): Promise<{ ok: true; usuario: Usuario; primeiroAcesso?: boolean } | { ok: false; erro: string }> {
  const u = await buscarPorLogin(login);
  if (!u) return { ok: false, erro: 'Login ou senha incorretos.' };
  if (!u.ativo) return { ok: false, erro: 'Usuário inativo. Procure o gestor.' };

  // Usuário que desceu do servidor chega sem senha: o hash nunca trafega.
  // A primeira senha digitada neste aparelho passa a ser a senha dele aqui.
  if (!u.senhaHash) {
    if (senha.length < 4) {
      return { ok: false, erro: 'Primeiro acesso neste aparelho: escolha uma senha com 4 ou mais caracteres.' };
    }
    const comSenha = { ...u, senhaHash: await gerarSenhaHash(senha) };
    await db.salvar('usuarios', comSenha);
    localStorage.setItem(CHAVE_SESSAO, u.id);
    return { ok: true, usuario: comSenha, primeiroAcesso: true };
  }

  if (!(await conferirSenha(senha, u.senhaHash))) return { ok: false, erro: 'Login ou senha incorretos.' };
  localStorage.setItem(CHAVE_SESSAO, u.id);
  return { ok: true, usuario: u };
}

export function sair(): void {
  localStorage.removeItem(CHAVE_SESSAO);
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
 * Provisionamento local. Cada bloco é marcado com a própria chave, então um
 * bloco novo também roda nos aparelhos que já abriram o app antes dele existir
 * — o seed antigo, com chave única, nunca mais rodava depois da primeira vez.
 *
 * O flag é gravado mesmo quando o bloco não cria nada: quem apagou o usuário
 * de propósito não vai vê-lo voltar no próximo boot.
 */
async function umaVez(chave: string, passo: () => Promise<void>): Promise<boolean> {
  if (await db.configGet(chave, false)) return false;
  await passo();
  await db.configSet(chave, true);
  return true;
}

/** Primeira execução: cria o gestor padrão e grupos de exemplo. */
export async function garantirSeed(): Promise<{ criou: boolean }> {
  const criou = await umaVez('seed.v1', async () => {
    const usuarios = await db.todos('usuarios');
    if (usuarios.length === 0) {
      await criarUsuario({
        nome: 'Gestor de Transporte', login: 'gestor', senha: 'gestor',
        gestor: true, funcao: 'Gestor de transporte'
      });
      await criarUsuario({
        nome: 'Operador', login: 'operador', senha: 'operador',
        gestor: false, funcao: 'Conferente'
      });
    }

    // Uma transportadora de exemplo com as duas rotas conhecidas, para o app
    // não abrir num beco sem saída antes do primeiro cadastro do gestor.
    const transportadoras = await db.todos('transportadoras');
    if (transportadoras.length === 0) {
      const transportadora: Transportadora = {
        ...novoSync(),
        nome: 'LOGDIS',
        cnpj: '',
        responsavel: '',
        telefone: '',
        email: '',
        ativo: true
      };
      await db.salvar('transportadoras', transportadora);

      const rota = (codigo: string, nome: string): Rota => ({
        ...novoSync(),
        codigo,
        nome,
        transportadoraId: transportadora.id,
        descricao: '',
        ativo: true
      });
      await db.salvarVarios('rotas', [rota('FNOR', 'Carga Norte'), rota('FSUL', 'Carga Sul')]);
    }
  });

  // Gestor nominal da operação. A senha aqui é a de primeiro acesso: ela fica
  // em texto no repositório, então precisa ser trocada no painel.
  await umaVez('seed.gestor-sandro', async () => {
    if (await buscarPorLogin('sandro')) return;
    await criarUsuario({
      nome: 'Sandro', login: 'sandro', senha: 'Lodis@123',
      gestor: true, funcao: 'Gestor de transporte'
    });
  });

  return { criou };
}
