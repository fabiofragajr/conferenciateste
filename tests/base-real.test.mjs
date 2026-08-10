// Confere a base de produção de verdade — SÓ LEITURA, nada é gravado aqui.
//
// Os outros testes rodam com o aparelho sem projeto configurado, para uma
// rodada de teste não virar sessão de mentira no painel de quem está operando.
// Este fecha a única lacuna que isso abre: o cadastro que o app espera existe
// mesmo na base, e a descida consegue trazê-lo.
//
// Roda contra o projeto do `.env`. Sem `.env`, é pulado.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = (() => {
  try {
    return Object.fromEntries(
      readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        })
    );
  } catch {
    return {};
  }
})();

const URL_BASE = env.VITE_SUPABASE_URL;
const CHAVE = env.VITE_SUPABASE_ANON_KEY;
const LOGIN_TESTE = env.SUPABASE_TEST_LOGIN;
const SENHA_TESTE = env.SUPABASE_TEST_PASSWORD;

if (!URL_BASE || !CHAVE) {
  console.log('sem .env — pulando a checagem da base real');
  process.exit(0);
}

let falhou = false;
const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

const base = createClient(URL_BASE, CHAVE, { auth: { persistSession: false } });

await passo('a chave anônima não consegue ler cadastros', async () => {
  const { data, error } = await base.from('usuarios').select('id').limit(1);
  if (error) throw new Error(error.message);
  if (data.length) throw new Error('RLS expôs usuários para anon');
});

if (!LOGIN_TESTE || !SENHA_TESTE) {
  console.log('sem SUPABASE_TEST_LOGIN/PASSWORD — isolamento anon validado; pulando leitura autenticada');
  process.exit(falhou ? 1 : 0);
}

const email = LOGIN_TESTE.includes('@') ? LOGIN_TESTE : `${LOGIN_TESTE}@usuarios.logdis.local`;
const login = await base.auth.signInWithPassword({ email, password: SENHA_TESTE });
if (login.error) {
  console.error('não foi possível autenticar o teste:', login.error.message);
  process.exit(1);
}

await passo('usuário autenticado lê o cache mestre do próprio tenant', async () => {
  for (const tabela of ['usuarios', 'transportadoras', 'rotas']) {
    const { error } = await base.from(tabela).select('id').limit(1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
});

await passo('tenant e vínculo Auth existem (migração v4 aplicada)', async () => {
  const { error } = await base.from('usuarios').select('tenant_id,auth_user_id').limit(1);
  if (error) {
    throw new Error(`${error.message}\n       Rode supabase/migracao-v3-para-v4.sql no SQL Editor.`);
  }
});

await passo('existe um gestor ativo para entrar no painel', async () => {
  const { data, error } = await base.from('usuarios').select('login,nome').eq('gestor', true).eq('ativo', true);
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error('nenhum gestor ativo — ninguém abre o painel');
});

await passo('cada login aparece uma vez só', async () => {
  const { data, error } = await base.from('usuarios').select('tenant_id,login');
  if (error) throw new Error(error.message);
  const vistos = new Set();
  const repetidos = new Set();
  for (const u of data) {
    const chave = `${u.tenant_id}:${u.login}`;
    (vistos.has(chave) ? repetidos : vistos).add(chave);
  }
  if (repetidos.size) {
    throw new Error(`login repetido: ${[...repetidos].join(', ')}\n       Rode supabase/migracao-v2-para-v3.sql.`);
  }
});

await passo('cada transportadora aparece uma vez só', async () => {
  const { data, error } = await base.from('transportadoras').select('tenant_id,nome');
  if (error) throw new Error(error.message);
  const vistos = new Set();
  const repetidos = new Set();
  for (const t of data) {
    const chave = `${t.tenant_id}:${t.nome}`;
    (vistos.has(chave) ? repetidos : vistos).add(chave);
  }
  if (repetidos.size) {
    throw new Error(`nome repetido: ${[...repetidos].join(', ')}\n       Rode supabase/migracao-v2-para-v3.sql.`);
  }
});

await passo('cada código de rota tem uma dona só', async () => {
  const { data, error } = await base.from('rotas').select('tenant_id,codigo,transportadora_id');
  if (error) throw new Error(error.message);
  const dono = new Map();
  for (const r of data) {
    const chave = `${r.tenant_id}:${r.codigo}`;
    if (dono.has(chave) && dono.get(chave) !== r.transportadora_id) {
      throw new Error(`${r.codigo} tem mais de uma dona — a conferência não teria resposta`);
    }
    dono.set(chave, r.transportadora_id);
  }
});

if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nBASE_REAL_OK');
