// basico.ts — os componentes de conteúdo do LOGDIS.
//
// Funções puras: entra dado tipado, sai HTML. Sem DOM, sem estado, sem efeito —
// por isso testam em Node, sem navegador.
//
// Toda função escapa o que vem do cadastro. A única exceção é `corpo`, que é
// HTML montado por nós: escapá-lo apagaria a tabela que ele carrega.
//
// Os imports trazem a extensão `.ts`, e não `.js` como no resto de `src/`, de
// propósito: quem roda este arquivo é o Node do teste, e o Node não mapeia
// `.js` para `.ts` — ele procura o arquivo com o nome que está escrito. Os
// outros módulos testados em Node (`model`, `router`) não têm import nenhum em
// tempo de execução, e por isso nunca esbarraram nisto.

import type { StatusLeitura } from '../../types.ts';
import { STATUS_INFO } from '../model.ts';
import { esc } from '../util.ts';

export type Tom = 'marca' | 'alarme' | 'atencao' | 'neutro';

const fmtN = new Intl.NumberFormat('pt-BR');

/**
 * "1 volume(s)" é texto de sistema. Zero vira "nenhum", que é como a pessoa fala.
 */
export function plural(n: number, um: string, muitos: string): string {
  if (n === 0) return `nenhum ${um}`;
  return `${fmtN.format(n)} ${n === 1 ? um : muitos}`;
}

export interface Acao {
  rotulo: string;
  href: string;
}

const linkAcao = (a: Acao): string =>
  `<a class="ui-acao" href="${esc(a.href)}">${esc(a.rotulo)} ›</a>`;

/**
 * Estado vazio: uma linha no lugar onde o conteúdo estaria.
 *
 * Nunca um cartão com título próprio. Um cartão inteiro para dizer que não há
 * nada ocupa a tela com a ausência de informação.
 */
export function vazio(texto: string, acao?: Acao): string {
  return `<p class="ui-vazio">${esc(texto)}${acao ? ` ${linkAcao(acao)}` : ''}</p>`;
}

/** Badge de contagem. Zero não desenha: alarme que aparece sempre deixa de ser alarme. */
export function badge(n: number, tom: Tom = 'alarme'): string {
  if (n <= 0) return '';
  return `<span class="ui-badge ui-${esc(tom)}">${fmtN.format(n)}</span>`;
}

export interface OpcoesAlerta {
  tom: Tom;
  titulo: string;
  texto?: string;
  acao?: Acao;
}

/**
 * Faixa lateral, nunca moldura de quatro lados, e uma por tela.
 *
 * Três blocos vermelhos seguidos dizendo quase a mesma coisa foi o que diluiu o
 * alarme na versão anterior: quem aprende a passar por um aviso redundante passa
 * também pelo aviso que era a única notícia do problema.
 */
export function alerta(op: OpcoesAlerta): string {
  return `<div class="ui-alerta ui-${esc(op.tom)}">
    <div>
      <b>${esc(op.titulo)}</b>
      ${op.texto ? `<p>${esc(op.texto)}</p>` : ''}
    </div>
    ${op.acao ? linkAcao(op.acao) : ''}
  </div>`;
}

export interface Kpi {
  rotulo: string;
  valor: number | string;
  tom?: Tom;
}

/** Régua de indicadores. Duas colunas no celular só porque são números curtos. */
export function kpis(itens: Kpi[]): string {
  const celulas = itens.map((k) => `
    <div class="ui-kpi">
      <small>${esc(k.rotulo)}</small>
      <b class="ui-${esc(k.tom ?? 'neutro')}">${typeof k.valor === 'number' ? fmtN.format(k.valor) : esc(k.valor)}</b>
    </div>`).join('');
  return `<div class="ui-kpis">${celulas}</div>`;
}

export interface OpcoesSecao {
  titulo: string;
  /** Texto pequeno à direita do título: contagem, período, origem do dado. */
  meta?: string;
  /** HTML já montado. Não é escapado — ver o comentário do topo. */
  corpo: string;
}

export function secao(op: OpcoesSecao): string {
  return `<section class="ui-secao">
    <h3>${esc(op.titulo)}${op.meta ? `<span class="ui-meta">${esc(op.meta)}</span>` : ''}</h3>
    ${op.corpo}
  </section>`;
}

/**
 * Forma por status, além da cor.
 *
 * Verde e vermelho são o par mais difícil para daltonismo, e o gestor lê isto
 * numa tabela densa. As formas são as mesmas de `src/lib/mapa.ts` de propósito:
 * o ponto do mapa e a etiqueta da tabela precisam ser reconhecíveis um pelo
 * outro.
 */
const FORMA: Record<StatusLeitura, string> = {
  OK: '●',
  ROTA_DIVERGENTE: '▲',
  DESTINO_NAO_MAPEADO: '▼',
  DUPLICADO: '■',
  INVALIDO: '◆'
};

/** Etiqueta de status: cor, forma e texto — nunca cor sozinha. */
export function status(s: StatusLeitura): string {
  const info = STATUS_INFO[s];
  return `<span class="ui-status ${esc(info.classe)}" aria-label="${esc(info.rotulo)}">
    <i aria-hidden="true" style="color:${esc(info.cor)}">${FORMA[s]}</i>${esc(info.curto)}
  </span>`;
}

export interface OpcoesPageHeader {
  titulo: string;
  sub?: string;
  /** HTML de botões, à direita. */
  acoes?: string;
}

export function pageHeader(op: OpcoesPageHeader): string {
  return `<header class="ui-page-header">
    <h2>${esc(op.titulo)}</h2>
    ${op.sub ? `<span>${esc(op.sub)}</span>` : ''}
    ${op.acoes ? `<div class="ui-page-acoes">${op.acoes}</div>` : ''}
  </header>`;
}
