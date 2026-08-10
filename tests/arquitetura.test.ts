import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
assert.match(db, /STORES_MESTRES[^=]*=\s*\['usuarios', 'transportadoras', 'rotas'\]/);
assert.match(db, /STORES_SYNC[^=]*=\s*\['sessoes', 'leituras', 'ocorrencias'\]/);

const sync = readFileSync(new URL('../src/lib/sync.ts', import.meta.url), 'utf8');
assert.doesNotMatch(sync, /linhaUsuario|linhaTransportadora|linhaRota/);
assert.match(sync, /sessaoAutenticada\(\)/);
assert.match(sync, /separarCadastrosLegados\(\)/);

const auth = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8');
assert.doesNotMatch(auth, /senhaHash|PBKDF2|gerarSenhaHash|conferirSenha/);
assert.match(auth, /entrarNoSupabase\(login, senha\)/);

// Itens de menu não podem apontar para placeholders permanentes. Mapa e
// Relatórios são módulos de verdade e precisam estar ligados ao gestor.
const gestor = readFileSync(new URL('../src/app/gestor.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(gestor, /montarMapa/);
assert.match(gestor, /montarRelatorios/);
for (const secao of ['mapa', 'relatorios']) {
  const bloco = html.match(new RegExp(`data-secao="${secao}"[\\s\\S]*?<\\/section>`))?.[0] ?? '';
  assert.ok(bloco, `seção ${secao} ausente do HTML`);
  assert.doesNotMatch(bloco, /Carregando/, `${secao} voltou a ser só placeholder`);
}

const migracao = readFileSync(new URL('../supabase/migracao-v3-para-v4.sql', import.meta.url), 'utf8');
assert.match(migracao, /enable row level security/i);
assert.match(migracao, /to authenticated/i);
assert.match(migracao, /tenant_id = public\.tenant_atual\(\)/i);
assert.match(migracao, /drop column if exists senha_hash/i);
assert.match(migracao, /security_invoker\s*=\s*true/i);
assert.doesNotMatch(migracao, /create policy[^;]+\bto anon\b/is);

console.log('ARQUITETURA_OK');
