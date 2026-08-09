// lateral.ts — o menu do desktop, e a identidade do sistema.
//
// Os itens levam `href` de rota de verdade, não `#hash`: é o roteador quem
// intercepta o clique. Assim o menu funciona com clique do meio, "abrir em nova
// aba" e leitor de tela, que é o que um menu de sistema precisa fazer.
//
// A marca mora AQUI, e não numa barra verde no topo. A barra alta empurrava o
// conteúdo para baixo em toda tela e competia com o vermelho da divergência; a
// coluna já está sempre presente e não custa altura nenhuma. Moldura verde,
// miolo claro: a identidade fica na borda e o alarme fica com o centro.

import { esc } from '../util.js';

export interface ItemMenu {
  /** Casa com `Secao` do roteador e com o `data-secao` da região. */
  id: string;
  rotulo: string;
  grupo: string;
  href: string;
}

/**
 * Um glifo por seção. Ícone aqui não é enfeite: é o que deixa a pessoa achar
 * "Divergências" pela forma antes de ler, e é o que dá à coluna o ritmo de
 * sistema em vez de lista de links.
 */
const ICONE: Record<string, string> = {
  inicio: '◱',
  divergencias: '▲',
  incompletos: '◪',
  conferencias: '▤',
  ocorrencias: '✎',
  desempenho: '◤',
  indicadores: '◈',
  mapa: '◎',
  relatorios: '⎗',
  pessoas: '☰',
  transportadoras: '⬢',
  rotas: '⌗',
  sincronizacao: '↻'
};

export function montarLateral(itens: ItemMenu[], usuario: string): HTMLElement {
  const grupos = [...new Set(itens.map((i) => i.grupo))];

  const nav = document.createElement('nav');
  nav.className = 'p-lateral';
  nav.setAttribute('aria-label', 'Seções do painel');
  nav.innerHTML = `
    <div class="p-marca">
      <img src="/logdis-simbolo.png" alt="" width="34" height="34" />
      <span class="p-marca-nome">LOGDIS <i>Entrega</i></span>
    </div>

    <div class="p-lateral-rolagem">
      ${grupos.map((g) => `
        <div class="p-lateral-grupo">
          <h2>${esc(g)}</h2>
          ${itens.filter((i) => i.grupo === g).map((i) => `
            <a class="p-item" href="${esc(i.href)}" data-item="${esc(i.id)}">
              <i class="p-item-icone" aria-hidden="true">${ICONE[i.id] ?? '·'}</i>
              <span class="p-item-rotulo">${esc(i.rotulo)}</span>
              <span class="ui-badge" data-badge="${esc(i.id)}" hidden></span>
            </a>`).join('')}
        </div>`).join('')}
    </div>

    <div class="p-lateral-rodape">
      <span id="p-usuario" class="p-usuario">${esc(usuario)}</span>
      <a class="btn btn-bipar" id="btn-bipar" href="/bipagem">Abrir bipagem</a>
      <button id="btn-sair" class="btn btn-sair" type="button">Sair</button>
    </div>`;
  return nav;
}
