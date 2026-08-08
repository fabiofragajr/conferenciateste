# Painel do gestor — menu lateral, gráficos e parametrização — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao gestor um painel próprio — menu lateral, gráficos, cadastro editável e uso no celular — e fazer o login levar cada pessoa para a tela onde ela trabalha.

**Architecture:** O painel ganha uma moldura (`src/lib/painel-shell.ts`) que desenha barra do topo, menu lateral, gaveta do celular e a faixa de alerta, e controla qual seção está visível pelo `location.hash`. Cada seção do painel vira um módulo em `src/app/gestor/` com o contrato `montar(raiz, ctx) → { pintar }`; `gestor.ts` fica só com boot, login, carga de dados e roteamento. Os gráficos continuam sendo SVG gerado por `src/lib/graficos.ts` — nenhuma biblioteca nova, porque o painel precisa abrir offline.

**Tech Stack:** TypeScript sem framework, Vite 8, IndexedDB via `idb`, Supabase só como destino de sincronização, Playwright para os testes de ponta a ponta, `node --experimental-strip-types` para os testes de unidade.

**Spec:** `docs/superpowers/specs/2026-08-08-painel-gestor-menu-lateral-design.md`

**Já feito antes deste plano:** os ajustes no `CLAUDE.md` (spec §9) estão aplicados no commit `dd8da50`. O arquivo proibia painel no celular, proibia menu e não tinha regra de roteamento por papel — quem executar este plano encontra as regras novas já valendo.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/painel-shell.ts` | **Criar.** Barra do topo, menu lateral, gaveta, navegação por hash, badge e faixa de alerta. Sem regra de negócio, sem IndexedDB. |
| `src/app/gestor/contexto.ts` | **Criar.** `Base` e `Contexto` — os tipos que os módulos de seção compartilham. |
| `src/app/gestor/hoje.ts` | **Criar.** Bloco de atenção, faixa de divergência, conferências abertas, pedidos incompletos, rotas não mapeadas, KPIs do dia. |
| `src/app/gestor/conferencias.ts` | **Criar.** Filtros do período, tabela de sessões, liberação da carga, gaveta de detalhe. |
| `src/app/gestor/ocorrencias.ts` | **Criar.** Lista com texto na íntegra, filtros, busca livre, recorrentes por transportadora, CSV. |
| `src/app/gestor/desempenho.ts` | **Criar.** Gráficos e tabelas do período. |
| `src/app/gestor/cadastros.ts` | **Criar.** Pessoas, transportadoras e códigos de rota — criar, editar, ativar/desativar. |
| `src/app/gestor/sincronizacao.ts` | **Criar.** Conexão Supabase, fila local, aparelhos em operação. |
| `src/app/gestor.ts` | **Modificar.** Fica só com boot, login, carga de dados e roteamento entre seções. |
| `src/app/operador.ts` | **Modificar.** Roteamento por papel e botão Painel. |
| `src/app/diretor.ts` | **Modificar.** Passa a usar o mesmo shell. |
| `src/lib/graficos.ts` | **Modificar.** `graficoDiario()` e `barraEmpilhada()`. |
| `src/lib/model.ts` | **Modificar.** `mesmoNome()` — comparação normalizada de nome de transportadora. |
| `src/styles/painel.css` | **Modificar.** Estilos do shell e o modo celular. |
| `gestor.html`, `index.html`, `diretor.html` | **Modificar.** Moldura vazia com uma `<section data-secao>` por item de menu. |

---

## Task 1: Roteamento por papel

Hoje `boot()` e o `submit` do login em `operador.ts` mandam todo mundo para a tela de transportadora, sem olhar `usuario.gestor`. E `gestor.ts` derruba a sessão de quem não é gestor com "Este usuário não tem acesso ao painel", sem saída.

**Files:**
- Modify: `src/app/operador.ts:145-219`
- Modify: `src/app/gestor.ts:119-141`
- Modify: `index.html:52-77` (cabeçalho da tela de transportadora), `index.html:80-92` (topo da bipagem)
- Modify: `gestor.html:22` (id no link "Abrir bipagem")
- Modify: `src/styles/app.css`
- Test: `tests/login-sandro.mjs`

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/login-sandro.mjs`, **substituir** o passo `'sandro bipa no app do operador'` (linhas 75-82) por estes quatro passos:

```js
await passo('sandro entra pelo app e cai no painel, não na tela de transportadora', async () => {
  const { ctx, p } = await novoAparelho('index.html', { width: 420, height: 900 });
  await entrar(p, 'sandro');
  await p.waitForURL(/gestor\.html/, { timeout: 8000 });
  await ctx.close();
});

await passo('ana entra pelo app e vai bipar', async () => {
  const { ctx, p } = await novoAparelho('index.html', { width: 420, height: 900 });
  await entrar(p, 'ana');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });
  if (/gestor\.html/.test(p.url())) throw new Error('conferente foi parar no painel');
  await ctx.close();
});

await passo('sandro também bipa, e volta ao painel pelo botão', async () => {
  const { ctx, p } = await novoAparelho('index.html', { width: 420, height: 900 });
  await entrar(p, 'sandro');
  await p.waitForURL(/gestor\.html/, { timeout: 8000 });

  await p.click('#btn-bipar');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });
  await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });

  // Conferência aberta: voltar ao painel não pode encerrar nada.
  await p.click('#btn-painel');
  await p.waitForURL(/gestor\.html/, { timeout: 8000 });
  const abertas = await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const tx = bd.transaction('sessoes', 'readonly');
    const todas = await new Promise((ok) => {
      const q = tx.objectStore('sessoes').getAll();
      q.onsuccess = () => ok(q.result);
    });
    bd.close();
    return todas.filter((s) => s.status === 'ABERTA').length;
  });
  if (abertas !== 1) throw new Error(`sessões abertas depois de voltar: ${abertas}`);
  await ctx.close();
});

await passo('quem não é gestor abre gestor.html e é mandado para a bipagem', async () => {
  const { ctx, p } = await novoAparelho('gestor.html');
  await entrar(p, 'ana');
  await p.waitForURL(/index\.html/, { timeout: 8000 });
  await ctx.close();
});
```

E **substituir** o passo `'quem não é gestor não abre o painel'` (linhas 60-66) — ele afirma o comportamento antigo (ficar bloqueado) e passa a contradizer o novo. O passo que o substitui é o último acima.

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/login-sandro.mjs
```

Esperado: `FALHA - sandro entra pelo app e cai no painel...`, `FALHA - sandro também bipa...` (não existe `#btn-bipar`), `FALHA - quem não é gestor abre gestor.html...`.

- [ ] **Step 3: Roteamento no `operador.ts`**

Em `src/app/operador.ts`, logo abaixo de `function erroEm(...)` (linha 141), acrescentar:

```ts
/**
 * Cada um começa onde trabalha: gestor no painel, operador na bipagem.
 *
 * Conferência aberta ganha das duas regras — ninguém é tirado do meio de uma
 * carga por causa do papel que tem no cadastro.
 */
function levarParaOPainel(): void {
  location.href = 'gestor.html';
}
```

Em `boot()` (linha 177-195), trocar o trecho final por:

```ts
  usuario = await auth.usuarioLogado();
  if (!usuario) {
    mostrarView('login');
    el.inLogin.focus();
    return;
  }

  // Conferência aberta no aparelho: volta direto para a bipagem.
  const abertas = (await db.porIndice('sessoes', 'usuarioId', usuario.id))
    .filter((s) => s.status === 'ABERTA')
    .sort((a, b) => b.inicio.localeCompare(a.inicio));

  if (abertas.length) {
    await retomarSessao(abertas[0]);
    return;
  }

  if (usuario.gestor) {
    levarParaOPainel();
    return;
  }

  await irParaGrupos();
```

No `submit` do login (linhas 199-213), trocar as duas últimas linhas do bloco de sucesso:

```ts
  usuario = r.usuario;
  el.inSenha.value = '';
  if (usuario.gestor) {
    levarParaOPainel();
    return;
  }
  await irParaGrupos();
```

- [ ] **Step 4: Botão Painel nas duas telas**

Em `index.html`, no `<header class="topo">` da tela de transportadora (linha 63), trocar a linha do botão Sair por:

```html
      <div class="topo-acoes">
        <button id="btn-painel" class="btn btn-secundario" hidden>Painel</button>
        <button id="btn-sair" class="btn btn-fantasma">Sair</button>
      </div>
```

Remover o link do rodapé (linha 75):

```html
      <a id="link-painel" href="gestor.html" hidden>Painel do gestor</a>
```

Em `index.html`, dentro de `<div class="bip-topo-acoes">` (linha 87-91), acrescentar como primeiro filho:

```html
        <button id="btn-painel-bip" class="chip-btn" hidden>Painel</button>
```

Em `gestor.html`, o link "Abrir bipagem" do cabeçalho (linha 22) ganha o id que o teste procura — o mesmo id que o shell vai usar na Task 6, para o teste continuar valendo depois:

```html
    <a class="btn btn-fantasma" id="btn-bipar" href="index.html">Abrir bipagem</a>
```

Em `src/app/operador.ts`, no objeto `el` (linha 73), trocar `linkPainel` por:

```ts
  btnPainel: $<HTMLButtonElement>('#btn-painel'),
  btnPainelBip: $<HTMLButtonElement>('#btn-painel-bip'),
```

Em `irParaGrupos()` (linha 242), trocar `el.linkPainel.hidden = !usuario.gestor;` por:

```ts
  el.btnPainel.hidden = !usuario.gestor;
  el.btnPainelBip.hidden = !usuario.gestor;
```

E abaixo do listener de `#btn-sair` (linha 219), acrescentar:

```ts
// Voltar ao painel não encerra nada: a sessão fica ABERTA e o boot a retoma.
for (const b of [el.btnPainel, el.btnPainelBip]) {
  b.addEventListener('click', levarParaOPainel);
}
```

- [ ] **Step 5: `gestor.ts` para de trancar quem não é gestor**

Em `src/app/gestor.ts`, no `submit` do login (linhas 128-133), trocar:

```ts
  if (!r.usuario.gestor) {
    // Erro não é beco sem saída: quem não tem painel tem bipagem.
    location.href = 'index.html';
    return;
  }
```

Em `boot()` (linhas 159-163), trocar:

```ts
  usuario = await auth.usuarioLogado();
  if (!usuario) {
    elLogin.bloqueio.hidden = false;
    return;
  }
  if (!usuario.gestor) {
    location.href = 'index.html';
    return;
  }
```

- [ ] **Step 6: Estilo do agrupamento de ações**

Em `src/styles/app.css`, acrescentar ao final:

```css
/* topo da tela de transportadora: Painel e Sair lado a lado */
.topo-acoes { display: flex; gap: 8px; align-items: center; }
```

- [ ] **Step 7: Rodar e ver passar**

```bash
npm run typecheck && npm run build && node tests/login-sandro.mjs
```

Esperado: `SANDRO_OK`, sem nenhuma linha `FALHA`.

- [ ] **Step 8: Commit**

```bash
git add index.html src/app/operador.ts src/app/gestor.ts src/styles/app.css tests/login-sandro.mjs
git commit -m "cada um entra na tela onde trabalha

O gestor entrava pelo app e caía em 'Qual transportadora você vai conferir?',
com o caminho de volta escondido num link de rodapé que some quando a câmera
abre. E quem não era gestor batia em 'acesso negado' no painel, sem saída.

Voltar ao painel com conferência aberta não encerra nada: a sessão continua
ABERTA e o boot a retoma na volta."
```

