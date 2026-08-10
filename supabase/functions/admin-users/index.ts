// Edge Function protegida para administrar Supabase Auth.
// Secrets esperados: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), {
  status, headers: { ...cors, 'Content-Type': 'application/json' }
});

const emailDeLogin = (login: string) => {
  const limpo = String(login ?? '').trim().toLowerCase();
  return limpo.includes('@') ? limpo : `${limpo}@usuarios.logdis.local`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authorization = req.headers.get('Authorization') ?? '';
  if (!url || !anon || !service || !authorization) return json({ erro: 'Função não configurada.' }, 500);

  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) return json({ erro: 'Sessão inválida.' }, 401);

  const { data: gestor } = await admin.from('usuarios').select('id,tenant_id,gestor,ativo')
    .eq('auth_user_id', authData.user.id).maybeSingle();
  const tenantDoToken = String(authData.user.app_metadata?.tenant_id ?? '');
  if (!gestor?.gestor || !gestor.ativo || !tenantDoToken || tenantDoToken !== gestor.tenant_id) {
    return json({ erro: 'Apenas gestores autenticados no tenant podem administrar usuários.' }, 403);
  }

  const corpo = await req.json().catch(() => ({})) as {
    acao?: 'criar' | 'atualizar' | 'excluir'; id?: string;
    dados?: Record<string, unknown>;
  };
  const dados = corpo.dados ?? {};

  try {
    if (corpo.acao === 'criar') {
      const login = String(dados.login ?? '').trim().toLowerCase();
      const senha = String(dados.senha ?? '');
      const nome = String(dados.nome ?? '').trim();
      if (!login || !nome || senha.length < 4) return json({ erro: 'Nome, login e senha são obrigatórios.' }, 400);

      const { data: criado, error } = await admin.auth.admin.createUser({
        email: emailDeLogin(login), password: senha, email_confirm: true,
        app_metadata: { tenant_id: gestor.tenant_id }
      });
      if (error || !criado.user) return json({ erro: error?.message ?? 'Não foi possível criar a conta.' }, 400);

      const perfil = {
        id: crypto.randomUUID(), auth_user_id: criado.user.id, tenant_id: gestor.tenant_id,
        nome, login, gestor: dados.gestor === true,
        funcao: String(dados.funcao ?? '').trim() || null,
        telefone: String(dados.telefone ?? '').trim() || null,
        placa: String(dados.placa ?? '').trim().toUpperCase() || null,
        ativo: dados.ativo !== false, atualizado_em: new Date().toISOString()
      };
      const inserido = await admin.from('usuarios').insert(perfil).select('id').single();
      if (inserido.error) {
        await admin.auth.admin.deleteUser(criado.user.id);
        return json({ erro: inserido.error.message }, 400);
      }
      return json({ id: perfil.id });
    }

    const id = String(corpo.id ?? '');
    const alvo = await admin.from('usuarios').select('id,auth_user_id,tenant_id').eq('id', id).maybeSingle();
    if (alvo.error || !alvo.data || alvo.data.tenant_id !== gestor.tenant_id) {
      return json({ erro: 'Usuário não encontrado neste tenant.' }, 404);
    }
    if (alvo.data.auth_user_id === authData.user.id && (corpo.acao === 'excluir' || dados.ativo === false || dados.gestor === false)) {
      return json({ erro: 'Você não pode remover o próprio acesso.' }, 400);
    }

    if (corpo.acao === 'excluir') {
      if (!alvo.data.auth_user_id) return json({ erro: 'Cadastro legado sem conta Auth vinculada.' }, 400);
      const removido = await admin.auth.admin.deleteUser(alvo.data.auth_user_id);
      if (removido.error) return json({ erro: removido.error.message }, 400);
      return json({ id });
    }

    if (corpo.acao === 'atualizar') {
      if (!alvo.data.auth_user_id) return json({ erro: 'Migre este usuário legado antes de editá-lo.' }, 400);
      const authCampos: { email?: string; password?: string; app_metadata?: Record<string, string> } = {};
      if (dados.login) authCampos.email = emailDeLogin(String(dados.login));
      if (dados.senha) authCampos.password = String(dados.senha);
      authCampos.app_metadata = { tenant_id: gestor.tenant_id };
      const atualizadoAuth = await admin.auth.admin.updateUserById(alvo.data.auth_user_id, authCampos);
      if (atualizadoAuth.error) return json({ erro: atualizadoAuth.error.message }, 400);

      const permitidos = ['nome', 'login', 'gestor', 'funcao', 'telefone', 'placa', 'ativo'];
      const perfil: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      for (const campo of permitidos) if (campo in dados) perfil[campo] = dados[campo];
      if (perfil.login) perfil.login = String(perfil.login).trim().toLowerCase();
      if (perfil.placa) perfil.placa = String(perfil.placa).trim().toUpperCase();
      const atualizado = await admin.from('usuarios').update(perfil).eq('id', id).eq('tenant_id', gestor.tenant_id);
      if (atualizado.error) return json({ erro: atualizado.error.message }, 400);
      return json({ id });
    }

    return json({ erro: 'Ação inválida.' }, 400);
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : 'Falha inesperada.' }, 500);
  }
});
