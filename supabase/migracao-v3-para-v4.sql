-- LOGDIS v4 — administração online, operação offline-first e RLS por tenant.
-- Execute no SQL Editor depois da v3. É idempotente quanto a colunas/policies.

begin;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Tenant de compatibilidade para os dados anteriores à arquitetura multi-tenant.
insert into public.tenants (id, nome)
values ('00000000-0000-4000-8000-000000000001', 'Milfarma')
on conflict (id) do nothing;

create or replace function public.tenant_atual()
returns uuid language sql stable security invoker set search_path = '' as $$
  select nullif(auth.jwt() #>> '{app_metadata,tenant_id}', '')::uuid
$$;

alter table public.usuarios add column if not exists tenant_id uuid references public.tenants(id);
alter table public.usuarios add column if not exists auth_user_id uuid unique;
alter table public.usuarios drop constraint if exists usuarios_auth_user_id_fkey;
alter table public.usuarios add constraint usuarios_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete cascade;
alter table public.transportadoras add column if not exists tenant_id uuid references public.tenants(id);
alter table public.rotas add column if not exists tenant_id uuid references public.tenants(id);
alter table public.dispositivos add column if not exists tenant_id uuid references public.tenants(id);
alter table public.sessoes add column if not exists tenant_id uuid references public.tenants(id);
alter table public.leituras add column if not exists tenant_id uuid references public.tenants(id);
alter table public.ocorrencias add column if not exists tenant_id uuid references public.tenants(id);

do $$
declare tabela text;
begin
  foreach tabela in array array[
    'usuarios','transportadoras','rotas','dispositivos','sessoes','leituras','ocorrencias'
  ] loop
    execute format(
      'update public.%I set tenant_id = %L where tenant_id is null',
      tabela, '00000000-0000-4000-8000-000000000001'
    );
    execute format('alter table public.%I alter column tenant_id set not null', tabela);
    execute format(
      'alter table public.%I alter column tenant_id set default public.tenant_atual()', tabela
    );
    execute format('create index if not exists %I on public.%I (tenant_id)', 'idx_' || tabela || '_tenant', tabela);
  end loop;
end $$;

-- Liga perfis existentes a contas Auth já criadas com o e-mail técnico.
update public.usuarios u
   set auth_user_id = a.id
  from auth.users a
 where u.auth_user_id is null
   and lower(a.email) = lower(u.login || '@usuarios.logdis.local');

-- Autorização fica em app_metadata: usuário comum não consegue alterá-la.
update auth.users a
   set raw_app_meta_data = coalesce(a.raw_app_meta_data, '{}'::jsonb)
       || jsonb_build_object('tenant_id', u.tenant_id::text)
  from public.usuarios u
 where u.auth_user_id = a.id
   and coalesce(a.raw_app_meta_data ->> 'tenant_id', '') <> u.tenant_id::text;

-- Credenciais não pertencem ao cache nem à tabela pública.
alter table public.usuarios drop column if exists senha_hash;

-- Unicidade é por tenant. O mesmo código pode existir em organizações isoladas.
alter table public.usuarios drop constraint if exists usuarios_login_key;
drop index if exists public.usuarios_login_key;
alter table public.transportadoras drop constraint if exists transportadoras_nome_key;
drop index if exists public.transportadoras_nome_key;
alter table public.rotas drop constraint if exists rotas_codigo_key;
drop index if exists public.rotas_codigo_key;
create unique index if not exists usuarios_tenant_login_key on public.usuarios (tenant_id, login);
create unique index if not exists transportadoras_tenant_nome_key on public.transportadoras (tenant_id, nome);
create unique index if not exists rotas_tenant_codigo_key on public.rotas (tenant_id, codigo);

create or replace function public.gestor_do_tenant()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u
     where u.auth_user_id = auth.uid()
       and u.tenant_id = public.tenant_atual()
       and u.gestor and u.ativo
  )
$$;

grant execute on function public.tenant_atual() to authenticated;
grant execute on function public.gestor_do_tenant() to authenticated;