---

## Task 2: Gráficos novos em `graficos.ts`

`graficoMensal()` e `ranking()` já existem. Faltam a série diária (o gestor olha o período filtrado, não o mês) e a barra empilhada de status.

**Files:**
- Modify: `src/lib/graficos.ts`
- Test: `tests/graficos.test.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/graficos.test.ts`:

```ts
import assert from 'node:assert/strict';
import { graficoDiario, barraEmpilhada } from '../src/lib/graficos.ts';

// série diária: um retângulo por dia, e o rótulo do eixo é dia/mês
const svg = graficoDiario(
  [
    { rotulo: '2026-08-06', valor: 12 },
    { rotulo: '2026-08-07', valor: 0 },
    { rotulo: '2026-08-08', valor: 30 }
  ],
  { titulo: 'Volumes por dia', cor: '#109976' }
);
assert.equal((svg.match(/<rect/g) ?? []).length, 3, 'um retângulo por dia, inclusive o dia zerado');
assert.ok(svg.includes('06/08'), 'o eixo mostra dia/mês');
assert.ok(svg.includes('Volumes por dia'));

// dia sem conferência não pode sumir: some a barra, fica o rótulo
const semDados = graficoDiario([], { titulo: 'Vazio', cor: '#109976' });
assert.ok(semDados.includes('Sem dados no período.'));

// barra empilhada: uma faixa por fatia com valor > 0, largura proporcional
const barra = barraEmpilhada([
  { rotulo: 'Liberados', valor: 90, cor: '#16a34a' },
  { rotulo: 'Divergentes', valor: 10, cor: '#dc2626' },
  { rotulo: 'Duplicados', valor: 0, cor: '#d97706' }
]);
assert.equal((barra.match(/class="p-fatia"/g) ?? []).length, 2, 'fatia zerada não entra no desenho');
assert.ok(barra.includes('90%'), 'a fatia carrega a porcentagem');
assert.ok(barra.includes('Divergentes'));

// tudo zero não pode virar divisão por zero nem barra fantasma
const zerada = barraEmpilhada([{ rotulo: 'Liberados', valor: 0, cor: '#16a34a' }]);
assert.ok(zerada.includes('Sem leituras no período.'));

// escape: nome de rota vem do cadastro e pode ter aspas
const escapado = barraEmpilhada([{ rotulo: '<b>x</b>', valor: 1, cor: '#16a34a' }]);
assert.ok(!escapado.includes('<b>x</b>'), 'rótulo precisa sair escapado');

console.log('GRAFICOS_OK');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --experimental-strip-types tests/graficos.test.ts
```

Esperado: `SyntaxError` / `does not provide an export named 'graficoDiario'`.

- [ ] **Step 3: Implementar**

Em `src/lib/graficos.ts`, acrescentar ao final:

```ts
const diaMes = (iso: string): string => {
  const [, mes, dia] = iso.split('-');
  return dia && mes ? `${dia}/${mes}` : iso;
};

/**
 * Série por dia, para o período filtrado do gestor.
 *
 * Dia sem conferência entra com barra zero em vez de sumir: buraco na operação
 * é informação, e uma série que pula dias mente sobre o ritmo.
 */
export function graficoDiario(serie: PontoSerie[], op: OpcoesGrafico): string {
  return graficoMensal(
    serie.map((p) => ({ rotulo: diaMes(p.rotulo), valor: p.valor })),
    op
  );
}

export interface Fatia {
  rotulo: string;
  valor: number;
  cor: string;
}

/**
 * Distribuição de status numa barra só: a pergunta é a proporção entre eles,
 * e proporção de um todo se lê melhor empilhada do que em barras separadas.
 */
export function barraEmpilhada(fatias: Fatia[]): string {
  const total = fatias.reduce((n, f) => n + f.valor, 0);
  if (!total) return '<p class="p-vazio">Sem leituras no período.</p>';

  const visiveis = fatias.filter((f) => f.valor > 0);
  const faixas = visiveis.map((f) => {
    const p = (f.valor / total) * 100;
    return `<span class="p-fatia" style="width:${p.toFixed(2)}%;background:${esc(f.cor)}"
                  title="${esc(f.rotulo)}: ${f.valor}"></span>`;
  }).join('');

  const legenda = visiveis.map((f) => `
    <span class="p-fatia-item">
      <i style="background:${esc(f.cor)}"></i>${esc(f.rotulo)}
      <b>${Math.round((f.valor / total) * 100)}%</b>
    </span>`).join('');

  return `<div class="p-empilhada">${faixas}</div>
          <div class="p-fatia-legenda">${legenda}</div>`;
}
```

- [ ] **Step 4: Estilo da barra empilhada**

Em `src/styles/painel.css`, acrescentar ao final:

```css
/* distribuição de status: proporção de um todo, numa barra só */
.p-empilhada {
  display: flex;
  height: 26px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--fundo-3);
}
.p-empilhada .p-fatia { display: block; height: 100%; }
.p-fatia-legenda { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 12.5px; }
.p-fatia-item { display: inline-flex; align-items: center; gap: 6px; color: var(--texto-2); }
.p-fatia-item i { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
.p-fatia-item b { color: var(--texto); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Rodar e ver passar**

```bash
node --experimental-strip-types tests/graficos.test.ts && npm run typecheck
```

Esperado: `GRAFICOS_OK` e typecheck limpo.

- [ ] **Step 6: Registrar o teste no `npm test`**

Em `package.json`, trocar a linha do script `test` por:

```json
    "test": "npm run typecheck && node --experimental-strip-types tests/model.test.ts && node --experimental-strip-types tests/graficos.test.ts && node tests/decode.test.mjs",
```

Rodar:

```bash
npm test
```

Esperado: `GRAFICOS_OK` no meio da saída, sem erro.

- [ ] **Step 7: Commit**

```bash
git add src/lib/graficos.ts src/styles/painel.css tests/graficos.test.ts package.json
git commit -m "série por dia e barra de status para o painel do gestor

O gestor filtra período, não mês: graficoMensal não servia. Dia sem conferência
entra zerado em vez de sumir da série — buraco na operação é informação, e série
que pula dia mente sobre o ritmo."
```

---

## Task 3: Nome de transportadora é único

`criarUsuario` recusa login repetido; o cadastro de transportadora não recusa nada. É o que produziu duas "LOGDIS" na base de produção.

**Files:**
- Modify: `src/lib/model.ts`
- Test: `tests/model.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Ao final de `tests/model.test.ts`, antes da última linha de log (se houver), acrescentar:

```ts
// nome de transportadora é único, e a comparação precisa aguentar o que a
// pessoa digita: espaço sobrando, maiúscula trocada
import { mesmoNome } from '../src/lib/model.ts';

assert.equal(mesmoNome('LOGDIS', 'logdis'), true);
assert.equal(mesmoNome(' LOGDIS ', 'LOGDIS'), true);
assert.equal(mesmoNome('LOGDIS', 'LOGDIS Transportes'), false);
assert.equal(mesmoNome('', ''), true);
```

Mover esse `import` para junto dos outros no topo do arquivo (linha 2-5) em vez de deixá-lo no meio — o teste roda como módulo e o import é içado, mas ficar no meio confunde quem lê.

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --experimental-strip-types tests/model.test.ts
```

Esperado: `does not provide an export named 'mesmoNome'`.

- [ ] **Step 3: Implementar**

Em `src/lib/model.ts`, acrescentar depois de `prefixoRota` (procure `export function prefixoRota`):

```ts
/**
 * Comparação de nome de cadastro. Duas "LOGDIS" na lista não são incômodo
 * estético: o operador escolhe uma das duas na doca sem ter como saber qual tem
 * o código de rota, e a carga certa cai como rota não cadastrada por causa da
 * escolha dele.
 */
export const mesmoNome = (a: string, b: string): boolean =>
  String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npm test
```

Esperado: sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/model.ts tests/model.test.ts
git commit -m "mesmoNome: a comparação que faltava para o cadastro não aceitar repetido"
```

---

## Task 4: O shell do painel

**Files:**
- Create: `src/lib/painel-shell.ts`
- Modify: `src/styles/painel.css`
- Test: `tests/painel-shell.test.mjs` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/painel-shell.test.mjs`:

```js
// O shell é a moldura do painel: menu lateral no desktop, gaveta no celular,
// hash na URL e — a parte que não pode falhar — a divergência visível de
// qualquer seção.
import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, entrar } from './cadastro.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
let falhou = false;

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

const painelAberto = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, 'gestor.html');
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  return { ctx, p };
};

await passo('cada item do menu mostra sua seção e escreve o hash', async () => {
  const { ctx, p } = await painelAberto();
  for (const id of ['conferencias', 'ocorrencias', 'desempenho', 'pessoas', 'transportadoras', 'rotas', 'sincronizacao']) {
    await p.click(`.p-item[href="#${id}"]`);
    await p.waitForSelector(`[data-secao="${id}"]:not([hidden])`, { timeout: 4000 });
    if (!p.url().endsWith(`#${id}`)) throw new Error(`hash não acompanhou: ${p.url()}`);
    const visiveis = await p.$$eval('[data-secao]', (ns) => ns.filter((n) => !n.hidden).length);
    if (visiveis !== 1) throw new Error(`${visiveis} seções visíveis ao mesmo tempo`);
  }
  await ctx.close();
});

await passo('recarregar a página cai na mesma seção', async () => {
  const { ctx, p } = await painelAberto();
  await p.click('.p-item[href="#transportadoras"]');
  await p.waitForSelector('[data-secao="transportadoras"]:not([hidden])', { timeout: 4000 });
  await p.reload();
  await p.waitForSelector('[data-secao="transportadoras"]:not([hidden])', { timeout: 8000 });
  await ctx.close();
});

await passo('sem hash, abre em Hoje', async () => {
  const { ctx, p } = await painelAberto();
  await p.waitForSelector('[data-secao="hoje"]:not([hidden])', { timeout: 4000 });
  await ctx.close();
});

await passo('no celular a lateral é gaveta, e ela abre e fecha', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  if (await p.isVisible('.p-lateral')) throw new Error('gaveta já nasce aberta no celular');
  await p.click('.p-hamburguer');
  await p.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
  await p.click('.p-item[href="#sincronizacao"]');
  await p.waitForSelector('[data-secao="sincronizacao"]:not([hidden])', { timeout: 4000 });
  // Escolher um item fecha a gaveta: ninguém quer tocar duas vezes.
  if (await p.isVisible('.p-lateral.aberta')) throw new Error('a gaveta ficou aberta depois de escolher');
  await ctx.close();
});

await passo('o painel não rola na horizontal no celular', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  const sobra = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sobra > 1) throw new Error(`sobram ${sobra}px de rolagem horizontal`);
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nSHELL_OK');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/painel-shell.test.mjs
```

Esperado: todas as linhas `FALHA` — não existe `.p-item` nem `[data-secao]`.

- [ ] **Step 3: Escrever o shell**

Criar `src/lib/painel-shell.ts`:

```ts
// painel-shell.ts — a moldura dos painéis: barra do topo, menu lateral (gaveta
// no celular), navegação por hash, badge e faixa de alerta.
//
// Não conhece regra de negócio e não toca no IndexedDB. Recebe os itens do
// menu, diz qual seção está visível e avisa quem precisa repintar.
//
// A regra que justifica o badge e a faixa: com menu, a divergência do dia
// passaria a viver atrás de um item — e divergência escondida é exatamente o
// que este sistema existe para evitar.

