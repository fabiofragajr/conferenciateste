// main.ts — a entrada única do LOGDIS.
//
// Faz três coisas e só três: prepara o que toda tela precisa (cadastro local e
// sincronização), cuida do login — que agora é um só no sistema inteiro — e
// entrega a navegação ao roteador.
//
// As telas são importadas sob demanda: quem abre para bipar não paga o download
// do painel, e o painel não instancia a câmera.

import '../styles/base.css';
import '../styles/app.css';
import '../styles/painel.css';
import '../styles/relatorio.css';

import type { Usuario } from '../types.js';
import * as db from '../lib/db.js';
import * as auth from '../lib/auth.js';
import * as sync from '../lib/sync.js';
import * as fb from '../lib/feedback.js';
import { $ } from '../lib/util.js';
import {
  criarRoteador, destinoDeEntrada, type Roteador, type Situacao, type Tela
} from '../lib/router.js';
import type { Ambiente } from './ambiente.js';

// Atalho antigo salvo na tela do celular da doca: o app reconhece o caminho por
// conta própria, sem depender do redirect do servidor. `vite preview` não aplica
// o vercel.json, e o aparelho da operação não vai ser reconfigurado.
//
// Roda antes de tudo: `criarRoteador` lê `location.pathname` na criação.
const ANTIGOS: Record<string, string> = {
  '/gestor.html': '/painel',
  '/diretor.html': '/painel/indicadores',
  '/index.html': '/'
};
const antigo = ANTIGOS[location.pathname];
if (antigo) history.replaceState(null, '', antigo + location.search + location.hash);

let usuario: Usuario | null = null;
let sessaoAberta = false;
let roteador: Roteador | null = null;

const regiao = {
  login: $('#view-login'),
  operacao: $('#tela-operacao'),
  painel: $('#tela-painel')
};

const elLogin = {
  form: $<HTMLFormElement>('#form-login'),
  login: $<HTMLInputElement>('#in-login'),
  senha: $<HTMLInputElement>('#in-senha'),
  erro: $('#login-erro'),
  dica: $('#dica-seed')
};

const situacao = (): Situacao => ({
  logado: !!usuario,
  gestor: !!usuario?.gestor,
  sessaoAberta
});

const ambiente = (): Ambiente => ({
  usuario: usuario as Usuario,
  irPara: (t) => roteador?.ir(t),
  sair: () => {
    auth.sair();
    usuario = null;
    sessaoAberta = false;
    // Chamada de roteador, não `location.reload()` torcendo para o boot da
    // outra página decidir certo — era daí que vinha o "não desloga".
    roteador?.ir({ tela: 'entrar' }, true);
  }
});

/** Conferência ABERTA deste usuário neste aparelho? Decide a tela de entrada. */
async function conferirSessaoAberta(): Promise<void> {
  sessaoAberta = usuario
    ? (await db.porIndice('sessoes', 'usuarioId', usuario.id)).some((s) => s.status === 'ABERTA')
    : false;
}

async function mostrar(t: Tela): Promise<void> {
  regiao.login.hidden = t.tela !== 'entrar';
  regiao.operacao.hidden = !(t.tela === 'bipagem' || t.tela === 'relatorio');
  regiao.painel.hidden = t.tela !== 'painel';
  // A classe do <body> troca a escala tipográfica: o painel encolhe no celular,
  // a bipagem nunca — ela é lida a um braço de distância, com luva.
  document.body.classList.toggle('painel', t.tela === 'painel');
  document.body.classList.toggle('operacao', t.tela !== 'painel');

  if (t.tela === 'entrar') {
    elLogin.login.focus();
    return;
  }

  if (t.tela === 'painel') {
    const painel = await import('./gestor.js');
    await painel.montar(ambiente());
    const indicadores = await import('./diretor.js');
    await indicadores.montar();
    painel.mostrarSecao(t.secao);
    return;
  }

  const operacao = await import('./operador.js');
  await operacao.montar(ambiente());
}

elLogin.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  fb.prepararAudio(); // gesto do usuário: é aqui que o som fica liberado
  elLogin.erro.hidden = true;
  await pronto;

  const r = await auth.entrar(elLogin.login.value, elLogin.senha.value);
  if (!r.ok) {
    elLogin.erro.textContent = r.erro;
    elLogin.erro.hidden = false;
    return;
  }
  usuario = r.usuario;
  elLogin.dica.hidden = true;
  elLogin.senha.value = '';
  await conferirSessaoAberta();
  // `true` substitui a entrada do histórico: voltar depois de entrar não pode
  // devolver o formulário de login de quem já está dentro.
  roteador?.ir(destinoDeEntrada(situacao()), true);
});

async function boot(): Promise<void> {
  // Cache vazio não é bloqueio de login. Online, a pessoa apenas entra e o
  // perfil desce automaticamente depois do Supabase Auth. Offline, explicamos
  // por que um primeiro acesso ainda não é possível.
  if (!(await sync.garantirCadastroLocal())) {
    elLogin.dica.hidden = false;
    elLogin.dica.textContent = navigator.onLine
      ? 'Entre normalmente. Seu cadastro será carregado automaticamente.'
      : 'Primeiro acesso neste navegador: conecte-se à internet para entrar.';
  }

  sync.iniciarAuto();
  usuario = await auth.usuarioLogado();
  await conferirSessaoAberta();

  roteador = criarRoteador(situacao, (t) => void mostrar(t));
}

// O boot demora (cadastro, IndexedDB, rede). Guardar a promessa deixa o login
// esperar por ele em vez de disputar a tela.
const pronto = boot().catch((e: unknown) => {
  console.error('boot', e);
});
