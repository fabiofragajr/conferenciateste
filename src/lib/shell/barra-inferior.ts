// barra-inferior.ts — a navegação do painel no celular.
//
// Cinco abas na zona do polegar, contra um hambúrguer no canto mais alto e mais
// longe da mão. As quatro primeiras são o que o gestor usa todo dia; as outras
// oito são consulta, e moram atrás de "Mais".
//
// A aba Divergências carrega o badge, e é essa a razão de ela estar aqui em vez
// de dentro de "Mais": com a gaveta, a contagem só existia com o menu aberto.

import { esc } from '../util.js';
import type { ItemMenu } from './lateral.js';

/** Ids que ganham aba própria, nesta ordem. O resto vai para "Mais". */
export const ABAS = ['inicio', 'divergencias', 'conferencias', 'mapa'] as const;

const ICONE: Record<string, string> = {
  inicio: '◱', divergencias: '▲', conferencias: '▤', mapa: '◎', mais: '⋯'
};

const ROTULO_CURTO: Record<string, string> = {
  inicio: 'Início', divergencias: 'Alertas', conferencias: 'Conferências', mapa: 'Mapa'
};

export function montarBarra(itens: ItemMenu[]): HTMLElement {
  const barra = document.createElement('nav');
  barra.className = 'sh-barra';
  barra.setAttribute('aria-label', 'Navegação do painel');

  const abas = ABAS.map((id) => {
    const item = itens.find((i) => i.id === id);
    if (!item) return '';
    return `<a class="sh-aba" data-aba="${esc(id)}" href="${esc(item.href)}">
      <i aria-hidden="true">${ICONE[id]}</i>
      <span class="ui-badge" data-badge="${esc(id)}" hidden></span>
      ${esc(ROTULO_CURTO[id] ?? item.rotulo)}
    </a>`;
  }).join('');

  barra.innerHTML = `${abas}
    <button class="sh-aba" data-aba="mais" type="button">
      <i aria-hidden="true">${ICONE.mais}</i>Mais
    </button>`;
  return barra;
}

/** Os itens que não têm aba própria — o conteúdo da folha "Mais". */
export function itensDaFolha(itens: ItemMenu[]): ItemMenu[] {
  return itens.filter((i) => !(ABAS as readonly string[]).includes(i.id));
}

export function htmlDaFolha(itens: ItemMenu[]): string {
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  return grupos.map((g) => `
    <div class="p-lateral-grupo">
      <h2>${esc(g)}</h2>
      ${itens.filter((i) => i.grupo === g).map((i) => `
        <a class="p-item" href="${esc(i.href)}" data-item="${esc(i.id)}">
          <span>${esc(i.rotulo)}</span>
          <span class="ui-badge" data-badge="${esc(i.id)}" hidden></span>
        </a>`).join('')}
    </div>`).join('');
}
