// barra-inferior.ts — a navegação do painel no celular.
//
// Cinco ações na zona do polegar, contra um hambúrguer no canto mais alto e mais
// longe da mão. "Bipar" é uma ação operacional (não uma seção do painel), mas
// precisa ficar direta e destacada: é a passagem mais frequente entre gestão e
// doca. As consultas menos frequentes moram atrás de "Mais".
//
// A aba Divergências carrega o badge, e é essa a razão de ela estar aqui em vez
// de dentro de "Mais": com a gaveta, a contagem só existia com o menu aberto.
//
// Os ícones vêm de `icones.ts`, e não de um mapa próprio. O mapa próprio era o
// jeito de a mesma seção ganhar desenhos diferentes na coluna e na barra —
// duas telas do mesmo sistema pedindo para serem decoradas separadamente.

import { esc } from '../util.js';
import { icone } from './icones.js';
import { htmlDaArvore, type ItemMenu } from './lateral.js';

/** Ids de seções que ganham aba própria. O resto vai para "Mais". */
export const ABAS = ['inicio', 'divergencias', 'conferencias'] as const;

const ROTULO_CURTO: Record<string, string> = {
  inicio: 'Início', divergencias: 'Alertas', conferencias: 'Conferências', mapa: 'Mapa'
};

/**
 * Traço mais grosso que o da lateral, e não é descuido.
 *
 * 1,5 px é o peso certo a 18 px sobre o verde escuro da coluna. Na barra o
 * ícone tem 22 px sobre fundo branco, e o mesmo traço fica anêmico — some no
 * relance de quem está de pé segurando caixa. O desenho é o mesmo; o peso
 * acompanha o tamanho e o fundo.
 */
const TRACO_BARRA = 1.75;

export function montarBarra(itens: ItemMenu[]): HTMLElement {
  const barra = document.createElement('nav');
  barra.className = 'sh-barra';
  barra.setAttribute('aria-label', 'Navegação do painel');

  const aba = (id: typeof ABAS[number]): string => {
    const item = itens.find((i) => i.id === id);
    if (!item) return '';
    return `<a class="sh-aba" data-aba="${esc(id)}" href="${esc(item.href)}">
      ${icone(id, { tamanho: 22, traco: TRACO_BARRA })}
      <span class="ui-badge" data-badge="${esc(id)}" hidden></span>
      ${esc(ROTULO_CURTO[id] ?? item.rotulo)}
    </a>`;
  };

  const abas = [
    aba('inicio'),
    aba('divergencias'),
    `<a class="sh-aba sh-aba-bipar" data-aba="bipagem" href="/bipagem" aria-label="Abrir bipagem">
      ${icone('bipagem', { tamanho: 23, traco: 1.9 })}<span>Bipar</span>
    </a>`,
    aba('conferencias')
  ].join('');

  barra.innerHTML = `${abas}
    <button class="sh-aba" data-aba="mais" type="button">
      ${icone('mais', { tamanho: 22, traco: TRACO_BARRA })}Mais
    </button>`;
  return barra;
}

/** Os itens que não têm aba própria — o conteúdo da folha "Mais". */
export function itensDaFolha(itens: ItemMenu[]): ItemMenu[] {
  return itens.filter((i) => !(ABAS as readonly string[]).includes(i.id));
}

/**
 * A folha usa a MESMA árvore da lateral, com o mesmo recolhimento.
 *
 * O prefixo `folha` separa os ids de `aria-controls` dos da coluna: as duas
 * árvores existem no documento ao mesmo tempo, e id repetido faz o cabeçalho de
 * uma abrir a lista da outra. O estado de recolhido é compartilhado de
 * propósito — é a preferência da pessoa, não da tela.
 */
export function htmlDaFolha(itens: ItemMenu[], fechados: Set<string>): string {
  return htmlDaArvore(itens, { fechados, prefixo: 'folha', tamanho: 20 });
}
