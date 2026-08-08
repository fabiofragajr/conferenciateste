// auth.ts — login local. Sem OAuth e sem backend: no galpão o app precisa
// abrir e logar mesmo sem rede nenhuma.
//
// Quem está logado é quem bipa, e é isso que fica gravado na leitura.
// `funcao` é texto descritivo para o relatório — nunca libera nem bloqueia nada.
// A única regra de acesso do sistema é `gestor: true` (abre os painéis).

import type { Usuario } from '../types.js';
import * as db from './db.js';
import { novoSync } from './db.js';

const CHAVE_SESSAO = 'logdis.usuarioLogado';

/**
 * O hash viaja junto com o cadastro, então precisa custar caro para quebrar.
 * PBKDF2 com iteração alta é o que o WebCrypto oferece sem dependência externa.
 */
const ITERACOES = 210_000;

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

async function pbkdf2(salt: string, senha: string, iteracoes: number): Promise<string | null> {
  if (!crypto?.subtle) return null;
  try {
    const material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: iteracoes, hash: 'SHA-256' },
      material, 256
    );
    return paraHex(bits);
  } catch {
    return null;
  }
}

/** Formato legado (v1): SHA-256 simples de `salt:senha`. Só para conferir. */
async function digerirLegado(salt: string, senha: string): Promise<string> {
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

function novoSalt(): string {
  if (crypto?.randomUUID) return crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

export async function gerarSenhaHash(senha: string): Promise<string> {
  const salt = novoSalt();
  const derivado = await pbkdf2(salt, senha, ITERACOES);
  if (derivado) return `${salt}$pbkdf2$${ITERACOES}$${derivado}`;
  return `${salt}$simples$${hashSimples(`${salt}:${senha}`)}`;
}

/**
 * Confere nos três formatos já emitidos. O legado continua valendo para não
 * trancar ninguém para fora num aparelho que já tinha senha gravada.
 */
export async function conferirSenha(senha: string, senhaHash: string): Promise<boolean> {
  const partes = String(senhaHash ?? '').split('$');

  if (partes.length === 4 && partes[1] === 'pbkdf2') {
    const iteracoes = Number(partes[2]);
    if (!Number.isFinite(iteracoes) || iteracoes <= 0) return false;
    return (await pbkdf2(partes[0], senha, iteracoes)) === partes[3];
  }
  if (partes.length === 3 && partes[1] === 'simples') {
    return hashSimples(`${partes[0]}:${senha}`) === partes[2];
  }
  if (partes.length === 2 && partes[0] && partes[1]) {
    return (await digerirLegado(partes[0], senha)) === partes[1];
  }
  return false;
}

const formatoLegado = (senhaHash: string): boolean => String(senhaHash ?? '').split('$').length === 2;

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

/**
 * Cadastro mínimo para alguém começar a bipar hoje: nome e login.
 *
 * A senha é opcional de propósito. O gestor cadastra o ajudante que entrou hoje
 * sem precisar inventar senha por ele: quem entra sem senha define a dela na
 * primeira entrada, no próprio aparelho.
 */
export async function criarUsuario(dados: DadosUsuario): Promise<Usuario> {
  if (!dados.nome?.trim()) throw new Error('Informe o nome.');
  if (!dados.login?.trim()) throw new Error('Informe o login.');
  if (dados.senha && dados.senha.length < SENHA_MINIMA) {
    throw new Error(`A senha precisa ter ${SENHA_MINIMA} ou mais caracteres.`);
  }
  if (await buscarPorLogin(dados.login)) throw new Error('Já existe um usuário com este login.');

  const usuario: Usuario = {
    ...novoSync(),
    nome: dados.nome.trim(),
    login: normalizarLogin(dados.login),
    senhaHash: dados.senha ? await gerarSenhaHash(dados.senha) : '',
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
  if (novaSenha && novaSenha.length < SENHA_MINIMA) {
    throw new Error(`A senha precisa ter ${SENHA_MINIMA} ou mais caracteres.`);
  }

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

/**
 * Libera o login para a pessoa escolher outra senha na próxima entrada.
 * É o caminho do "esqueci a senha": o gestor não precisa inventar uma senha
 * nova nem descobrir a antiga, e ninguém fica parado na doca esperando.
 */
export async function redefinirSenha(id: string): Promise<Usuario> {
  const atual = await db.obter('usuarios', id);
  if (!atual) throw new Error('Usuário não encontrado.');
  const novo: Usuario = { ...atual, senhaHash: '' };
  await db.salvar('usuarios', novo);
  return novo;
}

type Resultado =
  | { ok: true; usuario: Usuario; primeiroAcesso?: boolean }
  | { ok: false; erro: string };

/**
 * Entra, e se não der, busca o cadastro e tenta uma segunda vez.
 *
 * A mesma pessoa usa mais de um aparelho, e a senha vive no cadastro: ela pode
 * ter sido definida no celular e estar sendo usada no desktop, ou trocada pelo
 * gestor cinco minutos atrás. O aparelho que ainda não sincronizou recusaria a
 * senha certa e mandaria a pessoa procurar um erro que não existe.
 *
 * A segunda tentativa só acontece quando a primeira falha — o caminho normal
 * continua sem tocar na rede, que é o que faz o login funcionar no galpão sem
 * sinal.
 */
export async function entrar(login: string, senha: string): Promise<Resultado> {
  const primeira = await tentarEntrar(login, senha);
  if (primeira.ok) return primeira;

  // Inativo é decisão do gestor, não desencontro de cadastro: não insiste.
  if (primeira.erro.startsWith('Usuário inativo')) return primeira;

  const sync = await import('./sync.js');
  if (!(await sync.baixarCadastroAgora())) return primeira;

  return tentarEntrar(login, senha);
}

async function tentarEntrar(login: string, senha: string): Promise<Resultado> {
  const u = await buscarPorLogin(login);
  if (!u) return { ok: false, erro: 'Login ou senha incorretos.' };
  if (!u.ativo) return { ok: false, erro: 'Usuário inativo. Procure o gestor.' };

  // Cadastrado pelo gestor sem senha, ou senha redefinida por ele: a primeira
  // senha digitada passa a ser a senha da pessoa, e sobe junto com o cadastro.
  if (!u.senhaHash) {
    if (senha.length < SENHA_MINIMA) {
      return {
        ok: false,
        erro: `Primeiro acesso: escolha uma senha com ${SENHA_MINIMA} ou mais caracteres.`
      };
    }
    const comSenha = { ...u, senhaHash: await gerarSenhaHash(senha) };
    await db.salvar('usuarios', comSenha);
    localStorage.setItem(CHAVE_SESSAO, u.id);
    return { ok: true, usuario: comSenha, primeiroAcesso: true };
  }

  if (!(await conferirSenha(senha, u.senhaHash))) return { ok: false, erro: 'Login ou senha incorretos.' };

  // Senha certa num hash do formato antigo: regrava no formato forte agora que
  // o hash acompanha o cadastro. A pessoa não percebe nada.
  let usuario = u;
  if (formatoLegado(u.senhaHash)) {
    usuario = { ...u, senhaHash: await gerarSenhaHash(senha) };
    await db.salvar('usuarios', usuario);
  }

  localStorage.setItem(CHAVE_SESSAO, usuario.id);
  return { ok: true, usuario };
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
