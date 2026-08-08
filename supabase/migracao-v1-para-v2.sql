-- LogDis Entrega — migração v1 -> v2
--
-- Use este arquivo em projetos que JÁ rodaram o schema antigo (com a tabela
-- `grupos_rota`). Em projeto novo, rode apenas `schema.sql`.
--
-- O que muda: a transportadora deixa de ser um texto solto dentro do grupo de
-- rota e vira entidade, com códigos de rota únicos apontando para ela. É essa
-- unicidade que permite descobrir o dono do volume só a partir da etiqueta.
--
-- A migração preserva o histórico: o id do grupo vira o id da transportadora,
-- exatamente como faz o upgrade do IndexedDB no aparelho — os dois lados
-- convergem para os mesmos UUIDs e as sessões antigas continuam de pé.
--
-- Roda inteira dentro de uma transação: ou passa tudo, ou não muda nada.

begin;

-- ------------------------------------------------------- views antigas ----
-- As views apontam para colunas que vão sair (`grupo_nome`, `transportadora`).
-- Enquanto elas existirem, o Postgres recusa o ALTER. Caem aqui e voltam no
-- fim do arquivo, já no formato novo.

drop view if exists public.vw_divergencias;
drop view if exists public.vw_pedidos_incompletos;
drop view if exists public.vw_rotas_nao_cadastradas;
drop view if exists public.vw_cargas_aguardando_liberacao;

-- ------------------------------------------------------- tabelas novas ----

create table if not exists public.transportadoras (
  id             uuid primary key,
  nome           text not null,
  cnpj           text,
  responsavel    text,
  telefone       text,
  email          text,
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now(),
  recebido_em    timestamptz not null default now()
);

create table if not exists public.rotas (
  id                uuid primary key,
  codigo            text not null unique,
  nome              text not null,
  transportadora_id uuid not null references public.transportadoras(id),
  descricao         text,
  ativo             boolean not null default true,
  atualizado_em     timestamptz not null default now(),
  recebido_em       timestamptz not null default now()
);

create table if not exists public.dispositivos (
  id             uuid primary key,
  apelido        text,
  ultima_sync    timestamptz,
  pendentes      integer not null default 0,
  ultimo_usuario text,
  atualizado_em  timestamptz not null default now()
);

-- --------------------------------------------- grupos_rota -> cadastro ----
--
-- Tudo que toca a estrutura antiga vive dentro deste bloco condicional: rodar
-- a migração duas vezes tem que ser inofensivo. Na segunda vez `grupos_rota`
-- já não existe, e o bloco inteiro é pulado em vez de estourar.

do $migracao$
begin
  if to_regclass('public.grupos_rota') is null then
    raise notice 'grupos_rota não existe: cadastro já migrado, pulando.';
    return;
  end if;

  -- Cada grupo vira uma transportadora, mantendo o id. O nome vem do campo
  -- `transportadora` quando ele foi preenchido; senão, do nome do grupo.
  insert into public.transportadoras (id, nome, ativo, atualizado_em)
  select
    g.id,
    coalesce(nullif(btrim(g.transportadora), ''), g.nome),
    g.ativo,
    g.atualizado_em
  from public.grupos_rota g
  on conflict (id) do nothing;

  -- Cada prefixo do grupo vira um código de rota. Código repetido em grupos
  -- diferentes fica com o mais antigo: o índice é único, e cadastro ambíguo era
  -- justamente o problema que a v2 veio resolver. Confira a lista no fim.
  insert into public.rotas (id, codigo, nome, transportadora_id, ativo, atualizado_em)
  select distinct on (upper(btrim(codigo)))
    gen_random_uuid(),
    upper(btrim(codigo)),
    g.nome,
    g.id,
    g.ativo,
    g.atualizado_em
  from public.grupos_rota g
  cross join unnest(g.rotas) as codigo
  where btrim(codigo) <> ''
  order by upper(btrim(codigo)), g.atualizado_em, g.id
  on conflict (codigo) do nothing;

  -- ---------------------------------------------------------- sessões ----

  alter table public.sessoes
    add column if not exists transportadora_id uuid references public.transportadoras(id),
    add column if not exists transportadora_nome text,
    add column if not exists liberada_em timestamptz,
    add column if not exists liberada_por text,
    add column if not exists liberada_com_pendencias boolean not null default false;

  -- Dinâmico porque as colunas antigas só existem nesta primeira passada: o
  -- Postgres valida o corpo de um comando estático já na análise do bloco.
  execute $sql$
    update public.sessoes s
       set transportadora_id = coalesce(s.transportadora_id, s.grupo_rota_id),
           transportadora_nome = coalesce(
             s.transportadora_nome,
             nullif(btrim(s.transportadora), ''),
             s.grupo_nome
           )
     where s.transportadora_nome is null
  $sql$;

  alter table public.sessoes alter column transportadora_nome set not null;

  -- As colunas antigas precisam sair: `grupo_nome` era NOT NULL e o app novo
  -- não envia mais esse campo — mantê-las quebraria toda inserção daqui para
  -- frente.
  alter table public.sessoes drop column if exists grupo_rota_id;
  alter table public.sessoes drop column if exists grupo_nome;
  alter table public.sessoes drop column if exists transportadora;

  drop table if exists public.grupos_rota;
