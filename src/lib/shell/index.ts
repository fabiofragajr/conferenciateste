// index.ts — a moldura do painel.
//
// Não conhece regra de negócio e não toca no IndexedDB. Recebe os itens do
// menu, diz qual seção está visível e avisa quem precisa repintar.
//
// A regra que o menu põe em risco: com seções, a divergência do dia passaria a
// viver atrás de um item. Duas travas contra isso — badge no item, visível de
// qualquer seção, e faixa fixa acima do conteúdo de todas elas. A faixa se cala
// só onde ela seria redundante com o conteúdo logo abaixo.

import { $$ } from '../util.js';
import { montarTopo, definirTituloSecao, type ModoShell } from './topo.js';
import { montarLateral, type ItemMenu } from './lateral.js';

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

  if (op.modo === 'painel') document.body.prepend(montarLateral(op.itens, op.usuario));

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
    for (const s of $$<HTMLElement>('[data-secao]', op.raiz)) s.hidden = s.dataset.secao !== id;
    for (const item of $$<HTMLAnchorElement>('.p-item')) {
      const ativo = item.dataset.item === id;
      item.classList.toggle('ativo', ativo);
      if (ativo) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    definirTituloSecao(topo, op.itens.find((i) => i.id === id)?.rotulo ?? '');
    // O conteúdo troca inteiro: continuar na rolagem da seção anterior confunde.
    window.scrollTo(0, 0);
    for (const fn of ouvintes) fn(id);
  };

  return {
    mostrar,
    secaoAtual: () => visivel,
    aoTrocarSecao: (fn) => { ouvintes.push(fn); },
    definirBadge: (id, n) => {
      for (const b of $$<HTMLElement>(`[data-badge="${id}"]`)) {
        b.textContent = String(n);
        b.hidden = n <= 0;
      }
    },
    definirAlerta: (html, o) => {
      alertaHtml = html;
      redundanteEm = o?.redundanteEm;
      pintarAlerta();
    },
    topo
  };
}
