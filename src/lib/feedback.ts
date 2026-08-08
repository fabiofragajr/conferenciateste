// feedback.ts — cor, som e vibração por status.
// O resultado da leitura tem que ser entendido SEM LER, a um braço de distância,
// com luva e sob luz de galpão. Cada status tem assinatura sonora própria.

import type { StatusLeitura } from '../types.js';

interface Tom { freq: number; dur: number; atraso: number }
interface Perfil { cor: string; vibra: number[]; tons: Tom[] }

const PERFIL: Record<StatusLeitura, Perfil> = {
  OK: {
    cor: 'rgba(18, 161, 80, 0.80)',
    vibra: [70],
    tons: [{ freq: 1180, dur: 0.10, atraso: 0 }]
  },
  ROTA_DIVERGENTE: {
    // alarme: três graves seguidos, impossível confundir com o OK
    cor: 'rgba(217, 45, 32, 0.88)',
    vibra: [180, 90, 180, 90, 180],
    tons: [
      { freq: 300, dur: 0.16, atraso: 0 },
      { freq: 300, dur: 0.16, atraso: 0.22 },
      { freq: 300, dur: 0.22, atraso: 0.44 }
    ]
  },
  DESTINO_NAO_MAPEADO: {
    // Nem verde nem vermelho: o sistema não sabe de quem é a caixa. O padrão
    // sobe-desce-sobe é diferente dos outros três de propósito — dá para
    // reconhecer de longe, sem olhar a tela.
    cor: 'rgba(234, 88, 12, 0.86)',
    vibra: [60, 60, 200],
    tons: [
      { freq: 520, dur: 0.12, atraso: 0 },
      { freq: 340, dur: 0.12, atraso: 0.16 },
      { freq: 760, dur: 0.18, atraso: 0.32 }
    ]
  },
  DUPLICADO: {
    cor: 'rgba(232, 163, 61, 0.86)',
    vibra: [90, 70, 90],
    tons: [
      { freq: 620, dur: 0.11, atraso: 0 },
      { freq: 620, dur: 0.11, atraso: 0.17 }
    ]
  },
  INVALIDO: {
    cor: 'rgba(120, 126, 136, 0.86)',
    vibra: [260],
    tons: [{ freq: 200, dur: 0.30, atraso: 0 }]
  }
};

let audioCtx: AudioContext | null = null;
let overlayEl: HTMLElement | null = null;
let timerFlash: number | undefined;

/** Precisa ser chamado dentro de um gesto do usuário (o toque no login serve). */
export function prepararAudio(): void {
  if (!audioCtx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try { audioCtx = new AC(); } catch { audioCtx = null; }
  }
  if (audioCtx?.state === 'suspended') void audioCtx.resume().catch(() => undefined);
}

function tocar(tons: Tom[]): void {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined);
  const base = audioCtx.currentTime;
  for (const t of tons) {
    const osc = audioCtx.createOscillator();
    const ganho = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = t.freq;
    osc.connect(ganho);
    ganho.connect(audioCtx.destination);
    const ini = base + t.atraso;
    ganho.gain.setValueAtTime(0.0001, ini);
    ganho.gain.exponentialRampToValueAtTime(0.35, ini + 0.012);
    ganho.gain.exponentialRampToValueAtTime(0.0001, ini + t.dur);
    osc.start(ini);
    osc.stop(ini + t.dur + 0.03);
  }
}

export function definirOverlay(el: HTMLElement): void {
  overlayEl = el;
}

export function sinalizar(status: StatusLeitura): void {
  const p = PERFIL[status];

  if (overlayEl) {
    overlayEl.style.backgroundColor = p.cor;
    overlayEl.style.opacity = '1';
    window.clearTimeout(timerFlash);
    timerFlash = window.setTimeout(() => {
      if (overlayEl) overlayEl.style.opacity = '0';
    }, 260);
  }

  tocar(p.tons);
  try { navigator.vibrate?.(p.vibra); } catch { /* sem vibração, sem problema */ }
}

/** Confirmação leve: ocorrência salva, sessão encerrada. */
export function sinalizarAcao(): void {
  tocar([{ freq: 820, dur: 0.07, atraso: 0 }, { freq: 1100, dur: 0.09, atraso: 0.09 }]);
  try { navigator.vibrate?.([40, 40, 40]); } catch { /* idem */ }
}
