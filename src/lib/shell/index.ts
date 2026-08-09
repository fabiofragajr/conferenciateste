// index.ts — a moldura do painel.
//
// Não conhece regra de negócio e não toca no IndexedDB. Recebe os itens do
// menu, diz qual seção está visível e avisa quem precisa repintar.
//
// A regra que o menu põe em risco: com seções, a divergência do dia passaria a
// viver atrás de um item. Duas travas contra isso — badge no item, visível de
// qualquer seção, e faixa fixa acima do conteúdo de todas elas. A faixa se cala
// só onde ela seria redundante com o conteúdo logo abaixo.
//
// Recolher grupos abriu um terceiro buraco na mesma regra, e ele tem cara de
// detalhe: com "Operação" fechada, o item Divergências fica `hidden` e o badge
// vai junto — o alarme do dia sumiria da tela sem ninguém ter pedido. Por isso
// `definirBadge` guarda as contagens e as REPINTA nos dois lugares: no item e,
// somadas, no cabeçalho do grupo fechado. É por isso que ele deixou de ser um
// `for` de uma linha.

import { $$, esc } from '../util.js';
import { montarTopo, definirTrilha, type ModoShell } from './topo.js';
import { montarLateral, gruposDe, grupoDaSecao, type ItemMenu } from './lateral.js';
import { montarBarra, itensDaFolha, htmlDaFolha } from './barra-inferior.js';
import { criarFolha } from '../ui/folha.js';
import * as grupos from './grupos.js';

export type { ItemMenu, ModoShell };

export interface OpcoesShell {
  modo: ModoShell;
  itens: ItemMenu[];
  usuario: string;
  /** Onde as `[data-secao]` vivem. */
  raiz: HTMLElement;
}

export interface OpcoesAlerta {
  /**
   * Seção onde a faixa é redundante: ela se cala enquanto essa seção estiver
   * visível. A faixa existe para quem está LONGE do alarme — dentro da seção
   * que já mostra o problema inteiro, o aviso repetido só ensina a ignorá-lo.
   */
  redundanteEm?: string;
}

export interface Shell {
  mostrar(secao: string): void;
  secaoAtual(): string;
  aoTrocarSecao(fn: (id: string) => void): void;
  definirBadge(id: string, n: number): void;
  definirAlerta(html: string | null, op?: OpcoesAlerta): void;
  topo: HTMLElement;
}

