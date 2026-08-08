// geo.ts — posição durante a sessão.
//
// Regra dura: geolocalização NUNCA bloqueia a bipagem. GPS negado ou sem sinal
// grava a leitura assim mesmo, com o geoStatus correspondente.
// O rastreio existe apenas com sessão aberta — nunca em segundo plano.

import type { GeoStatus, PontoGeo } from '../types.js';

/** Dentro de galpão o sinal degrada muito; acima disso o ponto não é confiável. */
export const PRECISAO_LIMITE_M = 100;

/** Ponto velho demais não prova onde a pessoa está agora. */
const IDADE_MAX_MS = 5 * 60 * 1000;

export const GEO_ROTULO: Record<GeoStatus, string> = {
  OK: 'Local registrado',
  IMPRECISO: 'Local impreciso',
  NEGADO: 'Local não permitido',
  INDISPONIVEL: 'Sem sinal de GPS'
};

let watchId: number | null = null;
let ultima: { lat: number; lng: number; precisaoMetros: number; momento: number } | null = null;
let statusAtual: GeoStatus = 'INDISPONIVEL';
const ouvintes = new Set<(p: PontoGeo) => void>();

function notificar(): void {
  const s = snapshot();
  for (const fn of ouvintes) {
    try { fn(s); } catch { /* ouvinte quebrado não derruba o GPS */ }
  }
}

export function aoMudar(fn: (p: PontoGeo) => void): () => void {
  ouvintes.add(fn);
  fn(snapshot());
  return () => { ouvintes.delete(fn); };
}

export const ativo = (): boolean => watchId !== null;

export function iniciar(): void {
  if (!('geolocation' in navigator)) {
    statusAtual = 'INDISPONIVEL';
    notificar();
    return;
  }
  if (watchId !== null) return;

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      ultima = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        precisaoMetros: Math.round(pos.coords.accuracy),
        momento: pos.timestamp
      };
      statusAtual = ultima.precisaoMetros > PRECISAO_LIMITE_M ? 'IMPRECISO' : 'OK';
      notificar();
    },
    (err) => {
      statusAtual = err.code === err.PERMISSION_DENIED ? 'NEGADO' : 'INDISPONIVEL';
      notificar();
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
  );
}

export function parar(): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  ultima = null;
  statusAtual = 'INDISPONIVEL';
  notificar();
}

/** Ponto para carimbar numa leitura/ocorrência. Retorna na hora, nunca espera o GPS. */
export function snapshot(): PontoGeo {
  if (!ultima || statusAtual === 'NEGADO') {
    return { lat: null, lng: null, precisaoMetros: null, geoStatus: statusAtual };
  }
  const velho = Date.now() - ultima.momento > IDADE_MAX_MS;
  return {
    lat: ultima.lat,
    lng: ultima.lng,
    precisaoMetros: ultima.precisaoMetros,
    geoStatus: velho ? 'IMPRECISO' : statusAtual
  };
}