import { $, $$, esc } from './util.js';

export interface ItemMenu {
  /** Vira o hash da URL e o `data-secao` da seção correspondente. */
  id: string;
  rotulo: string;
  grupo: string;
  /** Preenchido só quando o item leva a outra página (o painel do diretor). */
  href?: string;
}

export interface OpcoesShell {
  titulo: string;
  usuario: string;
  /** Seção mostrada quando a URL não traz hash. */
  inicial: string;
}

export interface Shell {
  aoTrocarSecao(fn: (id: string) => void): void;
  irPara(id: string): void;
  secaoAtual(): string;
  definirBadge(id: string, n: number): void;
  definirAlerta(html: string | null): void;
}

export function montarShell(itens: ItemMenu[], op: OpcoesShell): Shell {
  const secoes = itens.filter((i) => !i.href);
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  const ouvintes: ((id: string) => void)[] = [];

  const lista = grupos.map((g) => `
    <div class="p-lateral-grupo">
      <h2>${esc(g)}</h2>
      ${itens.filter((i) => i.grupo === g).map((i) => `
        <a class="p-item" href="${i.href ? esc(i.href) : `#${esc(i.id)}`}" data-item="${esc(i.id)}">
          <span>${esc(i.rotulo)}</span>
          <span class="p-badge" data-badge="${esc(i.id)}" hidden></span>
        </a>`).join('')}
    </div>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <header class="p-topo">
      <button class="p-hamburguer" type="button" aria-expanded="false" aria-label="Abrir menu">
        <span></span><span></span><span></span>
      </button>
      <h1 class="marca-logdis">
        <img src="./logdis-simbolo.png" alt="" width="34" height="34" />
        <span class="marca-nome">LOGDIS <i>Connect</i></span>
      </h1>
      <span class="p-titulo-painel">${esc(op.titulo)}</span>
      <span class="p-titulo-secao"></span>
      <span class="p-espaco"></span>
      <span class="p-badge p-badge-topo" data-badge-topo hidden></span>
      <span id="chip-sync" class="chip chip-sync">Fila</span>
    </header>

    <div class="p-fundo-gaveta" hidden></div>

    <nav class="p-lateral" aria-label="Seções do painel">
      ${lista}
      <div class="p-lateral-rodape">
        <span id="p-usuario" class="p-usuario">${esc(op.usuario)}</span>
        <a class="btn btn-secundario" id="btn-bipar" href="index.html">Abrir bipagem</a>
        <button id="btn-sair" class="btn btn-fantasma" type="button">Sair</button>
      </div>
    </nav>`);

  const lateral = $('.p-lateral');
  const fundo = $('.p-fundo-gaveta');
  const hamburguer = $<HTMLButtonElement>('.p-hamburguer');
  const tituloSecao = $('.p-titulo-secao');
  const alerta = document.createElement('div');
  alerta.className = 'p-alerta-fixo';
  alerta.hidden = true;
  $('.p-corpo').prepend(alerta);

  const fecharGaveta = (): void => {
    lateral.classList.remove('aberta');
    fundo.hidden = true;
    hamburguer.setAttribute('aria-expanded', 'false');
  };

  hamburguer.addEventListener('click', () => {
    const abrindo = !lateral.classList.contains('aberta');
    lateral.classList.toggle('aberta', abrindo);
    fundo.hidden = !abrindo;
    hamburguer.setAttribute('aria-expanded', String(abrindo));
  });
  fundo.addEventListener('click', fecharGaveta);

  const valido = (id: string): string =>
    secoes.some((s) => s.id === id) ? id : op.inicial;

  const mostrar = (bruto: string): void => {
    const id = valido(bruto);
    for (const secao of $$<HTMLElement>('[data-secao]')) {
      secao.hidden = secao.dataset.secao !== id;
    }
    for (const item of $$<HTMLAnchorElement>('.p-item')) {
      item.classList.toggle('ativo', item.dataset.item === id);
      if (item.dataset.item === id) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    tituloSecao.textContent = itens.find((i) => i.id === id)?.rotulo ?? '';
    fecharGaveta();
    // O conteúdo troca inteiro: continuar na rolagem da seção anterior confunde.
    window.scrollTo(0, 0);
    for (const fn of ouvintes) fn(id);
  };

  window.addEventListener('hashchange', () => mostrar(location.hash.slice(1)));
  mostrar(location.hash.slice(1));

  return {
    aoTrocarSecao: (fn) => { ouvintes.push(fn); },
    irPara: (id) => {
      if (location.hash.slice(1) === id) mostrar(id);
      else location.hash = id;
    },
    secaoAtual: () => valido(location.hash.slice(1)),
    definirBadge: (id, n) => {
      const b = document.querySelector<HTMLElement>(`[data-badge="${id}"]`);
      if (!b) return;
      b.textContent = String(n);
      b.hidden = n <= 0;
    },
    definirAlerta: (html) => {
      alerta.innerHTML = html ?? '';
      alerta.hidden = !html;
      const topo = document.querySelector<HTMLElement>('[data-badge-topo]');
      if (topo) topo.hidden = !html;
    }
  };
}
```

- [ ] **Step 4: Estilo do shell**

Em `src/styles/painel.css`, **substituir** a regra `body.painel { min-height: 100vh; }` (linha 8) por:

```css
/* Grade do painel: lateral à esquerda em toda a altura, topo e corpo à direita.
   Abaixo de 1024px a lateral sai do fluxo e vira gaveta sobre o conteúdo. */
body.painel {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 248px 1fr;
  grid-template-areas:
    "lateral topo"
    "lateral corpo";
  grid-template-rows: auto 1fr;
}
body.painel > .p-topo { grid-area: topo; }
body.painel > .p-lateral { grid-area: lateral; }
body.painel > .p-corpo { grid-area: corpo; min-width: 0; }
```

E acrescentar ao final do arquivo:

```css
/* ------------------------------------------------------------- lateral --- */
.p-lateral {
  background: var(--fundo-2);
  border-right: 1px solid var(--borda);
  padding: 16px 0 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
}
.p-lateral-grupo h2 {
  font-size: 11px;
  letter-spacing: .09em;
  text-transform: uppercase;
  color: var(--texto-2);
  margin: 0 0 6px;
  padding: 0 18px;
}
.p-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  font-size: 14.5px;
  color: var(--texto);
  text-decoration: none;
  border-left: 3px solid transparent;
}
.p-item:hover { background: var(--logdis-mint-surface); color: var(--texto); }
.p-item.ativo {
  background: var(--logdis-mint-surface);
  border-left-color: var(--logdis-green);
  color: var(--logdis-forest);
  font-weight: 700;
}
.p-lateral-rodape {
  margin-top: auto;
  padding: 16px 18px 0;
  border-top: 1px solid var(--borda);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.p-lateral-rodape .p-usuario { color: var(--texto-2); }
.p-lateral-rodape .btn { min-height: 40px; font-size: 14px; }

/* badge de divergência: o item leva até ela, e o número aparece sem abrir nada */
.p-badge {
  min-width: 22px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--div);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.p-badge[hidden] { display: none; }

/* faixa que acompanha TODA seção enquanto houver divergência no dia */
.p-alerta-fixo {
  border: 2px solid var(--div);
  background: rgba(220, 38, 38, .08);
  border-radius: var(--raio);
  padding: 12px 18px;
  margin-bottom: 18px;
  font-size: 15px;
}
.p-alerta-fixo[hidden] { display: none; }
.p-alerta-fixo a { color: var(--div); font-weight: 700; }

/* hambúrguer: só existe abaixo de 1024px */
.p-hamburguer {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  width: 44px;
  height: 44px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, .38);
  border-radius: 8px;
  cursor: pointer;
}
.p-hamburguer span { display: block; height: 2px; background: #fff; border-radius: 2px; }
.p-titulo-secao { color: #fff; font-size: 15px; font-weight: 700; }
.p-fundo-gaveta { display: none; }

@media (max-width: 1023px) {
  body.painel {
    grid-template-columns: 1fr;
    grid-template-areas: "topo" "corpo";
  }
  .p-hamburguer { display: flex; }
  /* Título do painel some: no celular a barra é estreita e quem manda é a seção. */
  .p-topo .p-titulo-painel { display: none; }
  .p-topo .marca-nome { display: none; }

  body.painel > .p-lateral {
    position: fixed;
    z-index: 200;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(300px, 84vw);
    transform: translateX(-100%);
    transition: transform .18s ease-out;
    box-shadow: 0 0 32px rgba(0, 0, 0, .18);
  }
  body.painel > .p-lateral.aberta { transform: translateX(0); }
  .p-fundo-gaveta {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(34, 38, 37, .5);
  }
  .p-fundo-gaveta[hidden] { display: none; }
  .p-item { min-height: 48px; }
}
```

A `@media (max-width: 720px)` que já existe (linha 226) continua valendo — ela só encolhe padding.

- [ ] **Step 5: Rodar e ver falhar por outro motivo**

```bash
npm run build && node tests/painel-shell.test.mjs
```

Esperado: ainda `FALHA` — o shell existe, mas `gestor.html` ainda não o usa. Isso é a Task 6. Seguir para o commit; o teste fica vermelho de propósito até lá.

- [ ] **Step 6: Commit**

```bash
git add src/lib/painel-shell.ts src/styles/painel.css tests/painel-shell.test.mjs
git commit -m "a moldura do painel: menu lateral no desktop, gaveta no celular

O menu resolve a rolagem infinita e cria um risco novo: a divergência do dia
passaria a viver atrás de um item. Por isso o shell nasce com badge e faixa
fixa — a faixa acompanha toda seção, inclusive Cadastros.

O teste fica vermelho até gestor.html usar o shell."
```

---

## Task 5: Extrair o contexto compartilhado

`Base` é uma interface local de `gestor.ts` (linhas 32-41). Os módulos de seção precisam dela.

**Files:**
- Create: `src/app/gestor/contexto.ts`
- Modify: `src/app/gestor.ts:32-41`

- [ ] **Step 1: Criar o contexto**

Criar `src/app/gestor/contexto.ts`:

```ts
// contexto.ts — o que as seções do painel compartilham.
//
// Os dados são carregados uma vez por `gestor.ts` e passados prontos: nenhuma
// seção abre o IndexedDB por conta própria, senão a mesma tela lê o banco seis
// vezes a cada 15 segundos.

import type {
  Dispositivo, Leitura, Ocorrencia, Rota, Sessao, Transportadora, Usuario
} from '../../types.js';

export interface Base {
  usuarios: Usuario[];
  transportadoras: Transportadora[];
  rotas: Rota[];
  sessoes: Sessao[];
  leituras: Leitura[];
  ocorrencias: Ocorrencia[];
  porSessao: Map<string, Leitura[]>;
  ocPorSessao: Map<string, Ocorrencia[]>;
}

export interface Contexto {
  /** Quem está no painel. Trocado só no login. */
  usuario: () => Usuario;
  base: () => Base;
  dispositivos: () => Dispositivo[];
  /** Recarrega tudo do IndexedDB e repinta a seção visível. */
  recarregar: () => Promise<void>;
  irPara: (secao: string) => void;
}

/** Contrato de toda seção do painel. */
export interface Secao {
  pintar: () => void;
}

export const dentro = (iso: string, de: string, ate: string): boolean => iso >= de && iso <= ate;

export const baseVazia = (): Base => ({
  usuarios: [], transportadoras: [], rotas: [], sessoes: [], leituras: [], ocorrencias: [],
  porSessao: new Map(), ocPorSessao: new Map()
});
```

- [ ] **Step 2: Usar em `gestor.ts`**

Em `src/app/gestor.ts`, remover a interface `Base` (linhas 32-41) e a constante `dentro` (linha 105), e trocar a inicialização de `base` (linhas 44-47) por:

```ts
import { baseVazia, dentro, type Base, type Contexto, type Secao } from './gestor/contexto.js';

let usuario: Usuario | null = null;
let base: Base = baseVazia();
```

Os tipos `Dispositivo`, `Leitura`, `Ocorrencia`, `Rota`, `Sessao`, `Transportadora`, `Usuario` continuam importados de `../types.js` — `gestor.ts` ainda os usa direto.

- [ ] **Step 3: Verificar**

```bash
npm run typecheck
```

Esperado: sem erro. Se acusar import não usado, remover o que sobrou.

- [ ] **Step 4: Commit**

```bash
git add src/app/gestor/contexto.ts src/app/gestor.ts
git commit -m "Base e Contexto saem de gestor.ts para poderem ser compartilhados"
```

---

## Task 6: `gestor.html` ganha seções e `gestor.ts` usa o shell

Esta é a task que deixa `tests/painel-shell.test.mjs` verde. **O HTML de cada seção não é apagado aqui** — ele é reagrupado dentro de uma `<section data-secao>`, e continua sendo pintado pelas funções que já existem em `gestor.ts`. A mudança de dono do HTML acontece na Task 7, um módulo por commit.

Isso não é caprichoso: `tsconfig.json` tem `noUnusedLocals: true`, e `$()` lança quando o elemento não existe. Apagar markup antes de mover a função correspondente quebra o typecheck **e** o boot no mesmo commit.

**Files:**
- Modify: `gestor.html`
- Modify: `src/app/gestor.ts:107-198`

- [ ] **Step 1: Reagrupar `gestor.html` em seções**

Apagar o `<header class="p-topo">` inteiro (linhas 12-25) — quem desenha o topo agora é o shell.

Dentro de `<div id="conteudo" hidden>`, substituir as cinco `<section class="p-secao">` numeradas por oito seções com `data-secao`, **movendo o markup existente para dentro delas sem alterar nenhum `id`**:

| `data-secao` | Recebe o markup de |
|---|---|
| `hoje` | `#atencao`, `#faixa-divergencia`, o `p-grade` com `#sessoes-abertas` e `#incompletos-hoje`, e o cartão de `#nao-mapeados` (hoje linhas 51-63 e 97-104) |
| `ocorrencias` | O cartão "Ocorrências do dia" com seus filtros e `#oc-lista`, e o cartão `#recorrentes` (linhas 65-95 e 106-110) |
| `conferencias` | O `p-filtros` do período e o cartão de `#tabela-sessoes` (linhas 117-149) |
| `desempenho` | O `p-grade` com `#desempenho-pessoa` e `#desempenho-rota` (linhas 155-164) |
| `pessoas` | O cartão "Acessos" (linhas 171-198) |
| `transportadoras` | O cartão "Transportadoras" (linhas 200-215) |
| `rotas` | O cartão "Códigos de rota" (linhas 217-236) |
| `sincronizacao` | O `p-grade` da seção 5 inteira (linhas 243-276) |

Cada uma fica assim, com o `<h2>` virando o título da seção:

```html
      <section class="p-secao" data-secao="hoje" hidden>
        <h2>Tem algo errado agora?</h2>
        <!-- markup existente, ids preservados -->
      </section>
```

Os botões `#btn-sync` e `#btn-retry`, que estavam no `<header>`, vão para o `p-filtros` do cartão "Conexão" dentro de `data-secao="sincronizacao"`, junto de `#btn-salvar-sup` e `#btn-testar-sup`. `#chip-sync` e `#btn-sair` passam a nascer com o shell.

O `<div id="gaveta">` continua onde está, no fim do `<body>`: é sobreposição, não conteúdo de seção.

O shell é montado por JavaScript depois do login — antes disso a página é só a caixa de acesso, sem menu para quem não entrou.

- [ ] **Step 2: Montar o shell em `iniciarPainel()`**

Em `src/app/gestor.ts`, acrescentar ao topo do arquivo:

```ts
import { montarShell, type ItemMenu, type Shell } from '../lib/painel-shell.js';
```

Declarar, junto das outras variáveis de módulo (perto da linha 48):

```ts
let shell: Shell | null = null;

const MENU: ItemMenu[] = [
  { id: 'hoje', rotulo: 'Hoje', grupo: 'Operação' },
  { id: 'conferencias', rotulo: 'Conferências', grupo: 'Operação' },
  { id: 'ocorrencias', rotulo: 'Ocorrências', grupo: 'Operação' },
  { id: 'desempenho', rotulo: 'Desempenho', grupo: 'Análise' },
  { id: 'diretor', rotulo: 'Visão do diretor', grupo: 'Análise', href: 'diretor.html' },
  { id: 'pessoas', rotulo: 'Pessoas', grupo: 'Cadastros' },
  { id: 'transportadoras', rotulo: 'Transportadoras', grupo: 'Cadastros' },
  { id: 'rotas', rotulo: 'Códigos de rota', grupo: 'Cadastros' },
  { id: 'sincronizacao', rotulo: 'Sincronização', grupo: 'Sistema' }
];
```

Declarar também o mapa de seções montadas e o contexto que elas recebem:

```ts
/** Seções já montadas, por id do menu. Preenchido conforme a Task 7 avança. */
const secoes = new Map<string, Secao>();

const contexto: Contexto = {
  usuario: () => usuario as Usuario,
  base: () => base,
  dispositivos: () => dispositivos,
  recarregar: () => recarregarTudo(),
  irPara: (id) => shell?.irPara(id)
};

/**
 * Repinta só a seção visível.
 *
 * Antes as cinco seções eram redesenhadas a cada 15 segundos, inclusive as que
 * ninguém estava vendo — e cada repintura reconstrói tabela inteira em innerHTML.
 */
function pintarSecaoVisivel(): void {
  if (!shell) return;
  secoes.get(shell.secaoAtual())?.pintar();
}
```

Trocar `iniciarPainel()` (linhas 167-182) por:

```ts
async function iniciarPainel(): Promise<void> {
  elLogin.bloqueio.hidden = true;
  elLogin.conteudo.hidden = false;

  shell = montarShell(MENU, {
    titulo: 'Painel do gestor',
    usuario: usuario ? `${usuario.nome} • gestor` : '',
    inicial: 'hoje'
  });

  $('#btn-sair').addEventListener('click', () => {
    auth.sair();
    location.href = 'index.html';
  });

  shell.aoTrocarSecao(() => pintarSecaoVisivel());

  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 29 * 86400000);
  $<HTMLInputElement>('#f-de').value = trintaDias.toISOString().slice(0, 10);
  $<HTMLInputElement>('#f-ate').value = hoje.toISOString().slice(0, 10);

  await recarregarTudo();
  await preencherConfigSupabase();

  // Sessão aberta é informação viva: sem atualizar, o painel mente.
  window.setInterval(() => void atualizarAoVivo(), 15000);
}
```

As quatro linhas de `#f-de`/`#f-ate` e a de `preencherConfigSupabase()` mudam de casa na Task 7, junto com as seções donas desses campos.

E `recarregarTudo()` / `atualizarAoVivo()` (linhas 184-198) ganham a repintura da seção visível **sem perder** as chamadas antigas, que ainda são as donas do HTML até a Task 7:

```ts
async function recarregarTudo(): Promise<void> {
  await carregar();
  dispositivos = await sync.listarDispositivos();
  pintarDispositivos();
  preencherSelects();
  pintarAgora();
  pintarHistorico();
  pintarCadastros();
  pintarSecaoVisivel();   // vazio hoje; cresce conforme a Task 7 avança
  void sync.atualizarContagem();
}

async function atualizarAoVivo(): Promise<void> {
  await carregar();
  pintarAgora();
  pintarSecaoVisivel();
}
```

Cada passo da Task 7 remove daqui a chamada da seção que virou módulo. No fim da Task 7 só sobram `carregar()`, `listarDispositivos()`, `pintarAlarmeGlobal()` e `pintarSecaoVisivel()`.

`pintarAlarmeGlobal()` é escrito na Task 8. Até lá, não declarar nada: `noUnusedLocals` reprovaria uma função de corpo vazio que ninguém chama.

O `#p-usuario` some do objeto `elLogin` e a linha `elLogin.usuario.textContent = ...` sai — quem escreve o nome agora é o shell, pelo `OpcoesShell.usuario`.

O listener `$('#btn-sair')` de módulo (linhas 138-141) sai: o botão passa a nascer com o shell, depois do login, e é ligado dentro de `iniciarPainel()`.

- [ ] **Step 3: Rodar e ver passar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs
```

Esperado: `SHELL_OK`, e o painel abre com o menu funcionando e todo o conteúdo antigo no lugar — só que agora distribuído entre as seções em vez de empilhado numa rolagem só.

- [ ] **Step 4: Commit**

```bash
git add gestor.html src/app/gestor.ts
git commit -m "o painel deixa de ser uma rolagem só e passa a ter seções

gestor.html vira moldura: uma seção vazia por item de menu, preenchida em
JavaScript. O shell só nasce depois do login — quem não entrou não vê menu."
```

---

## Task 7: Mover as seções para módulos

Seis módulos, um por seção. Cada um recebe a raiz onde pintar e o contexto.

**Files:**
- Create: `src/app/gestor/hoje.ts`, `conferencias.ts`, `ocorrencias.ts`, `desempenho.ts`, `cadastros.ts`, `sincronizacao.ts`
- Modify: `src/app/gestor.ts`, `gestor.html`

**Regra de transformação, igual para os seis.** Cada passo faz exatamente isto, num commit:

1. O markup daquela seção **sai** de `gestor.html` e vira a string de `montar()`.
2. As funções daquela seção **saem** de `gestor.ts` e entram no módulo.
3. Todo `$('#x')` que aponta para dentro da seção ganha a raiz: `$('#x', raiz)`.
4. O que a função lia de variável de módulo (`base`, `dispositivos`, `usuario`) passa a vir do contexto: `ctx.base()`, `ctx.dispositivos()`, `ctx.usuario()`.
5. `recarregarTudo()` perde a chamada antiga daquela seção; `secoes.set('<id>', modulo.montar($('[data-secao="<id>"]'), contexto))` entra em `iniciarPainel()`.

Antes, em `gestor.ts`:

```ts
function pintarDispositivos(): void {
  $('#dispositivos').innerHTML = tabela([...], dispositivos.map(...), 'Nenhum aparelho...');
}
```

Depois, em `src/app/gestor/sincronizacao.ts`:

```ts
  pintar: () => {
    $('#dispositivos', raiz).innerHTML = tabela([...], ctx.dispositivos().map(...), 'Nenhum aparelho...');
  }
```

Faça um módulo por commit, nesta ordem, rodando depois de cada um:

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs && node tests/login-sandro.mjs && node tests/e2e.test.mjs
```

Nenhum passo pode fechar com typecheck vermelho: `noUnusedLocals` reprova função que sobrou sem chamador, e é justamente esse o sinal de que a etapa 5 acima não foi feita.

- [ ] **Step 1: `sincronizacao.ts`** — é o menor e o mais isolado, bom para firmar o padrão.

Criar `src/app/gestor/sincronizacao.ts`:

```ts
// sincronizacao.ts — conexão com o Supabase, fila local e aparelhos em operação.
//
// A conferência funciona sem nada disto: o Supabase é destino de sincronização,
// nunca dependência da bipagem.

import * as sync from '../../lib/sync.js';
import { salvarConfig, obterConfig, testarConexao } from '../../lib/supabase.js';
import { $, dataHora, esc } from '../../lib/util.js';
import type { Contexto, Secao } from './contexto.js';

export function montar(raiz: HTMLElement, ctx: Contexto): Secao {
  raiz.innerHTML = `
    <h2>Sincronização com o Supabase</h2>
    <div class="p-grade p-grade-2">
      <div class="p-cartao">
        <h3>Conexão</h3>
        <p class="p-vazio" style="padding-top:0">
          A conferência funciona sem isto. O Supabase só recebe o que já foi
          gravado no aparelho — se faltar rede, a fila espera.
        </p>
        <label for="s-url">URL do projeto</label>
        <input id="s-url" type="text" placeholder="https://xxxx.supabase.co" />
        <label for="s-key">Chave anônima (anon)</label>
        <input id="s-key" type="text" placeholder="eyJhbGciOi..." />
        <label for="s-bucket">Bucket das fotos</label>
        <input id="s-bucket" type="text" placeholder="ocorrencias" />
        <div class="p-filtros" style="margin-top:14px">
          <button id="btn-salvar-sup" class="btn btn-primario">Salvar</button>
          <button id="btn-testar-sup" class="btn btn-secundario">Testar conexão</button>
          <button id="btn-sync" class="btn btn-secundario">Sincronizar agora</button>
          <button id="btn-retry" class="btn btn-secundario">Reenviar o que falhou</button>
        </div>
        <p id="s-msg" class="sucesso" hidden></p>
      </div>
      <div class="p-cartao">
        <h3>Fila local</h3>
        <div id="fila-status"></div>
      </div>
      <div class="p-cartao">
        <h3>Aparelhos em operação</h3>
        <p class="p-vazio" style="padding-top:0">
          Aparelho com leitura pendente significa que o número desta tela ainda
          não está completo.
        </p>
        <div id="dispositivos" class="p-tab-wrap"></div>
      </div>
    </div>`;

  void obterConfig().then((c) => {
    $<HTMLInputElement>('#s-url', raiz).value = c.url;
    $<HTMLInputElement>('#s-key', raiz).value = c.anonKey;
    $<HTMLInputElement>('#s-bucket', raiz).value = c.bucket;
  });

  $('#btn-sync', raiz).addEventListener('click', async () => {
    await sync.sincronizar();
    await ctx.recarregar();
  });

  $('#btn-retry', raiz).addEventListener('click', async () => {
    await sync.tentarNovamente();
    await ctx.recarregar();
  });

  $('#btn-salvar-sup', raiz).addEventListener('click', async () => {
    await salvarConfig({
      url: $<HTMLInputElement>('#s-url', raiz).value,
      anonKey: $<HTMLInputElement>('#s-key', raiz).value,
      bucket: $<HTMLInputElement>('#s-bucket', raiz).value
    });
    const msg = $('#s-msg', raiz);
    msg.className = 'sucesso';
    msg.textContent = 'Configuração salva neste aparelho.';
    msg.hidden = false;
    await sync.atualizarContagem();
  });

  $('#btn-testar-sup', raiz).addEventListener('click', async () => {
    const msg = $('#s-msg', raiz);
    msg.textContent = 'Testando…';
    msg.className = 'sucesso';
    msg.hidden = false;
    const r = await testarConexao();
    msg.className = r.ok ? 'sucesso' : 'erro';
    msg.textContent = r.mensagem;
  });

  return {
    pintar: () => {
      const linhas = ctx.dispositivos().map((d) => `
        <tr>
          <td>${esc(d.apelido.slice(0, 48))}</td>
          <td>${esc(d.ultimoUsuario || '—')}</td>
          <td>${d.ultimaSync ? dataHora(d.ultimaSync) : 'nunca'}</td>
          <td class="p-num-col">${d.pendentes > 0 ? `<b style="color:var(--dup)">${d.pendentes}</b>` : '0'}</td>
        </tr>`).join('');

      $('#dispositivos', raiz).innerHTML = linhas
        ? `<table class="p-tab">
             <thead><tr><th>Aparelho</th><th>Última pessoa</th><th>Última sincronização</th><th>Pendentes</th></tr></thead>
             <tbody>${linhas}</tbody>
           </table>`
        : '<p class="p-vazio">Nenhum aparelho sincronizou ainda — ou o Supabase não está configurado.</p>';
    }
  };
}

/** A fila é pintada pelo callback de sync, que vive em `gestor.ts`. */
export function pintarFila(
  raiz: HTMLElement,
  erro: string | null,
  pendentes: number,
  configurado: boolean,
  ultimo: string | null
): void {
  const alvo = raiz.querySelector('#fila-status');
  if (!alvo) return; // a seção ainda não foi montada
  alvo.innerHTML = `
    <div class="p-kpis">
      <div class="p-kpi"><span class="p-kpi-rot">Registros na fila</span><span class="p-kpi-val">${pendentes}</span></div>
      <div class="p-kpi"><span class="p-kpi-rot">Conexão</span><span class="p-kpi-val" style="font-size:18px">${navigator.onLine ? 'online' : 'offline'}</span></div>
      <div class="p-kpi"><span class="p-kpi-rot">Supabase</span><span class="p-kpi-val" style="font-size:18px">${configurado ? 'configurado' : 'não configurado'}</span></div>
    </div>
    <p class="p-vazio">Último envio: ${ultimo ? dataHora(ultimo) : 'ainda não houve'}.</p>
    ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}`;
}
```

Em `gestor.ts`: apagar `preencherConfigSupabase()`, `pintarFila()`, `pintarDispositivos()` e os quatro listeners de módulo (linhas 946-997); apagar os imports de `salvarConfig/obterConfig/testarConexao`; montar a seção em `iniciarPainel()`:

```ts
  const secoes = new Map<string, Secao>();
  secoes.set('sincronizacao', sincronizacao.montar($('[data-secao="sincronizacao"]'), contexto));
```

e no callback `sync.aoMudarSync`, trocar a chamada de `pintarFila(...)` por:

```ts
    sincronizacao.pintarFila($('[data-secao="sincronizacao"]'), estado.ultimoErro, estado.pendentes, estado.configurado, estado.ultimoEnvio);
```

**Commit:** `git commit -m "seção de sincronização vira módulo próprio"`

- [ ] **Step 2: `ocorrencias.ts`**

Mover de `gestor.ts` as funções `ocorrenciasFiltradas()` (375-397), `pintarOcorrencias()` (398-416) e `pintarRecorrentes()` (417-447), mais o HTML dos filtros de ocorrência que estava em `gestor.html:66-95` e o cartão de recorrentes (`gestor.html:106-110`). O `montar()` escreve esse HTML e prende os listeners de `#oc-momento`, `#oc-etiqueta`, `#oc-busca`, `#oc-dias` e `#btn-oc-csv`; o `pintar()` chama as duas funções de pintura. Todo `$('#x')` vira `$('#x', raiz)`.

**Commit:** `git commit -m "seção de ocorrências vira módulo próprio"`

- [ ] **Step 3: `conferencias.ts`**

Mover `filtroPeriodo()` (450-455), `sessoesFiltradas()` (456-470), `pintarHistorico()` (471-513), `estadoDaCarga()` (514-532), `liberarCarga()` (533-579), `abrirGaveta()` (640-655), mais o HTML de `gestor.html:117-149`. A gaveta (`#gaveta`) continua fora das seções, no fim do `body` — ela é sobreposição, não conteúdo de seção.

`sessoesFiltradas()` e `filtroPeriodo()` são usadas também pela seção Desempenho. Exportar as duas:

```ts
export function filtroPeriodo(raiz: HTMLElement): { de: string; ate: string };
export function sessoesFiltradas(raiz: HTMLElement, base: Base): Sessao[];
```

As duas leem `#f-de`/`#f-ate`, que vivem nesta seção — por isso recebem a raiz dela, não a de quem chama. `sessoesFiltradas()` não ordena: quem precisar de ordem que ordene.

O valor inicial dos dois campos (últimos 30 dias) sai de `iniciarPainel()` e entra no `montar()` desta seção:

```ts
  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 29 * 86400000);
  $<HTMLInputElement>('#f-de', raiz).value = trintaDias.toISOString().slice(0, 10);
  $<HTMLInputElement>('#f-ate', raiz).value = hoje.toISOString().slice(0, 10);
```

O `#btn-filtrar` repinta só esta seção. Desempenho lê o mesmo filtro quando o gestor navega até ela — `aoTrocarSecao` dispara `pintarSecaoVisivel()`, e ela pega o valor atual dos campos. É o que evita redesenhar gráfico que ninguém está olhando.

**A seção Conferências fica sempre montada**, mesmo escondida: `#f-de` e `#f-ate` precisam existir no DOM para Desempenho conseguir lê-los. Montar todas as seções no `iniciarPainel()` — o que o shell controla é a visibilidade, não a existência.

**Commit:** `git commit -m "seção de conferências vira módulo próprio"`

- [ ] **Step 4: `desempenho.ts`**

Mover `pintarDesempenho()` (582-635) e o HTML de `gestor.html:153-165`. Recebe as sessões filtradas por parâmetro, como já recebe hoje.

**Commit:** `git commit -m "seção de desempenho vira módulo próprio"`

- [ ] **Step 5: `cadastros.ts`**

Mover `preencherSelects()` (658-682), `pintarCadastros()` (684-785), `donoDoCodigo()` (788-792), `cadastrarRota()` (795-818), `avisoUsuario()` (826-833), `limparFormUsuario()` (834-842), `entrarEmEdicao()` (843-945) e os três formulários de `gestor.html:168-238`.

O módulo exporta **três** `montar`, um por seção do menu — as três telas de cadastro são itens separados:

```ts
export function montarPessoas(raiz: HTMLElement, ctx: Contexto): Secao;
export function montarTransportadoras(raiz: HTMLElement, ctx: Contexto): Secao;
export function montarRotas(raiz: HTMLElement, ctx: Contexto): Secao;
```

`preencherSelects()` mexe em `#f-pessoa`, `#f-rota` e `#oc-etiqueta`, que agora vivem em outras seções — mover essas três linhas para os `montar()` de `conferencias.ts` e `ocorrencias.ts`, deixando em `cadastros.ts` só o `#r-transportadora`.

**Commit:** `git commit -m "cadastros viram três telas: pessoas, transportadoras e códigos de rota"`

- [ ] **Step 6: `hoje.ts`**

Mover `pintarAgora()` (202-259), `pintarAtencao()` (265-297) e `pintarNaoMapeados()` (303-357), mais o HTML de `gestor.html:48-63` e `:97-104`. As chamadas a `pintarOcorrencias()` e `pintarRecorrentes()` saem de `pintarAgora()` — aquelas seções são pintadas pelos próprios módulos.

`pintarNaoMapeados()` chama `cadastrarRota()`, que mudou de arquivo: importar de `./cadastros.js`.

**Commit:** `git commit -m "seção Hoje vira módulo próprio, e gestor.ts fica só com boot e roteamento"`

- [ ] **Step 7: Verificação final da task**

```bash
npm run typecheck && npm run build \
  && node tests/painel-shell.test.mjs \
  && node tests/login-sandro.mjs \
  && node tests/e2e.test.mjs
```

Esperado: `SHELL_OK`, `SANDRO_OK` e a saída de sucesso do e2e. Conferir também:

```bash
wc -l src/app/gestor.ts src/app/gestor/*.ts
```

Esperado: `gestor.ts` abaixo de 200 linhas; nenhum módulo acima de 400.

---

## Task 8: A trava da divergência — badge e faixa em toda seção

**Files:**
- Modify: `src/app/gestor.ts`
- Test: `tests/painel-shell.test.mjs`

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/painel-shell.test.mjs`, antes de `await navegador.close()`, acrescentar:

```js
await passo('divergência do dia acompanha o gestor até em Cadastros', async () => {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, 'gestor.html');

  // Uma sessão de hoje com um volume de outra transportadora.
  await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const agora = new Date().toISOString();
    const meta = { sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: agora };
    await new Promise((ok) => {
      const tx = bd.transaction(['sessoes', 'leituras'], 'readwrite');
      tx.objectStore('sessoes').put({
        ...meta, id: 'sessao-div', transportadoraId: '00000000-0000-4000-8000-000000000010',
        usuarioId: '00000000-0000-4000-8000-000000000002', inicio: agora, fim: agora,
        status: 'ENCERRADA', transportadoraNome: 'LOGDIS', rotas: ['FNOR'], usuarioNome: 'Ana Paula',
        geoInicio: null, geoFim: null, liberadaEm: null, liberadaPor: null, liberadaComPendencias: false
      });
      tx.objectStore('leituras').put({
        ...meta, id: 'leitura-div', sessaoId: 'sessao-div', codigoVolume: 'EMB0008399999',
        rota: 'FSUL 200', rotaPrefixo: 'FSUL', rotaId: null,
        transportadoraDonaId: '00000000-0000-4000-8000-000000000011',
        transportadoraDonaNome: 'Transportadora Sul', volume: '0001/0002', pedido: '86945574',
        status: 'ROTA_DIVERGENTE', timestamp: agora, rawData: 'EMB0008399999;FSUL 200;0001/0002;86945574',
        origem: 'MANUAL', dispositivoId: 'teste', lat: null, lng: null, precisaoMetros: null,
        geoStatus: 'INDISPONIVEL'
      });
      tx.oncomplete = ok;
    });
    bd.close();
  });

  await p.reload();
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });

  const badge = await p.textContent('[data-badge="hoje"]');
  if (badge.trim() !== '1') throw new Error(`badge do item Hoje: "${badge}"`);

  // O ponto do teste: navegar para longe do alarme não apaga o alarme.
  await p.click('.p-item[href="#transportadoras"]');
  await p.waitForSelector('[data-secao="transportadoras"]:not([hidden])', { timeout: 4000 });
  if (!(await p.isVisible('.p-alerta-fixo'))) throw new Error('a faixa sumiu em Cadastros');

  await p.click('.p-alerta-fixo a');
  await p.waitForSelector('[data-secao="hoje"]:not([hidden])', { timeout: 4000 });
  await ctx.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/painel-shell.test.mjs