export function montarShell(op: OpcoesShell): Shell {
  const ouvintes: ((id: string) => void)[] = [];
  const topo = montarTopo(op.modo);
  document.body.prepend(topo);

  /** Contagem por item. A fonte para repintar item e cabeçalho de grupo. */
  const contagens = new Map<string, number>();
  let fechados = op.modo === 'painel' ? grupos.carregar() : new Set<string>();
  let folha: ReturnType<typeof criarFolha> | null = null;

  const pintarBadges = (): void => {
    for (const b of $$<HTMLElement>('[data-badge]')) {
      const n = contagens.get(b.dataset.badge ?? '') ?? 0;
      b.textContent = String(n);
      b.hidden = n <= 0;
    }
    // O cabeçalho só mostra número quando o grupo está fechado: com o grupo
    // aberto o badge do item já está à vista, e o mesmo número duas vezes na
    // mesma coluna lê como dois problemas diferentes.
    for (const b of $$<HTMLElement>('[data-badge-grupo]')) {
      const g = b.dataset.badgeGrupo ?? '';
      const soma = op.itens
        .filter((i) => i.grupo === g)
        .reduce((t, i) => t + (contagens.get(i.id) ?? 0), 0);
      b.textContent = String(soma);
      b.hidden = soma <= 0 || grupos.estaAberto(fechados, g);
    }
  };

  /** Espelha o estado recolhido no DOM das DUAS árvores (coluna e folha). */
  const pintarGrupos = (): void => {
    for (const g of gruposDe(op.itens)) {
      const aberto = grupos.estaAberto(fechados, g);
      for (const cab of $$<HTMLElement>(`[data-grupo-cab="${CSS.escape(g)}"]`)) {
        cab.setAttribute('aria-expanded', String(aberto));
        const lista = cab.parentElement?.querySelector<HTMLElement>('.p-grupo-itens');
        if (lista) lista.hidden = !aberto;
      }
    }
    pintarBadges();
  };

  if (op.modo === 'painel') {
    document.body.prepend(montarLateral(op.itens, op.usuario, fechados));

    const barra = montarBarra(op.itens);
    document.body.append(barra);

    folha = criarFolha('Mais seções');
    // `esc` porque o nome vem do cadastro, e cadastro aceita qualquer coisa.
    const rodape = `<div class="p-lateral-rodape">
      <span class="p-usuario">${esc(op.usuario)}</span>
      <a class="btn btn-secundario" href="/bipagem">Abrir bipagem</a>
      <button class="btn btn-fantasma" data-sair type="button">Sair</button>
    </div>`;
    barra.querySelector('[data-aba="mais"]')?.addEventListener('click', () => {
      folha?.abrir(htmlDaFolha(itensDaFolha(op.itens), fechados) + rodape);
      // A folha nasce com HTML novo a cada abertura: o badge precisa ser
      // repintado nela, senão a contagem só existe na coluna do desktop.
      pintarBadges();
    });

    // Delegação no documento, e não um listener por cabeçalho: a árvore da
    // folha é remontada a cada abertura, e listener preso ao elemento morre
    // junto com o HTML anterior.
    document.addEventListener('click', (ev) => {
      const cab = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-grupo-cab]');
      if (!cab) return;
      fechados = grupos.alternar(fechados, cab.dataset.grupoCab ?? '');
      grupos.salvar(fechados);
      pintarGrupos();
    });
  }

  const alerta = document.createElement('div');
  alerta.className = 'p-alerta-fixo';
  alerta.hidden = true;
  op.raiz.prepend(alerta);

  let visivel = op.itens[0]?.id ?? '';
  let alertaHtml: string | null = null;
  let redundanteEm: string | undefined;

  const pintarAlerta = (): void => {
    alerta.innerHTML = alertaHtml ?? '';
    alerta.hidden = !alertaHtml || redundanteEm === visivel;
  };

  const mostrar = (id: string): void => {
    visivel = id;
    pintarAlerta();

    // O grupo da seção atual nunca fica recolhido: chegar aqui por URL colada
    // ou por F5 com o grupo fechado deixaria a página em que a pessoa está
    // invisível no menu.
    const grupo = grupoDaSecao(op.itens, id);
    const abertos = grupos.abrirGrupoDaSecao(fechados, grupo);
    if (abertos !== fechados) {
      fechados = abertos;
      grupos.salvar(fechados);
      pintarGrupos();
    }

    for (const s of $$<HTMLElement>('[data-secao]', op.raiz)) s.hidden = s.dataset.secao !== id;
    for (const item of $$<HTMLAnchorElement>('.p-item')) {
      const ativo = item.dataset.item === id;
      item.classList.toggle('ativo', ativo);
      if (ativo) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    for (const aba of $$<HTMLElement>('.sh-aba')) {
      aba.classList.toggle('ativa', aba.dataset.aba === id);
    }
    definirTrilha(topo, grupo ?? '', op.itens.find((i) => i.id === id)?.rotulo ?? '');
    // O conteúdo troca inteiro: continuar na rolagem da seção anterior confunde.
    window.scrollTo(0, 0);
    for (const fn of ouvintes) fn(id);
  };

  return {
    mostrar,
    secaoAtual: () => visivel,
    aoTrocarSecao: (fn) => { ouvintes.push(fn); },
    definirBadge: (id, n) => {
      contagens.set(id, n);
      pintarBadges();
    },
    definirAlerta: (html, o) => {
      alertaHtml = html;
      redundanteEm = o?.redundanteEm;
      pintarAlerta();
    },
    topo
  };
}