-- Remove as policies permissivas antigas, inclusive acesso anon.
do $$
declare tabela text; politica record;
begin
  foreach tabela in array array[
    'tenants','usuarios','transportadoras','rotas','dispositivos','sessoes','leituras','ocorrencias'
  ] loop
    execute format('alter table public.%I enable row level security', tabela);
    for politica in select policyname from pg_policies where schemaname = 'public' and tablename = tabela loop
      execute format('drop policy if exists %I on public.%I', politica.policyname, tabela);
    end loop;
  end loop;
end $$;

create policy tenant_leitura on public.tenants for select to authenticated
  using (id = public.tenant_atual());

create policy usuarios_leitura on public.usuarios for select to authenticated
  using (tenant_id = public.tenant_atual());
-- Escritas em perfis passam somente pela Edge Function admin-users. Ela valida
-- gestor + tenant e usa service_role apenas no servidor.

do $$
declare tabela text;
begin
  foreach tabela in array array['transportadoras','rotas'] loop
    execute format(
      'create policy mestre_leitura on public.%I for select to authenticated using (tenant_id = public.tenant_atual())', tabela
    );
    execute format(
      'create policy mestre_admin_insert on public.%I for insert to authenticated with check (tenant_id = public.tenant_atual() and public.gestor_do_tenant())', tabela
    );
    execute format(
      'create policy mestre_admin_update on public.%I for update to authenticated using (tenant_id = public.tenant_atual() and public.gestor_do_tenant()) with check (tenant_id = public.tenant_atual() and public.gestor_do_tenant())', tabela
    );
    execute format(
      'create policy mestre_admin_delete on public.%I for delete to authenticated using (tenant_id = public.tenant_atual() and public.gestor_do_tenant())', tabela
    );
  end loop;
end $$;

-- Uma rota do tenant nunca pode apontar para transportadora de outro tenant.
drop policy if exists mestre_admin_insert on public.rotas;
drop policy if exists mestre_admin_update on public.rotas;
create policy rota_admin_insert on public.rotas for insert to authenticated
  with check (
    tenant_id = public.tenant_atual() and public.gestor_do_tenant()
    and exists (
      select 1 from public.transportadoras t
       where t.id = transportadora_id and t.tenant_id = public.tenant_atual()
    )
  );
create policy rota_admin_update on public.rotas for update to authenticated
  using (tenant_id = public.tenant_atual() and public.gestor_do_tenant())
  with check (
    tenant_id = public.tenant_atual() and public.gestor_do_tenant()
    and exists (
      select 1 from public.transportadoras t
       where t.id = transportadora_id and t.tenant_id = public.tenant_atual()
    )
  );

create policy dispositivos_tenant on public.dispositivos for select to authenticated
  using (tenant_id = public.tenant_atual());
create policy dispositivos_insert on public.dispositivos for insert to authenticated
  with check (tenant_id = public.tenant_atual());
create policy dispositivos_update on public.dispositivos for update to authenticated
  using (tenant_id = public.tenant_atual()) with check (tenant_id = public.tenant_atual());

create policy sessoes_tenant_select on public.sessoes for select to authenticated
  using (tenant_id = public.tenant_atual());
create policy sessoes_tenant_insert on public.sessoes for insert to authenticated
  with check (
    tenant_id = public.tenant_atual()
    and exists (select 1 from public.usuarios u where u.id = usuario_id and u.tenant_id = public.tenant_atual())
    and exists (select 1 from public.transportadoras t where t.id = transportadora_id and t.tenant_id = public.tenant_atual())
  );
create policy sessoes_tenant_update on public.sessoes for update to authenticated
  using (tenant_id = public.tenant_atual())
  with check (
    tenant_id = public.tenant_atual()
    and exists (select 1 from public.usuarios u where u.id = usuario_id and u.tenant_id = public.tenant_atual())
    and exists (select 1 from public.transportadoras t where t.id = transportadora_id and t.tenant_id = public.tenant_atual())
  );

create policy leituras_tenant_select on public.leituras for select to authenticated
  using (tenant_id = public.tenant_atual());