```

Esperado: `FALHA - divergência do dia acompanha o gestor até em Cadastros` — badge vazio.

- [ ] **Step 3: Implementar**

Em `src/app/gestor.ts`, acrescentar:

```ts
/**
 * As duas travas que o menu exige.
 *
 * Sem elas, a divergência do dia passaria a viver atrás de um item de menu — e
 * o painel inteiro existe para que ela não precise ser procurada.
 */
function pintarAlarmeGlobal(): void {
  if (!shell) return;
  const { inicio, fim } = limitesDoDia();
  const n = base.leituras.filter(
    (l) => l.status === 'ROTA_DIVERGENTE' && dentro(l.timestamp, inicio, fim)
  ).length;

  shell.definirBadge('hoje', n);
  shell.definirAlerta(n
    ? `<b>${n} volume(s) de outra rota hoje.</b> Não podem embarcar.
       <a href="#hoje">Ver quais são</a>`
    : null);
}
```

Chamar em `recarregarTudo()` e em `atualizarAoVivo()`, depois de `carregar()`.

- [ ] **Step 4: Rodar e ver passar**

```bash
npm run build && node tests/painel-shell.test.mjs
```

Esperado: `SHELL_OK`.

- [ ] **Step 5: Commit**

```bash
git add src/app/gestor.ts tests/painel-shell.test.mjs
git commit -m "a divergência do dia segue o gestor por todas as seções

