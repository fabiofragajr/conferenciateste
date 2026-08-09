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
//
// Os grupos recolhem. O cabeçalho é `<button aria-expanded>` e a seta ocupa a
// coluna do ícone — de propósito: cabeçalho de grupo NÃO ganha ícone próprio.
// Ícone de grupo alinhado com ícone de item destrói exatamente a hierarquia que
// o recolhimento existe para criar, e a seta é o desenho que diz o que o toque
// vai fazer. `htmlDaArvore` é a mesma árvore da folha do celular: um desenho
// só, para a pessoa aprender uma vez.

import { esc } from '../util.js';
import { icone } from './icones.js';
import { estaAberto, idDoGrupo } from './grupos.js';

export interface ItemMenu {
  /** Casa com `Secao` do roteador e com o `data-secao` da região. */
  id: string;
  rotulo: string;
  grupo: string;
  href: string;
}

/** Os grupos na ordem em que aparecem no menu, sem repetir. */
export const gruposDe = (itens: ItemMenu[]): string[] => [...new Set(itens.map((i) => i.grupo))];

/** O grupo dono de uma seção, ou `undefined` se a seção não está no menu. */
export const grupoDaSecao = (itens: ItemMenu[], id: string): string | undefined =>
  itens.find((i) => i.id === id)?.grupo;

export interface OpcoesArvore {
  /** Grupos recolhidos agora. */
  fechados: Set<string>;
  /** Separa os ids da lateral dos da folha: as duas árvores coexistem no documento. */
  prefixo: string;
  /** Lado do ícone, em px. */
  tamanho?: number;
}

/**
 * A árvore inteira: grupos recolhíveis, itens com ícone e badge.
 *
 * O badge do cabeçalho (`data-badge-grupo`) é a trava que o recolhimento
 * obriga: com o grupo fechado, a contagem de divergências sobe para o cabeçalho
 * em vez de sumir junto com o item. Sem ele, recolher "Operação" apagaria o
 * alarme do dia da tela — o oposto do que o painel promete. Quem preenche os
 * dois é `definirBadge`, no shell.
 */
export function htmlDaArvore(itens: ItemMenu[], op: OpcoesArvore): string {
  const { fechados, prefixo, tamanho = 18 } = op;

  return gruposDe(itens).map((g) => {
    const aberto = estaAberto(fechados, g);
    const idLista = idDoGrupo(prefixo, g);
    const filhos = itens.filter((i) => i.grupo === g);

    return `
    <div class="p-grupo" data-grupo="${esc(g)}">
      <button class="p-grupo-cab" type="button" data-grupo-cab="${esc(g)}"
              aria-expanded="${aberto}" aria-controls="${idLista}" data-nao-fecha>
        ${icone('seta', { tamanho: 14, traco: 2, classe: 'p-grupo-seta' })}
        <span class="p-grupo-nome">${esc(g)}</span>
        <span class="ui-badge p-grupo-badge" data-badge-grupo="${esc(g)}" hidden></span>
      </button>
      <div class="p-grupo-itens" id="${idLista}"${aberto ? '' : ' hidden'}>
        ${filhos.map((i) => `
        <a class="p-item" href="${esc(i.href)}" data-item="${esc(i.id)}">
          <span class="p-item-icone">${icone(i.id, { tamanho })}</span>
          <span class="p-item-rotulo">${esc(i.rotulo)}</span>
          <span class="ui-badge" data-badge="${esc(i.id)}" hidden></span>
        </a>`).join('')}
      </div>
    </div>`;
  }).join('');
}

export function montarLateral(itens: ItemMenu[], usuario: string, fechados: Set<string>): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'p-lateral';
  nav.setAttribute('aria-label', 'Seções do painel');
  nav.innerHTML = `
    <div class="p-marca">
      <img src="/logdis-simbolo.png" alt="" width="34" height="34" />
      <span class="p-marca-nome">LOGDIS <i>Entrega</i></span>
    </div>

    <div class="p-lateral-rolagem">
      ${htmlDaArvore(itens, { fechados, prefixo: 'lat' })}
    </div>

    <div class="p-lateral-rodape">
      <span id="p-usuario" class="p-usuario">${esc(usuario)}</span>
      <a class="btn btn-bipar" id="btn-bipar" href="/bipagem">
        ${icone('bipagem', { tamanho: 16 })}<span>Abrir bipagem</span>
      </a>
      <button id="btn-sair" class="btn btn-sair" type="button">Sair</button>
    </div>`;
  return nav;
}
