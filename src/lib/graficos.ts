// graficos.ts — SVG simples, sem biblioteca (o app precisa ser leve e offline).
//
// Regras seguidas aqui:
//  - uma série por gráfico (small multiples). Nada de dois eixos y no mesmo
//    desenho: séries de escalas diferentes viram gráficos diferentes.
//  - rótulo direto só no último ponto e no maior — número em cima de tudo vira ruído.
//  - grade discreta, sem moldura, sem legenda quando há uma série só (o título nomeia).

import { esc } from './util.js';

export interface PontoSerie {
  rotulo: string;
  valor: number;
}

export interface OpcoesGrafico {
  titulo: string;
  subtitulo?: string;
  cor: string;
  sufixo?: string;
  casas?: number;
}

const L = 300;
const A = 120;
const BASE = A - 18;
const TOPO = 12;

const fmt = (v: number, casas: number, sufixo: string): string =>
  `${casas > 0 ? v.toFixed(casas) : Math.round(v)}${sufixo}`;

/** Barras verticais por mês — a pergunta é "melhorou?", e isso é série no tempo. */
export function graficoMensal(serie: PontoSerie[], op: OpcoesGrafico): string {
  const casas = op.casas ?? 0;
  const sufixo = op.sufixo ?? '';

  if (!serie.length) {
    return `<div class="p-gr"><h4>${esc(op.titulo)}</h4>
      <p class="p-gr-sub">Sem dados no período.</p></div>`;
  }

  const max = Math.max(...serie.map((p) => p.valor), casas > 0 ? 0.1 : 1);
  const largura = L / serie.length;
  const larguraBarra = Math.min(34, largura * 0.62);
  const ultimo = serie.length - 1;
  const indiceMaior = serie.reduce((m, p, i) => (p.valor > serie[m].valor ? i : m), 0);

  const barras = serie.map((p, i) => {
    const x = i * largura + (largura - larguraBarra) / 2;
    const alt = Math.max(p.valor > 0 ? 2 : 0, ((p.valor / max) * (BASE - TOPO)));
    const y = BASE - alt;
    // rótulo direto só onde ajuda a ler: último mês e o pico
    const marcaValor = (i === ultimo || i === indiceMaior)
      ? `<text class="p-rotulo" x="${x + larguraBarra / 2}" y="${y - 4}" text-anchor="middle">${fmt(p.valor, casas, sufixo)}</text>`
      : '';
    return `<g><title>${esc(p.rotulo)}: ${fmt(p.valor, casas, sufixo)}</title>
      <rect x="${x}" y="${y}" width="${larguraBarra}" height="${alt}" rx="3" fill="${op.cor}"
            opacity="${i === ultimo ? 1 : 0.72}" />
      ${marcaValor}
      <text class="p-eixo" x="${x + larguraBarra / 2}" y="${A - 4}" text-anchor="middle">${esc(p.rotulo)}</text>
    </g>`;
  }).join('');

  return `<div class="p-gr">
    <h4>${esc(op.titulo)}</h4>
    ${op.subtitulo ? `<p class="p-gr-sub">${esc(op.subtitulo)}</p>` : ''}
    <svg viewBox="0 0 ${L} ${A}" role="img" aria-label="${esc(op.titulo)} por mês">
      <line class="p-grade-linha" x1="0" y1="${BASE}" x2="${L}" y2="${BASE}" />
      ${barras}
    </svg>
  </div>`;
}

/** Barras horizontais para ranking — rótulo à esquerda, valor à direita. */
export function ranking(
  itens: { rotulo: string; valor: number; detalhe?: string }[],
  cor: string,
  vazio = 'Sem dados no período.'
): string {
  if (!itens.length) return `<p class="p-vazio">${esc(vazio)}</p>`;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return `<div class="p-barras">${itens.map((i) => `
    <div class="p-barra-linha">
      <span>${esc(i.rotulo)}</span>
      <span class="p-barra-trilho">
        <span class="p-barra-fill" style="width:${(i.valor / max) * 100}%;background:${cor}"></span>
      </span>
      <span class="p-barra-val">${esc(i.detalhe ?? String(i.valor))}</span>
    </div>`).join('')}</div>`;
}

/**
 * Mapa de calor agregado das conferências: célula = quadrado de ~120 m.
 * É o padrão de onde a operação acontece — nunca o rastro de uma pessoa.
 */
export function mapaCalor(pontos: { lat: number; lng: number }[], cor: string): string {
  if (pontos.length < 3) {
    return '<p class="p-vazio">Poucas conferências com posição registrada para formar um padrão.</p>';
  }

  const CELULA_GRAUS = 0.0011; // ~120 m
  const chave = (p: { lat: number; lng: number }): string =>
    `${Math.round(p.lat / CELULA_GRAUS)}|${Math.round(p.lng / CELULA_GRAUS)}`;

  const celulas = new Map<string, { lat: number; lng: number; n: number }>();
  for (const p of pontos) {
    const k = chave(p);
    const c = celulas.get(k) ?? { lat: Math.round(p.lat / CELULA_GRAUS) * CELULA_GRAUS, lng: Math.round(p.lng / CELULA_GRAUS) * CELULA_GRAUS, n: 0 };
    c.n++;
    celulas.set(k, c);
  }

  const lista = [...celulas.values()];
  const lats = lista.map((c) => c.lat);
  const lngs = lista.map((c) => c.lng);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);
  const maxN = Math.max(...lista.map((c) => c.n));

  const larg = 320;
  const alt = 180;
  const pad = 16;
  const escX = lngMax === lngMin ? 0 : (larg - pad * 2) / (lngMax - lngMin);
  const escY = latMax === latMin ? 0 : (alt - pad * 2) / (latMax - latMin);
  const lado = Math.max(10, Math.min(26, (larg - pad * 2) / Math.max(3, (lngMax - lngMin) / CELULA_GRAUS + 1)));

  const quadros = lista.map((c) => {
    // Com uma coluna/linha só não há escala: centraliza em vez de jogar no canto.
    const x = escX === 0 ? larg / 2 : pad + (c.lng - lngMin) * escX;
    const y = escY === 0 ? alt / 2 : alt - pad - (c.lat - latMin) * escY;
    // sequencial: uma cor só, clara -> escura pela intensidade
    const intensidade = 0.25 + 0.75 * (c.n / maxN);
    return `<g><title>${c.n} leitura(s) nesta área</title>
      <rect x="${x - lado / 2}" y="${y - lado / 2}" width="${lado}" height="${lado}" rx="3"
            fill="${cor}" opacity="${intensidade.toFixed(2)}" /></g>`;
  }).join('');

  return `<div class="p-mapa">
    <svg viewBox="0 0 ${larg} ${alt}" role="img" aria-label="Mapa de calor das conferências">
      ${quadros}
    </svg>
    <p class="p-mapa-nota">
      Cada quadrado agrega cerca de 120 m; a cor mais forte indica mais volumes
      conferidos ali. Visão agregada — sem rastro individual.
      <a href="https://www.openstreetmap.org/#map=15/${(latMin + latMax) / 2}/${(lngMin + lngMax) / 2}"
         target="_blank" rel="noopener">Abrir a região no mapa</a>.
    </p>
  </div>`;
}