O menu criou o risco de esconder o alarme atrás de um item. Badge no item Hoje
e faixa fixa acima de toda seção — inclusive Cadastros e Sincronização. Sem
divergência, a faixa some: alarme que toca sempre deixa de ser alarme."
```

---

## Task 9: KPIs do dia na seção Hoje

**Files:**
- Modify: `src/app/gestor/hoje.ts`

- [ ] **Step 1: Implementar**

Em `src/app/gestor/hoje.ts`, acrescentar ao HTML de `montar()`, logo depois do `<div id="faixa-divergencia"></div>`:

```html
      <div id="kpis-hoje" class="p-kpis"></div>
```

E a função de pintura:

```ts
/**
 * KPI com comparação. Número sozinho não sustenta decisão: 4 divergências é
 * ruim ou é terça-feira? A média dos sete dias anteriores responde.
 */
function kpi(rotulo: string, valor: number, media: number, menorEhMelhor = true): string {
  const dif = valor - media;
  const classe = Math.abs(dif) < 0.5 ? 'p-neutro' : (dif > 0) === menorEhMelhor ? 'p-sobe' : 'p-desce';
  const cmp = media === 0 && valor === 0
    ? 'igual aos 7 dias anteriores'
    : `${dif >= 0 ? '+' : ''}${dif.toFixed(1)} vs. média de 7 dias (${media.toFixed(1)})`;
  return `<div class="p-kpi">
    <span class="p-kpi-rot">${esc(rotulo)}</span>
    <span class="p-kpi-val">${valor}</span>
    <span class="p-kpi-cmp ${classe}">${esc(cmp)}</span>
  </div>`;
}

