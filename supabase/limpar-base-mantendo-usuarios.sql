-- Limpa todos os cadastros e dados operacionais, preservando:
--   public.usuarios, auth.users e public.tenants.
--
-- ATENÇÃO: operação permanente. Confirme o projeto antes de executar.
-- Para apagar as fotos, use a API/Dashboard do Storage. Não apague linhas de
-- storage.objects por SQL: isso deixa arquivos físicos órfãos.

begin;

-- Abortamos antes da primeira exclusão se não houver identidades a preservar.
do $$
begin
  if not exists (select 1 from public.usuarios) then
    raise exception 'limpeza abortada: public.usuarios está vazia';
  end if;
  if not exists (select 1 from public.tenants) then
    raise exception 'limpeza abortada: public.tenants está vazia';
  end if;
end $$;

-- Ordem obrigatória pelas chaves estrangeiras.
delete from public.ocorrencias;
delete from public.leituras;
delete from public.sessoes;
delete from public.dispositivos;
delete from public.rotas;
delete from public.transportadoras;

commit;

-- Resultado esperado: usuários/tenants > 0; todas as demais tabelas = 0.
select 'usuarios' as tabela, count(*) as linhas from public.usuarios
union all select 'tenants', count(*) from public.tenants
union all select 'transportadoras', count(*) from public.transportadoras
union all select 'rotas', count(*) from public.rotas
union all select 'dispositivos', count(*) from public.dispositivos
union all select 'sessoes', count(*) from public.sessoes
union all select 'leituras', count(*) from public.leituras
union all select 'ocorrencias', count(*) from public.ocorrencias;
