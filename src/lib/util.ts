// util.ts — helpers compartilhados pelo app do operador e pelos painéis.

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback com formato UUID v4 — o Supabase espera uuid nas chaves.
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += hex[(Math.random() * 4 | 0) + 8];
    else s += hex[Math.random() * 16 | 0];
  }
  return s;
}

export const agora = (): string => new Date().toISOString();

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
const fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const dataHora = (iso?: string | null): string => (iso ? fmtDataHora.format(new Date(iso)) : '—');
export const hora = (iso?: string | null): string => (iso ? fmtHora.format(new Date(iso)) : '—');
export const data = (iso?: string | null): string => (iso ? fmtData.format(new Date(iso)) : '—');

export function duracao(inicioIso: string, fimIso?: string | null): string {
  const fim = fimIso ? new Date(fimIso) : new Date();
  const ms = fim.getTime() - new Date(inicioIso).getTime();
  if (ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${m}min`;
}

export function minutosEntre(inicioIso: string, fimIso?: string | null): number {
  const fim = fimIso ? new Date(fimIso) : new Date();
  return Math.max(0, (fim.getTime() - new Date(inicioIso).getTime()) / 60000);
}

export function esc(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function baixarArquivo(conteudo: Blob | string, nome: string, tipo = 'text/plain'): void {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** CSV com ';' — é o que o Excel pt-BR abre sem assistente de importação. */
export function paraCSV(cabecalho: string[], linhas: (string | number | null | undefined)[][]): string {
  const campo = (v: string | number | null | undefined): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = [cabecalho, ...linhas].map((l) => l.map(campo).join(';')).join('\r\n');
  return `﻿${corpo}`;
}

export function limitesDoDia(d: Date = new Date()): { inicio: string; fim: string } {
  const ini = new Date(d);
  ini.setHours(0, 0, 0, 0);
  const fim = new Date(d);
  fim.setHours(23, 59, 59, 999);
  return { inicio: ini.toISOString(), fim: fim.toISOString() };
}

export const chaveMes = (iso: string): string => iso.slice(0, 7);

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function rotuloMes(chave: string): string {
  const [ano, mes] = chave.split('-');
  return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}

/** Chave do mês deslocado — usado na comparação com o período anterior. */
export function mesAnterior(chave: string, passos = 1): string {
  const [ano, mes] = chave.split('-').map(Number);
  const d = new Date(ano, mes - 1 - passos, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function pct(parte: number, total: number, casas = 1): number {
  if (!total) return 0;
  return Number(((parte / total) * 100).toFixed(casas));
}

export function $<T extends HTMLElement = HTMLElement>(sel: string, raiz: ParentNode = document): T {
  const el = raiz.querySelector<T>(sel);
  if (!el) throw new Error(`Elemento não encontrado: ${sel}`);
  return el;
}

export function $$<T extends HTMLElement = HTMLElement>(sel: string, raiz: ParentNode = document): T[] {
  return Array.from(raiz.querySelectorAll<T>(sel));
}

/**
 * Comprime a foto antes de gravar: o aparelho do operador tem pouco espaço e a
 * foto ainda vai subir para o Storage por uma rede ruim.
 */
export async function comprimirImagem(arquivo: File, ladoMax = 1280, qualidade = 0.72): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo).catch(() => null);
  if (!bitmap) return arquivo;

  const escala = Math.min(1, ladoMax / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * escala);
  const h = Math.round(bitmap.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return arquivo;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', qualidade);
  });
  return blob ?? arquivo;
}

/** Mantém a tela acesa durante a conferência; degrada em silêncio onde não houver suporte. */
export async function manterTelaAcesa(): Promise<{ liberar: () => void }> {
  type Sentinela = { release: () => Promise<void> };
  let sentinela: Sentinela | null = null;
  const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<Sentinela> } }).wakeLock;

  const pedir = async (): Promise<void> => {
    if (!wl) return;
    try {
      sentinela = await wl.request('screen');
    } catch {
      sentinela = null;
    }
  };

  const aoVoltar = (): void => {
    if (document.visibilityState === 'visible') void pedir();
  };

  await pedir();
  document.addEventListener('visibilitychange', aoVoltar);

  return {
    liberar: () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      void sentinela?.release().catch(() => undefined);
      sentinela = null;
    }
  };
}
