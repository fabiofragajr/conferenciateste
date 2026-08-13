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

// A doca aponta o celular para BAIXO, sobre a caixa: quase deitado, o sensor
// troca de retrato para paisagem a cada tremida e a imagem gira sozinha na mão
// de quem está bipando. Retrato no manifesto é o que segura a versão instalada.
const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
assert.match(vite, /orientation:\s*'portrait'/);

// A trava de tela existe para a aba comum, que ignora o manifesto — e precisa
// soltar, senão o painel do gestor herda o retrato do operador.
const util = readFileSync(new URL('../src/lib/util.ts', import.meta.url), 'utf8');
assert.match(util, /export async function travarOrientacao/);
assert.match(util, /lock\('portrait'\)/);
assert.match(util, /unlock/);

// Sair da bipagem pelo `←` não encerra a carga, mas tem que devolver o
// aparelho: câmera acesa numa tela que não é mais a da câmera gasta bateria,
// mantém a luz do sensor ligada e deixaria a tela travada em retrato.
const operador = readFileSync(new URL('../src/app/operador.ts', import.meta.url), 'utf8');
const voltar = operador.match(/async function voltarDaBipagem\(\)[\s\S]*?\n}/)?.[0] ?? '';
assert.ok(voltar, 'voltarDaBipagem sumiu do operador');
assert.match(voltar, /soltarAparelho\(\)/);
const soltar = operador.match(/function soltarAparelho\(\)[\s\S]*?\n}/)?.[0] ?? '';
assert.match(soltar, /scanner\?\.parar\(\)/);
assert.match(soltar, /orientacao/);

const scanner = readFileSync(new URL('../src/lib/scanner.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../src/lib/decoder.worker.ts', import.meta.url), 'utf8');
assert.match(scanner, /requestVideoFrameCallback/);
assert.match(scanner, /focusMode:\s*'continuous'/);
assert.match(worker, /from 'zxing-wasm\/reader'/);
assert.match(worker, /zxing_reader\.wasm\?url/);
assert.doesNotMatch(worker, /BarcodeFormat\.(?:CODE_39|DATA_MATRIX|EAN_13|ITF)/);
assert.match(vite, /woff2,wasm/);

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