create policy leituras_tenant_insert on public.leituras for insert to authenticated
  with check (
    tenant_id = public.tenant_atual()
    and exists (select 1 from public.sessoes s where s.id = sessao_id and s.tenant_id = public.tenant_atual())
    and (rota_id is null or exists (
      select 1 from public.rotas r where r.id = rota_id and r.tenant_id = public.tenant_atual()
    ))
    and (transportadora_dona_id is null or exists (
      select 1 from public.transportadoras t
       where t.id = transportadora_dona_id and t.tenant_id = public.tenant_atual()
    ))
  );
create policy leituras_tenant_update on public.leituras for update to authenticated
  using (tenant_id = public.tenant_atual())
  with check (
    tenant_id = public.tenant_atual()
    and exists (select 1 from public.sessoes s where s.id = sessao_id and s.tenant_id = public.tenant_atual())
    and (rota_id is null or exists (
      select 1 from public.rotas r where r.id = rota_id and r.tenant_id = public.tenant_atual()
    ))
    and (transportadora_dona_id is null or exists (
      select 1 from public.transportadoras t
       where t.id = transportadora_dona_id and t.tenant_id = public.tenant_atual()
    ))
  );

create policy ocorrencias_tenant_select on public.ocorrencias for select to authenticated
  using (tenant_id = public.tenant_atual());
create policy ocorrencias_tenant_insert on public.ocorrencias for insert to authenticated
  with check (
    tenant_id = public.tenant_atual()
    and exists (select 1 from public.sessoes s where s.id = sessao_id and s.tenant_id = public.tenant_atual())
    and exists (select 1 from public.usuarios u where u.id = usuario_id and u.tenant_id = public.tenant_atual())
  );
-- Ocorrência é imutável: não há policy de update/delete para o cliente.

-- Storage: primeiro diretório do caminho é sempre o tenant.
drop policy if exists ocorrencias_upload on storage.objects;
drop policy if exists ocorrencias_update on storage.objects;
drop policy if exists ocorrencias_leitura on storage.objects;
create policy ocorrencias_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'ocorrencias' and (storage.foldername(name))[1] = public.tenant_atual()::text);
create policy ocorrencias_update on storage.objects for update to authenticated
  using (bucket_id = 'ocorrencias' and (storage.foldername(name))[1] = public.tenant_atual()::text)
  with check (bucket_id = 'ocorrencias' and (storage.foldername(name))[1] = public.tenant_atual()::text);
create policy ocorrencias_leitura on storage.objects for select to authenticated
  using (bucket_id = 'ocorrencias' and (storage.foldername(name))[1] = public.tenant_atual()::text);

-- As views também devem executar com os privilégios de quem consulta. Sem
-- isso, uma view criada pelo proprietário pode contornar o RLS das tabelas-base.
alter view public.vw_divergencias set (security_invoker = true);
alter view public.vw_pedidos_incompletos set (security_invoker = true);
alter view public.vw_rotas_nao_cadastradas set (security_invoker = true);
alter view public.vw_cargas_aguardando_liberacao set (security_invoker = true);

commit;

-- BOOTSTRAP DO PRIMEIRO GESTOR
-- 1. Crie a conta no painel Authentication > Users com o e-mail técnico:
--      sandro@usuarios.logdis.local
-- 2. Execute o bloco abaixo no SQL Editor. Depois disso, o próprio Sandro cria
--    e administra as demais contas pela Edge Function admin-users.
--
-- insert into public.usuarios (
--   id, auth_user_id, tenant_id, nome, login, gestor, funcao, telefone, placa, ativo
-- )
-- select gen_random_uuid(), a.id, '00000000-0000-4000-8000-000000000001',
--        'Sandro', 'sandro', true, 'Gestor de transporte', null, null, true
--   from auth.users a
--  where lower(a.email) = 'sandro@usuarios.logdis.local'
-- on conflict (tenant_id, login) do update
--   set auth_user_id = excluded.auth_user_id, gestor = true, ativo = true;
--
-- update auth.users
--    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--        || '{"tenant_id":"00000000-0000-4000-8000-000000000001"}'::jsonb
--  where lower(email) = 'sandro@usuarios.logdis.local';