end
$migracao$;

-- Projeto que nunca teve `grupos_rota` (schema.sql novo) já tem estas colunas;
-- aqui elas são garantidas de qualquer forma.
alter table public.sessoes
  add column if not exists transportadora_id uuid references public.transportadoras(id),
  add column if not exists transportadora_nome text,
  add column if not exists liberada_em timestamptz,
  add column if not exists liberada_por text,
  add column if not exists liberada_com_pendencias boolean not null default false;

-- ----------------------------------------------------------- leituras ----

alter table public.leituras
  add column if not exists rota_id uuid references public.rotas(id),
  add column if not exists transportadora_dona_id uuid references public.transportadoras(id),
  add column if not exists transportadora_dona_nome text,
  add column if not exists dispositivo_id uuid;

-- Novo estado: código de rota que ninguém cadastrou. Não é divergência — o
-- sistema não sabe de quem é a caixa.
alter table public.leituras drop constraint if exists leituras_status_check;
alter table public.leituras add constraint leituras_status_check
  check (status in ('OK', 'ROTA_DIVERGENTE', 'DESTINO_NAO_MAPEADO', 'DUPLICADO', 'INVALIDO'));

-- Histórico ganha o dono do código, quando ele existe no cadastro migrado.
-- Sem isso, o relatório antigo não saberia dizer de quem era a caixa.
--
-- O `status` das leituras antigas NÃO é recalculado: ele registra o que o
-- sistema respondeu na doca, com o cadastro que existia naquele momento. Uma
-- leitura que hoje seria DESTINO_NAO_MAPEADO continua como foi classificada —
-- reescrever isso seria apagar o que de fato aconteceu.
update public.leituras l
   set rota_id = r.id,
       transportadora_dona_id = r.transportadora_id,
       transportadora_dona_nome = t.nome
  from public.rotas r
  join public.transportadoras t on t.id = r.transportadora_id
 where l.rota_prefixo = r.codigo
   and l.rota_id is null;

-- ------------------------------------------------------------ índices ----

create index if not exists idx_rotas_transp        on public.rotas (transportadora_id);
create index if not exists idx_transp_atualizado   on public.transportadoras (atualizado_em);
create index if not exists idx_rotas_atualizado    on public.rotas (atualizado_em);
create index if not exists idx_usuarios_atualizado on public.usuarios (atualizado_em);
create index if not exists idx_sessoes_liberar     on public.sessoes (fim desc) where liberada_em is null;

-- ---------------------------------------------------------------- RLS ----

