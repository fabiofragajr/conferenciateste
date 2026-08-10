// Limpeza administrativa intencional do projeto Supabase.
//
// Preserva public.usuarios, auth.users, public.tenants e o bucket em si.
// Remove todos os arquivos do bucket e todas as linhas das demais tabelas do app.

// Uso:
//   SUPABASE_SERVICE_ROLE_KEY='...' npm run limpar:base -- --confirm-project=ddhcueidpgvrawclzrte

// A service role nunca deve ser gravada em .env versionado ou enviada ao navegador.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const PROJETO_ESPERADO = 'ddhcueidpgvrawclzrte';
const confirmacao = process.argv.find((arg) => arg.startsWith('--confirm-project='))?.split('=')[1];

if (confirmacao !== PROJETO_ESPERADO) {
  throw new Error(`Confirme o destino com --confirm-project=${PROJETO_ESPERADO}`);
}

const lerEnv = (arquivo) => {
  try {
    return Object.fromEntries(
      readFileSync(new URL(arquivo, import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter((linha) => linha.includes('=') && !linha.trim().startsWith('#'))
        .map((linha) => {
          const indice = linha.indexOf('=');
          return [linha.slice(0, indice).trim(), linha.slice(indice + 1).trim()];
        })
    );
  } catch {
    return {};
  }
};

const envArquivo = { ...lerEnv('../.env'), ...lerEnv('../.env.local') };

const url = process.env.VITE_SUPABASE_URL || envArquivo.VITE_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || envArquivo.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.VITE_SUPABASE_BUCKET || envArquivo.VITE_SUPABASE_BUCKET || 'ocorrencias';

if (!url || new URL(url).hostname !== `${PROJETO_ESPERADO}.supabase.co`) {
  throw new Error(`A URL configurada não pertence ao projeto confirmado (${PROJETO_ESPERADO}).`);
}
if (!serviceRole) {
  throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY somente no ambiente desta execução.');
}

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const contar = async (tabela) => {
  const { count, error } = await supabase.from(tabela).select('id', { count: 'exact', head: true });
  if (error) throw new Error(`${tabela}: ${error.message}`);
  return count ?? 0;
};

const usuariosAntes = await contar('usuarios');
const tenantsAntes = await contar('tenants');
if (usuariosAntes < 1) throw new Error('Limpeza abortada: nenhum usuário seria preservado.');
if (tenantsAntes < 1) throw new Error('Limpeza abortada: nenhum tenant seria preservado.');

console.log(`Projeto confirmado: ${PROJETO_ESPERADO}`);
console.log(`Preservando ${usuariosAntes} usuário(s) e ${tenantsAntes} tenant(s).`);

// A API de Storage remove tanto o objeto físico quanto seus metadados.
const storage = await supabase.storage.emptyBucket(bucket);
if (storage.error) throw new Error(`storage/${bucket}: ${storage.error.message}`);
console.log(`Bucket ${bucket}: arquivos removidos.`);

// Ordem obrigatória pelas chaves estrangeiras.
const tabelas = ['ocorrencias', 'leituras', 'sessoes', 'dispositivos', 'rotas', 'transportadoras'];
for (const tabela of tabelas) {
  const { data, error } = await supabase.from(tabela).delete().not('id', 'is', null).select('id');
  if (error) throw new Error(`${tabela}: ${error.message}`);
  console.log(`${tabela}: ${data?.length ?? 0} registro(s) removido(s).`);
}

for (const tabela of tabelas) {
  const restantes = await contar(tabela);
  if (restantes !== 0) throw new Error(`${tabela}: ainda restaram ${restantes} registro(s).`);
}

const usuariosDepois = await contar('usuarios');
const tenantsDepois = await contar('tenants');
if (usuariosDepois !== usuariosAntes || tenantsDepois !== tenantsAntes) {
  throw new Error('Verificação final falhou: usuários ou tenants foram alterados.');
}

console.log('LIMPEZA_OK — usuários, contas Auth e tenants preservados.');
