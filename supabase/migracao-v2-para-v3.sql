-- LogDis Entrega — migração v2 -> v3
--
-- Rode depois de `migracao-v1-para-v2.sql`. Em projeto novo, rode só `schema.sql`.
--
-- O que esta migração conserta, e por quê:
--
-- O app criava um cadastro de exemplo em CADA aparelho (transportadora LOGDIS,
-- rotas FNOR/FSUL, usuários gestor/operador/sandro) com UUID gerado ali mesmo.
-- Esse cadastro subia. Como `rotas.codigo` é único, o segundo aparelho em diante
-- levava 409 para sempre — e, pior, o envio parava na primeira store que falhava:
-- `rotas` vem antes de `leituras`, então NENHUMA conferência daquele aparelho
-- chegava ao servidor. Ao mesmo tempo, `usuarios.login` e `transportadoras.nome`
-- não eram únicos, e cada aparelho somava mais uma cópia das mesmas pessoas e da
-- mesma transportadora.
--
-- O seed saiu do app: o cadastro nasce aqui, na base, e desce para os aparelhos.
-- Esta migração junta as cópias, impede que voltem e prepara a senha para
-- acompanhar o cadastro.
--
-- Roda inteira dentro de uma transação: ou passa tudo, ou não muda nada.

begin;

-- --------------------------------------------------------------- senha ----
--
-- ATENÇÃO, é uma troca consciente: o hash da senha passa a acompanhar o
-- cadastro. Sem isso, a senha definida pelo gestor no desktop não valeria no
-- celular da doca, e — pior — qualquer pessoa poderia reivindicar um login num
-- aparelho novo só digitando uma senha qualquer, porque o aparelho não tinha
-- contra o que conferir.
--
-- O hash é PBKDF2-SHA256, 210.000 iterações, com salt por usuário. Ainda assim,
-- a chave anônima está dentro do app e é pública na prática: quem a tiver
-- consegue LER esta coluna. Trate como proteção contra uso indevido casual, não
-- contra um atacante. O caminho definitivo continua sendo o do `schema.sql`:
-- autenticação de verdade do Supabase, com políticas por usuário.
alter table public.usuarios add column if not exists senha_hash text;

-- ----------------------------------------------------- pessoas repetidas ----
-- Mesma pessoa, um id por aparelho. Fica a mais antiga; sessões e ocorrências
-- das outras são repontadas para ela — o histórico de quem bipou não se perde.

create temporary table mapa_usuario on commit drop as
select u.id as antigo, c.id as novo
from public.usuarios u
join (
  select distinct on (lower(btrim(login))) id, lower(btrim(login)) as login
  from public.usuarios
  order by lower(btrim(login)), recebido_em, id
) c on c.login = lower(btrim(u.login))
where u.id <> c.id;

update public.sessoes s
   set usuario_id = m.novo
  from mapa_usuario m
 where s.usuario_id = m.antigo;

update public.ocorrencias o
   set usuario_id = m.novo
  from mapa_usuario m
 where o.usuario_id = m.antigo;

delete from public.usuarios u
 using mapa_usuario m
 where u.id = m.antigo;

-- O app normaliza o login para minúsculas; a base passa a garantir o mesmo.
update public.usuarios
   set login = lower(btrim(login))
 where login <> lower(btrim(login));

create unique index if not exists usuarios_login_key on public.usuarios (login);

-- ---------------------------------------------- transportadoras repetidas ----
-- Mesmo motivo, mesmo remédio. Rotas, sessões e a dona congelada na leitura
-- passam a apontar para a sobrevivente.

create temporary table mapa_transp on commit drop as
select t.id as antigo, c.id as novo
from public.transportadoras t
join (
  select distinct on (btrim(nome)) id, btrim(nome) as nome
  from public.transportadoras
  order by btrim(nome), recebido_em, id
) c on c.nome = btrim(t.nome)
where t.id <> c.id;

