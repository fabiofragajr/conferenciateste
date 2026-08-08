// supabase.ts — cliente do destino de sincronização.
//
// O Supabase NÃO é dependência da conferência. Ele recebe o que já foi gravado
// localmente. Sem URL/chave configurada, o app funciona igual: tudo fica na
// fila local até alguém configurar.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ConfigSupabase } from '../types.js';
import * as db from './db.js';

const CHAVE_CONFIG = 'supabase.config';

const doAmbiente: ConfigSupabase = {
  url: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  anonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  bucket: (import.meta.env.VITE_SUPABASE_BUCKET as string | undefined) ?? 'ocorrencias'
};

let cache: ConfigSupabase | null = null;
let cliente: SupabaseClient | null = null;
let clienteDe = '';

/**
 * Configuração do build (.env) com sobreposição gravada no aparelho — assim o
 * gestor aponta para outro projeto sem precisar recompilar o app.
 */
export async function obterConfig(): Promise<ConfigSupabase> {
  if (cache) return cache;
  const salva = await db.configGet<Partial<ConfigSupabase> | null>(CHAVE_CONFIG, null);
  cache = {
    url: (salva?.url || doAmbiente.url).trim(),
    anonKey: (salva?.anonKey || doAmbiente.anonKey).trim(),
    bucket: (salva?.bucket || doAmbiente.bucket).trim() || 'ocorrencias'
  };
  return cache;
}

export async function salvarConfig(config: Partial<ConfigSupabase>): Promise<ConfigSupabase> {
  const atual = await obterConfig();
  const nova: ConfigSupabase = {
    url: (config.url ?? atual.url).trim().replace(/\/+$/, ''),
    anonKey: (config.anonKey ?? atual.anonKey).trim(),
    bucket: (config.bucket ?? atual.bucket).trim() || 'ocorrencias'
  };
  await db.configSet(CHAVE_CONFIG, nova);
  cache = nova;
  cliente = null;
  return nova;
}

export async function estaConfigurado(): Promise<boolean> {
  const c = await obterConfig();
  return Boolean(c.url && c.anonKey);
}

export async function obterCliente(): Promise<SupabaseClient | null> {
  const c = await obterConfig();
  if (!c.url || !c.anonKey) return null;
  const assinatura = `${c.url}|${c.anonKey.slice(0, 12)}`;
  if (cliente && clienteDe === assinatura) return cliente;
  cliente = createClient(c.url, c.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // A fila local já garante a entrega; não queremos retry agressivo segurando
    // a thread enquanto a pessoa bipa.
    global: { headers: { 'x-client-info': 'logdis-entrega' } }
  });
  clienteDe = assinatura;
  return cliente;
}

/** Teste de conectividade usado no painel do gestor. */
export async function testarConexao(): Promise<{ ok: boolean; mensagem: string }> {
  const c = await obterCliente();
  if (!c) return { ok: false, mensagem: 'Informe a URL e a chave anônima do projeto.' };
  const { error } = await c.from('grupos_rota').select('id').limit(1);
  if (error) return { ok: false, mensagem: error.message };
  return { ok: true, mensagem: 'Conexão com o Supabase funcionando.' };
}
