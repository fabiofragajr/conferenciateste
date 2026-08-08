// mapa.ts — mapa relativo das bipagens de uma sessão.
//
// Não há base cartográfica: o app é offline e não vamos depender de servidor de
// tiles. O que interessa aqui é a dispersão dos pontos e o status de cada um.
// Cada status tem FORMA própria além da cor — vermelho e verde são o par mais
// difícil para daltonismo, e essa informação não pode depender só de cor.

import type { Leitura, StatusLeitura } from '../types.js';
import { STATUS_INFO } from './model.js';
import { esc, hora } from './util.js';

const FORMA: Record<StatusLeitura, string> = {
  OK: 'círculo',
  ROTA_DIVERGENTE: 'triângulo',
  DESTINO_NAO_MAPEADO: 'triângulo invertido',
  DUPLICADO: 'quadrado',
  INVALIDO: 'losango'
};

const L = 320; // largura do viewBox
const A = 190; // altura do viewBox
const M = 14;  // margem

function marca(status: StatusLeitura, x: number, y: number, impreciso: boolean): string {
  const cor = STATUS_INFO[status].cor;
  // ponto impreciso é desenhado vazado e tracejado: não desenhar precisão
  // que não existe.
  const pintura = impreciso
    ? `fill="none" stroke="${cor}" stroke-width="1.6" stroke-dasharray="2 1.6"`
    // contorno claro só para separar pontos sobrepostos, não para colorir
    : `fill="${cor}" stroke="#ffffff" stroke-width="1"`;
  const r = 4.6;

  switch (status) {
    case 'OK':
      return `<circle cx="${x}" cy="${y}" r="${r}" ${pintura} />`;
    case 'ROTA_DIVERGENTE':
      return `<polygon points="${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}" ${pintura} />`;
    case 'DESTINO_NAO_MAPEADO':
      return `<polygon points="${x},${y + r + 1} ${x + r + 1},${y - r} ${x - r - 1},${y - r}" ${pintura} />`;
    case 'DUPLICADO':
      return `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="1" ${pintura} />`;
    default:
      return `<polygon points="${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}" ${pintura} />`;
  }
}

/** Distância aproximada em metros entre dois pontos próximos. */
function metros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lat2 - lat1) * mLat, (lng2 - lng1) * mLng);
}

export function renderMapa(leituras: Leitura[]): string {
  const pontos = leituras.filter((l) => l.lat !== null && l.lng !== null && l.geoStatus !== 'NEGADO');

  if (!pontos.length) {
    return `<div class="p-mapa"><p class="p-mapa-nota">
      Nenhuma leitura desta conferência tem posição registrada — GPS negado ou sem
      sinal. As leituras continuam válidas; só não há evidência de local.
    </p></div>`;
  }

  const lats = pontos.map((p) => p.lat as number);
  const lngs = pontos.map((p) => p.lng as number);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);
  const latMeio = (latMin + latMax) / 2;

  const largMetros = Math.max(metros(latMeio, lngMin, latMeio, lngMax), 1);
  const altMetros = Math.max(metros(latMin, lngMin, latMax, lngMin), 1);
  const escala = Math.max(largMetros / (L - M * 2), altMetros / (A - M * 2));

  const proj = (p: Leitura): { x: number; y: number } => {
    const dx = metros(latMeio, lngMin, latMeio, p.lng as number) / escala;
    const dy = metros(latMin, lngMin, p.lat as number, lngMin) / escala;
    return {
      x: M + dx + (L - M * 2 - largMetros / escala) / 2,
      y: A - M - dy - (A - M * 2 - altMetros / escala) / 2
    };
  };

  const marcas = pontos.map((p) => {
    const { x, y } = proj(p);
    const titulo = `${p.codigoVolume ?? 'sem código'} • ${STATUS_INFO[p.status].curto} • ${hora(p.timestamp)}`
      + (p.precisaoMetros ? ` • ±${p.precisaoMetros} m` : '');
    return `<g><title>${esc(titulo)}</title>${marca(p.status, x, y, p.geoStatus === 'IMPRECISO')}</g>`;
  }).join('');

  const barraM = Math.max(5, Math.round((L / 5) * escala));
  const barraPx = barraM / escala;

  const usados = [...new Set(pontos.map((p) => p.status))] as StatusLeitura[];
  const legenda = usados.map((s) =>
    `<span><b style="color:${STATUS_INFO[s].cor}">${FORMA[s]}</b> ${esc(STATUS_INFO[s].curto)}</span>`
  ).join('');

  const temImpreciso = pontos.some((p) => p.geoStatus === 'IMPRECISO');

  return `<div class="p-mapa">
    <svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Dispersão das bipagens da conferência">
      <rect x="0" y="0" width="${L}" height="${A}" fill="#ffffff" rx="8" />
      ${marcas}
      <g>
        <line x1="${M}" y1="${A - 6}" x2="${M + barraPx}" y2="${A - 6}" stroke="#66706d" stroke-width="1.5" />
        <text x="${M + barraPx + 6}" y="${A - 3}" fill="#66706d" font-size="9">${barraM} m</text>
      </g>
    </svg>
    <div class="p-mapa-legenda">${legenda}${temImpreciso ? '<span>contorno tracejado = posição imprecisa</span>' : ''}</div>
    <p class="p-mapa-nota">
      Posição relativa entre as leituras (sem base cartográfica).
      <a href="https://www.openstreetmap.org/?mlat=${latMeio}&mlon=${(lngMin + lngMax) / 2}#map=17/${latMeio}/${(lngMin + lngMax) / 2}"
         target="_blank" rel="noopener">Abrir a região no mapa</a>.
    </p>
  </div>`;
}
