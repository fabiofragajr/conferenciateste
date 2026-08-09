-- limpar-e-recadastrar.sql — zera a base e deixa o cadastro de partida.
--
-- ATENÇÃO: apaga dados de verdade e NÃO tem volta. Rode no editor SQL do
-- Supabase (Dashboard → SQL Editor), lendo antes o que cada bloco faz.
--
-- Por que aqui e não pelo app: a chave anônima que o app carrega tem `insert`,
-- `update` e `select`, e nenhuma política de `delete` (schema.sql, seção de
-- RLS). Isso é proteção proposital — qualquer celular com o app instalado
-- carrega essa chave, e uma chave que apaga em massa num aparelho perdido é um
-- estrago que ninguém desfaz. O editor SQL roda com privilégio de dono, para
-- uma operação que é do dono mesmo.
--
-- Estado ao terminar:
--   usuarios        → só `sandro`
--   transportadoras → só `DHM AWAY`
--   rotas           → FCEN, FSUL, FNOR, FOES, FABC, FLES, todas da DHM AWAY
--   dispositivos, sessoes, leituras, ocorrencias → vazias
--
-- ==========================================================================
-- ANTES DE RODAR: os aparelhos não sabem que isto aconteceu
-- ==========================================================================
-- A descida de cadastro é incremental (`atualizado_em > desde`) e não tem como
-- dizer "isto foi apagado". Todo celular e todo desktop que já baixou o
-- cadastro antigo continua com LOGDIS, Transportadora Sul e as rotas velhas na
-- base local, e vai continuar mostrando esses botões para o operador escolher.
--
-- Não é só cosmético. `sessoes.transportadora_id` tem chave estrangeira: uma
-- conferência aberta num aparelho desses aponta para uma transportadora que não
-- existe mais no servidor, o envio bate em violação de FK, e a sessão — com as
-- leituras dela, que dependem de `sessao_id` — fica presa naquele aparelho para
-- sempre.
--
-- Então, DEPOIS de rodar este script, em CADA aparelho que já usou o app:
--   limpar os dados do site (Chrome/Safari → Configurações do site → Apagar
--   dados) ou desinstalar e reinstalar o PWA, e entrar de novo com a rede
--   ligada para baixar o cadastro novo.
-- Aparelho que não passar por isso não deve ser usado para bipar.

begin;

-- --------------------------------------------------------------- dados -----
-- Ordem obrigatória: cada tabela depende da seguinte por chave estrangeira
-- (ocorrencias → leituras → sessoes). Inverter a ordem faz o Postgres recusar.
delete from public.ocorrencias;
delete from public.leituras;
delete from public.sessoes;

-- Telemetria de aparelho. Sem FK para nada; some junto porque as contagens de
-- pendentes que ela guarda passam a ser mentira depois da limpeza.
delete from public.dispositivos;

-- ------------------------------------------------------------ cadastros ----
-- `rotas` antes de `transportadoras`: `rotas.transportadora_id` é NOT NULL.
delete from public.rotas;
delete from public.transportadoras;

-- Os acessos ficam, menos os que não são do Sandro. `senha_hash` dele fica
-- intacta: quem já escolheu senha continua entrando com ela.
delete from public.usuarios where login <> 'sandro';

-- Rede de segurança: se `sandro` não existir (base de outro projeto, login
-- escrito diferente), o comando acima teria apagado TODO MUNDO e ninguém mais
-- entraria no painel. Melhor abortar aqui do que descobrir na doca amanhã.
do $$
begin
  if not exists (select 1 from public.usuarios where login = 'sandro' and gestor) then
    raise exception
      'nenhum gestor com login "sandro" sobrou — nada foi apagado. Confira o login antes de rodar de novo.';
  end if;
end $$;

-- ------------------------------------------------ cadastro de partida ------
-- Uma transportadora só, por enquanto. `nome` é único no sistema.
insert into public.transportadoras (id, nome, ativo, atualizado_em)
values (gen_random_uuid(), 'DHM AWAY', true, now());

-- As seis rotas, todas da DHM AWAY.
--
-- `codigo` guarda só o prefixo alfabético da etiqueta: com 'FNOR' cadastrado,
-- as leituras 'FNOR 100', 'FNOR 200' e 'FNOR 15' casam com ele. Não cadastre o
-- sufixo numérico — ele é sequência de carga, não identidade de rota.
--
-- `codigo` é único no sistema inteiro, e é isso que permite descobrir a dona do
-- volume só a partir da etiqueta. Como as rotas antigas (FNOR, FSUL, FLES)
-- foram apagadas acima, não há conflito.
insert into public.rotas (id, codigo, nome, transportadora_id, ativo, atualizado_em)
select gen_random_uuid(), r.codigo, r.nome, t.id, true, now()
from (values
  ('FCEN', 'Centro'),
  ('FSUL', 'Sul'),
  ('FNOR', 'Norte'),
  ('FOES', 'Oeste'),
  ('FABC', 'ABC'),
  ('FLES', 'Leste')
) as r(codigo, nome)
cross join (select id from public.transportadoras where nome = 'DHM AWAY') as t;

commit;

-- ------------------------------------------------------------ conferir -----
-- Rode isto depois e leia o resultado antes de mandar alguém bipar.
select 'usuarios' as tabela, count(*) as linhas, string_agg(login, ', ' order by login) as conteudo
  from public.usuarios
union all
select 'transportadoras', count(*), string_agg(nome, ', ' order by nome)
  from public.transportadoras
union all
select 'rotas', count(*), string_agg(codigo, ', ' order by codigo)
  from public.rotas
union all
select 'dispositivos', count(*), null from public.dispositivos
union all
select 'sessoes', count(*), null from public.sessoes
union all
select 'leituras', count(*), null from public.leituras
union all
select 'ocorrencias', count(*), null from public.ocorrencias;

-- Esperado:
--   usuarios         1  sandro
--   transportadoras  1  DHM AWAY
--   rotas            6  FABC, FCEN, FLES, FNOR, FOES, FSUL
--   as demais        0
