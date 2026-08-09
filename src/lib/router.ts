// router.ts — as rotas do app único.
//
// Duas metades, separadas de propósito: as funções de decisão são puras e não
// tocam em `window` (dá para testá-las em Node), e `criarRoteador` é a única
// coisa aqui que conhece History API.
//
// Rota desconhecida não vira 404. O app tem dono conhecido e sempre sabe para
// onde mandar a pessoa — a regra de entrada decide, como decidiria na abertura.
//
// Assume caminhos absolutos de raiz ('/painel', nunca 'painel' ou './painel').
// Não dá pra ligar `criarRoteador` enquanto `vite.config.ts` tiver `base: './'`
// — a troca para `base: '/'` é a Task 3.

export const SECOES = [
  'inicio', 'divergencias', 'incompletos', 'conferencias', 'ocorrencias',
  'desempenho', 'indicadores', 'mapa', 'relatorios', 'pessoas',
  'transportadoras', 'rotas', 'sincronizacao'
] as const;

export type Secao = (typeof SECOES)[number];

// Chama-se `Tela`, não `Rota`: `Rota` já é o conceito central do domínio
// (types.ts) — o código de expedição com dono e transportadora, com dezenas
// de referências pela frente. Dois `Rota` no mesmo app condenam todo import
// deste módulo a um alias manual (`Rota as RotaTela` ou parecido) só pra não
// colidir — o nome errado é dívida que os próximos 15 arquivos carregam.
export type Tela =
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
export function rotaDe(pathname: string): Tela | null {
  const p = limpar(pathname);
  if (p === '/entrar') return { tela: 'entrar' };
  if (p === '/bipagem') return { tela: 'bipagem' };
  if (p === '/relatorio') return { tela: 'relatorio' };
  if (p === '/painel') return { tela: 'painel', secao: 'inicio' };

  const m = /^\/painel\/([a-z]+)$/.exec(p);
  // `/painel/inicio` é aceito, mesmo sendo o mesmo lugar que `/painel`: um
  // caminho que ninguém reconhece sai do interceptador de clique e recarrega
  // o app inteiro — recarga silenciosa é pior do que aceitar e normalizar.
  // `caminhoDe` nunca PRODUZ `/painel/inicio` (só `/painel`), então `ir()` e a
  // normalização de abertura corrigem a barra sozinhas; não precisa de caso
  // especial aqui.
  if (m && ehSecao(m[1])) return { tela: 'painel', secao: m[1] };

  return null;
}

export function caminhoDe(t: Tela): string {
  switch (t.tela) {
    case 'painel':
      return t.secao === 'inicio' ? '/painel' : `/painel/${t.secao}`;
    case 'entrar':
    case 'bipagem':
    case 'relatorio':
      return `/${t.tela}`;
    default: {
      // Se o TypeScript reclamar desta linha, uma tela nova nasceu sem
      // caminho — o compilador barra aqui, antes de virar link que recarrega
      // a página inteira em produção.
      const exaustivo: never = t;
      throw new Error(`tela sem caminho: ${JSON.stringify(exaustivo)}`);
    }
  }
}

/**
 * Para onde a pessoa vai quando o app abre, nesta ordem.
 *
 * Conferência aberta ganha do papel: ninguém é tirado do meio de uma carga por
 * causa de como foi classificado no cadastro.
 */
export function destinoDeEntrada(s: Situacao): Tela {
  if (!s.logado) return { tela: 'entrar' };
  if (s.sessaoAberta) return { tela: 'bipagem' };
  if (s.gestor) return { tela: 'painel', secao: 'inicio' };
  return { tela: 'bipagem' };
}

/** A rota que o app deve mostrar para este caminho, considerando quem está logado. */
export function resolver(pathname: string, s: Situacao): Tela {
  const pedida = rotaDe(pathname);

  if (!s.logado) return { tela: 'entrar' };
  if (!pedida || pedida.tela === 'entrar') return destinoDeEntrada(s);
  // Erro não é beco sem saída: quem não tem painel tem bipagem.
  if (pedida.tela === 'painel' && !s.gestor) return { tela: 'bipagem' };

  return pedida;
}

