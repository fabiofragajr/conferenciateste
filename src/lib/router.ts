// router.ts — as rotas do app único.
//
// Duas metades, separadas de propósito: as funções de decisão são puras e não
// tocam em `window` (dá para testá-las em Node), e `criarRoteador` é a única
// coisa aqui que conhece History API.
//
// Rota desconhecida não vira 404. O app tem dono conhecido e sempre sabe para
// onde mandar a pessoa — a regra de entrada decide, como decidiria na abertura.

export const SECOES = [
  'inicio', 'divergencias', 'incompletos', 'conferencias', 'ocorrencias',
  'desempenho', 'indicadores', 'mapa', 'relatorios', 'pessoas',
  'transportadoras', 'rotas', 'sincronizacao'
] as const;

export type Secao = (typeof SECOES)[number];

export type Rota =
  | { tela: 'entrar' }
  | { tela: 'bipagem' }
  | { tela: 'relatorio' }
  | { tela: 'painel'; secao: Secao };

export interface Situacao {
  logado: boolean;
  gestor: boolean;
  /** Sessão de conferência ABERTA neste aparelho. */
  sessaoAberta: boolean;
}

const ehSecao = (v: string): v is Secao => (SECOES as readonly string[]).includes(v);

/** Normaliza barra dobrada e barra final: `/painel//rotas/` e `/painel/rotas` são a mesma rota. */
const limpar = (pathname: string): string => {
  const p = `/${pathname}`.replace(/\/+/g, '/').replace(/\/+$/, '');
  return p === '' ? '/' : p;
};

/** Devolve `null` para caminho que o app não conhece — quem decide é `resolver`. */
export function rotaDe(pathname: string): Rota | null {
  const p = limpar(pathname);
  if (p === '/entrar') return { tela: 'entrar' };
  if (p === '/bipagem') return { tela: 'bipagem' };
  if (p === '/relatorio') return { tela: 'relatorio' };
  if (p === '/painel') return { tela: 'painel', secao: 'inicio' };

  const m = /^\/painel\/([a-z]+)$/.exec(p);
  // `inicio` fica de fora: ele É `/painel`. Duas URLs para a mesma tela fazem o
  // item ativo do menu piscar entre elas.
  if (m && m[1] !== 'inicio' && ehSecao(m[1])) return { tela: 'painel', secao: m[1] };

  return null;
}

export function caminhoDe(r: Rota): string {
  if (r.tela === 'painel') return r.secao === 'inicio' ? '/painel' : `/painel/${r.secao}`;
  return `/${r.tela}`;
}

/**
 * Para onde a pessoa vai quando o app abre, nesta ordem.
 *
 * Conferência aberta ganha do papel: ninguém é tirado do meio de uma carga por
 * causa de como foi classificado no cadastro.
 */
export function destinoDeEntrada(s: Situacao): Rota {
  if (!s.logado) return { tela: 'entrar' };
  if (s.sessaoAberta) return { tela: 'bipagem' };
  if (s.gestor) return { tela: 'painel', secao: 'inicio' };
  return { tela: 'bipagem' };
}

/** A rota que o app deve mostrar para este caminho, considerando quem está logado. */
export function resolver(pathname: string, s: Situacao): Rota {
  const pedida = rotaDe(pathname);

  if (!s.logado) return { tela: 'entrar' };
  if (!pedida || pedida.tela === 'entrar') return destinoDeEntrada(s);
  // Erro não é beco sem saída: quem não tem painel tem bipagem.
  if (pedida.tela === 'painel' && !s.gestor) return { tela: 'bipagem' };

  return pedida;
}

export interface Roteador {
  /** Navega sem recarregar. `substituir` troca a entrada atual do histórico. */
  ir: (r: Rota, substituir?: boolean) => void;
  atual: () => Rota;
}

/**
 * Liga as funções acima ao navegador.
 *
 * `aoNavegar` é chamado uma vez na criação, com a rota inicial já resolvida —
 * o boot não precisa repetir a decisão.
 */
export function criarRoteador(
  situacao: () => Situacao,
  aoNavegar: (r: Rota) => void
): Roteador {
  const atual = (): Rota => resolver(location.pathname, situacao());

  const ir = (r: Rota, substituir = false): void => {
    const destino = resolver(caminhoDe(r), situacao());
    const url = caminhoDe(destino);
    if (url !== location.pathname) {
      if (substituir) history.replaceState(null, '', url);
      else history.pushState(null, '', url);
    }
    aoNavegar(destino);
  };

  window.addEventListener('popstate', () => aoNavegar(atual()));

  // Link interno navega sem recarga. Sem isto, todo <a href="/painel/rotas">
  // recarregaria o app inteiro — que é exatamente o que este plano existe para
  // acabar.
  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    const a = (ev.target as HTMLElement | null)?.closest?.('a');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    if (a.getAttribute('href')?.startsWith('#')) return;
    if (new URL(a.href, location.origin).origin !== location.origin) return;

    const r = rotaDe(new URL(a.href, location.origin).pathname);
    if (!r) return;
    ev.preventDefault();
    ir(r);
  });

  // Normaliza a URL de abertura: quem entrou por `/` sai com `/painel` na barra.
  const inicial = atual();
  history.replaceState(null, '', caminhoDe(inicial));
  aoNavegar(inicial);

  return { ir, atual };
}
