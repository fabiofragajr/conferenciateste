// topo.ts — a barra do topo, nos dois modos.
//
// No painel ela carrega a trilha da seção e o estado da sincronização. Na
// operação ela carrega a carga que está sendo conferida — a informação que a
// pessoa erra se esquecer — e nada mais. Sem marca e sem botão de navegação:
// cada pixel gasto com logo na tela de trabalho é pixel que não é câmera.
//
// Trilha, e não título solto: o título repetia ao pé da letra o `<h2>` da
// própria seção logo abaixo ("Pedidos incompletos" duas vezes, em dois
// tamanhos). Dizendo "Operação › Pedidos incompletos" a mesma linha passa a
// informar onde a pessoa está na hierarquia — que é justamente o que um menu
// com grupos recolhíveis pode deixar de mostrar.
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
       <nav class="sh-trilha" aria-label="Trilha de navegação">
         <span class="sh-trilha-grupo"></span>
         <span class="sh-trilha-sep" aria-hidden="true">›</span>
         <span class="sh-trilha-secao"></span>
       </nav>
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

/**
 * Escreve a trilha do painel.
 *
 * No celular o CSS esconde o grupo e o separador: não há largura para os dois
 * níveis, e o que a pessoa precisa ler ali é onde ela está, não de onde veio.
 * A trilha continua no DOM inteira — o leitor de tela anuncia os dois níveis
 * mesmo onde a tela mostra um.
 */
export function definirTrilha(topo: HTMLElement, grupo: string, secao: string): void {
  const g = topo.querySelector('.sh-trilha-grupo');
  const s = topo.querySelector('.sh-trilha-secao');
  // `textContent` não interpreta HTML: escapar aqui escreveria "&amp;" na tela.
  if (g) g.textContent = grupo;
  if (s) s.textContent = secao;
  // Sem grupo (seção fora do menu) o separador vira sujeira pendurada.
  const sep = topo.querySelector<HTMLElement>('.sh-trilha-sep');
  if (sep) sep.hidden = !grupo;
}
