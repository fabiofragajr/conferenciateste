// supabase.ts — cliente do destino de sincronização.
//
// O Supabase NÃO é dependência da conferência. Ele recebe o que já foi gravado
// localmente. Sem URL/chave configurada, o app funciona igual: tudo fica na
// fila local até alguém configurar.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ConfigSupabase } from '../types.js';
import * as db from './db.js';

const CHAVE_CONFIG = 'supabase.config';

const variaveis = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env;
const doAmbiente: ConfigSupabase = {
  url: variaveis?.VITE_SUPABASE_URL ?? '',
  anonKey: variaveis?.VITE_SUPABASE_ANON_KEY ?? '',
  bucket: variaveis?.VITE_SUPABASE_BUCKET ?? 'ocorrencias'
};

let cache: ConfigSupabase | null = null;
let cliente: SupabaseClient | null = null;
let clienteDe = '';

/**
 * Configuração do build (.env), ou a do aparelho quando existe — assim o gestor
 * aponta para outro projeto sem precisar recompilar o app.
 *
 * O que foi gravado aqui MANDA, inclusive em branco. Antes, campo vazio caía de
 * volta no .env: não havia como desligar a sincronização de um aparelho, e
 * apagar a URL na tela não fazia nada. Aparelho sem projeto guarda tudo local,
 * que é o comportamento offline normal.
 */
export async function obterConfig(): Promise<ConfigSupabase> {
  if (cache) return cache;
  const salva = await db.configGet<Partial<ConfigSupabase> | null>(CHAVE_CONFIG, null);
  const origem = salva ?? doAmbiente;
  cache = {
    url: (origem.url ?? '').trim(),
    anonKey: (origem.anonKey ?? '').trim(),
    bucket: (origem.bucket ?? '').trim() || 'ocorrencias'
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
    // A sessão autenticada é o que faz as políticas RLS reconhecerem usuário e
    // tenant. Persistir o refresh token permite voltar ao galpão e operar
    // offline depois de uma primeira entrada online.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    // A fila local já garante a entrega; não queremos retry agressivo segurando
    // a thread enquanto a pessoa bipa.
    global: { headers: { 'x-client-info': 'logdis-entrega' } }
  });
  clienteDe = assinatura;
  return cliente;
}

/** Login curto continua na UI; o Auth recebe um e-mail técnico determinístico. */
export function emailDeLogin(login: string): string {
  const limpo = String(login ?? '').trim().toLowerCase();
  return limpo.includes('@') ? limpo : `${limpo}@usuarios.logdis.local`;
}

export async function sessaoAutenticada(): Promise<boolean> {
  const c = await obterCliente();
  if (!c) return false;
  const { data, error } = await c.auth.getSession();
  return !error && Boolean(data.session?.user && !data.session.user.is_anonymous);
}

export async function entrarNoSupabase(login: string, senha: string): Promise<{ ok: true; authUserId: string } | { ok: false; erro: string }> {
  const c = await obterCliente();
  if (!c) return { ok: false, erro: 'Supabase não configurado.' };
  const { data, error } = await c.auth.signInWithPassword({ email: emailDeLogin(login), password: senha });
  if (error || !data.user) return { ok: false, erro: 'Login ou senha incorretos.' };
  return { ok: true, authUserId: data.user.id };
}

export async function sairDoSupabase(): Promise<void> {
  const c = await obterCliente();
  if (c) await c.auth.signOut({ scope: 'local' });
}

/** Teste de conectividade usado no painel do gestor. */
export async function testarConexao(): Promise<{ ok: boolean; mensagem: string }> {
  const c = await obterCliente();
  if (!c) return { ok: false, mensagem: 'Informe a URL e a chave anônima do projeto.' };
  const { error } = await c.from('transportadoras').select('id').limit(1);
  if (error) return { ok: false, mensagem: error.message };
  return { ok: true, mensagem: 'Conexão com o Supabase funcionando.' };
}