update public.rotas r
   set transportadora_id = m.novo
  from mapa_transp m
 where r.transportadora_id = m.antigo;

update public.sessoes s
   set transportadora_id = m.novo
  from mapa_transp m
 where s.transportadora_id = m.antigo;

update public.leituras l
   set transportadora_dona_id = m.novo
  from mapa_transp m
 where l.transportadora_dona_id = m.antigo;

delete from public.transportadoras t
 using mapa_transp m
 where t.id = m.antigo;

update public.transportadoras
   set nome = btrim(nome)
 where nome <> btrim(nome);

-- Duas transportadoras com o mesmo nome viram dois botões idênticos na tela do
-- operador. Ele não tem como escolher certo.
create unique index if not exists transportadoras_nome_key on public.transportadoras (nome);

-- ----------------------------------------------------- gestor da operação ----
-- Sandro entra SEM senha de propósito: nenhuma senha em texto no repositório.
-- Ele escolhe a dele na primeira entrada, e a partir daí ela vale em qualquer
-- aparelho. Se já existir, aqui só garantimos que o acesso ao painel está de pé.

insert into public.usuarios (id, nome, login, gestor, funcao, ativo, atualizado_em)
select gen_random_uuid(), 'Sandro', 'sandro', true, 'Gestor de transporte', true, now()
where not exists (select 1 from public.usuarios where login = 'sandro');

update public.usuarios
   set gestor = true, ativo = true, atualizado_em = now()
 where login = 'sandro'
   and (gestor is distinct from true or ativo is distinct from true);

commit;

-- --------------------------------------------------------- conferência ----
-- Rode depois do commit.
--
--   select login, nome, gestor, ativo, senha_hash is not null as tem_senha
--     from public.usuarios order by login;
--   select nome from public.transportadoras order by nome;
--   select codigo, nome, transportadora_id from public.rotas order by codigo;
--
-- Esperado: um login por pessoa, um nome por transportadora, e `sandro` com
-- gestor = true. `tem_senha` falso é o certo para quem ainda não entrou.


-- ======================================================================== --
-- OPCIONAL — restos dos testes automatizados
-- ======================================================================== --
--
-- As rodadas de teste deixaram cadastro na base ('Transportadora Sul',
-- 'Transportadora Beta', rota 'FLES', logins 'gestor' e 'operador'). Não apago
-- nada automaticamente: só você sabe o que virou cadastro de verdade.
--
-- Confira o que existe e o que depende de cada um:
--
--   select t.nome,
--          (select count(*) from public.rotas r where r.transportadora_id = t.id)    as rotas,
--          (select count(*) from public.sessoes s where s.transportadora_id = t.id)  as sessoes
--     from public.transportadoras t order by t.nome;
--
--   select u.login,
--          (select count(*) from public.sessoes s where s.usuario_id = u.id) as sessoes
--     from public.usuarios u order by u.login;
--
-- Para remover um login de teste que nunca conferiu nada:
--
--   delete from public.usuarios
--    where login in ('gestor', 'operador')
--      and not exists (select 1 from public.sessoes s where s.usuario_id = usuarios.id)
--      and not exists (select 1 from public.ocorrencias o where o.usuario_id = usuarios.id);
--
-- Para remover uma transportadora de teste sem rota e sem sessão:
--
--   delete from public.transportadoras t
--    where t.nome in ('Transportadora Sul', 'Transportadora Beta')
--      and not exists (select 1 from public.rotas r where r.transportadora_id = t.id)
--      and not exists (select 1 from public.sessoes s where s.transportadora_id = t.id)
--      and not exists (select 1 from public.leituras l where l.transportadora_dona_id = t.id);
--
-- Transportadora COM sessão não deve ser apagada: o relatório daquela
-- conferência aponta para ela. Desative em vez de apagar:
--
--   update public.transportadoras set ativo = false, atualizado_em = now()
--    where nome in ('Transportadora Sul', 'Transportadora Beta');
