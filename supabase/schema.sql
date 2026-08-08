-- LogDis Entrega — schema do destino de sincronização.
--
-- Rode este arquivo no SQL Editor do projeto Supabase.
-- O app é offline-first: o IndexedDB do aparelho é a fonte da verdade durante a
-- operação e estas tabelas recebem os registros depois, por upsert em `id`.
-- Por isso todas as chaves primárias são geradas no cliente (uuid v4).

-- ---------------------------------------------------------------- pessoas ---
-- A senha NUNCA sai do aparelho: a autenticação da v1 é local. Aqui ficam só os
-- dados que o relatório precisa mostrar.
create table if not exists public.usuarios (
  id             uuid primary key,
  nome           text not null,
  login          text not null,
  gestor         boolean not null default false,
  funcao         text,           -- descritivo; não é regra de acesso
  telefone       text,
  placa          text,
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now(),
  recebido_em    timestamptz not null default now()
);

-- ---------------------------------------------------------- grupos de rota ---
-- `rotas` guarda os prefixos alfabéticos ('FNOR'); a leitura 'FNOR 100' casa
-- com o prefixo, o sufixo numérico é sequência de carga.
create table if not exists public.grupos_rota (
  id             uuid primary key,
  nome           text not null,
  rotas          text[] not null default '{}',
  transportadora text,
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now(),
  recebido_em    timestamptz not null default now()
);

-- --------------------------------------------------------------- sessões ----
-- grupo_nome/rotas/usuario_nome são cópias congeladas: o relatório de ontem não
-- pode mudar porque alguém renomeou um grupo hoje.
create table if not exists public.sessoes (
  id             uuid primary key,
  grupo_rota_id  uuid references public.grupos_rota(id),
  usuario_id     uuid references public.usuarios(id),
  inicio         timestamptz not null,
  fim            timestamptz,
  status         text not null check (status in ('ABERTA', 'ENCERRADA')),
  grupo_nome     text not null,
  rotas          text[] not null default '{}',
  transportadora text,
  usuario_nome   text not null,
  geo_inicio     jsonb,
  geo_fim        jsonb,
  atualizado_em  timestamptz not null default now(),
  recebido_em    timestamptz not null default now()
);

-- --------------------------------------------------------------- leituras ---
-- raw_data é a prova do que foi lido de fato. Nunca normalizar, nunca apagar.
create table if not exists public.leituras (
  id              uuid primary key,
  sessao_id       uuid not null references public.sessoes(id),
  codigo_volume   text,
  rota            text,
  rota_prefixo    text,
  volume          text,
  volume_atual    integer,
  volume_total    integer,
  pedido          text,
  status          text not null check (status in ('OK', 'ROTA_DIVERGENTE', 'DUPLICADO', 'INVALIDO')),
  lido_em         timestamptz not null,
  raw_data        text not null,
  origem          text not null default 'CAMERA' check (origem in ('CAMERA', 'MANUAL')),
  motivo_invalido text,
  lat             double precision,
  lng             double precision,
  precisao_metros integer,
  geo_status      text not null default 'INDISPONIVEL'
                  check (geo_status in ('OK', 'NEGADO', 'INDISPONIVEL', 'IMPRECISO')),
  atualizado_em   timestamptz not null default now(),
  recebido_em     timestamptz not null default now()
);

