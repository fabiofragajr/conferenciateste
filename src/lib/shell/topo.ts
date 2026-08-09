// topo.ts — a barra do topo, nos dois modos.
//
// No painel ela carrega o título da seção e o estado da sincronização. Na
// operação ela carrega a carga que está sendo conferida — a informação que a
// pessoa erra se esquecer — e nada mais. Sem marca e sem botão de navegação:
// cada pixel gasto com logo na tela de trabalho é pixel que não é câmera.
//
// O chip do painel é `#chip-sync-painel`, e não `#chip-sync`: este último é o
// da bipagem, em `index.html`. Como a barra é filha do <body>, ela vem antes de
// #tela-operacao na ordem do documento — com o mesmo id, o `$('#chip-sync')` do
// operador pegaria o chip do painel, e a fila sumiria da tela onde ela importa.

export type ModoShell = 'painel' | 'operacao';

export function montarTopo(modo: ModoShell): HTMLElement {
  const topo = document.createElement('header');
  topo.className = `sh-topo sh-topo-${modo}`;
  topo.innerHTML = modo === 'painel'
    ? `<span class="sh-marca" aria-hidden="true">
         <img src="/logdis-simbolo.png" alt="" width="26" height="26" />
       </span>
       <span class="sh-titulo-secao"></span>
       <span class="sh-espaco"></span>
       <span class="sh-sync chip chip-sync" id="chip-sync-painel">—</span>`
    : `<div class="sh-carga"><b class="sh-carga-nome">—</b><small class="sh-carga-quem"></small></div>
       <span class="sh-espaco"></span>
       <span class="sh-sync chip chip-sync" id="chip-sync-painel">—</span>
       <span class="sh-icones"></span>`;
  return topo;
}

/** Escreve a carga na barra da operação. Ignorado no modo painel. */
export function definirCarga(topo: HTMLElement, nome: string, quem: string): void {
  const b = topo.querySelector('.sh-carga-nome');
  const s = topo.querySelector('.sh-carga-quem');
  if (b) b.textContent = nome;
  if (s) s.textContent = quem;
}

export function definirTituloSecao(topo: HTMLElement, texto: string): void {
  const t = topo.querySelector('.sh-titulo-secao');
  // `textContent` não interpreta HTML: escapar aqui escreveria "&amp;" na tela.
  if (t) t.textContent = texto;
}
