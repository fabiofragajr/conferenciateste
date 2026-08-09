// lateral.ts — o menu do desktop.
//
// Os itens levam `href` de rota de verdade, não `#hash`: é o roteador quem
// intercepta o clique. Assim o menu funciona com clique do meio, "abrir em nova
// aba" e leitor de tela, que é o que um menu de sistema precisa fazer.

import { esc } from '../util.js';

export interface ItemMenu {
  /** Casa com `Secao` do roteador e com o `data-secao` da região. */
  id: string;
  rotulo: string;
  grupo: string;
  href: string;
}

export function montarLateral(itens: ItemMenu[], usuario: string): HTMLElement {
  const grupos = [...new Set(itens.map((i) => i.grupo))];

  const nav = document.createElement('nav');
  nav.className = 'p-lateral';
  nav.setAttribute('aria-label', 'Seções do painel');
  nav.innerHTML = `
    ${grupos.map((g) => `
      <div class="p-lateral-grupo">
        <h2>${esc(g)}</h2>
        ${itens.filter((i) => i.grupo === g).map((i) => `
          <a class="p-item" href="${esc(i.href)}" data-item="${esc(i.id)}">
            <span>${esc(i.rotulo)}</span>
            <span class="ui-badge" data-badge="${esc(i.id)}" hidden></span>
          </a>`).join('')}
      </div>`).join('')}
    <div class="p-lateral-rodape">
      <span id="p-usuario" class="p-usuario">${esc(usuario)}</span>
      <a class="btn btn-secundario" id="btn-bipar" href="/bipagem">Abrir bipagem</a>
      <button id="btn-sair" class="btn btn-fantasma" type="button">Sair</button>
    </div>`;
  return nav;
}