function pintarKPIs(raiz: HTMLElement, base: Base): void {
  const { inicio, fim } = limitesDoDia();
  const hoje = base.leituras.filter((l) => dentro(l.timestamp, inicio, fim));

  // Sete dias anteriores, sem contar hoje: a média é a régua, não o dado.
  const inicioJanela = new Date(new Date(inicio).getTime() - 7 * 86400000).toISOString();
  const anteriores = base.leituras.filter((l) => l.timestamp >= inicioJanela && l.timestamp < inicio);
  const mediaDe = (filtro: (l: Leitura) => boolean): number => anteriores.filter(filtro).length / 7;

  const abertas = base.sessoes.filter((s) => s.status === 'ABERTA').length;
  const gravesHoje = base.ocorrencias.filter((o) => o.grave && dentro(o.timestamp, inicio, fim)).length;
  const gravesAntes = base.ocorrencias.filter((o) => o.grave && o.timestamp >= inicioJanela && o.timestamp < inicio).length / 7;

  $('#kpis-hoje', raiz).innerHTML = [
    kpi('Volumes conferidos', hoje.length, mediaDe(() => true), false),
    kpi('Volumes de outra rota', hoje.filter((l) => l.status === 'ROTA_DIVERGENTE').length,
        mediaDe((l) => l.status === 'ROTA_DIVERGENTE')),
    kpi('Rotas não cadastradas', hoje.filter((l) => l.status === 'DESTINO_NAO_MAPEADO').length,
        mediaDe((l) => l.status === 'DESTINO_NAO_MAPEADO')),
    kpi('Pedidos incompletos', pedidosIncompletos(hoje).length,
        pedidosIncompletos(anteriores).length / 7),
    kpi('Ocorrências graves', gravesHoje, gravesAntes),
    `<div class="p-kpi${abertas ? ' p-destaque' : ''}">
       <span class="p-kpi-rot">Conferências abertas</span>
       <span class="p-kpi-val">${abertas}</span>
       <span class="p-kpi-cmp p-neutro">agora, em tempo real</span>
     </div>`
  ].join('');
}
```

Chamar `pintarKPIs(raiz, ctx.base())` dentro do `pintar()` da seção. Imports necessários:

```ts
import type { Leitura } from '../../types.js';
import { pedidosIncompletos } from '../../lib/model.js';
import { $, esc, limitesDoDia } from '../../lib/util.js';
import { dentro, type Base } from './contexto.js';
```

- [ ] **Step 2: Verificar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs && node tests/login-sandro.mjs
```

Esperado: tudo verde.

- [ ] **Step 3: Commit**

```bash
git add src/app/gestor/hoje.ts
git commit -m "KPIs do dia comparados com a média dos 7 dias anteriores

Quatro divergências é ruim ou é terça-feira? Sem régua o número não decide
nada — e o painel do diretor já fazia isso, o do gestor não."
```

---

## Task 10: Gráficos na seção Desempenho

**Files:**
- Modify: `src/app/gestor/desempenho.ts`

- [ ] **Step 1: Implementar**

Em `src/app/gestor/desempenho.ts`, acrescentar ao HTML de `montar()`, **antes** das tabelas por pessoa e por rota:

```html
    <div class="p-cartao" style="margin-bottom:16px">
      <h3>Distribuição das leituras</h3>
      <div id="dist-status"></div>
    </div>
    <div id="graficos-desempenho" class="p-graficos"></div>
    <div class="p-grade p-grade-2" style="margin-top:16px">
      <div class="p-cartao"><h3>Divergência por rota</h3><div id="rank-rota-gestor"></div></div>
      <div class="p-cartao"><h3>Divergência por transportadora</h3><div id="rank-transp-gestor"></div></div>
    </div>
```

E a pintura, dentro do `pintar()`, recebendo as sessões filtradas:

