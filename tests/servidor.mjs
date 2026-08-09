// servidor.mjs — sobe o `vite preview` para os testes de ponta a ponta e
// devolve a URL. Os testes precisam do build real: service worker e precache
// não existem no modo dev.

import { spawn } from 'node:child_process';
import { setTimeout as espere } from 'node:timers/promises';

export const PORTA = 4173;
export const BASE = `http://127.0.0.1:${PORTA}`;

async function respondendo() {
  try {
    const r = await fetch(`${BASE}/`);
    return r.ok;
  } catch {
    return false;
  }
}

export async function subirServidor() {
  // Já tem alguém servindo nessa porta (`npm run preview` aberto)? Aproveita.
  if (await respondendo()) return { base: BASE, parar: () => undefined };

  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORTA), '--host', '127.0.0.1'], {
    stdio: 'ignore',
    detached: false
  });

  for (let i = 0; i < 40; i++) {
    if (await respondendo()) return { proc, base: BASE, parar: () => proc.kill('SIGTERM') };
    await espere(250);
  }

  proc.kill('SIGTERM');
  throw new Error('vite preview não respondeu — rode `npm run build` antes.');
}

/** Playwright resolve o navegador por PLAYWRIGHT_BROWSERS_PATH; CHROMIUM_PATH força um binário. */
export const opcoesNavegador = {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
};
