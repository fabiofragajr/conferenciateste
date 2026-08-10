// forma.ts — botão, campo, seleção e a barra de filtros.
//
// Os estilos já existiam em base.css e cada tela montava o markup do seu jeito.
// Aqui o markup passa a ser um só; o CSS não muda de dono.

import { esc } from '../util.ts';

export type TipoBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';

export interface OpcoesBotao {
  rotulo: string;
  id?: string;
  tipo?: TipoBotao;
  /** Vira `type="submit"` quando verdadeiro. Padrão é `button`. */
  enviar?: boolean;
}

export function botao(op: OpcoesBotao): string {
  return `<button class="btn btn-${esc(op.tipo ?? 'secundario')}"
    ${op.id ? `id="${esc(op.id)}"` : ''}
    type="${op.enviar ? 'submit' : 'button'}">${esc(op.rotulo)}</button>`;
}

export interface OpcoesCampo {
  id: string;
  rotulo: string;
  tipo?: 'text' | 'date' | 'search' | 'password' | 'number';
  valor?: string;
  /** Some do rótulo visível, mas continua no leitor de tela. */
  rotuloOculto?: boolean;
  opcional?: boolean;
}

export function campo(op: OpcoesCampo): string {
  return `<div class="ui-campo">
    <label for="${esc(op.id)}"${op.rotuloOculto ? ' class="ui-so-leitor"' : ''}>
      ${esc(op.rotulo)}${op.opcional ? ' <em>opcional</em>' : ''}
    </label>
    <input id="${esc(op.id)}" type="${esc(op.tipo ?? 'text')}" value="${esc(op.valor ?? '')}" />
  </div>`;
}

export interface Opcao {
  valor: string;
  rotulo: string;
}

export interface OpcoesSelecao {
  id: string;
  rotulo: string;
  opcoes: Opcao[];
  valor?: string;
  rotuloOculto?: boolean;
}

export function selecao(op: OpcoesSelecao): string {
  const itens = op.opcoes.map((o) =>
    `<option value="${esc(o.valor)}"${o.valor === op.valor ? ' selected' : ''}>${esc(o.rotulo)}</option>`
  ).join('');
  return `<div class="ui-campo">
    <label for="${esc(op.id)}"${op.rotuloOculto ? ' class="ui-so-leitor"' : ''}>${esc(op.rotulo)}</label>
    <select id="${esc(op.id)}">${itens}</select>
  </div>`;
}

/**
 * Barra de filtros: visível no desktop, dobrada numa folha no celular.
 *
 * Filtro escondido atrás de um botão faz o gestor esquecer que ele está ligado —
 * e tabela filtrada sem aviso é tabela que mente. Por isso o resumo do que está
 * aplicado acompanha o botão no celular.
 */
export function filtros(campos: string[], resumo?: string): string {
  return `<div class="ui-filtros">
    <div class="ui-filtros-campos">${campos.join('')}</div>
    <button class="ui-filtros-abrir" type="button" aria-expanded="false">
      ${resumo ? `Filtros · ${esc(resumo)}` : 'Filtros'}
    </button>
  </div>`;
}