```ts
function pintarGraficos(raiz: HTMLElement, base: Base, sessoes: Sessao[], periodo: { de: string; ate: string }): void {
  const ids = new Set(sessoes.map((s) => s.id));
  const leituras = base.leituras.filter((l) => ids.has(l.sessaoId));

  // Os dias vêm do filtro, não das sessões: dia sem conferência precisa aparecer
  // zerado. Série que pula dia esconde justamente o dia em que ninguém conferiu.
  const dias: string[] = [];
  const fim = periodo.ate.slice(0, 10);
  for (let d = new Date(`${periodo.de.slice(0, 10)}T12:00:00`); d.toISOString().slice(0, 10) <= fim; d.setDate(d.getDate() + 1)) {
    dias.push(d.toISOString().slice(0, 10));
    if (dias.length > 120) break; // período absurdo não vira gráfico ilegível
  }
  const noDia = (dia: string): Leitura[] => leituras.filter((l) => l.timestamp.slice(0, 10) === dia);

  $('#graficos-desempenho', raiz).innerHTML =
    graficoDiario(dias.map((d) => ({ rotulo: d, valor: noDia(d).length })),
      { titulo: 'Volumes conferidos por dia', cor: 'var(--logdis-green)' })
    + graficoDiario(dias.map((d) => {
        const ls = noDia(d);
        return { rotulo: d, valor: pct(ls.filter((l) => l.status === 'ROTA_DIVERGENTE').length, ls.length) };
      }), { titulo: 'Taxa de divergência por dia', subtitulo: 'volume que quase embarcou errado', cor: 'var(--div)', sufixo: '%', casas: 1 });

  $('#dist-status', raiz).innerHTML = barraEmpilhada([
    { rotulo: 'Liberados', valor: leituras.filter((l) => l.status === 'OK').length, cor: STATUS_INFO.OK.cor },
    { rotulo: 'Outra rota', valor: leituras.filter((l) => l.status === 'ROTA_DIVERGENTE').length, cor: STATUS_INFO.ROTA_DIVERGENTE.cor },
    { rotulo: 'Rota não cadastrada', valor: leituras.filter((l) => l.status === 'DESTINO_NAO_MAPEADO').length, cor: STATUS_INFO.DESTINO_NAO_MAPEADO.cor },
    { rotulo: 'Duplicados', valor: leituras.filter((l) => l.status === 'DUPLICADO').length, cor: STATUS_INFO.DUPLICADO.cor },
    { rotulo: 'Inválidos', valor: leituras.filter((l) => l.status === 'INVALIDO').length, cor: STATUS_INFO.INVALIDO.cor }
  ]);

  const porChave = (chave: (l: Leitura) => string): { rotulo: string; valor: number; detalhe: string }[] => {
    const mapa = new Map<string, { total: number; div: number }>();
    for (const l of leituras) {
      const k = chave(l) || '—';
      const a = mapa.get(k) ?? { total: 0, div: 0 };
      a.total++;
      if (l.status === 'ROTA_DIVERGENTE') a.div++;
      mapa.set(k, a);
    }
    return [...mapa.entries()]
      .map(([rotulo, a]) => ({ rotulo, valor: a.div, detalhe: `${a.div} de ${a.total} (${pct(a.div, a.total)}%)` }))
      .filter((i) => i.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8);
  };

  $('#rank-rota-gestor', raiz).innerHTML =
    ranking(porChave((l) => l.rotaPrefixo ?? '—'), 'var(--div)', 'Nenhuma divergência no período.');
  $('#rank-transp-gestor', raiz).innerHTML =
    ranking(porChave((l) => l.transportadoraDonaNome ?? '—'), 'var(--div)', 'Nenhuma divergência no período.');
}
```

Imports necessários no topo do módulo:

```ts
import type { Leitura, Sessao } from '../../types.js';
import { barraEmpilhada, graficoDiario, ranking } from '../../lib/graficos.js';
import { STATUS_INFO } from '../../lib/model.js';
import { $, pct } from '../../lib/util.js';
import type { Base } from './contexto.js';
```

O `periodo` vem de `filtroPeriodo()`, que a Task 7 Step 3 exportou de `conferencias.ts` — a seção Desempenho lê o mesmo filtro que a de Conferências, e o `<h2>` dela já diz "(período filtrado)".

- [ ] **Step 2: Verificar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs
```

Esperado: verde. Abrir `http://127.0.0.1:4173/gestor.html` com `npm run preview` e conferir que os gráficos desenham e que a barra empilhada soma 100%.

- [ ] **Step 3: Commit**

```bash
git add src/app/gestor/desempenho.ts
git commit -m "o painel do gestor ganha gráficos: série diária, distribuição e ranking

Mesma paleta de status da tela do operador — verde e vermelho precisam
significar a mesma coisa nas duas telas. Ranking é por rota e por
transportadora, que são processos; pessoa em placar vira pressão por
velocidade, e velocidade é o que faz a conferência ser mal feita."
```

---

## Task 11: Cadastro editável e nome único

**Files:**
- Modify: `src/app/gestor/cadastros.ts`
- Test: `tests/cadastros.test.mjs` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/cadastros.test.mjs`:

```js
// O gestor precisa consertar o cadastro sozinho: renomear uma transportadora,
// mover um código de rota para a dona certa, e não conseguir criar a segunda
// "LOGDIS" que quebra a escolha do operador na doca.
import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, entrar } from './cadastro.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
let falhou = false;

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

const emCadastros = async (secao) => {
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, 'gestor.html');
  await entrar(p, 'sandro');
  await p.waitForSelector('#conteudo:not([hidden])', { timeout: 8000 });
  await p.click(`.p-item[href="#${secao}"]`);
  await p.waitForSelector(`[data-secao="${secao}"]:not([hidden])`, { timeout: 4000 });
  return { ctx, p };
};

await passo('nome de transportadora repetido é recusado', async () => {
  const { ctx, p } = await emCadastros('transportadoras');
  await p.fill('#t-nome', ' logdis ');
  await p.click('#form-transportadora button[type=submit]');
  await p.waitForSelector('#t-msg:not([hidden])', { timeout: 4000 });
  const msg = await p.textContent('#t-msg');
  if (!/LOGDIS/i.test(msg)) throw new Error(`mensagem não diz qual já existe: "${msg}"`);

  const quantas = await p.$$eval('#lista-transportadoras tbody tr', (ns) => ns.length);
  if (quantas !== 2) throw new Error(`gravou mesmo assim: ${quantas} transportadoras`);
  await ctx.close();
});

await passo('editar transportadora renomeia sem duplicar', async () => {
  const { ctx, p } = await emCadastros('transportadoras');
  await p.click('#lista-transportadoras button[data-editar-transp]');
  await p.fill('#t-nome', 'LOGDIS Matriz');
  await p.fill('#t-email', 'doca@logdis.exemplo');
  await p.click('#form-transportadora button[type=submit]');
  await p.waitForFunction(() =>
    document.querySelector('#lista-transportadoras').textContent.includes('LOGDIS Matriz'), null, { timeout: 4000 });
  const quantas = await p.$$eval('#lista-transportadoras tbody tr', (ns) => ns.length);
  if (quantas !== 2) throw new Error(`editar criou linha nova: ${quantas}`);
  await ctx.close();
});

await passo('trocar a dona do código de rota não reescreve leitura antiga', async () => {
  const { ctx, p } = await emCadastros('rotas');

  await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const agora = new Date().toISOString();
    const meta = { sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: agora };
    await new Promise((ok) => {
      const tx = bd.transaction('leituras', 'readwrite');
      tx.objectStore('leituras').put({
        ...meta, id: 'leitura-congelada', sessaoId: 'sessao-x', codigoVolume: 'EMB1',
        rota: 'FNOR 100', rotaPrefixo: 'FNOR', rotaId: '00000000-0000-4000-8000-000000000020',
        transportadoraDonaId: '00000000-0000-4000-8000-000000000010',
        transportadoraDonaNome: 'LOGDIS', volume: '0001/0001', pedido: '1', status: 'OK',
        timestamp: agora, rawData: 'EMB1;FNOR 100;0001/0001;1', origem: 'MANUAL',
        dispositivoId: 'teste', lat: null, lng: null, precisaoMetros: null, geoStatus: 'INDISPONIVEL'
      });
      tx.oncomplete = ok;
    });
    bd.close();
  });

  await p.click('#lista-rotas button[data-editar-rota]');
  await p.selectOption('#r-transportadora', { label: 'Transportadora Sul' });
  await p.click('#form-rota button[type=submit]');
  await p.waitForFunction(() =>
    document.querySelector('#lista-rotas').textContent.includes('Transportadora Sul'), null, { timeout: 4000 });

  const dona = await p.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    const q = bd.transaction('leituras', 'readonly').objectStore('leituras').get('leitura-congelada');
    const l = await new Promise((ok) => { q.onsuccess = () => ok(q.result); });
    bd.close();
    return l.transportadoraDonaNome;
  });
  if (dona !== 'LOGDIS') throw new Error(`a leitura de ontem mudou de dona: ${dona}`);
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nCADASTROS_OK');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/cadastros.test.mjs
```

Esperado: as três linhas `FALHA` — não existe `#t-email`, `[data-editar-transp]`, `[data-editar-rota]`, e o nome repetido é aceito.

- [ ] **Step 3: Nome único e edição de transportadora**

Em `src/app/gestor/cadastros.ts`, o formulário de transportadora ganha o campo que faltava e o botão de cancelar edição:

```html
  <div class="p-campo"><label for="t-email">E-mail <em>opcional</em></label><input id="t-email" type="text" /></div>
  <button class="btn btn-primario" type="submit" id="t-salvar">Cadastrar</button>
  <button class="btn btn-fantasma" type="button" id="t-cancelar" hidden>Cancelar</button>
```

E o submit passa a criar ou atualizar, recusando nome repetido:

```ts
let editandoTransportadora: string | null = null;

async function salvarTransportadora(raiz: HTMLElement, ctx: Contexto): Promise<void> {
  const nome = $<HTMLInputElement>('#t-nome', raiz).value.trim();
  const msg = $('#t-msg', raiz);
  const erro = (texto: string): void => { msg.textContent = texto; msg.hidden = false; };
  msg.hidden = true;

  if (!nome) return erro('Informe o nome da transportadora.');

  // O nome é o que o operador lê na doca: duas iguais e ele escolhe no chute.
  const repetida = ctx.base().transportadoras
    .find((t) => t.id !== editandoTransportadora && mesmoNome(t.nome, nome));
  if (repetida) {
    return erro(`Já existe uma transportadora com este nome: "${repetida.nome}"${
      repetida.ativo ? '' : ' (inativa)'}. O operador escolhe pelo nome — duas iguais e ele escolhe no chute.`);
  }

  const campos = {
    nome,
    cnpj: $<HTMLInputElement>('#t-cnpj', raiz).value.trim(),
    responsavel: $<HTMLInputElement>('#t-resp', raiz).value.trim(),
    telefone: $<HTMLInputElement>('#t-tel', raiz).value.trim(),
    email: $<HTMLInputElement>('#t-email', raiz).value.trim()
  };

  if (editandoTransportadora) {
    const atual = ctx.base().transportadoras.find((t) => t.id === editandoTransportadora);
    if (atual) await db.salvar('transportadoras', { ...atual, ...campos });
  } else {
    await db.salvar('transportadoras', { ...novoSync(), ...campos, ativo: true });
  }

  editandoTransportadora = null;
  $<HTMLFormElement>('#form-transportadora', raiz).reset();
  $('#t-salvar', raiz).textContent = 'Cadastrar';
  $('#t-cancelar', raiz).hidden = true;
  await ctx.recarregar();
}
```

Na tabela de transportadoras, acrescentar o botão de editar antes do de desativar:

```ts
        `<button class="btn btn-fantasma" data-editar-transp="${esc(t.id)}"
                 style="min-height:32px;font-size:12px">Editar</button> `
```

e o listener que preenche o formulário:

