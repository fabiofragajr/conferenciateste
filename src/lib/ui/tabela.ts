// tabela.ts — uma chamada, duas formas.
//
// Tabela densa no desktop; abaixo de 1024px cada linha vira um bloco empilhado,
// com o rótulo da coluna ao lado do valor. O rótulo viaja em `data-rotulo` na
// própria célula, e é o CSS que decide mostrá-lo — sem isso seriam dois HTML
// para o mesmo dado, e é dessa duplicação que nasce a divergência entre as duas
// telas.

import { esc } from '../util.ts';

export interface Coluna {
  chave: string;
  rotulo: string;
  alinhar?: 'direita';
  /** A célula já vem como HTML nosso (status com cor e forma, link, badge). */
  html?: boolean;
}

export type Linha = Record<string, string | number | null | undefined>;

export interface OpcoesTabela {
  colunas: Coluna[];
  linhas: Linha[];
  /** Texto do estado vazio. Sem linhas, a tabela inteira é substituída por ele. */
  vazio: string;
}

export function tabela(op: OpcoesTabela): string {
  // Cabeçalho sem linha nenhuma é promessa de dado que não veio.
  if (!op.linhas.length) return `<p class="ui-vazio">${esc(op.vazio)}</p>`;

  const cab = op.colunas.map((c) =>
    `<th${c.alinhar === 'direita' ? ' class="ui-dir"' : ''}>${esc(c.rotulo)}</th>`
  ).join('');

  const corpo = op.linhas.map((l) => {
    const celulas = op.colunas.map((c) => {
      const bruto = l[c.chave];
      const valor = bruto === null || bruto === undefined ? '—' : String(bruto);
      const classe = c.alinhar === 'direita' ? ' ui-dir' : '';
      return `<td class="ui-td${classe}" data-rotulo="${esc(c.rotulo)}">${c.html ? valor : esc(valor)}</td>`;
    }).join('');
    return `<tr>${celulas}</tr>`;
  }).join('');

  return `<div class="ui-tabela-rolagem">
    <table class="ui-tabela"><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
  </div>`;
}