export interface CliqueBruto {
  defaultPrevented: boolean;
  botao: number;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export interface LinkBruto {
  /** `a.href` — já absoluto pelo getter do DOM. */
  href: string;
  /** `a.target`. */
  alvo: string;
  temDownload: boolean;
  /** `a.getAttribute('href')` — o que está escrito no atributo, não resolvido. */
  hrefEscrito: string | null;
}

/**
 * A tela que este clique deve abrir sem recarga, ou `null` para deixar o
 * navegador agir (aba nova, download, link externo, âncora de rolagem...).
 *
 * A única lógica deste módulo cujo defeito não aparece como teste vermelho
 * nem como erro de tipo — aparece como "a página piscou" ou "o link não faz
 * nada". Por isso vive isolada e pura, em vez de dentro do listener.
 *
 * `atual` é o `location.pathname` no momento do clique. Só com ele dá pra
 * reconhecer "link de âncora dentro da própria tela" (`/painel/rotas#topo`
 * clicado a partir de `/painel/rotas`): esse caso tem que rolar, não navegar.
 */
export function telaDoClique(c: CliqueBruto, l: LinkBruto, origem: string, atual: string): Tela | null {
  if (c.defaultPrevented || c.botao !== 0) return null;
  // Alt/Option+clique é "salvar link como" no Chrome e no Firefox — interceptar
  // rouba um download legítimo, do mesmo jeito que meta/ctrl/shift roubariam
  // uma aba ou janela nova.
  if (c.meta || c.ctrl || c.shift || c.alt) return null;
  // Alvo vazio ou "_self" é navegação normal na mesma aba. Qualquer outro
  // (_blank, _top, _parent, janela nomeada) o app não controla.
  if (l.alvo && l.alvo !== '_self') return null;
  if (l.temDownload) return null;
  // Âncora pura ("#topo", sem caminho): não troca de tela, só rola.
  if (l.hrefEscrito?.startsWith('#')) return null;
  // <a> sem atributo href (gancho de clique puro — botão de fechar modal, por
  // exemplo) tem `a.href === ''` no DOM: não é hyperlink de verdade, e
  // `new URL('')` sem base lançaria em vez de devolver null.
  if (!l.href) return null;

  const url = new URL(l.href);
  // Cobre link externo e também mailto:/tel:/javascript:, que o navegador
  // resolve com origem opaca ("null") — nunca igual à origem do app.
  if (url.origin !== origem) return null;

  const destino = rotaDe(url.pathname);
  if (!destino) return null;

  // Âncora NUMA rota ("/painel/rotas#topo"): se o caminho resolve pra tela
  // que já está na barra, é rolagem dentro da própria página, não navegação.
  // Sem este caso, o clique é interceptado, `preventDefault` mata a rolagem,
  // e o link "não faz nada" — em seção longa do painel isso é o efeito mais
  // comum, não a exceção.
  if (url.hash) {
    const ondeEstou = rotaDe(atual);
    if (ondeEstou && caminhoDe(ondeEstou) === caminhoDe(destino)) return null;
  }

  return destino;
}

export interface Roteador {
  /**
   * Navega sem recarregar. `substituir` troca a entrada atual do histórico.
   *
   * `sufixo` é a query e a âncora que acompanham ESTE destino (`?de=...#topo`),
   * normalmente vindas do próprio link clicado. Sem ele, a URL nova sai limpa —
   * que é o certo: filtro é de uma seção só.
   */
  ir: (t: Tela, substituir?: boolean, sufixo?: string) => void;
  atual: () => Tela;
  /** Remove os listeners. Sem isto, recriar o roteador (o HMR do Vite faz isso em dev) empilha handler a cada troca de arquivo. */
  destruir: () => void;
}

/**
 * Liga as funções acima ao navegador.
 *
 * `aoNavegar` é chamado uma vez na criação, com a rota inicial já resolvida —
 * o boot não precisa repetir a decisão.
 */
export function criarRoteador(
  situacao: () => Situacao,
  aoNavegar: (t: Tela) => void
): Roteador {
  const controlador = new AbortController();
  const { signal } = controlador;

  const atual = (): Tela => resolver(location.pathname, situacao());

  // Mantém a query e a âncora que JÁ estão na barra, trocando só o caminho.
  //
  // Serve para os dois casos em que a URL é corrigida sem ninguém ter pedido
  // outra tela: a normalização de abertura e a reconciliação do `popstate`.
  // Nos dois, a query é daquela mesma entrada do histórico — preservá-la é o
  // que faz um filtro colado de um e-mail sobreviver ao boot (CLAUDE.md §9).
  //
  // NÃO serve para `ir()`. Lá o caminho está mudando de tela, e a query da tela
  // velha não tem nada que fazer na nova: sair de
  // `/painel/conferencias?de=2026-08-01` para Pessoas produziria
  // `/painel/pessoas?de=2026-08-01`, com o filtro de uma seção grudado na outra.
  const comBuscaAtual = (caminho: string): string => caminho + location.search + location.hash;

  const ir = (t: Tela, substituir = false, sufixo = ''): void => {
    const destino = resolver(caminhoDe(t), situacao());
    const url = caminhoDe(destino) + sufixo;
    if (url !== location.pathname + location.search + location.hash) {
      // `history.state` é preservado no replace: é lá que mora `pretendido`, e
      // o `ir(..., true)` do pós-login não pode apagá-lo antes de alguém ler.
      if (substituir) history.replaceState(history.state, '', url);
      else history.pushState(null, '', url);
    }
    aoNavegar(destino);
  };

  window.addEventListener('popstate', () => {
    const t = atual();
    const caminho = caminhoDe(t);
    // A barra pode ter ficado pra trás do estado real — ex.: gestor em
    // /painel/rotas sai, o app empilha /entrar, a pessoa aperta Voltar: a URL
    // volta a /painel/rotas mas quem não está mais logado resolve pra
    // /entrar. Sem corrigir aqui, o endereço mostrado mente até um F5.
    if (caminho !== location.pathname) history.replaceState(history.state, '', comBuscaAtual(caminho));
    aoNavegar(t);
  }, { signal });

  // Link interno navega sem recarga. Sem isto, todo <a href="/painel/rotas">
  // recarregaria o app inteiro — que é exatamente o que este plano existe para
  // acabar. Fase de captura, não de bubble: um stopPropagation numa gaveta ou
  // modal futuro não pode devolver o clique pro navegador sem o app saber.
  document.addEventListener('click', (ev) => {
    const a = (ev.target as HTMLElement | null)?.closest?.('a');
    if (!a) return;

    const destino = telaDoClique(
      { defaultPrevented: ev.defaultPrevented, botao: ev.button, meta: ev.metaKey, ctrl: ev.ctrlKey, shift: ev.shiftKey, alt: ev.altKey },
      { href: a.href, alvo: a.target, temDownload: a.hasAttribute('download'), hrefEscrito: a.getAttribute('href') },
      location.origin,
      location.pathname
    );
    if (!destino) return;

    ev.preventDefault();
    // A query e a âncora vêm do link clicado, não da barra: `/painel/rotas#form`
    // tem que chegar em `#form`, e não herdar a âncora da tela de onde saiu.
    const alvo = new URL(a.href, location.origin);
    ir(destino, false, alvo.search + alvo.hash);
  }, { capture: true, signal });

  // Normaliza a URL de abertura: quem entrou por `/` sai com `/painel` na
  // barra, sem perder query nem âncora — filtro que veio na URL sobrevive ao
  // boot. `pretendido` grava o caminho cru que a pessoa pediu de verdade;
  // ninguém lê isso ainda — é só pra não fechar a porta pra um deep link
  // pós-login numa task futura, não pra abri-la agora.
  const inicial = atual();
  history.replaceState({ pretendido: limpar(location.pathname) }, '', comBuscaAtual(caminhoDe(inicial)));
  aoNavegar(inicial);

  return { ir, atual, destruir: () => controlador.abort() };
}