```ts
  raiz.querySelectorAll<HTMLButtonElement>('button[data-editar-transp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = ctx.base().transportadoras.find((x) => x.id === btn.dataset.editarTransp);
      if (!t) return;
      editandoTransportadora = t.id;
      $<HTMLInputElement>('#t-nome', raiz).value = t.nome;
      $<HTMLInputElement>('#t-cnpj', raiz).value = t.cnpj;
      $<HTMLInputElement>('#t-resp', raiz).value = t.responsavel;
      $<HTMLInputElement>('#t-tel', raiz).value = t.telefone;
      $<HTMLInputElement>('#t-email', raiz).value = t.email;
      $('#t-salvar', raiz).textContent = 'Salvar alterações';
      $('#t-cancelar', raiz).hidden = false;
      $<HTMLInputElement>('#t-nome', raiz).focus();
    });
  });
```

Importar `mesmoNome` de `../../lib/model.js` e `novoSync` de `../../lib/db.js`.

- [ ] **Step 4: Edição de código de rota, incluindo a dona**

Mesmo padrão no formulário de rota: `#r-salvar`, `#r-cancelar`, `editandoRota`, botão `data-editar-rota` na tabela. O submit chama `cadastrarRota()` quando é novo e atualiza quando está editando, sempre passando por `donoDoCodigo(codigo, editandoRota)` para não deixar dois donos do mesmo código.

Ao entrar em edição, mostrar o aviso que evita o susto:

```ts
      $('#r-aviso', raiz).hidden = false;
      $('#r-aviso', raiz).textContent =
        'Trocar a dona vale da próxima bipagem em diante. As leituras já gravadas '
        + 'guardam cópia do dono da época — relatório de ontem não muda.';
```

com `<p id="r-aviso" class="p-vazio" hidden></p>` acrescentado ao formulário.

- [ ] **Step 5: Busca na lista de pessoas**

No `montarPessoas()`, acrescentar acima da tabela:

```html
  <div class="p-campo" style="margin-bottom:10px">
    <label for="u-busca">Buscar</label>
    <input id="u-busca" type="search" placeholder="nome ou login" />
  </div>
```

e filtrar a lista pelo valor, comparando com `nome` e `login` em minúsculas. `input` dispara a repintura da tabela — sem botão, sem submit.

- [ ] **Step 6: Rodar e ver passar**

```bash
npm run build && node tests/cadastros.test.mjs && npm test
```

Esperado: `CADASTROS_OK`.

- [ ] **Step 7: Registrar o teste no `test:e2e`**

Em `package.json`, acrescentar `&& node tests/cadastros.test.mjs && node tests/painel-shell.test.mjs` ao script `test:e2e`, antes de `node tests/login-sandro.mjs`.

- [ ] **Step 8: Commit**

```bash
git add src/app/gestor/cadastros.ts tests/cadastros.test.mjs package.json
git commit -m "o gestor passa a consertar o cadastro sozinho

Faltava editar transportadora e código de rota, e faltava recusar nome
repetido — é o que deixou duas 'LOGDIS' na base. Com duas iguais o operador
escolhe pelo nome, no chute, e a carga certa cai como rota não cadastrada por
causa da escolha dele.

Trocar a dona de um código vale da próxima bipagem em diante: leitura gravada
guarda cópia do dono da época, e a tela diz isso antes de salvar."
```

---

## Task 12: Aviso de transportadora sem código de rota

É a origem dos quatro "sem rota cadastrada" que aparecem na tela do operador. Hoje o painel não avisa.

**Files:**
- Modify: `src/app/gestor/hoje.ts`

- [ ] **Step 1: Implementar**

Em `pintarAtencao()`, acrescentar antes do bloco de aparelhos parados:

```ts
  // Transportadora que o operador consegue escolher e cujo volume não tem como
  // ser conferido: toda leitura vira DESTINO_NAO_MAPEADO por falta de cadastro.
  const semRota = base.transportadoras.filter(
    (t) => t.ativo && !base.rotas.some((r) => r.ativo && r.transportadoraId === t.id)
  );
  if (semRota.length) {
    itens.push({
      texto: `${semRota.length} transportadora(s) sem código de rota: ${semRota.map((t) => t.nome).join(', ')}`,
      alvo: '#rotas'
    });
  }
```

O `alvo` `#rotas` é o hash da seção de códigos de rota — o link do bloco de atenção passa a navegar entre seções, o que já funciona pelo `hashchange` do shell.

- [ ] **Step 2: Verificar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs
```

Abrir o painel com `npm run preview` e conferir que o aviso aparece quando existe transportadora sem rota, e some quando não existe.

- [ ] **Step 3: Commit**

```bash
git add src/app/gestor/hoje.ts
git commit -m "avisar transportadora sem código de rota

É o que põe 'sem rota cadastrada' na tela do operador: ele escolhe a
transportadora e toda caixa cai como rota não cadastrada. O painel sabia disso
e não falava."
```

---

## Task 13: Cartões empilhados no celular

**Files:**
- Modify: `src/styles/painel.css`
- Modify: `src/app/gestor/conferencias.ts`, `src/app/gestor/hoje.ts`

- [ ] **Step 1: CSS**

Acrescentar ao final de `src/styles/painel.css`:

```css
/* Abaixo de 1024px, tabela de operação vira cartão: rolagem lateral com o
   celular na mão faz o gestor perder a coluna que importa. Cadastro continua em
   tabela — é consulta, não urgência. */
@media (max-width: 1023px) {
  table.p-tab.p-cartoes thead { display: none; }
  table.p-tab.p-cartoes tbody tr {
    display: grid;
    grid-template-columns: minmax(96px, 34%) 1fr;
    gap: 2px 12px;
    border: 1px solid var(--borda);
    border-radius: var(--raio);
    padding: 10px 12px;
    margin-bottom: 10px;
    background: var(--fundo-2);
  }
  table.p-tab.p-cartoes tbody td {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    border: 0;
    padding: 3px 0;
    white-space: normal;
  }
  table.p-tab.p-cartoes tbody td::before {
    content: attr(data-rot);
    color: var(--texto-2);
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  table.p-tab.p-cartoes .p-num-col { text-align: left; }
}
```

- [ ] **Step 2: Marcar as tabelas de operação**

O helper `tabela()` (hoje em `gestor.ts:86-93`, movido junto com o primeiro módulo) ganha o rótulo em cada célula, que é o que o `::before` do CSS lê:

```ts
export function tabela(
  cabecalhos: string[],
  linhas: string[][],
  vazio = 'Nada aqui.',
  cartoesNoCelular = false
): string {
  if (!linhas.length) return `<p class="p-vazio">${esc(vazio)}</p>`;
  const corpo = linhas.map((l) => `<tr>${
    l.map((c, i) => `<td data-rot="${esc(cabecalhos[i] ?? '')}">${c}</td>`).join('')
  }</tr>`).join('');
  return `<table class="p-tab${cartoesNoCelular ? ' p-cartoes' : ''}">
    <thead><tr>${cabecalhos.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${corpo}</tbody>
  </table>`;
}
```

Passar `true` no quarto argumento nas tabelas de: divergências do dia, conferências abertas, pedidos incompletos, rotas não mapeadas (em `hoje.ts`) e histórico de sessões (em `conferencias.ts`).

Mover `tabela()` para `src/app/gestor/contexto.ts` e importar de lá em todos os módulos — hoje ela é duplicada em quem precisa.

- [ ] **Step 3: Verificar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs
```

Esperado: `SHELL_OK`, inclusive o passo `o painel não rola na horizontal no celular`.

- [ ] **Step 4: Commit**

```bash
git add src/styles/painel.css src/app/gestor/contexto.ts src/app/gestor/hoje.ts src/app/gestor/conferencias.ts
git commit -m "no celular, tabela de operação vira cartão

Rolar de lado com o celular na mão faz perder justamente a coluna que importa.
Cadastro continua em tabela: é consulta, não urgência."
```

---

## Task 14: O painel do diretor usa o mesmo shell

**Files:**
- Modify: `diretor.html`, `src/app/diretor.ts`

- [ ] **Step 1: Implementar**

Em `diretor.html`, remover o `<header class="p-topo">` inteiro (linhas 12-26) — quem desenha é o shell. O seletor de mês e o botão de PDF vão para dentro do conteúdo, num `.p-filtros` no topo da primeira seção.

Em `src/app/diretor.ts`, dentro da função que abre o painel depois do login, montar o shell com um menu de dois itens — o diretor tem uma tela só, e o segundo item é o caminho de volta:

```ts
montarShell(
  [
    { id: 'diretor', rotulo: 'Visão do diretor', grupo: 'Análise' },
    { id: 'gestor', rotulo: 'Painel do gestor', grupo: 'Operação', href: 'gestor.html' }
  ],
  { titulo: 'Painel do diretor', usuario: usuario ? usuario.nome : '', inicial: 'diretor' }
);
```

Envolver todo o `#conteudo` numa única `<section class="p-secao" data-secao="diretor">`, preservando as seções internas como estão: "uma tela, sem navegação profunda" continua valendo.

- [ ] **Step 2: Verificar**

```bash
npm run typecheck && npm run build && node tests/login-sandro.mjs
```

Esperado: `SANDRO_OK` — o passo `sandro abre o painel do diretor` continua verde.

- [ ] **Step 3: Commit**

```bash
git add diretor.html src/app/diretor.ts
git commit -m "o painel do diretor entra na mesma moldura

Continua sendo uma tela só, sem navegação profunda — o menu dele tem dois itens
e um deles é a volta para o painel do gestor."
```

---

## Task 15: Verificação final

- [ ] **Step 1: Bateria completa**

```bash
npm test && npm run test:e2e
```

Esperado: sem nenhuma linha `FALHA`, e as marcas de sucesso `GRAFICOS_OK`, `SHELL_OK`, `CADASTROS_OK`, `SANDRO_OK`.

- [ ] **Step 2: Screenshots novos**

`tests/saida/tela-gestor.png` é de antes do menu — `npm run test:e2e` já o regenera em `tests/e2e.test.mjs:194`. Acrescentar ali, logo depois daquela linha, o retrato do celular com a gaveta aberta:

```js
  await g.setViewportSize({ width: 390, height: 844 });
  await g.click('.p-hamburguer');
  await g.waitForSelector('.p-lateral.aberta', { timeout: 4000 });
  await g.screenshot({ path: 'tests/saida/tela-gestor-celular.png' });
```

Rodar `npm run test:e2e` e abrir os dois PNGs para conferir com o olho: menu legível, faixa de divergência visível, nada cortado na largura de 390.

- [ ] **Step 3: Conferir o tamanho dos arquivos**

```bash
wc -l src/app/gestor.ts src/app/gestor/*.ts src/lib/painel-shell.ts
```

Esperado: `gestor.ts` abaixo de 200 linhas, nenhum módulo acima de 400. Se algum passar, ele está fazendo mais de uma coisa — dividir antes de fechar.

- [ ] **Step 4: Rodar contra a base real**

```bash
npm run test:base
```

Esperado: verde. Este teste fala com o projeto de produção e é o que garante que a descida de cadastro continua funcionando depois do mexe-mexe em `gestor.ts`.

- [ ] **Step 5: Commit final**

```bash
git add tests/e2e.test.mjs tests/saida
git commit -m "screenshots do painel novo, desktop e celular"
```