alter table public.transportadoras enable row level security;
alter table public.rotas           enable row level security;
alter table public.dispositivos    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['transportadoras', 'rotas', 'dispositivos'] loop
    execute format('drop policy if exists app_insert on public.%I', t);
    execute format('drop policy if exists app_update on public.%I', t);
    execute format('drop policy if exists app_select on public.%I', t);
    execute format($f$create policy app_insert on public.%I for insert to anon, authenticated with check (true)$f$, t);
    execute format($f$create policy app_update on public.%I for update to anon, authenticated using (true) with check (true)$f$, t);
    execute format($f$create policy app_select on public.%I for select to authenticated using (true)$f$, t);
  end loop;
end $$;

-- O aparelho precisa LER o cadastro para validar offline. Leitura, ocorrência
-- e sessão continuam fechadas para `anon` — dessas ele só escreve.
do $$
declare t text;
begin
  foreach t in array array['transportadoras', 'rotas', 'usuarios', 'dispositivos'] loop
    execute format('drop policy if exists app_select_anon on public.%I', t);
    execute format($f$create policy app_select_anon on public.%I for select to anon using (true)$f$, t);
  end loop;
end $$;

-- ------------------------------------------------------------- views ----
-- Recriadas no formato novo (foram derrubadas no começo do arquivo).

create view public.vw_divergencias as
select
  l.id,
  l.lido_em,
  l.codigo_volume,
  l.rota                     as rota_lida,
  l.pedido,
  s.transportadora_nome      as transportadora_conferida,
  l.transportadora_dona_nome as transportadora_dona,
  s.rotas                    as rotas_da_carga,
  s.usuario_nome             as conferente,
  l.lat, l.lng, l.precisao_metros, l.geo_status
from public.leituras l
join public.sessoes s on s.id = l.sessao_id
where l.status = 'ROTA_DIVERGENTE';

create view public.vw_rotas_nao_cadastradas as
select
  l.rota_prefixo as codigo,
  count(*)       as volumes,
  min(l.lido_em) as primeira_leitura,
  max(l.lido_em) as ultima_leitura,
  array_agg(distinct s.transportadora_nome) as apareceu_conferindo
from public.leituras l
join public.sessoes s on s.id = l.sessao_id
where l.status = 'DESTINO_NAO_MAPEADO' and l.rota_prefixo is not null
  and not exists (select 1 from public.rotas r where r.codigo = l.rota_prefixo)
group by l.rota_prefixo;

create view public.vw_cargas_aguardando_liberacao as
select
  s.id, s.inicio, s.fim, s.transportadora_nome, s.usuario_nome,
  count(l.id) filter (where l.status = 'ROTA_DIVERGENTE')     as divergencias,
  count(l.id) filter (where l.status = 'DESTINO_NAO_MAPEADO') as nao_mapeados
from public.sessoes s
left join public.leituras l on l.sessao_id = s.id
where s.status = 'ENCERRADA' and s.liberada_em is null
group by s.id;

-- Continua valendo igual: a checagem sai do próprio QR, sem manifesto.
create view public.vw_pedidos_incompletos as
select
  l.pedido,
  max(l.rota)                    as rota,
  max(l.volume_total)            as volumes_declarados,
  count(distinct l.volume_atual) as volumes_bipados,
  min(l.lido_em)                 as primeiro,
  max(l.lido_em)                 as ultimo
from public.leituras l
where l.status <> 'INVALIDO' and l.pedido is not null and l.volume_total is not null
group by l.pedido
having count(distinct l.volume_atual) < max(l.volume_total);

commit;

-- --------------------------------------------------------- conferência ----
-- Rode depois do commit e confira antes de liberar o app novo.
--
--   select count(*) as transportadoras from public.transportadoras;
--   select codigo, nome from public.rotas order by codigo;
--   select count(*) as sessoes_sem_transportadora
--     from public.sessoes where transportadora_id is null;
--
-- Se alguma sessão ficou sem transportadora, o grupo dela foi apagado antes da
-- migração: o nome congelado continua em `transportadora_nome` e o relatório
-- daquela conferência segue correto.