-- ------------------------------------------------------------ ocorrências ---
-- leitura_id é nulo quando a ocorrência é da entrega inteira ("cheguei 7h, só
-- me atenderam 9h20"). `grave` é derivado das etiquetas, nunca digitado.
-- Ocorrência é imutável: correção se faz adicionando outra.
create table if not exists public.ocorrencias (
  id              uuid primary key,
  sessao_id       uuid not null references public.sessoes(id),
  leitura_id      uuid references public.leituras(id),
  codigo_volume   text,
  usuario_id      uuid references public.usuarios(id),
  momento         text not null check (momento in ('EXPEDICAO', 'TRANSPORTADORA')),
  texto           text not null default '',
  etiquetas       text[] not null default '{}',
  grave           boolean not null default false,
  fotos           text[] not null default '{}',  -- caminhos no Storage
  registrado_em   timestamptz not null,
  lat             double precision,
  lng             double precision,
  precisao_metros integer,
  geo_status      text not null default 'INDISPONIVEL',
  atualizado_em   timestamptz not null default now(),
  recebido_em     timestamptz not null default now()
);

-- ---------------------------------------------------------------- índices ---
create index if not exists idx_leituras_sessao   on public.leituras (sessao_id);
create index if not exists idx_leituras_lido_em  on public.leituras (lido_em desc);
create index if not exists idx_leituras_status   on public.leituras (status) where status <> 'OK';
create index if not exists idx_leituras_pedido   on public.leituras (pedido);
create index if not exists idx_ocorr_sessao      on public.ocorrencias (sessao_id);
create index if not exists idx_ocorr_momento     on public.ocorrencias (momento, registrado_em desc);
create index if not exists idx_ocorr_grave       on public.ocorrencias (registrado_em desc) where grave;
create index if not exists idx_sessoes_inicio    on public.sessoes (inicio desc);
create index if not exists idx_sessoes_abertas   on public.sessoes (status) where status = 'ABERTA';

-- Busca em texto livre da ocorrência: o gestor precisa achar "doca fechada"
-- sem depender de alguém ter marcado a etiqueta certa.
create index if not exists idx_ocorr_texto
  on public.ocorrencias using gin (to_tsvector('portuguese', texto));

-- ------------------------------------------------------------------- RLS ----
-- ATENÇÃO: as políticas abaixo são o mínimo para o app do galpão funcionar com
-- a chave anônima (que fica no aparelho e é, na prática, pública).
-- O aparelho precisa ESCREVER; ele não precisa LER os dados de volta, porque a
-- fonte da verdade é local. Por isso: insert/update liberados, select fechado
-- (exceto grupos_rota, usado pelo teste de conexão do painel).
-- Antes de produção, troque isto por autenticação Supabase de verdade e
-- políticas por usuário.
alter table public.usuarios    enable row level security;
alter table public.grupos_rota enable row level security;
alter table public.sessoes     enable row level security;
alter table public.leituras    enable row level security;
alter table public.ocorrencias enable row level security;

do $$
declare t text;
begin
  foreach t in array array['usuarios', 'grupos_rota', 'sessoes', 'leituras', 'ocorrencias'] loop
    execute format('drop policy if exists app_insert on public.%I', t);
    execute format('drop policy if exists app_update on public.%I', t);
    execute format($f$create policy app_insert on public.%I for insert to anon, authenticated with check (true)$f$, t);
    execute format($f$create policy app_update on public.%I for update to anon, authenticated using (true) with check (true)$f$, t);
    execute format('drop policy if exists app_select on public.%I', t);
    execute format($f$create policy app_select on public.%I for select to authenticated using (true)$f$, t);
  end loop;
end $$;

-- teste de conexão do painel do gestor
drop policy if exists app_select_anon on public.grupos_rota;
create policy app_select_anon on public.grupos_rota for select to anon using (true);

-- --------------------------------------------------------------- storage ----
-- Bucket privado para as fotos das ocorrências (evidência de avaria).
insert into storage.buckets (id, name, public)
values ('ocorrencias', 'ocorrencias', false)
on conflict (id) do nothing;

drop policy if exists ocorrencias_upload on storage.objects;
create policy ocorrencias_upload on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'ocorrencias');

drop policy if exists ocorrencias_update on storage.objects;
create policy ocorrencias_update on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'ocorrencias')
  with check (bucket_id = 'ocorrencias');

drop policy if exists ocorrencias_leitura on storage.objects;
create policy ocorrencias_leitura on storage.objects
  for select to authenticated
  using (bucket_id = 'ocorrencias');

-- ------------------------------------------------------------------ views ---
-- Divergência é o alarme principal: uma view pronta para BI/planilha.
create or replace view public.vw_divergencias as
select
  l.id,
  l.lido_em,
  l.codigo_volume,
  l.rota            as rota_lida,
  l.pedido,
  s.grupo_nome      as carga,
  s.rotas           as rotas_da_carga,
  s.usuario_nome    as conferente,
  s.transportadora,
  l.lat, l.lng, l.precisao_metros, l.geo_status
from public.leituras l
join public.sessoes s on s.id = l.sessao_id
where l.status = 'ROTA_DIVERGENTE';

-- Pedidos incompletos derivados do próprio QR (bipou 0001/0002 e o 0002 nunca veio).
create or replace view public.vw_pedidos_incompletos as
select
  l.pedido,
  max(l.rota)                       as rota,
  max(l.volume_total)               as volumes_declarados,
  count(distinct l.volume_atual)    as volumes_bipados,
  min(l.lido_em)                    as primeiro,
  max(l.lido_em)                    as ultimo
from public.leituras l
where l.status <> 'INVALIDO' and l.pedido is not null and l.volume_total is not null
group by l.pedido
having count(distinct l.volume_atual) < max(l.volume_total);
