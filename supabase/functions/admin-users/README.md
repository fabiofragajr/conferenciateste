# admin-users

Função administrativa para criar, atualizar e excluir contas do Supabase Auth
sem expor a `service_role` no navegador.

```bash
supabase functions deploy admin-users
```

O deploy injeta `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
`SUPABASE_SERVICE_ROLE_KEY`. Mantenha a verificação JWT habilitada. O chamador
também é conferido na tabela `usuarios`: precisa estar ativo, ser gestor e
pertencer ao mesmo tenant do alvo.
