# Repaginação do LOGDIS — fatia 1: a fundação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o LOGDIS de três páginas independentes num app único com rotas sem `.html`, shell padronizado (lateral no desktop, barra inferior no celular), biblioteca de componentes tipada e linguagem visual densa — sem tocar em nada do caminho crítico da conferência.

**Architecture:** Um `index.html`, uma entrada `src/app/main.ts`, um roteador sobre History API em `src/lib/router.ts`. Cada tela vira uma região do documento, montada sob demanda. O painel ganha `src/lib/shell/` (que substitui `painel-shell.ts`) e as 12 seções viram módulos em `src/app/painel/` com o contrato `montar(raiz, ctx) → { pintar }`. Componentes ficam em `src/lib/ui/`: funções puras que devolvem HTML, testáveis em Node sem navegador, mais classes para o que tem comportamento.

**Tech Stack:** TypeScript sem framework, Vite 8, IndexedDB via `idb`, Supabase só como destino de sincronização, Playwright nos testes de ponta a ponta, `node --experimental-strip-types` nos de unidade.

**Spec:** `docs/superpowers/specs/2026-08-08-repaginacao-fundacao-design.md`

**Torna obsoleto:** `docs/superpowers/plans/2026-08-08-painel-gestor-menu-lateral.md` — escrito antes da revisão 2 daquele spec, ainda baseado em três páginas com navegação por hash. As tarefas 1, 4, 5, 6 e 8 dele já estão nos commits `78243cf`, `e20334e`, `c32aed7` e `27245b6`; as demais foram absorvidas por este plano ou empurradas para as fatias seguintes.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/router.ts` | **Criar.** Formato da URL, regra de entrada, guarda de papel, navegação sem recarga. Sem DOM nas funções de decisão. |
| `src/app/main.ts` | **Criar.** Entrada única: sync, geo, login, roteamento, montagem preguiçosa das telas. |
| `src/lib/ui/basico.ts` | **Criar.** `pageHeader`, `secao`, `vazio`, `badge`, `status`, `kpis`, `alerta`, `plural`. |
| `src/lib/ui/tabela.ts` | **Criar.** `tabela()` — densa no desktop, empilhada no celular, mesma chamada. |
| `src/lib/ui/sinal-sync.ts` | **Criar.** `sinalSync()` — os cinco estados, fonte única do texto. |
| `src/lib/ui/folha.ts` | **Criar.** `Folha` (bottom sheet) e `toast`. |
| `src/lib/ui/forma.ts` | **Criar.** `botao`, `campo`, `selecao`, `filtros`. |
| `src/lib/ui/index.ts` | **Criar.** Reexporta o pacote. |
| `src/lib/shell/topo.ts` | **Criar.** Barra do topo dos dois modos. |
| `src/lib/shell/lateral.ts` | **Criar.** Menu lateral do desktop, com grupos e badge. |
| `src/lib/shell/barra-inferior.ts` | **Criar.** Cinco abas do celular e a folha "Mais". |
| `src/lib/shell/index.ts` | **Criar.** `montarShell()` — junta os três, controla seção visível, badge e faixa. |
| `src/app/painel/contexto.ts` | **Criar.** `Base`, `Contexto`, `Modulo` — o que as seções compartilham. |
| `src/app/painel/*.ts` | **Criar.** Um módulo por seção (13). |
| `src/styles/tokens.css` | **Criar.** Tokens, as duas escalas tipográficas, paleta por papel. |
| `vercel.json` | **Criar.** Redirect dos `.html` antigos e rewrite para `index.html`. |
| `index.html` | **Modificar.** Documento único: login, operação, painel. |
| `src/app/operador.ts` | **Modificar.** Vira `montar()` em vez de rodar no import; topo novo. |
| `src/app/gestor.ts` | **Modificar.** Esvazia para `src/app/painel/`. |
| `src/app/diretor.ts` | **Modificar.** Vira `src/app/painel/indicadores.ts`. |
| `vite.config.ts` | **Modificar.** Entrada única, `base: '/'`, sem denylist. |
| `gestor.html`, `diretor.html`, `src/lib/painel-menu.ts`, `src/lib/painel-shell.ts` | **Apagar** (o shell é reescrito em `src/lib/shell/`). |

**Não tocar em nenhuma tarefa:** `db.ts` · `sync.ts` · `auth.ts` · `scanner.ts` · `decoder.worker.ts` · `geo.ts` · `model.ts` · `supabase.ts` · `relatorio.ts` · `graficos.ts` · `feedback.ts` · `marca.ts`.

**Armadilha do `tsconfig.json`:** `noUnusedLocals` e `noUnusedParameters` estão ligados, e `$()` (`src/lib/util.ts:107`) **lança** quando o seletor não acha nada. Mover markup sem mover a função que o lê quebra typecheck e boot no mesmo commit. Sempre juntos.

---

## Task 1: O roteador

Funções puras primeiro: a decisão de para onde mandar a pessoa não pode depender de DOM, senão não dá para testar sem navegador.

**Files:**
- Create: `src/lib/router.ts`
- Test: `tests/router.test.ts` (criar)
- Modify: `package.json:10`

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/router.test.ts`:

```ts
import assert from 'node:assert/strict';
import { rotaDe, caminhoDe, destinoDeEntrada, resolver } from '../src/lib/router.ts';

/* ---------------------------------------------------------- rotaDe ------- */

assert.deepEqual(rotaDe('/entrar'), { tela: 'entrar' });
assert.deepEqual(rotaDe('/bipagem'), { tela: 'bipagem' });
assert.deepEqual(rotaDe('/relatorio'), { tela: 'relatorio' });
assert.deepEqual(rotaDe('/painel'), { tela: 'painel', secao: 'inicio' });
assert.deepEqual(rotaDe('/painel/rotas'), { tela: 'painel', secao: 'rotas' });
assert.deepEqual(rotaDe('/painel/divergencias'), { tela: 'painel', secao: 'divergencias' });

// Barra no fim e barra dobrada são a mesma rota: o gestor digita errado e cola de
// e-mail. Rota que muda de significado por causa de uma barra é rota quebrada.
assert.deepEqual(rotaDe('/painel/rotas/'), { tela: 'painel', secao: 'rotas' });
assert.deepEqual(rotaDe('//painel//rotas'), { tela: 'painel', secao: 'rotas' });

// Desconhecida devolve null: quem decide o que fazer é a regra de entrada, não
// uma tela de 404. O app sempre sabe para onde mandar a pessoa.
assert.equal(rotaDe('/'), null);
assert.equal(rotaDe('/painel/inexistente'), null);
assert.equal(rotaDe('/painel/rotas/extra'), null);
// `/painel/inicio` é aceito e canonizado para `/painel`. Recusá-lo faria o
// interceptador de clique desistir, e o navegador recarregaria a página inteira —
// recarga silenciosa é pior que normalização.
assert.deepEqual(rotaDe('/painel/inicio'), { tela: 'painel', secao: 'inicio' });
assert.equal(caminhoDe(rotaDe('/painel/inicio')!), '/painel');

/* -------------------------------------------------------- caminhoDe ------ */

assert.equal(caminhoDe({ tela: 'entrar' }), '/entrar');
assert.equal(caminhoDe({ tela: 'painel', secao: 'inicio' }), '/painel');
assert.equal(caminhoDe({ tela: 'painel', secao: 'ocorrencias' }), '/painel/ocorrencias');

// Ida e volta: todo caminho gerado precisa ser reconhecido de volta.
for (const secao of ['inicio', 'divergencias', 'incompletos', 'conferencias', 'ocorrencias',
  'desempenho', 'indicadores', 'mapa', 'relatorios', 'pessoas', 'transportadoras',
  'rotas', 'sincronizacao'] as const) {
  const r = { tela: 'painel', secao } as const;
  assert.deepEqual(rotaDe(caminhoDe(r)), r, `ida e volta falhou em ${secao}`);
}

/* --------------------------------------------------- destinoDeEntrada ---- */

const s = (p: Partial<Parameters<typeof destinoDeEntrada>[0]>) =>
  ({ logado: true, gestor: false, sessaoAberta: false, ...p });

assert.deepEqual(destinoDeEntrada(s({ logado: false })), { tela: 'entrar' });
assert.deepEqual(destinoDeEntrada(s({})), { tela: 'bipagem' });
assert.deepEqual(destinoDeEntrada(s({ gestor: true })), { tela: 'painel', secao: 'inicio' });

// Conferência aberta ganha do papel: ninguém é tirado do meio de uma carga.
assert.deepEqual(destinoDeEntrada(s({ gestor: true, sessaoAberta: true })), { tela: 'bipagem' });

/* ------------------------------------------------------------ resolver --- */

// Deslogado só chega em /entrar, venha de onde vier.
assert.deepEqual(resolver('/painel/rotas', s({ logado: false })), { tela: 'entrar' });
assert.deepEqual(resolver('/entrar', s({ logado: false })), { tela: 'entrar' });

// Logado que pede /entrar vai trabalhar, não fica olhando o formulário.
assert.deepEqual(resolver('/entrar', s({ gestor: true })), { tela: 'painel', secao: 'inicio' });

// Quem não é gestor pedindo painel vai bipar. Nunca "acesso negado" sem porta.
assert.deepEqual(resolver('/painel/pessoas', s({})), { tela: 'bipagem' });
assert.deepEqual(resolver('/painel/pessoas', s({ gestor: true })), { tela: 'painel', secao: 'pessoas' });

// Rota desconhecida cai na regra de entrada, não em 404.
assert.deepEqual(resolver('/coisa-que-nao-existe', s({ gestor: true })), { tela: 'painel', secao: 'inicio' });

// Sessão aberta não sequestra a navegação depois de o app já estar aberto: ela
// decide a ENTRADA. Um gestor com carga aberta ainda consegue abrir o painel.
assert.deepEqual(
  resolver('/painel/conferencias', s({ gestor: true, sessaoAberta: true })),
  { tela: 'painel', secao: 'conferencias' }
);

console.log('ROUTER_OK');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --experimental-strip-types tests/router.test.ts
```

Esperado: `Cannot find module '../src/lib/router.ts'`.

- [ ] **Step 3: Escrever o roteador**

Criar `src/lib/router.ts`:

```ts
// router.ts — as rotas do app único.
//
// Duas metades, separadas de propósito: as funções de decisão são puras e não
// tocam em `window` (dá para testá-las em Node), e `criarRoteador` é a única
// coisa aqui que conhece History API.
//
// Rota desconhecida não vira 404. O app tem dono conhecido e sempre sabe para
// onde mandar a pessoa — a regra de entrada decide, como decidiria na abertura.

export const SECOES = [
  'inicio', 'divergencias', 'incompletos', 'conferencias', 'ocorrencias',
  'desempenho', 'indicadores', 'mapa', 'relatorios', 'pessoas',
  'transportadoras', 'rotas', 'sincronizacao'
] as const;

export type Secao = (typeof SECOES)[number];

export type Tela =
  | { tela: 'entrar' }
  | { tela: 'bipagem' }
  | { tela: 'relatorio' }
  | { tela: 'painel'; secao: Secao };

export interface Situacao {
  logado: boolean;
  gestor: boolean;
  /** Sessão de conferência ABERTA neste aparelho. */
  sessaoAberta: boolean;
}

const ehSecao = (v: string): v is Secao => (SECOES as readonly string[]).includes(v);

/** Normaliza barra dobrada e barra final: `/painel//rotas/` e `/painel/rotas` são a mesma rota. */
const limpar = (pathname: string): string => {
  const p = `/${pathname}`.replace(/\/+/g, '/').replace(/\/+$/, '');
  return p === '' ? '/' : p;
};

/** Devolve `null` para caminho que o app não conhece — quem decide é `resolver`. */
export function rotaDe(pathname: string): Rota | null {
  const p = limpar(pathname);
  if (p === '/entrar') return { tela: 'entrar' };
  if (p === '/bipagem') return { tela: 'bipagem' };
  if (p === '/relatorio') return { tela: 'relatorio' };
  if (p === '/painel') return { tela: 'painel', secao: 'inicio' };

  const m = /^\/painel\/([a-z]+)$/.exec(p);
  // `/painel/inicio` entra e sai canonizado como `/painel` por `caminhoDe`.
  // Recusá-lo faria o interceptador de clique desistir e o navegador recarregar
  // a página — e a URL já é canonizada de qualquer jeito, na abertura e em `ir`.
  if (m && ehSecao(m[1])) return { tela: 'painel', secao: m[1] };

  return null;
}

export function caminhoDe(t: Tela): string {
  if (r.tela === 'painel') return r.secao === 'inicio' ? '/painel' : `/painel/${r.secao}`;
  return `/${r.tela}`;
}

/**
 * Para onde a pessoa vai quando o app abre, nesta ordem.
 *
 * Conferência aberta ganha do papel: ninguém é tirado do meio de uma carga por
 * causa de como foi classificado no cadastro.
 */
export function destinoDeEntrada(s: Situacao): Rota {
  if (!s.logado) return { tela: 'entrar' };
  if (s.sessaoAberta) return { tela: 'bipagem' };
  if (s.gestor) return { tela: 'painel', secao: 'inicio' };
  return { tela: 'bipagem' };
}

/** A rota que o app deve mostrar para este caminho, considerando quem está logado. */
export function resolver(pathname: string, s: Situacao): Rota {
  const pedida = rotaDe(pathname);

  if (!s.logado) return { tela: 'entrar' };
  if (!pedida || pedida.tela === 'entrar') return destinoDeEntrada(s);
  // Erro não é beco sem saída: quem não tem painel tem bipagem.
  if (pedida.tela === 'painel' && !s.gestor) return { tela: 'bipagem' };

  return pedida;
}

export interface Roteador {
  /** Navega sem recarregar. `substituir` troca a entrada atual do histórico. */
  ir: (t: Tela, substituir?: boolean) => void;
  atual: () => Rota;
}

/**
 * Liga as funções acima ao navegador.
 *
 * `aoNavegar` é chamado uma vez na criação, com a rota inicial já resolvida —
 * o boot não precisa repetir a decisão.
 */
export function criarRoteador(
  situacao: () => Situacao,
  aoNavegar: (t: Tela) => void
): Roteador {
  const atual = (): Rota => resolver(location.pathname, situacao());

  const ir = (t: Tela, substituir = false): void => {
    const destino = resolver(caminhoDe(r), situacao());
    const url = caminhoDe(destino);
    if (url !== location.pathname) {
      if (substituir) history.replaceState(null, '', url);
      else history.pushState(null, '', url);
    }
    aoNavegar(destino);
  };

  window.addEventListener('popstate', () => aoNavegar(atual()));

  // Link interno navega sem recarga. Sem isto, todo <a href="/painel/rotas">
  // recarregaria o app inteiro — que é exatamente o que este plano existe para
  // acabar.
  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    const a = (ev.target as HTMLElement | null)?.closest?.('a');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    if (a.getAttribute('href')?.startsWith('#')) return;
    if (new URL(a.href, location.origin).origin !== location.origin) return;

    const r = rotaDe(new URL(a.href, location.origin).pathname);
    if (!r) return;
    ev.preventDefault();
    ir(r);
  });

  // Normaliza a URL de abertura: quem entrou por `/` sai com `/painel` na barra.
  const inicial = atual();
  history.replaceState(null, '', caminhoDe(inicial));
  aoNavegar(inicial);

  return { ir, atual };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
node --experimental-strip-types tests/router.test.ts && npm run typecheck
```

Esperado: `ROUTER_OK` e typecheck limpo.

- [ ] **Step 5: Registrar no `npm test`**

Em `package.json`, trocar a linha 10 por:

```json
    "test": "npm run typecheck && node --experimental-strip-types tests/model.test.ts && node --experimental-strip-types tests/router.test.ts && node tests/decode.test.mjs",
```

Rodar `npm test`. Esperado: `ROUTER_OK` no meio da saída, sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/lib/router.ts tests/router.test.ts package.json
git commit -m "o roteador do app único, com a decisão separada do navegador

Rota desconhecida não vira 404: cai na regra de entrada. O app tem dono
conhecido e sempre sabe para onde mandar a pessoa.

Conferência aberta ganha do papel na ENTRADA, não na navegação — o gestor com
carga aberta ainda consegue abrir o painel depois que o app já está de pé."
```

---

## Task 2: Desfazer as colisões de id antes de juntar

Os três documentos vão virar um. Hoje eles repetem ids, e `$()` devolve o primeiro que achar — juntar antes de resolver isto produz um bug silencioso, do tipo em que o botão "Baixar PDF" do relatório dispara o PDF do período.

Colisões verificadas: `form-login`, `in-login`, `in-senha`, `login-erro` (nos três); `btn-pdf` (index × diretor); `bloqueio`, `conteudo` (gestor × diretor). Em tempo de execução há mais duas, que só aparecem com o shell montado: `btn-sair` (index.html:65 × `painel-shell.ts:90`) e `p-usuario` (diretor.html × `painel-shell.ts:88`).

As de login, `bloqueio` e `conteudo` somem sozinhas na Task 3, porque passa a existir um login só. As outras três precisam de nome novo agora, com tudo ainda funcionando.

**Files:**
- Modify: `diretor.html:24`, `src/app/diretor.ts`
- Modify: `index.html:65`, `src/app/operador.ts:72`

- [ ] **Step 1: Renomear o PDF do período**

Em `diretor.html`, linha 24, trocar:

```html
    <button id="btn-pdf-periodo" class="btn btn-secundario">PDF do período</button>
```

Em `src/app/diretor.ts`, procurar `$('#btn-pdf')` e trocar por `$('#btn-pdf-periodo')`.

- [ ] **Step 2: Renomear o Sair da operação**

Em `index.html`, linha 65, trocar:

```html
        <button id="btn-sair-operacao" class="btn btn-fantasma">Sair</button>
```

Em `src/app/operador.ts`, linha 72, trocar:

```ts
  btnSair: $('#btn-sair-operacao'),
```

- [ ] **Step 3: Tirar o nome do usuário do markup do diretor**

Em `diretor.html`, apagar a linha `<span id="p-usuario" class="p-usuario"></span>` do `<header>`. Em `src/app/diretor.ts`, dentro de `abrir()`, apagar a linha `$('#p-usuario').textContent = nome;` e trocar a assinatura para `async function abrir(): Promise<void>`, ajustando as duas chamadas (`abrir(r.usuario.nome)` e `abrir(u.nome)`) para `abrir()`.

Isso deixa `noUnusedParameters` satisfeito e não perde informação: o nome do usuário passa a ser responsabilidade do shell, na Task 8.

- [ ] **Step 4: Verificar que nada quebrou**

```bash
npm run typecheck && npm run build && node tests/e2e.test.mjs && node tests/pdf.test.mjs
```

Esperado: os dois passam. `pdf.test.mjs` cobre justamente o botão renomeado.

- [ ] **Step 5: Commit**

```bash
git add index.html diretor.html src/app/operador.ts src/app/diretor.ts
git commit -m "ids únicos antes de os três documentos virarem um

form-login, in-login, in-senha, login-erro, btn-pdf, bloqueio e conteudo se
repetem entre as três páginas, e btn-sair e p-usuario colidem em tempo de
execução com os que o shell cria. Num documento só, \$() devolveria o primeiro
que achasse — 'Baixar PDF' do relatório dispararia o PDF do período.

As de login somem na próxima task, quando passa a existir um login só."
```

---

## Task 3: Um documento só

A task que carrega o risco da fatia inteira. Por isso ela **não muda um pixel**: se os testes de ponta a ponta passam aqui, a arquitetura está certa e todo o resto é aparência.

**Files:**
- Modify: `index.html`
- Create: `src/app/main.ts`
- Modify: `src/app/operador.ts`, `src/app/gestor.ts`, `src/app/diretor.ts`
- Modify: `vite.config.ts`
- Create: `vercel.json`
- Delete: `gestor.html`, `diretor.html`, `src/lib/painel-menu.ts`
- Modify: `tests/cadastro.mjs:91-125`, `tests/servidor.mjs:13`
- Modify: `tests/login-sandro.mjs`, `tests/painel-shell.test.mjs`, `tests/diretor.test.mjs`

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/cadastro.mjs`, trocar a assinatura e o `goto` de `prepararAparelho` (linha 91 e 95):

```js
export async function prepararAparelho(pagina, base, rota = '/entrar') {
  const contexto = pagina.context();
  await isolarDaProducao(contexto);

  await pagina.goto(`${base}${rota}`);
```

O resto da função fica igual.

Criar `tests/rotas.test.mjs`:

```js
// As rotas do app único, no navegador de verdade: F5 em rota profunda, link
// interno sem recarga, e os .html antigos ainda abrindo.
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

const aparelho = async (rota = '/entrar', viewport = { width: 1440, height: 900 }) => {
  const ctx = await navegador.newContext({ viewport, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, rota);
  return { ctx, p };
};

await passo('gestor entra e cai em /painel', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });
  await ctx.close();
});

await passo('conferente entra e cai em /bipagem', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'ana');
  await p.waitForURL(`${BASE}/bipagem`, { timeout: 8000 });
  await ctx.close();
});

await passo('F5 em rota profunda devolve a mesma rota', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });
  await p.goto(`${BASE}/painel/rotas`);
  await p.waitForSelector('[data-secao="rotas"]:not([hidden])', { timeout: 8000 });
  await p.reload();
  await p.waitForSelector('[data-secao="rotas"]:not([hidden])', { timeout: 8000 });
  if (p.url() !== `${BASE}/painel/rotas`) throw new Error(`URL virou ${p.url()}`);
  await ctx.close();
});

await passo('quem não é gestor pedindo /painel vai para /bipagem', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'ana');
  await p.waitForURL(`${BASE}/bipagem`, { timeout: 8000 });
  await p.goto(`${BASE}/painel/pessoas`);
  await p.waitForURL(`${BASE}/bipagem`, { timeout: 8000 });
  await ctx.close();
});

await passo('rota desconhecida cai na regra de entrada, sem 404', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });
  await p.goto(`${BASE}/isso-nao-existe`);
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });
  await ctx.close();
});

await passo('sair leva a /entrar e não deixa voltar pelo histórico', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });
  await p.click('#btn-sair');
  await p.waitForURL(`${BASE}/entrar`, { timeout: 8000 });
  await p.goBack();
  await p.waitForURL(`${BASE}/entrar`, { timeout: 8000 });
  await ctx.close();
});

await passo('o gestor abre a bipagem sem recarregar a página', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });

  // Marca o documento. Se a navegação recarregar, a marca some — e era isso que
  // obrigava a intenção a viajar em #bipar na URL.
  await p.evaluate(() => { window.__mesmoDocumento = true; });
  await p.click('#btn-bipar');
  await p.waitForURL(`${BASE}/bipagem`, { timeout: 8000 });
  const sobreviveu = await p.evaluate(() => window.__mesmoDocumento === true);
  if (!sobreviveu) throw new Error('a navegação recarregou o documento');
  await ctx.close();
});

await passo('trocar de seção não leva o filtro da anterior junto', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });

  // Filtro na URL de uma seção não pode grudar na próxima: o `de` de
  // Conferências não significa nada em Pessoas, e um valor herdado em silêncio
  // é pior que nenhum — a tabela filtra e não diz por quê.
  await p.goto(`${BASE}/painel/conferencias?de=2026-08-01`);
  await p.waitForSelector('[data-secao="conferencias"]:not([hidden])', { timeout: 8000 });
  await p.click('.p-item[href="/painel/pessoas"]');
  await p.waitForSelector('[data-secao="pessoas"]:not([hidden])', { timeout: 4000 });
  if (p.url() !== `${BASE}/painel/pessoas`) throw new Error(`o filtro veio junto: ${p.url()}`);
  await ctx.close();
});

await passo('F5 preserva o filtro da própria seção', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });

  // O outro lado da regra acima: a query daquela entrada do histórico sobrevive
  // à normalização de abertura. É o que faz um filtro colado de um e-mail valer.
  await p.goto(`${BASE}/painel/conferencias?de=2026-08-01`);
  await p.waitForSelector('[data-secao="conferencias"]:not([hidden])', { timeout: 8000 });
  await p.reload();
  await p.waitForSelector('[data-secao="conferencias"]:not([hidden])', { timeout: 8000 });
  if (!p.url().endsWith('?de=2026-08-01')) throw new Error(`o filtro sumiu no F5: ${p.url()}`);
  await ctx.close();
});

await passo('os .html antigos ainda abrem', async () => {
  const { ctx, p } = await aparelho();
  await entrar(p, 'sandro');
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });
  // `vite preview` não aplica o vercel.json; o app precisa reconhecer o caminho
  // antigo por conta própria, que é o que protege o atalho salvo na doca.
  await p.goto(`${BASE}/gestor.html`);
  await p.waitForURL(`${BASE}/painel`, { timeout: 8000 });
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nROTAS_OK');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/rotas.test.mjs
```

Esperado: todas as linhas `FALHA` — `/entrar` ainda não existe.

- [ ] **Step 3: Juntar os três documentos**

Em `index.html`, envolver as quatro `<section class="view">` existentes numa região e acrescentar as outras duas. A estrutura final do `<body>`:

```html
<body class="app">
  <div id="flash-overlay" aria-hidden="true"></div>

  <!-- LOGIN — um só no sistema inteiro -->
  <section id="view-login" class="view">
    <!-- exatamente o conteúdo de hoje (index.html:18-50), sem alteração -->
  </section>

  <!-- OPERAÇÃO -->
  <div id="tela-operacao" hidden>
    <!-- #view-grupo, #view-bipagem, #view-relatorio de hoje, sem alteração -->
  </div>

  <!-- PAINEL -->
  <div id="tela-painel" class="p-corpo" hidden>
    <!-- as 8 <section data-secao> de gestor.html, sem os ids de login -->
    <!-- mais 4 novas, vazias por enquanto:
         data-secao="divergencias", "incompletos", "mapa", "relatorios" -->
    <!-- e data-secao="indicadores" recebendo o conteúdo de diretor.html -->
  </div>

  <!-- MODAIS — continuam no fim do body -->
  ...
  <script type="module" src="/src/app/main.ts"></script>
</body>
```

Regras da mudança, todas obrigatórias:

1. **Nenhum `id` muda de nome** além dos três da Task 2. As funções de pintura continuam achando o que procuram.
2. `data-secao="hoje"` passa a ser `data-secao="inicio"`, para casar com `SECOES` do roteador.
3. O `<header class="p-topo">` de `diretor.html` **não** vem junto — quem desenha topo é o shell. O `<select id="f-mes">` e o `<button id="btn-pdf-periodo">` migram para dentro de `data-secao="indicadores"`.
4. Os blocos `#bloqueio` e `#conteudo` de `gestor.html` e `diretor.html` **somem**. Quem controla visibilidade agora é o roteador.
5. As quatro seções novas nascem com um `<p class="p-vazio">` provisório; elas ganham conteúdo nas Tasks 11 e 12.
6. `gestor.html` e `diretor.html` são apagados.

- [ ] **Step 4: Os três módulos param de rodar no import**

Em `src/app/operador.ts`:

- Envolver todo o código que hoje roda no topo do módulo (as chamadas `fb.definirOverlay`, os `addEventListener`, e a linha final `const bootPronto = boot()...`) numa função exportada:

```ts
import type { Ambiente } from './painel/index.js';

let montado = false;
let ambiente: Ambiente | null = null;

/** Chamado pelo roteador na primeira vez que a operação aparece. */
export async function montar(amb: Ambiente): Promise<void> {
  ambiente = amb;
  usuario = amb.usuario;
  if (montado) return;
  montado = true;
  el = lerEls();
  views = lerViews();
  fb.definirOverlay(el.flash);
  ligarEventos();          // tudo que era addEventListener de módulo
  await boot();
}
```

`Ambiente` (`{ usuario: Usuario; irPara: (t: Tela) => void }`) é definido no Step 6, em `src/app/painel/index.ts`. `ambiente` substitui `levarParaOPainel()`: onde o código chamava aquela função, passa a chamar `ambiente?.irPara({ tela: 'painel', secao: 'inicio' })`.

- O objeto `el` e `views` continuam no escopo do módulo, mas **a resolução deles precisa ser preguiçosa**: `$()` lança se o elemento não existe, e agora o módulo pode ser importado antes de a região estar no DOM. Trocar `const el = { ... }` por uma função:

```ts
type Els = ReturnType<typeof lerEls>;
function lerEls() { return { flash: $('#flash-overlay'), /* ...todos os de hoje... */ }; }
let el!: Els;
```

e, dentro de `montar()`, antes de tudo: `el = lerEls();`.

Fazer o mesmo com `views`.

- Apagar `levarParaOPainel()` (linhas 144-152), o bloco `pediuBipagem` do `boot()` (linhas 219-230) e o `for` dos botões de painel (linhas 264-267). O roteamento sai daqui.
- `boot()` para de decidir tela: ele só prepara sync, geo e cadastro. A decisão é do `main.ts`.
- O `submit` do login sai deste arquivo — vai para `main.ts`, porque o login agora é um só.

Em `src/app/gestor.ts` e `src/app/diretor.ts`, a mesma transformação: `export async function montar(): Promise<void>`, `el`/`elLogin` preguiçosos, e o `submit` do login apagado. `diretor.ts` passa a exportar `montar` e a pintar dentro de `#tela-painel [data-secao="indicadores"]`.

Apagar `src/lib/painel-menu.ts` e o import dele em `gestor.ts`, se houver.

- [ ] **Step 5: Escrever `src/app/main.ts`**

```ts
// main.ts — a entrada única do LOGDIS.
//
// Faz três coisas e só três: prepara o que toda tela precisa (cadastro local,
// sincronização, geolocalização), cuida do login — que agora é um só no sistema
// inteiro — e entrega a navegação ao roteador.
//
// As telas são importadas sob demanda: quem abre para bipar não paga o download
// do painel, e o painel não instancia a câmera.

import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/app.css';
import '../styles/painel.css';
import '../styles/relatorio.css';

import type { Usuario } from '../types.js';
import * as db from '../lib/db.js';
import * as auth from '../lib/auth.js';
import * as sync from '../lib/sync.js';
import * as fb from '../lib/feedback.js';
import { $ } from '../lib/util.js';
import {
  criarRoteador, destinoDeEntrada, type Roteador, type Tela, type Situacao
} from '../lib/router.js';

// Atalho antigo salvo na tela do celular da doca: o app reconhece o caminho por
// conta própria, sem depender do redirect do servidor. `vite preview` não aplica
// o vercel.json, e o aparelho da operação não vai ser reconfigurado.
const ANTIGOS: Record<string, string> = {
  '/gestor.html': '/painel',
  '/diretor.html': '/painel/indicadores',
  '/index.html': '/'
};
const antigo = ANTIGOS[location.pathname];
if (antigo) history.replaceState(null, '', antigo);

let usuario: Usuario | null = null;
let sessaoAberta = false;
let roteador: Roteador | null = null;

const regiao = {
  login: $('#view-login'),
  operacao: $('#tela-operacao'),
  painel: $('#tela-painel')
};

const elLogin = {
  form: $<HTMLFormElement>('#form-login'),
  login: $<HTMLInputElement>('#in-login'),
  senha: $<HTMLInputElement>('#in-senha'),
  erro: $('#login-erro'),
  dica: $('#dica-seed')
};

const situacao = (): Situacao => ({
  logado: !!usuario,
  gestor: !!usuario?.gestor,
  sessaoAberta
});

/** Uma conferência ABERTA deste usuário neste aparelho? */
async function conferirSessaoAberta(): Promise<void> {
  sessaoAberta = usuario
    ? (await db.porIndice('sessoes', 'usuarioId', usuario.id)).some((s) => s.status === 'ABERTA')
    : false;
}

async function mostrar(t: Tela): Promise<void> {
  regiao.login.hidden = r.tela !== 'entrar';
  regiao.operacao.hidden = !(r.tela === 'bipagem' || r.tela === 'relatorio');
  regiao.painel.hidden = r.tela !== 'painel';
  document.body.classList.toggle('painel', r.tela === 'painel');
  document.body.classList.toggle('operacao', r.tela !== 'painel');

  if (r.tela === 'entrar') {
    elLogin.login.focus();
    return;
  }
  if (r.tela === 'painel') {
    const painel = await import('./painel/index.js');
    await painel.montar(r.secao, { usuario: usuario as Usuario, irPara: (x) => roteador?.ir(x) });
    return;
  }
  const operacao = await import('./operador.js');
  await operacao.montar({ usuario: usuario as Usuario, irPara: (x) => roteador?.ir(x) });
}

elLogin.form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  fb.prepararAudio(); // gesto do usuário: é aqui que o som fica liberado
  elLogin.erro.hidden = true;
  await pronto;

  const r = await auth.entrar(elLogin.login.value, elLogin.senha.value);
  if (!r.ok) {
    elLogin.erro.textContent = r.erro;
    elLogin.erro.hidden = false;
    return;
  }
  usuario = r.usuario;
  elLogin.senha.value = '';
  await conferirSessaoAberta();
  // `true` substitui a entrada do histórico: voltar depois de entrar não pode
  // devolver o formulário de login de um usuário que já está dentro.
  roteador?.ir(destinoDeEntrada(situacao()), true);
});

async function boot(): Promise<void> {
  // Aparelho novo não tem cadastro: ele desce da base. Enquanto não descer, a
  // tela diz o que fazer em vez de ficar recusando a senha certa.
  if (!(await sync.garantirCadastroLocal())) {
    elLogin.dica.hidden = false;
    elLogin.dica.textContent =
      'Este aparelho ainda não recebeu o cadastro. Conecte-se à internet uma vez para baixá-lo.';
  }

  sync.iniciarAuto();
  usuario = await auth.usuarioLogado();
  await conferirSessaoAberta();

  roteador = criarRoteador(situacao, (r) => void mostrar(r));
}

const pronto = boot().catch((e: unknown) => {
  console.error('boot', e);
});
```

O bloco `ANTIGOS` roda no topo do módulo, antes de `boot()`, de propósito: ele precisa consertar `location.pathname` antes de `criarRoteador` ler a URL.

`Tela` fica importado como tipo e usado em `mostrar(t: Tela)`; `Roteador` em `let roteador`. Se o typecheck acusar import não usado, é sinal de que algum trecho acima foi omitido.

- [ ] **Step 6: `src/app/painel/index.ts` provisório**

Criar `src/app/painel/index.ts`, que por enquanto só delega para os dois módulos antigos:

```ts
// index.ts — a porta do painel. Nesta task ele só junta o que já existia; as
// seções viram módulos próprios nas Tasks 10 a 13.

import type { Usuario } from '../../types.js';
import type { Tela } from '../../lib/router.js';

export interface Ambiente {
  usuario: Usuario;
  irPara: (t: Tela) => void;
}

let montado = false;

export async function montar(secao: string, amb: Ambiente): Promise<void> {
  const gestor = await import('../gestor.js');
  if (!montado) {
    montado = true;
    await gestor.montar(amb);
    const indicadores = await import('../diretor.js');
    await indicadores.montar();
  }
  gestor.mostrarSecao(secao);
}
```

Em `src/app/gestor.ts`, exportar `mostrarSecao(id: string)`, que faz o que `mostrar()` de `painel-shell.ts` fazia: percorre `[data-secao]` e esconde todas menos a pedida, marca o item ativo e chama os ouvintes.

- [ ] **Step 7: Vite e Vercel**

Em `vite.config.ts`:

```ts
  base: '/',

  build: {
    target: 'es2022'
  },
```

(apagar `rollupOptions` inteiro — entrada única é o `index.html` da raiz)

e, no bloco `workbox`, apagar a linha `navigateFallbackDenylist: [/gestor\.html/, /diretor\.html/],`.

Criar `vercel.json`:

```json
{
  "redirects": [
    { "source": "/gestor.html", "destination": "/painel", "permanent": true },
    { "source": "/diretor.html", "destination": "/painel/indicadores", "permanent": true },
    { "source": "/index.html", "destination": "/", "permanent": true }
  ],
  "rewrites": [
    { "source": "/((?!assets/|.*\\.[a-z0-9]+$).*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 8: Atualizar os testes que apontam para `.html`**

Em `tests/servidor.mjs`, linha 13, trocar `fetch(\`${BASE}/index.html\`)` por `fetch(\`${BASE}/\`)`.

Em `tests/login-sandro.mjs`, `tests/painel-shell.test.mjs` e `tests/diretor.test.mjs`, trocar toda chamada `prepararAparelho(p, BASE, 'gestor.html')` por `prepararAparelho(p, BASE, '/entrar')`, e todo `waitForURL(/gestor\.html/)` por `waitForURL(\`${BASE}/painel\`)`. Em `tests/diretor.test.mjs`, `'diretor.html'` vira `'/entrar'` e a navegação para o painel do diretor passa a ser `p.goto(\`${BASE}/painel/indicadores\`)`.

- [ ] **Step 9: Rodar tudo**

```bash
npm run typecheck && npm run build && \
node tests/rotas.test.mjs && node tests/e2e.test.mjs && node tests/e2e-offline.test.mjs && \
node tests/sync-fila.test.mjs && node tests/pdf.test.mjs && node tests/login-sandro.mjs
```

Esperado: `ROTAS_OK` e todos os demais verdes, **sem nenhuma mudança no comportamento esperado** — só as URLs mudaram. Se algum e2e precisou de mais que troca de URL, a Task 3 mexeu em algo que não devia.

- [ ] **Step 10: Registrar o e2e novo**

Em `package.json`, na linha 11, acrescentar `node tests/rotas.test.mjs && ` logo depois de `vite build && `.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "três documentos viram um, e a URL perde o .html

A recarga entre páginas era a causa de duas coisas: a marca #bipar, que existia
só porque o clique não sobrevive à troca de documento, e o logout que dependia
do boot da outra página decidir certo.

Nada muda de aparência nesta task, de propósito. Os seis e2e passam com mudança
apenas de URL — é esse o contrato de que a arquitetura nova não quebrou nada.

O app reconhece /gestor.html e /diretor.html por conta própria, sem depender do
vercel.json: o atalho salvo na tela do celular da doca continua abrindo."
```

---

## Task 4: Tokens e as duas escalas tipográficas

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/styles/base.css:15-45`

- [ ] **Step 1: Criar `src/styles/tokens.css`**

```css
/* tokens.css — a fonte da verdade de cor, espaço e tipografia.
 *
 * Duas escalas, não uma. "Reduzir tamanhos no mobile" vale para o painel, onde
 * o gestor senta com teclado e tempo. Não vale para a bipagem: ali o texto
 * precisa ser lido a um braço de distância, com luva, sob luz de galpão — e
 * correção da conferência vem antes de densidade de tela.
 *
 * Quem troca a escala é a classe do <body>, posta pelo roteador.
 */

:root {
  /* ------------------------------------------------------- papéis de cor --- */
  /* Verde é marca, ação principal, item ativo e sucesso. Nada mais.
     Superfície nunca é verde: cabeçalho verde alto foi o que deixou a tela
     pesada e roubou o destaque de quem precisava dele. */
  --marca: #105945;
  --marca-forte: #109976;
  --marca-clara: #2eb58d;
  --marca-superficie: #e8f6f2;

  --alarme: #dc2626;        /* divergência, erro */
  --alarme-superficie: #fdf2f2;
  --atencao: #d97706;       /* pendência, duplicado */
  --atencao-superficie: #fef6e7;
  --bom: #16a34a;

  --fundo: #f4f7f6;
  --superficie: #ffffff;
  --linha: #dce4e1;         /* régua que separa seção — o lugar da borda agora */
  --linha-fraca: #eef2f0;
  --tinta: #16211d;
  --tinta-2: #66706d;
  --tinta-3: #97a09d;

  --raio: 10px;
  --gap: 16px;
}

/* --------------------------------------------------------- escala painel --- */
body.painel {
  --t-pagina: 20px;
  --t-secao: 11px;
  --t-indicador: 26px;
  --t-corpo: 14px;
  --t-secundario: 12.5px;
  --t-label: 11px;
  --toque: 40px;
}

@media (max-width: 1023px) {
  body.painel {
    --t-pagina: 18px;
    --t-indicador: 22px;
    --t-corpo: 15px;
  }
}

/* ------------------------------------------------------ escala operação --- */
/* Legível a um braço de distância, com luva, sob luz de galpão. */
body.operacao {
  --t-pagina: 22px;
  --t-secao: 15px;
  --t-indicador: 34px;
  --t-corpo: 17px;
  --t-secundario: 15px;
  --t-label: 14px;
  --toque: 56px;
}

/* Campo de formulário nunca abaixo de 16px: o iOS dá zoom ao focar, e o zoom
   desalinha a tela inteira no meio de uma conferência. */
input, select, textarea { font-size: max(16px, var(--t-corpo)); }

/* Título de seção: caixa alta pequena sobre régua. É o "linhas, não caixas" —
   o bloco se separa por espaço e traço, não por moldura. */
.ui-secao > h3 {
  margin: 0 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--linha);
  font-size: var(--t-secao);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--tinta-2);
  display: flex;
  align-items: center;
  gap: 10px;
}
.ui-secao { margin-bottom: 22px; }
.ui-secao > h3 .ui-meta {
  margin-left: auto;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--tinta-3);
}

/* No celular, onde os blocos empilham e ficam colados, a separação vem de
   espaço e régua de largura total — nunca de virar cartão. Um padrão só. */
@media (max-width: 1023px) {
  .ui-secao { margin-bottom: 30px; }
}
```

- [ ] **Step 2: Ligar os tokens novos aos antigos**

Em `src/styles/base.css`, dentro de `:root` (linhas 15-45), **manter** os nomes antigos e apontá-los para os novos, para nenhum estilo existente quebrar:

```css
  --logdis-forest: var(--marca);
  --logdis-green: var(--marca-forte);
  --logdis-mint: var(--marca-clara);
  --logdis-mint-surface: var(--marca-superficie);
  --div: var(--alarme);
  --dup: var(--atencao);
  --ok: var(--bom);
  --fundo-2: var(--superficie);
  --fundo-3: var(--linha-fraca);
  --borda: var(--linha);
  --texto: var(--tinta);
  --texto-2: var(--tinta-2);
  --acento: var(--marca-forte);
```

Apagar as declarações literais dessas variáveis; manter `--mapa`, `--inv`, `--oc`, `--oc-grave` como estão.

Acrescentar `@import './tokens.css';` como **primeira** linha de `base.css`, antes do `@import './fonte.css';`.

- [ ] **Step 3: Verificar**

```bash
npm run build && node tests/e2e.test.mjs
```

Esperado: verde. A aparência muda pouco aqui — os tokens só passam a existir; quem os usa são as tasks seguintes.

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css src/styles/base.css
git commit -m "tokens com dois nomes por papel, e duas escalas tipográficas

A escala do painel encolhe no celular; a da operação não. Ali o texto precisa
ser lido a um braço de distância, com luva, sob luz de galpão — correção da
conferência vem antes de densidade de tela.

Os nomes antigos viram apelidos dos novos: nenhum estilo existente quebra."
```

---

## Task 5: `src/lib/ui/` — os componentes de conteúdo

**Files:**
- Create: `src/lib/ui/basico.ts`, `src/lib/ui/index.ts`
- Test: `tests/ui.test.ts` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/ui.test.ts`:

```ts
import assert from 'node:assert/strict';
import { plural, vazio, badge, alerta, kpis, secao, pageHeader, status } from '../src/lib/ui/basico.ts';

/* ----------------------------------------------------------- plural ------ */
// "1 volume(s)" é texto de sistema. A tela é de produto.
assert.equal(plural(1, 'volume', 'volumes'), '1 volume');
assert.equal(plural(0, 'volume', 'volumes'), 'nenhum volume');
assert.equal(plural(3, 'volume', 'volumes'), '3 volumes');
assert.equal(plural(2, 'pedido incompleto', 'pedidos incompletos'), '2 pedidos incompletos');

/* ------------------------------------------------------------ vazio ------ */
// Estado vazio é uma linha, nunca um cartão com título.
const v = vazio('Nenhuma conferência aberta.');
assert.ok(v.includes('Nenhuma conferência aberta.'));
assert.ok(!/<h[1-6]/.test(v), 'estado vazio não tem título próprio');
assert.ok(v.includes('ui-vazio'));

// Com ação, o vazio vira saída: erro nunca é beco sem saída.
const v2 = vazio('Cobertura indisponível.', { rotulo: 'Configurar', href: '/painel/sincronizacao' });
assert.ok(v2.includes('Configurar') && v2.includes('/painel/sincronizacao'));

/* ------------------------------------------------------------ badge ------ */
assert.equal(badge(0, 'alarme'), '', 'badge zerado não desenha nada');
assert.ok(badge(3, 'alarme').includes('3'));

/* ----------------------------------------------------------- status ------ */
// Cor nunca sozinha: verde e vermelho são o pior par para daltonismo, e o
// gestor lê isto numa tabela densa. Texto sempre; forma além da cor.
const st = status('ROTA_DIVERGENTE');
assert.ok(st.includes('Divergente'), 'status carrega o texto');
assert.ok(st.includes('#dc2626'), 'status carrega a cor de STATUS_INFO');
assert.ok(/aria-label="[^"]+"/.test(st), 'status tem rótulo acessível');
// A forma vem do mesmo dicionário do mapa: triângulo é divergência nos dois.
assert.notEqual(status('OK'), status('ROTA_DIVERGENTE'));
assert.ok(!status('OK').includes('Divergente'));

/* ----------------------------------------------------------- alerta ------ */
const a = alerta({ tom: 'alarme', titulo: '1 volume de outra transportadora',
                   texto: 'Não pode embarcar.', acao: { rotulo: 'Ver volume', href: '/painel/divergencias' } });
assert.ok(a.includes('ui-alerta') && a.includes('alarme'));
assert.ok(a.includes('1 volume de outra transportadora'));
assert.ok(a.includes('/painel/divergencias'));

/* -------------------------------------------------------------- kpis ----- */
const k = kpis([
  { rotulo: 'Volumes', valor: 4315 },
  { rotulo: 'Divergências', valor: 3, tom: 'alarme' }
]);
assert.ok(k.includes('4.315') || k.includes('4315'));
assert.ok(k.includes('Divergências'));

/* ------------------------------------------------------- escape --------- */
// Tudo aqui recebe texto de cadastro, e cadastro tem aspas e sinal de maior.
assert.ok(!vazio('<b>x</b>').includes('<b>x</b>'));
assert.ok(!kpis([{ rotulo: '<b>x</b>', valor: 1 }]).includes('<b>x</b>'));
assert.ok(!secao({ titulo: '<b>x</b>', corpo: '<p>ok</p>' }).includes('<b>x</b>'));
// O corpo é HTML montado por nós, e não pode ser escapado — senão a tabela some.
assert.ok(secao({ titulo: 'T', corpo: '<p>ok</p>' }).includes('<p>ok</p>'));

/* -------------------------------------------------------- pageHeader ----- */
const ph = pageHeader({ titulo: 'Início', sub: 'sábado, 8 de agosto' });
assert.ok(ph.includes('Início') && ph.includes('sábado'));

console.log('UI_OK');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --experimental-strip-types tests/ui.test.ts
```

Esperado: `Cannot find module '../src/lib/ui/basico.ts'`.

- [ ] **Step 3: Implementar**

Criar `src/lib/ui/basico.ts`:

```ts
// basico.ts — os componentes de conteúdo do LOGDIS.
//
// Funções puras: entra dado tipado, sai HTML. Sem DOM, sem estado, sem efeito —
// por isso testam em Node, sem navegador.
//
// Toda função escapa o que vem do cadastro. A única exceção é `corpo`, que é
// HTML montado por nós: escapá-lo apagaria a tabela que ele carrega.

import type { StatusLeitura } from '../../types.js';
import { STATUS_INFO } from '../model.js';
import { esc } from '../util.js';

export type Tom = 'marca' | 'alarme' | 'atencao' | 'neutro';

const fmtN = new Intl.NumberFormat('pt-BR');

/**
 * "1 volume(s)" é texto de sistema. Zero vira "nenhum", que é como a pessoa fala.
 */
export function plural(n: number, um: string, muitos: string): string {
  if (n === 0) return `nenhum ${um}`;
  return `${fmtN.format(n)} ${n === 1 ? um : muitos}`;
}

export interface Acao {
  rotulo: string;
  href: string;
}

const linkAcao = (a: Acao): string =>
  `<a class="ui-acao" href="${esc(a.href)}">${esc(a.rotulo)} ›</a>`;

/**
 * Estado vazio: uma linha no lugar onde o conteúdo estaria.
 *
 * Nunca um cartão com título próprio. Um cartão inteiro para dizer que não há
 * nada ocupa a tela com a ausência de informação.
 */
export function vazio(texto: string, acao?: Acao): string {
  return `<p class="ui-vazio">${esc(texto)}${acao ? ` ${linkAcao(acao)}` : ''}</p>`;
}

/** Badge de contagem. Zero não desenha: alarme que aparece sempre deixa de ser alarme. */
export function badge(n: number, tom: Tom = 'alarme'): string {
  if (n <= 0) return '';
  return `<span class="ui-badge ui-${esc(tom)}">${fmtN.format(n)}</span>`;
}

export interface OpcoesAlerta {
  tom: Tom;
  titulo: string;
  texto?: string;
  acao?: Acao;
}

/**
 * Faixa lateral, nunca moldura de quatro lados, e uma por tela.
 *
 * Três blocos vermelhos seguidos dizendo quase a mesma coisa foi o que diluiu o
 * alarme na versão anterior: quem aprende a passar por um aviso redundante passa
 * também pelo aviso que era a única notícia do problema.
 */
export function alerta(op: OpcoesAlerta): string {
  return `<div class="ui-alerta ui-${esc(op.tom)}">
    <div>
      <b>${esc(op.titulo)}</b>
      ${op.texto ? `<p>${esc(op.texto)}</p>` : ''}
    </div>
    ${op.acao ? linkAcao(op.acao) : ''}
  </div>`;
}

export interface Kpi {
  rotulo: string;
  valor: number | string;
  tom?: Tom;
}

/** Régua de indicadores. Duas colunas no celular só porque são números curtos. */
export function kpis(itens: Kpi[]): string {
  const celulas = itens.map((k) => `
    <div class="ui-kpi">
      <small>${esc(k.rotulo)}</small>
      <b class="ui-${esc(k.tom ?? 'neutro')}">${typeof k.valor === 'number' ? fmtN.format(k.valor) : esc(k.valor)}</b>
    </div>`).join('');
  return `<div class="ui-kpis">${celulas}</div>`;
}

export interface OpcoesSecao {
  titulo: string;
  /** Texto pequeno à direita do título: contagem, período, origem do dado. */
  meta?: string;
  /** HTML já montado. Não é escapado — ver o comentário do topo. */
  corpo: string;
}

export function secao(op: OpcoesSecao): string {
  return `<section class="ui-secao">
    <h3>${esc(op.titulo)}${op.meta ? `<span class="ui-meta">${esc(op.meta)}</span>` : ''}</h3>
    ${op.corpo}
  </section>`;
}

/**
 * Forma por status, além da cor.
 *
 * Verde e vermelho são o par mais difícil para daltonismo, e o gestor lê isto
 * numa tabela densa. As formas são as mesmas de `src/lib/mapa.ts` de propósito:
 * o ponto do mapa e a etiqueta da tabela precisam ser reconhecíveis um pelo
 * outro.
 */
const FORMA: Record<StatusLeitura, string> = {
  OK: '●',
  ROTA_DIVERGENTE: '▲',
  DESTINO_NAO_MAPEADO: '▼',
  DUPLICADO: '■',
  INVALIDO: '◆'
};

/** Etiqueta de status: cor, forma e texto — nunca cor sozinha. */
export function status(s: StatusLeitura): string {
  const info = STATUS_INFO[s];
  return `<span class="ui-status ${esc(info.classe)}" aria-label="${esc(info.rotulo)}">
    <i aria-hidden="true" style="color:${esc(info.cor)}">${FORMA[s]}</i>${esc(info.curto)}
  </span>`;
}

export interface OpcoesPageHeader {
  titulo: string;
  sub?: string;
  /** HTML de botões, à direita. */
  acoes?: string;
}

export function pageHeader(op: OpcoesPageHeader): string {
  return `<header class="ui-page-header">
    <h2>${esc(op.titulo)}</h2>
    ${op.sub ? `<span>${esc(op.sub)}</span>` : ''}
    ${op.acoes ? `<div class="ui-page-acoes">${op.acoes}</div>` : ''}
  </header>`;
}
```

Criar `src/lib/ui/index.ts`:

```ts
export * from './basico.js';
```

- [ ] **Step 4: Estilo dos componentes**

Acrescentar ao fim de `src/styles/tokens.css`:

```css
/* ------------------------------------------------------- componentes UI --- */
.ui-page-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
.ui-page-header h2 { margin: 0; font-size: var(--t-pagina); color: var(--tinta); letter-spacing: -.01em; }
.ui-page-header > span { font-size: var(--t-secundario); color: var(--tinta-2); }
.ui-page-acoes { margin-left: auto; display: flex; gap: 8px; }

.ui-vazio { margin: 4px 0; font-size: var(--t-corpo); color: var(--tinta-3); }
.ui-acao { font-size: var(--t-secundario); font-weight: 700; white-space: nowrap; }

.ui-badge {
  min-width: 20px; padding: 1px 6px; border-radius: 999px;
  font-size: 11px; font-weight: 800; color: #fff; text-align: center;
  font-variant-numeric: tabular-nums; background: var(--alarme);
}
.ui-badge.ui-atencao { background: var(--atencao); }
.ui-badge.ui-marca { background: var(--marca-forte); }

/* Faixa lateral, não moldura. Uma por tela. */
.ui-alerta {
  display: flex; gap: 12px; align-items: flex-start;
  border-left: 4px solid var(--alarme); background: var(--alarme-superficie);
  border-radius: 0 var(--raio) var(--raio) 0; padding: 10px 14px; margin-bottom: 16px;
}
.ui-alerta.ui-atencao { border-left-color: var(--atencao); background: var(--atencao-superficie); }
.ui-alerta b { display: block; font-size: var(--t-corpo); color: var(--tinta); }
.ui-alerta p { margin: 2px 0 0; font-size: var(--t-secundario); color: var(--tinta-2); }
.ui-alerta .ui-acao { margin-left: auto; align-self: center; }

.ui-kpis { display: flex; flex-wrap: wrap; gap: 28px; padding: 2px 0 6px; }
.ui-kpi small { display: block; font-size: var(--t-label); color: var(--tinta-2); }
.ui-kpi b {
  font-size: var(--t-indicador); color: var(--tinta);
  letter-spacing: -.02em; font-variant-numeric: tabular-nums;
}
.ui-kpi b.ui-alarme { color: var(--alarme); }
.ui-kpi b.ui-atencao { color: var(--atencao); }

/* Status: forma + texto. A cor acompanha, nunca carrega sozinha. */
.ui-status {
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  font-size: var(--t-label); font-weight: 600; color: var(--tinta);
}
.ui-status i { font-size: 9px; line-height: 1; font-style: normal; }

/* Duas colunas no celular só para número curto. Texto explicativo ocupa a
   largura toda — dois cartões estreitos com frase dentro viram ilegíveis. */
@media (max-width: 560px) {
  .ui-kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
node --experimental-strip-types tests/ui.test.ts && npm run typecheck
```

Esperado: `UI_OK`.

- [ ] **Step 6: Registrar no `npm test` e commitar**

Em `package.json`, acrescentar `node --experimental-strip-types tests/ui.test.ts && ` ao script `test`, antes de `node tests/decode.test.mjs`.

```bash
npm test
git add src/lib/ui tests/ui.test.ts src/styles/tokens.css package.json
git commit -m "os componentes de conteúdo, como função pura

Entra dado tipado, sai HTML — testam em Node, sem navegador. Escape embutido em
todas: o que elas recebem vem do cadastro, e cadastro tem aspas.

plural() acaba com '1 volume(s)'. vazio() é uma linha, nunca um cartão com
título. alerta() é faixa lateral, nunca moldura, e uma por tela."
```

---

## Task 6: `tabela()` — a mesma chamada nos dois tamanhos

A divergência entre desktop e celular nasce porque cada função monta o seu `innerHTML` do zero. Uma função só, que decide a forma, é o que impede isso de voltar.

**Files:**
- Create: `src/lib/ui/tabela.ts`
- Modify: `src/lib/ui/index.ts`, `tests/ui.test.ts`, `src/styles/tokens.css`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao fim de `tests/ui.test.ts`, antes da linha `console.log('UI_OK')`:

```ts
import { tabela } from '../src/lib/ui/tabela.ts';

const t = tabela({
  colunas: [
    { chave: 'codigo', rotulo: 'Código' },
    { chave: 'rota', rotulo: 'Rota lida' },
    { chave: 'hora', rotulo: 'Hora', alinhar: 'direita' }
  ],
  linhas: [
    { codigo: 'EMB0008399999', rota: 'FSUL 200', hora: '19:05' }
  ],
  vazio: 'Nenhum volume divergente hoje.'
});
assert.ok(t.includes('<table'));
assert.ok(t.includes('EMB0008399999'));
// O rótulo viaja em cada célula: é ele que vira o rótulo da linha empilhada no
// celular, sem o CSS precisar de um segundo HTML.
assert.ok(t.includes('data-rotulo="Rota lida"'));
assert.ok(t.includes('ui-dir'), 'coluna à direita marca a célula');

// Tabela sem linha não desenha cabeçalho de coluna nenhuma: cabeçalho vazio é
// promessa de dado que não veio.
const tv = tabela({ colunas: [{ chave: 'a', rotulo: 'A' }], linhas: [], vazio: 'Nada aqui.' });
assert.ok(!tv.includes('<table'));
assert.ok(tv.includes('Nada aqui.'));

// Escape na célula e no rótulo.
const te = tabela({
  colunas: [{ chave: 'a', rotulo: '<b>R</b>' }],
  linhas: [{ a: '<b>x</b>' }],
  vazio: '—'
});
assert.ok(!te.includes('<b>x</b>') && !te.includes('<b>R</b>'));

// Célula pode ser HTML nosso quando marcada — é como o status entra com cor,
// texto e forma sem a tabela conhecer status.
const th = tabela({
  colunas: [{ chave: 'a', rotulo: 'A', html: true }],
  linhas: [{ a: '<span class="st">ok</span>' }],
  vazio: '—'
});
assert.ok(th.includes('<span class="st">ok</span>'));
```

Mover esse `import` para junto dos outros, no topo do arquivo.

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --experimental-strip-types tests/ui.test.ts
```

Esperado: `does not provide an export named 'tabela'` ou módulo não encontrado.

- [ ] **Step 3: Implementar**

Criar `src/lib/ui/tabela.ts`:

```ts
// tabela.ts — uma chamada, duas formas.
//
// Tabela densa no desktop; abaixo de 1024px cada linha vira um bloco empilhado,
// com o rótulo da coluna ao lado do valor. O rótulo viaja em `data-rotulo` na
// própria célula, e é o CSS que decide mostrá-lo — sem isso seriam dois HTML
// para o mesmo dado, e é dessa duplicação que nasce a divergência entre as duas
// telas.

import { esc } from '../util.js';

export interface Coluna {
  chave: string;
  rotulo: string;
  alinhar?: 'direita';
  /** A célula já vem como HTML nosso (status com cor e forma, link, badge). */
  html?: boolean;
}

export type Linha = Record<string, string | number | null | undefined>;

export interface OpcoesTabela {
  colunas: Coluna[];
  linhas: Linha[];
  /** Texto do estado vazio. Sem linhas, a tabela inteira é substituída por ele. */
  vazio: string;
}

export function tabela(op: OpcoesTabela): string {
  // Cabeçalho sem linha nenhuma é promessa de dado que não veio.
  if (!op.linhas.length) return `<p class="ui-vazio">${esc(op.vazio)}</p>`;

  const cab = op.colunas.map((c) =>
    `<th${c.alinhar === 'direita' ? ' class="ui-dir"' : ''}>${esc(c.rotulo)}</th>`
  ).join('');

  const corpo = op.linhas.map((l) => {
    const celulas = op.colunas.map((c) => {
      const bruto = l[c.chave];
      const valor = bruto === null || bruto === undefined ? '—' : String(bruto);
      const classe = c.alinhar === 'direita' ? ' ui-dir' : '';
      return `<td class="ui-td${classe}" data-rotulo="${esc(c.rotulo)}">${c.html ? valor : esc(valor)}</td>`;
    }).join('');
    return `<tr>${celulas}</tr>`;
  }).join('');

  return `<div class="ui-tabela-rolagem">
    <table class="ui-tabela"><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
  </div>`;
}
```

Em `src/lib/ui/index.ts`, acrescentar `export * from './tabela.js';`.

- [ ] **Step 4: Estilo**

Acrescentar ao fim de `src/styles/tokens.css`:

```css
/* --------------------------------------------------------------- tabela --- */
.ui-tabela-rolagem { overflow-x: auto; }
.ui-tabela { width: 100%; border-collapse: collapse; font-size: var(--t-secundario); }
.ui-tabela th {
  text-align: left; padding: 6px 10px 6px 0;
  font-size: var(--t-label); letter-spacing: .06em; text-transform: uppercase;
  color: var(--tinta-3); font-weight: 600; border-bottom: 1px solid var(--linha);
  white-space: nowrap;
}
.ui-tabela td { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--linha-fraca); color: var(--tinta); }
.ui-tabela .ui-dir { text-align: right; font-variant-numeric: tabular-nums; }

/* Celular: cada linha vira um bloco, com o rótulo da coluna ao lado do valor.
   Tabela de operação não pode virar rolagem lateral — a divergência ficaria
   fora da tela, e o gestor confere isto de pé na doca. */
@media (max-width: 1023px) {
  .ui-tabela, .ui-tabela tbody, .ui-tabela tr, .ui-tabela td { display: block; width: 100%; }
  .ui-tabela thead { display: none; }
  .ui-tabela tr {
    border-bottom: 1px solid var(--linha);
    padding: 10px 0;
  }
  .ui-tabela td {
    display: flex; gap: 12px; align-items: baseline;
    padding: 3px 0; border: 0; font-size: var(--t-corpo);
  }
  .ui-tabela td::before {
    content: attr(data-rotulo);
    flex: none; min-width: 40%;
    font-size: var(--t-label); color: var(--tinta-2);
  }
  .ui-tabela .ui-dir { text-align: left; }
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
node --experimental-strip-types tests/ui.test.ts && npm run typecheck
```

Esperado: `UI_OK`.

- [ ] **Step 6: `filtros()` e os primitivos de formulário**

A barra de filtros mora acima de toda tabela e hoje é remontada à mão em cada seção — é assim que `#f-de` no gestor e `#f-mes` no diretor viraram dois desenhos diferentes do mesmo controle.

Criar `src/lib/ui/forma.ts`:

```ts
// forma.ts — botão, campo, seleção e a barra de filtros.
//
// Os estilos já existiam em base.css e cada tela montava o markup do seu jeito.
// Aqui o markup passa a ser um só; o CSS não muda de dono.

import { esc } from '../util.js';

export type TipoBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo';

export interface OpcoesBotao {
  rotulo: string;
  id?: string;
  tipo?: TipoBotao;
  /** Vira `type="submit"` quando verdadeiro. Padrão é `button`. */
  enviar?: boolean;
}

export function botao(op: OpcoesBotao): string {
  return `<button class="btn btn-${esc(op.tipo ?? 'secundario')}"
    ${op.id ? `id="${esc(op.id)}"` : ''}
    type="${op.enviar ? 'submit' : 'button'}">${esc(op.rotulo)}</button>`;
}

export interface OpcoesCampo {
  id: string;
  rotulo: string;
  tipo?: 'text' | 'date' | 'search' | 'password' | 'number';
  valor?: string;
  /** Some do rótulo visível, mas continua no leitor de tela. */
  rotuloOculto?: boolean;
  opcional?: boolean;
}

export function campo(op: OpcoesCampo): string {
  return `<div class="ui-campo">
    <label for="${esc(op.id)}"${op.rotuloOculto ? ' class="ui-so-leitor"' : ''}>
      ${esc(op.rotulo)}${op.opcional ? ' <em>opcional</em>' : ''}
    </label>
    <input id="${esc(op.id)}" type="${esc(op.tipo ?? 'text')}" value="${esc(op.valor ?? '')}" />
  </div>`;
}

export interface Opcao {
  valor: string;
  rotulo: string;
}

export interface OpcoesSelecao {
  id: string;
  rotulo: string;
  opcoes: Opcao[];
  valor?: string;
  rotuloOculto?: boolean;
}

export function selecao(op: OpcoesSelecao): string {
  const itens = op.opcoes.map((o) =>
    `<option value="${esc(o.valor)}"${o.valor === op.valor ? ' selected' : ''}>${esc(o.rotulo)}</option>`
  ).join('');
  return `<div class="ui-campo">
    <label for="${esc(op.id)}"${op.rotuloOculto ? ' class="ui-so-leitor"' : ''}>${esc(op.rotulo)}</label>
    <select id="${esc(op.id)}">${itens}</select>
  </div>`;
}

/**
 * Barra de filtros: visível no desktop, dobrada numa folha no celular.
 *
 * Filtro escondido atrás de um botão faz o gestor esquecer que ele está ligado —
 * e tabela filtrada sem aviso é tabela que mente. Por isso o resumo do que está
 * aplicado acompanha o botão no celular.
 */
export function filtros(campos: string[], resumo?: string): string {
  return `<div class="ui-filtros">
    <div class="ui-filtros-campos">${campos.join('')}</div>
    ${resumo ? `<button class="ui-filtros-abrir" type="button">Filtros · ${esc(resumo)}</button>` : ''}
  </div>`;
}
```

Acrescentar a `tests/ui.test.ts` (import no topo):

```ts
import { botao, campo, selecao, filtros } from '../src/lib/ui/forma.ts';

assert.ok(botao({ rotulo: 'Liberar carga', tipo: 'primario' }).includes('btn-primario'));
assert.ok(botao({ rotulo: 'x' }).includes('type="button"'), 'botão não vira submit por acidente');
assert.ok(botao({ rotulo: 'x', enviar: true }).includes('type="submit"'));

// Campo sempre tem label ligado por for/id: sem isso o leitor de tela anuncia
// "caixa de edição" e nada mais.
const c = campo({ id: 'f-de', rotulo: 'De' });
assert.ok(c.includes('for="f-de"') && c.includes('id="f-de"'));

const s2 = selecao({ id: 'f-mes', rotulo: 'Mês', opcoes: [{ valor: '2026-08', rotulo: 'Agosto' }], valor: '2026-08' });
assert.ok(s2.includes('selected'));

assert.ok(filtros([c], '30 dias').includes('30 dias'));

// Escape em tudo que vem do cadastro.
assert.ok(!botao({ rotulo: '<b>x</b>' }).includes('<b>x</b>'));
assert.ok(!selecao({ id: 'a', rotulo: 'A', opcoes: [{ valor: '<b>', rotulo: '<b>x</b>' }] }).includes('<b>x</b>'));
```

Acrescentar `export * from './forma.js';` a `src/lib/ui/index.ts`, e ao fim de `src/styles/tokens.css`:

```css
.ui-filtros { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.ui-filtros-campos { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.ui-filtros-abrir { display: none; }
.ui-campo label { margin: 0 0 4px; font-size: var(--t-label); color: var(--tinta-2); font-weight: 600; }
.ui-campo input, .ui-campo select { min-height: var(--toque); }
.ui-so-leitor {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}

@media (max-width: 1023px) {
  .ui-filtros-campos { display: none; }
  .ui-filtros-campos.aberto { display: flex; flex-direction: column; align-items: stretch; width: 100%; }
  .ui-filtros-abrir {
    display: inline-flex; align-items: center; min-height: var(--toque);
    padding: 0 14px; border: 1px solid var(--linha); border-radius: 999px;
    background: var(--superficie); color: var(--tinta); font-size: var(--t-secundario);
  }
}
```

**Fora desta fatia, de propósito:** a spec §8 lista também `esqueleto` (skeleton) e `Modal`. Nenhum dos dois entra aqui, e por motivos diferentes. `esqueleto` não tem o que resolver: o painel lê do IndexedDB, que responde em milissegundos, e um esqueleto que pisca é pior que a tela aparecendo pronta. `Modal` já existe e funciona, em markup e CSS, nas três caixas do operador — e essas caixas ficam no caminho crítico da bipagem, que esta fatia não toca (§9 da spec). Os dois entram na fatia 2, se as telas de lá pedirem.

- [ ] **Step 7: Commit**

```bash
node --experimental-strip-types tests/ui.test.ts && npm run typecheck
git add src/lib/ui tests/ui.test.ts src/styles/tokens.css
git commit -m "tabela(): uma chamada, densa no desktop e empilhada no celular

O rótulo da coluna viaja em data-rotulo na própria célula e o CSS decide
mostrá-lo. Sem isso seriam dois HTML para o mesmo dado — e é dessa duplicação
que nasce a divergência entre a tela grande e a pequena.

Tabela sem linha não desenha cabeçalho: cabeçalho vazio é promessa de dado que
não veio."
```

---

## Task 7: `sinalSync()` — cinco estados, uma fonte

Hoje o mesmo dado aparece com quatro textos: `Fila` (`painel-shell.ts:80`), `Fila local` (`index.html:77`), `N no aparelho` (`operador.ts:181`) e `N só no aparelho` (`gestor.ts:162`). Nenhum diz o que são os N.

**Files:**
- Create: `src/lib/ui/sinal-sync.ts`
- Modify: `src/lib/ui/index.ts`, `tests/ui.test.ts`
- Modify: `src/app/operador.ts:179-189`, `src/app/gestor.ts:156-168`

**Atenção ao nome:** `src/lib/sync.ts:64` já exporta uma função chamada `estadoSync`. A nova se chama `sinalSync` de propósito — duas com o mesmo nome em módulos diferentes confundem quem lê o import.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `tests/ui.test.ts` (import no topo, junto dos outros):

```ts
import { sinalSync } from '../src/lib/ui/sinal-sync.ts';

const e = (p = {}) => ({
  pendentes: 0, online: true, configurado: true, enviando: false,
  ultimoEnvio: null, ultimaDescida: null, ultimoErro: null, usuarioAtual: '', ...p
});

assert.equal(sinalSync(e()).texto, 'Sincronizado');
assert.equal(sinalSync(e()).tom, 'ok');

assert.equal(sinalSync(e({ enviando: true, pendentes: 3 })).texto, 'Sincronizando');
assert.equal(sinalSync(e({ online: false, pendentes: 3 })).texto, 'Offline');
assert.equal(sinalSync(e({ pendentes: 8 })).texto, '8 leituras pendentes');
assert.equal(sinalSync(e({ pendentes: 1 })).texto, '1 leitura pendente');

// Erro ganha de tudo: falha silenciosa é pior que fila cheia.
assert.equal(sinalSync(e({ ultimoErro: 'timeout', pendentes: 3 })).texto, 'Falha ao sincronizar');
assert.equal(sinalSync(e({ ultimoErro: 'timeout', online: false })).tom, 'falha');

// Aparelho sem projeto configurado guarda tudo local, e isso não é falha.
assert.equal(sinalSync(e({ configurado: false, pendentes: 5 })).texto, '5 leituras pendentes');
assert.equal(sinalSync(e({ configurado: false, pendentes: 0 })).texto, 'Nada pendente');

// Nunca vocabulário de sistema na tela.
for (const p of [{}, { pendentes: 8 }, { online: false }, { ultimoErro: 'x' }, { configurado: false }]) {
  const t = sinalSync(e(p)).texto.toLowerCase();
  for (const proibido of ['fila', 'indexeddb', 'queue', 'payload', 'sync']) {
    assert.ok(!t.includes(proibido), `"${t}" usa vocabulário de sistema: ${proibido}`);
  }
}
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
node --experimental-strip-types tests/ui.test.ts
```

Esperado: módulo não encontrado.

- [ ] **Step 3: Implementar**

Criar `src/lib/ui/sinal-sync.ts`:

```ts
// sinal-sync.ts — o único lugar do sistema que transforma o estado da
// sincronização em texto de tela.
//
// Antes eram quatro textos diferentes para o mesmo dado, e nenhum dizia o que
// eram os números. O operador não sabe o que é uma fila; ele sabe o que é uma
// leitura que ainda não chegou ao servidor.

import type { EstadoSync } from '../../types.js';
import { plural } from './basico.js';

export type TomSync = 'ok' | 'enviando' | 'offline' | 'pendente' | 'falha';

export interface SinalSync {
  tom: TomSync;
  /** Emoji de apoio. A cor nunca carrega a informação sozinha. */
  icone: string;
  texto: string;
}

export function sinalSync(e: EstadoSync): SinalSync {
  // Falha ganha de tudo: erro silencioso é pior que fila cheia, porque ninguém
  // vai atrás do que não apareceu.
  if (e.ultimoErro) return { tom: 'falha', icone: '🔴', texto: 'Falha ao sincronizar' };

  if (e.pendentes === 0) {
    // Aparelho sem projeto configurado nunca fica "sincronizado": não há para
    // onde sincronizar, e dizer que está sincronizado seria mentira.
    return e.configurado
      ? { tom: 'ok', icone: '🟢', texto: 'Sincronizado' }
      : { tom: 'pendente', icone: '🟠', texto: 'Nada pendente' };
  }

  if (!e.online) return { tom: 'offline', icone: '🟠', texto: 'Offline' };
  if (e.enviando) return { tom: 'enviando', icone: '🔵', texto: 'Sincronizando' };

  return {
    tom: 'pendente',
    icone: '🟠',
    texto: plural(e.pendentes, 'leitura pendente', 'leituras pendentes')
  };
}

/** Chip pronto para a barra do topo, nos dois modos. */
export function chipSync(e: EstadoSync): string {
  const s = sinalSync(e);
  return `<span class="ui-chip-sync ui-sync-${s.tom}">${s.icone} ${s.texto}</span>`;
}
```

Em `src/lib/ui/index.ts`, acrescentar `export * from './sinal-sync.js';`.

- [ ] **Step 4: Usar nos dois lugares que ainda montam texto à mão**

Em `src/app/operador.ts`, substituir o corpo de `sync.aoMudarSync` (linhas 179-189) por:

```ts
  sync.aoMudarSync((estado) => {
    const s = sinalSync(estado);
    const texto = `${s.icone} ${s.texto}`;
    el.chipSync.textContent = texto;
    el.syncGrupo.textContent = texto;
    el.chipSync.className = `chip chip-sync ui-sync-${s.tom}`;
    el.syncGrupo.className = `chip chip-sync ui-sync-${s.tom}`;
  });
```

Em `src/app/gestor.ts`, substituir o bloco do chip dentro de `sync.aoMudarSync` (linhas 159-166) por:

```ts
    const chip = document.querySelector<HTMLElement>('#chip-sync');
    if (chip) {
      const s = sinalSync(estado);
      chip.textContent = `${s.icone} ${s.texto}`;
      chip.className = `chip chip-sync ui-sync-${s.tom}`;
    }
```

Acrescentar `import { sinalSync } from '../lib/ui/index.js';` nos dois arquivos.

Em `index.html`, trocar o texto inicial `Fila local` (linha 77) e `Fila` (linha 93) por `—` nos dois — o valor real chega no primeiro `aoMudarSync`, que dispara na inscrição (`sync.ts:60`).

- [ ] **Step 5: Estilo dos tons**

Acrescentar ao fim de `src/styles/tokens.css`:

```css
.ui-chip-sync, .chip-sync {
  font-size: var(--t-label); padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--linha); background: var(--fundo); color: var(--tinta-2);
  white-space: nowrap;
}
.ui-sync-ok { background: rgba(22,163,74,.12); border-color: var(--bom); color: var(--tinta); }
.ui-sync-enviando { background: rgba(16,153,118,.12); border-color: var(--marca-forte); color: var(--tinta); }
.ui-sync-offline, .ui-sync-pendente { background: var(--atencao-superficie); border-color: var(--atencao); color: var(--tinta); }
.ui-sync-falha { background: var(--alarme-superficie); border-color: var(--alarme); color: var(--alarme); }
```

- [ ] **Step 6: Rodar e ver passar**

```bash
node --experimental-strip-types tests/ui.test.ts && npm run build && node tests/sync-fila.test.mjs
```

Esperado: `UI_OK` e o e2e da fila verde.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ui/sinal-sync.ts src/lib/ui/index.ts tests/ui.test.ts src/app/operador.ts src/app/gestor.ts index.html src/styles/tokens.css
git commit -m "o estado da sincronização passa a ter um nome só

Eram quatro textos para o mesmo dado — 'Fila', 'Fila local', 'N no aparelho',
'N só no aparelho' — e nenhum dizia o que eram os N.

Aparelho sem projeto configurado não fica 'Sincronizado': não há para onde
sincronizar, e dizer o contrário seria mentira. O teste proíbe 'fila',
'IndexedDB', 'queue', 'payload' e 'sync' no texto de tela."
```

---

## Task 8: O shell — topo e lateral

Reescreve `src/lib/painel-shell.ts` como `src/lib/shell/`, trocando navegação por hash por navegação por rota e ganhando o modo `operacao`.

**Files:**
- Create: `src/lib/shell/topo.ts`, `src/lib/shell/lateral.ts`, `src/lib/shell/index.ts`
- Delete: `src/lib/painel-shell.ts`
- Modify: `src/app/gestor.ts`, `src/styles/painel.css`
- Modify: `tests/painel-shell.test.mjs`

- [ ] **Step 1: Adaptar o teste que já existe**

Em `tests/painel-shell.test.mjs`, trocar os seletores de navegação `.p-item[href="#<id>"]` por `.p-item[href="/painel/<id>"]`, e `#hoje` por `/painel` (o item Início). Trocar a asserção `p.url().endsWith('#'+id)` por `p.url().endsWith('/painel/'+id)`.

Acrescentar dois passos novos ao fim, antes de `await navegador.close()`:

```js
await passo('a lateral mostra os quatro grupos, na ordem', async () => {
  const { ctx, p } = await painelAberto();
  const grupos = await p.$$eval('.p-lateral-grupo h2', (ns) => ns.map((n) => n.textContent.trim()));
  const esperado = ['Operação', 'Análise', 'Cadastros', 'Sistema'];
  if (JSON.stringify(grupos) !== JSON.stringify(esperado)) {
    throw new Error(`grupos: ${JSON.stringify(grupos)}`);
  }
  await ctx.close();
});

await passo('o badge da divergência aparece em TODA seção', async () => {
  const { ctx, p } = await painelAberto();
  await p.evaluate(() => window.__shell.definirBadge('divergencias', 3));
  for (const secao of ['pessoas', 'sincronizacao', 'transportadoras']) {
    await p.click(`.p-item[href="/painel/${secao}"]`);
    await p.waitForSelector(`[data-secao="${secao}"]:not([hidden])`, { timeout: 4000 });
    const visivel = await p.isVisible('[data-badge="divergencias"]');
    if (!visivel) throw new Error(`badge sumiu em ${secao}`);
  }
  await ctx.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/painel-shell.test.mjs
```

Esperado: `FALHA` nos passos de navegação — os `href` ainda são hash.

- [ ] **Step 3: Escrever `src/lib/shell/topo.ts`**

```ts
// topo.ts — a barra do topo, nos dois modos.
//
// No painel ela carrega o título da seção e o estado da sincronização. Na
// operação ela carrega a carga que está sendo conferida — a informação que a
// pessoa erra se esquecer — e nada mais. Sem marca e sem botão de navegação:
// cada pixel gasto com logo na tela de trabalho é pixel que não é câmera.

export type ModoShell = 'painel' | 'operacao';

export function montarTopo(modo: ModoShell): HTMLElement {
  const topo = document.createElement('header');
  topo.className = `sh-topo sh-topo-${modo}`;
  topo.innerHTML = modo === 'painel'
    ? `<button class="sh-voltar" type="button" hidden aria-label="Voltar">‹</button>
       <span class="sh-titulo-secao"></span>
       <span class="sh-espaco"></span>
       <span class="sh-sync" id="chip-sync">—</span>`
    : `<div class="sh-carga"><b class="sh-carga-nome">—</b><small class="sh-carga-quem"></small></div>
       <span class="sh-espaco"></span>
       <span class="sh-sync" id="chip-sync">—</span>
       <span class="sh-icones"></span>`;
  return topo;
}

/** Escreve a carga na barra da operação. Ignorado no modo painel. */
export function definirCarga(topo: HTMLElement, nome: string, quem: string): void {
  const b = topo.querySelector('.sh-carga-nome');
  const s = topo.querySelector('.sh-carga-quem');
  if (b) b.textContent = nome;
  if (s) s.textContent = quem;
}

export function definirTituloSecao(topo: HTMLElement, texto: string): void {
  const t = topo.querySelector('.sh-titulo-secao');
  // `textContent` não interpreta HTML: escapar aqui escreveria "&amp;" na tela.
  if (t) t.textContent = texto;
}
```

- [ ] **Step 4: Escrever `src/lib/shell/lateral.ts`**

```ts
// lateral.ts — o menu do desktop.
//
// Os itens levam `href` de rota de verdade, não `#hash`: é o roteador quem
// intercepta o clique. Assim o menu funciona com clique do meio, "abrir em nova
// aba" e leitor de tela, que é o que um menu de sistema precisa fazer.

import { esc } from '../util.js';

export interface ItemMenu {
  /** Casa com `Secao` do roteador e com o `data-secao` da região. */
  id: string;
  rotulo: string;
  grupo: string;
  href: string;
}

export function montarLateral(itens: ItemMenu[], usuario: string): HTMLElement {
  const grupos = [...new Set(itens.map((i) => i.grupo))];

  const nav = document.createElement('nav');
  nav.className = 'p-lateral';
  nav.setAttribute('aria-label', 'Seções do painel');
  nav.innerHTML = `
    ${grupos.map((g) => `
      <div class="p-lateral-grupo">
        <h2>${esc(g)}</h2>
        ${itens.filter((i) => i.grupo === g).map((i) => `
          <a class="p-item" href="${esc(i.href)}" data-item="${esc(i.id)}">
            <span>${esc(i.rotulo)}</span>
            <span class="ui-badge" data-badge="${esc(i.id)}" hidden></span>
          </a>`).join('')}
      </div>`).join('')}
    <div class="p-lateral-rodape">
      <span class="p-usuario">${esc(usuario)}</span>
      <a class="btn btn-secundario" id="btn-bipar" href="/bipagem">Abrir bipagem</a>
      <button id="btn-sair" class="btn btn-fantasma" type="button">Sair</button>
    </div>`;
  return nav;
}
```

- [ ] **Step 5: Escrever `src/lib/shell/index.ts`**

```ts
// index.ts — a moldura do painel.
//
// Não conhece regra de negócio e não toca no IndexedDB. Recebe os itens do
// menu, diz qual seção está visível e avisa quem precisa repintar.
//
// A regra que o menu põe em risco: com seções, a divergência do dia passaria a
// viver atrás de um item. Duas travas contra isso — badge no item, visível de
// qualquer seção, e faixa fixa acima do conteúdo de todas elas. A faixa se cala
// só onde ela seria redundante com o conteúdo logo abaixo.

import { $$, esc } from '../util.js';
import { montarTopo, definirTituloSecao, type ModoShell } from './topo.js';
import { montarLateral, type ItemMenu } from './lateral.js';

export type { ItemMenu, ModoShell };

export interface OpcoesShell {
  modo: ModoShell;
  itens: ItemMenu[];
  usuario: string;
  /** Onde as `[data-secao]` vivem. */
  raiz: HTMLElement;
}

export interface OpcoesAlerta {
  /**
   * Seção onde a faixa é redundante: ela se cala enquanto essa seção estiver
   * visível. A faixa existe para quem está LONGE do alarme — dentro da seção
   * que já mostra o problema inteiro, o aviso repetido só ensina a ignorá-lo.
   */
  redundanteEm?: string;
}

export interface Shell {
  mostrar(secao: string): void;
  secaoAtual(): string;
  aoTrocarSecao(fn: (id: string) => void): void;
  definirBadge(id: string, n: number): void;
  definirAlerta(html: string | null, op?: OpcoesAlerta): void;
  topo: HTMLElement;
}

export function montarShell(op: OpcoesShell): Shell {
  const ouvintes: ((id: string) => void)[] = [];
  const topo = montarTopo(op.modo);
  document.body.prepend(topo);

  if (op.modo === 'painel') document.body.prepend(montarLateral(op.itens, op.usuario));

  const alerta = document.createElement('div');
  alerta.className = 'p-alerta-fixo';
  alerta.hidden = true;
  op.raiz.prepend(alerta);

  let visivel = op.itens[0]?.id ?? '';
  let alertaHtml: string | null = null;
  let redundanteEm: string | undefined;

  const pintarAlerta = (): void => {
    alerta.innerHTML = alertaHtml ?? '';
    alerta.hidden = !alertaHtml || redundanteEm === visivel;
  };

  const mostrar = (id: string): void => {
    visivel = id;
    pintarAlerta();
    for (const s of $$<HTMLElement>('[data-secao]', op.raiz)) s.hidden = s.dataset.secao !== id;
    for (const item of $$<HTMLAnchorElement>('.p-item')) {
      const ativo = item.dataset.item === id;
      item.classList.toggle('ativo', ativo);
      if (ativo) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    definirTituloSecao(topo, op.itens.find((i) => i.id === id)?.rotulo ?? '');
    // O conteúdo troca inteiro: continuar na rolagem da seção anterior confunde.
    window.scrollTo(0, 0);
    for (const fn of ouvintes) fn(id);
  };

  return {
    mostrar,
    secaoAtual: () => visivel,
    aoTrocarSecao: (fn) => { ouvintes.push(fn); },
    definirBadge: (id, n) => {
      for (const b of $$<HTMLElement>(`[data-badge="${id}"]`)) {
        b.textContent = String(n);
        b.hidden = n <= 0;
      }
    },
    definirAlerta: (html, o) => {
      alertaHtml = html;
      redundanteEm = o?.redundanteEm;
      pintarAlerta();
    },
    topo
  };
}
```

`esc` só passa a ser usado na Task 9. Até lá, deixá-lo fora do import — `noUnusedLocals` reprova o build.

- [ ] **Step 6: `gestor.ts` usa o shell novo**

Em `src/app/gestor.ts`:

- Trocar o import de `painel-shell.js` por `import { montarShell, type ItemMenu, type Shell } from '../lib/shell/index.js';`
- Substituir a constante `MENU` (linha 53) pelos 13 itens, com `href` de rota:

```ts
const MENU: ItemMenu[] = [
  { id: 'inicio', rotulo: 'Início', grupo: 'Operação', href: '/painel' },
  { id: 'divergencias', rotulo: 'Divergências', grupo: 'Operação', href: '/painel/divergencias' },
  { id: 'incompletos', rotulo: 'Pedidos incompletos', grupo: 'Operação', href: '/painel/incompletos' },
  { id: 'conferencias', rotulo: 'Conferências', grupo: 'Operação', href: '/painel/conferencias' },
  { id: 'ocorrencias', rotulo: 'Ocorrências', grupo: 'Operação', href: '/painel/ocorrencias' },
  { id: 'desempenho', rotulo: 'Desempenho', grupo: 'Análise', href: '/painel/desempenho' },
  { id: 'indicadores', rotulo: 'Indicadores', grupo: 'Análise', href: '/painel/indicadores' },
  { id: 'mapa', rotulo: 'Mapa', grupo: 'Análise', href: '/painel/mapa' },
  { id: 'relatorios', rotulo: 'Relatórios', grupo: 'Análise', href: '/painel/relatorios' },
  { id: 'pessoas', rotulo: 'Pessoas', grupo: 'Cadastros', href: '/painel/pessoas' },
  { id: 'transportadoras', rotulo: 'Transportadoras', grupo: 'Cadastros', href: '/painel/transportadoras' },
  { id: 'rotas', rotulo: 'Códigos de rota', grupo: 'Cadastros', href: '/painel/rotas' },
  { id: 'sincronizacao', rotulo: 'Sincronização', grupo: 'Sistema', href: '/painel/sincronizacao' }
];
```

- Em `iniciarPainel()`, trocar a chamada por:

```ts
  shell = montarShell({
    modo: 'painel',
    itens: MENU,
    usuario: usuario ? `${usuario.nome} • gestor` : '',
    raiz: $('#tela-painel')
  });
  // O teste de ponta a ponta precisa de um jeito de forçar o badge sem inventar
  // divergência no banco. É a única superfície pública do shell.
  (window as unknown as { __shell: Shell }).__shell = shell;
```

- `mostrarSecao(id)` (criada na Task 3) passa a delegar para `shell.mostrar(id)`.
- Onde o código de hoje chamava `definirBadge('hoje', ...)`, passar a chamar `definirBadge('divergencias', ...)`; e `definirAlerta(..., { redundanteEm: 'hoje' })` vira `{ redundanteEm: 'divergencias' }`.
- Apagar `src/lib/painel-shell.ts`.

- [ ] **Step 7: Estilo da lateral e do topo**

Em `src/styles/painel.css`, substituir as regras que hoje começam em `.p-topo` e `.p-lateral` pelas do shell novo. A grade:

```css
body.painel {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 248px 1fr;
  grid-template-areas: "lateral topo" "lateral corpo";
  grid-template-rows: auto 1fr;
  background: var(--fundo);
}
body.painel > .sh-topo { grid-area: topo; }
body.painel > .p-lateral { grid-area: lateral; }
body.painel > #tela-painel { grid-area: corpo; min-width: 0; padding: 20px 24px 40px; }

/* Barra fina e clara: nada de cabeçalho verde alto. */
.sh-topo {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 20px calc(10px + env(safe-area-inset-top));
  background: var(--superficie); border-bottom: 1px solid var(--linha);
}
.sh-espaco { flex: 1; }
.sh-titulo-secao { font-size: var(--t-corpo); font-weight: 700; color: var(--tinta); }

.p-lateral {
  background: var(--superficie); border-right: 1px solid var(--linha);
  padding: 16px 0 24px; display: flex; flex-direction: column; gap: 18px; overflow-y: auto;
}
.p-lateral-grupo h2 {
  font-size: var(--t-label); letter-spacing: .09em; text-transform: uppercase;
  color: var(--tinta-3); margin: 0 0 4px; padding: 0 18px;
}
.p-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-height: var(--toque); padding: 0 18px; font-size: var(--t-corpo);
  color: var(--tinta); text-decoration: none; border-left: 3px solid transparent;
}
.p-item:hover { background: var(--marca-superficie); }
.p-item.ativo {
  background: var(--marca-superficie); border-left-color: var(--marca-forte);
  color: var(--marca); font-weight: 700;
}
.p-lateral-rodape {
  margin-top: auto; padding: 16px 18px 0; border-top: 1px solid var(--linha);
  display: flex; flex-direction: column; gap: 8px;
}
.p-lateral-rodape .p-usuario { color: var(--tinta-2); font-size: var(--t-secundario); }

.p-alerta-fixo {
  border-left: 4px solid var(--alarme); background: var(--alarme-superficie);
  border-radius: 0 var(--raio) var(--raio) 0; padding: 12px 16px; margin-bottom: 18px;
  font-size: var(--t-corpo);
}
.p-alerta-fixo[hidden] { display: none; }
.p-alerta-fixo a { color: var(--alarme); font-weight: 700; }
```

Apagar de `painel.css` as regras `.p-hamburguer`, `.p-fundo-gaveta`, `.p-com-menu` e o bloco `@media (max-width: 1023px)` que transformava a lateral em gaveta — a Task 9 põe a barra inferior no lugar.

- [ ] **Step 8: Rodar e ver passar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs && node tests/rotas.test.mjs
```

Esperado: `SHELL_OK` e `ROTAS_OK`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "o shell deixa de navegar por hash e passa a navegar por rota

Os itens levam href de verdade: clique do meio, 'abrir em nova aba' e leitor de
tela passam a funcionar, que é o que um menu de sistema precisa fazer.

O badge muda de dono — sai de 'Início' e vai para 'Divergências', que agora é
destino próprio. A faixa fixa se cala lá, não em Início: é lá que ela seria
redundante com o conteúdo logo abaixo.

A barra do topo perde o verde alto e vira faixa fina e clara."
```

---

## Task 9: A barra inferior e a folha "Mais"

**Files:**
- Create: `src/lib/shell/barra-inferior.ts`, `src/lib/ui/folha.ts`
- Modify: `src/lib/shell/index.ts`, `src/lib/ui/index.ts`, `src/styles/painel.css`
- Test: `tests/painel-shell.test.mjs`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `tests/painel-shell.test.mjs`, antes de `await navegador.close()`:

```js
await passo('no celular a navegação é a barra inferior, não gaveta', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  if (await p.isVisible('.p-lateral')) throw new Error('a lateral do desktop apareceu no celular');
  if (!(await p.isVisible('.sh-barra'))) throw new Error('não há barra inferior');
  const abas = await p.$$eval('.sh-aba', (ns) => ns.map((n) => n.dataset.aba));
  const esperado = ['inicio', 'divergencias', 'conferencias', 'mapa', 'mais'];
  if (JSON.stringify(abas) !== JSON.stringify(esperado)) throw new Error(`abas: ${JSON.stringify(abas)}`);
  await ctx.close();
});

await passo('a aba navega e marca a ativa', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.sh-aba[data-aba="conferencias"]');
  await p.waitForSelector('[data-secao="conferencias"]:not([hidden])', { timeout: 4000 });
  if (!p.url().endsWith('/painel/conferencias')) throw new Error(`URL: ${p.url()}`);
  const ativa = await p.getAttribute('.sh-aba.ativa', 'data-aba');
  if (ativa !== 'conferencias') throw new Error(`aba ativa: ${ativa}`);
  await ctx.close();
});

await passo('"Mais" abre a folha com os oito restantes e fecha ao escolher', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.click('.sh-aba[data-aba="mais"]');
  await p.waitForSelector('.ui-folha.aberta', { timeout: 4000 });
  const n = await p.$$eval('.ui-folha .p-item', (ns) => ns.length);
  if (n !== 9) throw new Error(`a folha traz ${n} itens, não 9`);
  await p.click('.ui-folha .p-item[href="/painel/rotas"]');
  await p.waitForSelector('[data-secao="rotas"]:not([hidden])', { timeout: 4000 });
  if (await p.isVisible('.ui-folha.aberta')) throw new Error('a folha ficou aberta depois de escolher');
  await ctx.close();
});

await passo('o badge da divergência aparece na aba, sem abrir nada', async () => {
  const { ctx, p } = await painelAberto({ width: 390, height: 844 });
  await p.evaluate(() => window.__shell.definirBadge('divergencias', 3));
  await p.click('.sh-aba[data-aba="conferencias"]');
  await p.waitForSelector('[data-secao="conferencias"]:not([hidden])', { timeout: 4000 });
  if (!(await p.isVisible('.sh-aba[data-aba="divergencias"] .ui-badge'))) {
    throw new Error('o badge sumiu da barra');
  }
  await ctx.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/painel-shell.test.mjs
```

Esperado: `FALHA` nos quatro passos novos — `.sh-barra` não existe.

- [ ] **Step 3: Escrever `src/lib/ui/folha.ts`**

```ts
// folha.ts — a folha que sobe de baixo (bottom sheet) e o aviso passageiro.
//
// No celular, o que no desktop é menu lateral ou diálogo vira folha: ela nasce
// perto do polegar e fecha arrastando ou tocando fora. Modal centralizado num
// aparelho grande obriga a mão a subir até o meio da tela.

export interface Folha {
  abrir: (conteudoHtml: string) => void;
  fechar: () => void;
  aberta: () => boolean;
  raiz: HTMLElement;
}

export function criarFolha(rotulo: string): Folha {
  const fundo = document.createElement('div');
  fundo.className = 'ui-folha-fundo';
  fundo.hidden = true;

  const folha = document.createElement('div');
  folha.className = 'ui-folha';
  folha.setAttribute('role', 'dialog');
  folha.setAttribute('aria-label', rotulo);
  folha.innerHTML = '<div class="ui-folha-alca"></div><div class="ui-folha-corpo"></div>';

  document.body.append(fundo, folha);

  const fechar = (): void => {
    folha.classList.remove('aberta');
    fundo.hidden = true;
  };

  fundo.addEventListener('click', fechar);
  // Escolher um item fecha: ninguém quer tocar duas vezes para chegar num lugar.
  folha.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('a, button')) fechar();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(); });

  return {
    abrir: (html) => {
      const corpo = folha.querySelector('.ui-folha-corpo');
      if (corpo) corpo.innerHTML = html;
      folha.classList.add('aberta');
      fundo.hidden = false;
    },
    fechar,
    aberta: () => folha.classList.contains('aberta'),
    raiz: folha
  };
}

/** Aviso passageiro. Some sozinho: confirmação que exige toque interrompe. */
export function toast(texto: string, tom: 'ok' | 'erro' = 'ok'): void {
  const t = document.createElement('div');
  t.className = `ui-toast ui-toast-${tom}`;
  t.setAttribute('role', 'status');
  t.textContent = texto;
  document.body.append(t);
  window.setTimeout(() => t.remove(), 4000);
}
```

Em `src/lib/ui/index.ts`, acrescentar `export * from './folha.js';`.

- [ ] **Step 4: Escrever `src/lib/shell/barra-inferior.ts`**

```ts
// barra-inferior.ts — a navegação do painel no celular.
//
// Cinco abas na zona do polegar, contra um hambúrguer no canto mais alto e mais
// longe da mão. As quatro primeiras são o que o gestor usa todo dia; as outras
// oito são consulta, e moram atrás de "Mais".
//
// A aba Divergências carrega o badge, e é essa a razão de ela estar aqui em vez
// de dentro de "Mais": com a gaveta, a contagem só existia com o menu aberto.

import { esc } from '../util.js';
import type { ItemMenu } from './lateral.js';

/** Ids que ganham aba própria, nesta ordem. O resto vai para "Mais". */
export const ABAS = ['inicio', 'divergencias', 'conferencias', 'mapa'] as const;

const ICONE: Record<string, string> = {
  inicio: '◱', divergencias: '▲', conferencias: '▤', mapa: '◎', mais: '⋯'
};

const ROTULO_CURTO: Record<string, string> = {
  inicio: 'Início', divergencias: 'Alertas', conferencias: 'Conferências', mapa: 'Mapa'
};

export function montarBarra(itens: ItemMenu[]): HTMLElement {
  const barra = document.createElement('nav');
  barra.className = 'sh-barra';
  barra.setAttribute('aria-label', 'Navegação do painel');

  const abas = ABAS.map((id) => {
    const item = itens.find((i) => i.id === id);
    if (!item) return '';
    return `<a class="sh-aba" data-aba="${esc(id)}" href="${esc(item.href)}">
      <i aria-hidden="true">${ICONE[id]}</i>
      <span class="ui-badge" data-badge="${esc(id)}" hidden></span>
      ${esc(ROTULO_CURTO[id] ?? item.rotulo)}
    </a>`;
  }).join('');

  barra.innerHTML = `${abas}
    <button class="sh-aba" data-aba="mais" type="button">
      <i aria-hidden="true">${ICONE.mais}</i>Mais
    </button>`;
  return barra;
}

/** Os itens que não têm aba própria — o conteúdo da folha "Mais". */
export function itensDaFolha(itens: ItemMenu[]): ItemMenu[] {
  return itens.filter((i) => !(ABAS as readonly string[]).includes(i.id));
}

export function htmlDaFolha(itens: ItemMenu[]): string {
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  return grupos.map((g) => `
    <div class="p-lateral-grupo">
      <h2>${esc(g)}</h2>
      ${itens.filter((i) => i.grupo === g).map((i) => `
        <a class="p-item" href="${esc(i.href)}" data-item="${esc(i.id)}">
          <span>${esc(i.rotulo)}</span>
          <span class="ui-badge" data-badge="${esc(i.id)}" hidden></span>
        </a>`).join('')}
    </div>`).join('');
}
```

- [ ] **Step 5: Ligar no shell**

Em `src/lib/shell/index.ts`, depois de montar a lateral:

```ts
import { montarBarra, itensDaFolha, htmlDaFolha } from './barra-inferior.js';
import { criarFolha } from '../ui/folha.js';
```

e, no corpo de `montarShell`, quando `op.modo === 'painel'`:

```ts
    document.body.prepend(montarLateral(op.itens, op.usuario));

    const barra = montarBarra(op.itens);
    document.body.append(barra);

    const folha = criarFolha('Mais seções');
    // `esc` porque o nome vem do cadastro, e cadastro aceita qualquer coisa.
    const rodape = `<div class="p-lateral-rodape">
      <span class="p-usuario">${esc(op.usuario)}</span>
      <a class="btn btn-secundario" href="/bipagem">Abrir bipagem</a>
      <button class="btn btn-fantasma" data-sair type="button">Sair</button>
    </div>`;
    barra.querySelector('[data-aba="mais"]')?.addEventListener('click', () => {
      folha.abrir(htmlDaFolha(itensDaFolha(op.itens)) + rodape);
    });
```

Acrescentar `esc` ao import de `'../util.js'` no topo de `src/lib/shell/index.ts`.

O botão `[data-sair]` da folha precisa do mesmo listener de `#btn-sair`. Em `gestor.ts`, trocar o listener por delegação:

```ts
  document.addEventListener('click', (ev) => {
    if (!(ev.target as HTMLElement).closest('#btn-sair, [data-sair]')) return;
    auth.sair();
    irPara({ tela: 'entrar' });
  });
```

Dentro de `mostrar()`, marcar também a aba ativa:

```ts
    for (const aba of $$<HTMLElement>('.sh-aba')) {
      aba.classList.toggle('ativa', aba.dataset.aba === id);
    }
```

`definirBadge` já percorre **todos** os `[data-badge="<id>"]` (Task 8, Step 5), então o badge da lateral e o da aba acendem juntos, sem código novo.

- [ ] **Step 6: Estilo**

Acrescentar ao fim de `src/styles/painel.css`:

```css
/* --------------------------------------------- celular: barra inferior --- */
.sh-barra { display: none; }
.ui-folha-fundo { display: none; }

@media (max-width: 1023px) {
  body.painel {
    grid-template-columns: 1fr;
    grid-template-areas: "topo" "corpo";
  }
  body.painel > .p-lateral { display: none; }
  body.painel > #tela-painel {
    padding: 16px 16px calc(78px + env(safe-area-inset-bottom));
  }

  .sh-barra {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 120;
    display: grid; grid-template-columns: repeat(5, 1fr);
    background: var(--superficie); border-top: 1px solid var(--linha);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .sh-aba {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 7px 2px 9px; font-size: 10px; color: var(--tinta-2);
    text-decoration: none; background: transparent; border: 0; cursor: pointer;
    position: relative; min-height: 56px; justify-content: center;
  }
  .sh-aba i { font-size: 17px; line-height: 1; opacity: .65; }
  .sh-aba.ativa { color: var(--marca); font-weight: 700; }
  .sh-aba.ativa i { opacity: 1; }
  .sh-aba .ui-badge { position: absolute; top: 4px; right: 22%; }

  .ui-folha-fundo { display: block; position: fixed; inset: 0; z-index: 150; background: rgba(22,33,29,.45); }
  .ui-folha-fundo[hidden] { display: none; }
}

/* ------------------------------------------------------------- folha ----- */
.ui-folha {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 160;
  background: var(--superficie); border-radius: 18px 18px 0 0;
  padding: 8px 0 calc(14px + env(safe-area-inset-bottom));
  transform: translateY(101%); transition: transform .18s ease-out;
  max-height: 82vh; overflow-y: auto;
}
.ui-folha.aberta { transform: translateY(0); }
.ui-folha-alca { width: 34px; height: 4px; background: var(--linha); border-radius: 999px; margin: 0 auto 10px; }

/* ------------------------------------------------------------- toast ----- */
.ui-toast {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(90px + env(safe-area-inset-bottom)); z-index: 300;
  background: var(--tinta); color: #fff; padding: 10px 16px; border-radius: 999px;
  font-size: var(--t-secundario); box-shadow: 0 6px 20px rgba(0,0,0,.22);
}
.ui-toast-erro { background: var(--alarme); }
```

- [ ] **Step 7: Rodar e ver passar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs
```

Esperado: `SHELL_OK`, com os quatro passos novos verdes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "no celular o painel navega por barra inferior, não por gaveta

Cinco abas na zona do polegar, contra um hambúrguer no canto mais alto e mais
longe da mão. As quatro do dia a dia ficam na barra; as outras oito são consulta
e moram em 'Mais'.

Divergências ganha aba própria porque é ela que carrega o badge: com a gaveta,
a contagem só existia com o menu aberto — e divergência que precisa de um toque
para aparecer é divergência escondida."
```

---

## Task 10: O contexto das seções

`Base` ainda é uma interface local de `gestor.ts`. Os 12 módulos precisam dela.

**Files:**
- Create: `src/app/painel/contexto.ts`
- Modify: `src/app/gestor.ts`

- [ ] **Step 1: Criar o contexto**

```ts
// contexto.ts — o que as seções do painel compartilham.
//
// Os dados são carregados uma vez por `index.ts` e passados prontos: nenhuma
// seção abre o IndexedDB por conta própria, senão a mesma tela lê o banco treze
// vezes a cada ciclo de atualização.

import type {
  Dispositivo, Leitura, Ocorrencia, Rota, Sessao, Transportadora, Usuario
} from '../../types.js';
import type { Tela } from '../../lib/router.js';

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
  usuario: () => Usuario;
  base: () => Base;
  dispositivos: () => Dispositivo[];
  /** Recarrega tudo do IndexedDB e repinta a seção visível. */
  recarregar: () => Promise<void>;
  irPara: (t: Tela) => void;
}

/** Contrato de toda seção do painel. */
export interface Modulo {
  pintar: () => void;
}

export type Montar = (raiz: HTMLElement, ctx: Contexto) => Modulo;

export const dentro = (iso: string, de: string, ate: string): boolean => iso >= de && iso <= ate;

export const baseVazia = (): Base => ({
  usuarios: [], transportadoras: [], rotas: [], sessoes: [], leituras: [], ocorrencias: [],
  porSessao: new Map(), ocPorSessao: new Map()
});
```

- [ ] **Step 2: Usar em `gestor.ts`**

Remover a interface `Base` local e a constante `dentro` (linha 119), e importar:

```ts
import { baseVazia, dentro, type Base, type Contexto, type Modulo } from './painel/contexto.js';
```

Declarar, junto das variáveis de módulo:

```ts
/** Seções já migradas, por id do menu. Cresce nas Tasks 11 a 13. */
const secoes = new Map<string, Modulo>();

const contexto: Contexto = {
  usuario: () => usuario as Usuario,
  base: () => base,
  dispositivos: () => dispositivos,
  recarregar: () => recarregarTudo(),
  irPara: (r) => ambiente?.irPara(r)
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

Acrescentar `pintarSecaoVisivel()` ao fim de `recarregarTudo()` e de `atualizarAoVivo()`, **sem remover** as chamadas antigas — elas ainda são as donas do HTML até a Task 13.

Registrar `shell.aoTrocarSecao(() => pintarSecaoVisivel())` em `iniciarPainel()`.

- [ ] **Step 3: Verificar**

```bash
npm run typecheck && npm run build && node tests/painel-shell.test.mjs
```

Esperado: verde, sem mudança visível.

- [ ] **Step 4: Commit**

```bash
git add src/app/painel/contexto.ts src/app/gestor.ts
git commit -m "Base e Contexto saem de gestor.ts para poderem ser compartilhados

Os dados são carregados uma vez e passados prontos: nenhuma seção abre o
IndexedDB por conta própria, senão a mesma tela lê o banco treze vezes a cada
ciclo de atualização."
```

---

## Task 11: Operação — Início, Divergências, Pedidos incompletos, Conferências, Ocorrências

Cinco módulos. **A regra de transformação é a mesma para todos**, e está escrita por inteiro aqui porque cada passo é um commit e quem executa pode estar lendo fora de ordem.

**Regra de transformação (vale para cada um dos cinco):**

1. O markup daquela seção **sai** de `index.html` e vira a string devolvida por `montar()`.
2. As funções daquela seção **saem** de `gestor.ts` e entram no módulo novo.
3. Todo `$('#x')` que aponta para dentro da seção ganha a raiz: `$('#x', raiz)`.
4. O que a função lia de variável de módulo (`base`, `dispositivos`, `usuario`) passa a vir do contexto: `ctx.base()`, `ctx.dispositivos()`, `ctx.usuario()`.
5. Toda tabela montada à mão vira `tabela()` de `src/lib/ui/`; todo "nada aqui" vira `vazio()`; todo bloco vira `secao()`; todo `N item(s)` vira `plural()`.
6. A chamada da seção sai de `recarregarTudo()` / `atualizarAoVivo()` em `gestor.ts`, e o módulo entra no mapa `secoes`.
7. Rodar `npm run build && node tests/painel-shell.test.mjs && node tests/rotas.test.mjs` e commitar.

**Files:**
- Create: `src/app/painel/inicio.ts`, `divergencias.ts`, `incompletos.ts`, `conferencias.ts`, `ocorrencias.ts`
- Modify: `src/app/gestor.ts`, `index.html`

- [ ] **Step 1: `inicio.ts`**

Recebe: `pintarAgora` (parte), `pintarAtencao`, `pintarNaoMapeados` e os KPIs do dia. Estrutura de `montar()`:

```ts
export const montar: Montar = (raiz, ctx) => {
  const pintar = (): void => {
    const { inicio, fim } = limitesDoDia();
    const hoje = ctx.base().leituras.filter((l) => dentro(l.timestamp, inicio, fim));
    const divergentes = hoje.filter((l) => l.status === 'ROTA_DIVERGENTE');
    const abertas = ctx.base().sessoes.filter((s) => s.status === 'ABERTA');

    raiz.innerHTML = [
      pageHeader({ titulo: 'Início', sub: data(new Date().toISOString()) }),
      divergentes.length
        ? alerta({
            tom: 'alarme',
            titulo: plural(divergentes.length, 'volume de outra transportadora', 'volumes de outra transportadora'),
            texto: 'Não podem embarcar. Confira antes de liberar a carga.',
            acao: { rotulo: 'Ver volumes', href: '/painel/divergencias' }
          })
        : '',
      kpis([
        { rotulo: 'Volumes hoje', valor: hoje.length },
        { rotulo: 'Divergências', valor: divergentes.length, tom: divergentes.length ? 'alarme' : 'neutro' },
        { rotulo: 'Conferências abertas', valor: abertas.length },
        { rotulo: 'Pedidos incompletos', valor: incompletosDeHoje(ctx).length }
      ]),
      secao({ titulo: 'Precisa de atenção', meta: plural(atencao.length, 'item', 'itens'), corpo: listaDeAtencao(ctx) }),
      secao({ titulo: 'Conferências abertas', corpo: tabelaDeAbertas(abertas, ctx) })
    ].join('');
  };
  return { pintar };
};
```

O bloco `#atencao` deixa de ser uma lista vermelha com moldura e vira lista de linhas clicáveis, cada uma apontando para a seção que resolve o problema — é o drill-down do item 17, e é por isso que `Divergências` e `Pedidos incompletos` viraram rotas. O cartão `#faixa-divergencia` **não vem** para cá: ele é a seção `divergencias` inteira.

`listaDeAtencao`, `tabelaDeAbertas` e `incompletosDeHoje` são funções locais do módulo, extraídas de `pintarAtencao` e `pintarAgora`.

- [ ] **Step 2: `divergencias.ts`**

Recebe o conteúdo de `#faixa-divergencia`, montado hoje dentro de `pintarAgora` (`gestor.ts:227-299`). `pintar()` monta `pageHeader` + `tabela()` com as colunas Código, Rota lida, Dono do código, Pedido, Conferente, Carga, Hora, sobre `ctx.base().leituras` filtradas por `status === 'ROTA_DIVERGENTE'` no período do dia. Estado vazio: `vazio('Nenhum volume divergente hoje.')`.

Em `gestor.ts`, `definirAlerta` passa a receber `{ redundanteEm: 'divergencias' }`.

- [ ] **Step 3: `incompletos.ts`**

Recebe `#incompletos-hoje`. Usa `pedidosIncompletos` de `src/lib/model.js`, que já existe (é importado hoje por `diretor.ts`). Colunas: Pedido, Rota, Bipados, Declarado, Faltando. Cada linha leva a `/painel/conferencias` com o pedido no filtro — o drill-down do item 17 chega ao volume que falta.

- [ ] **Step 4: `conferencias.ts`**

Recebe `#tabela-sessoes` e o `p-filtros` do período, mais `filtroPeriodo` (`gestor.ts:487-492`), `sessoesFiltradas` (`493-507`), `pintarHistorico` (`508-550`), `estadoDaCarga` (`551-569`), `liberarCarga` (`570-618`) e `abrirGaveta` (`677-694`).

A gaveta de detalhe passa a usar `criarFolha` de `src/lib/ui/folha.js` em vez do `#gaveta` fixo — mesma informação, e no celular ela sobe de baixo, perto do polegar. O `const gaveta = $('#gaveta')` de módulo (`gestor.ts:675`) some junto.

O par de campos do período vira `filtros([campo({ id: 'f-de', ... }), campo({ id: 'f-ate', ... })], resumo)`, com os mesmos ids de hoje.

- [ ] **Step 5: `ocorrencias.ts`**

Recebe `#oc-lista` e `#recorrentes`, mais `ocorrenciasFiltradas` (`gestor.ts:414-434`), `pintarOcorrencias` (`435-453`) e `pintarRecorrentes` (`454-486`).

O texto escrito continua vindo **na íntegra**, nunca resumido em etiqueta — é ali que está a informação, e é o que o CLAUDE.md §9 exige. `tabela()` não serve para a lista de ocorrências por isso: ela é uma lista de blocos com texto corrido, não uma grade.

- [ ] **Step 6: Rodar e commitar cada um**

Um commit por módulo, com a verificação da regra 7. Mensagens:

```
Início vira módulo, e o bloco de atenção vira drill-down
Divergências ganha seção própria — o destino do alarme
Pedidos incompletos saem de Hoje e viram seção com período
Conferências vira módulo, e a gaveta de detalhe vira folha
Ocorrências vira módulo, com o texto ainda por inteiro
```

---

## Task 12: Análise — Desempenho, Indicadores, Mapa, Relatórios

**Files:**
- Create: `src/app/painel/desempenho.ts`, `indicadores.ts`, `mapa.ts`, `relatorios.ts`
- Delete: `src/app/diretor.ts`
- Modify: `src/app/gestor.ts`, `index.html`, `tests/diretor.test.mjs`

- [ ] **Step 1: `desempenho.ts`**

Recebe `pintarDesempenho` (`gestor.ts:619-674`) e o `p-grade` com `#desempenho-pessoa` e `#desempenho-rota`, seguindo a regra de transformação da Task 11.

Esta seção é a terceira pergunta do CLAUDE.md §9 — "Como está o desempenho?" — e **não** se funde com Indicadores: a §10 proíbe ranking de pessoas lá, e é justamente por pessoa que esta seção olha. São leituras diferentes com regras diferentes, e juntá-las quebraria uma das duas.

O enquadramento continua sendo diagnóstico de gargalo, nunca placar: ritmo de bipagem aparece ao lado da taxa de divergência, e a tabela não ordena por "melhor pessoa".

- [ ] **Step 2: `indicadores.ts`**

`src/app/diretor.ts` inteiro vira este módulo, seguindo a mesma regra de transformação da Task 11. O que muda além do formato:

- O `<header>` próprio some — quem desenha topo é o shell.
- `#f-mes` e `#btn-pdf-periodo` viram parte do corpo da seção, num `filtros`.
- O `#bloqueio`/`#conteudo` somem: quem controla acesso é o roteador.
- **As diretrizes do CLAUDE.md §10 continuam valendo por inteiro**: nada operacional, sem ranking de pessoas, e toda métrica comparada com o período anterior. O que muda é o endereço, não o conteúdo.

Apagar `src/app/diretor.ts`.

- [ ] **Step 3: `mapa.ts`**

Hoje `renderMapa` só é chamado dentro da gaveta de uma sessão. Aqui vira seção: `pageHeader` + filtro de período (reaproveitando o mesmo par `#f-de`/`#f-ate` de Conferências, com ids próprios `#m-de`/`#m-ate`) + `renderMapa(leiturasDoPeriodo)`.

`src/lib/mapa.ts` **não é modificado** — o mapa com base cartográfica é fatia 4.

- [ ] **Step 4: `relatorios.ts`**

Reúne as exportações que hoje estão espalhadas: CSV do período (de `conferencias`) e PDF por sessão (de `abrirGaveta`). Nenhum formato novo. Uma lista de sessões do período, cada linha com os dois botões.

- [ ] **Step 5: Ajustar `tests/diretor.test.mjs`**

**Este teste já nasce vermelho, e isso não é regressão sua.** Verificado na Task 2: ele procura `.p-hamburguer`, `.p-lateral`, `.p-item` e `[data-secao]` dentro de `diretor.html`, que não tem nenhum deles — foi escrito à frente da implementação, contra o shell que o painel do gestor ganhou e o do diretor nunca recebeu. Também não está em nenhum script do `package.json`, então nunca rodou no `test:e2e`. Quatro dos sete passos falham.

O teste mede a altura da moldura do painel do diretor no celular. Com o shell único, a moldura passa a ser a mesma do resto — o teste vira uma asserção sobre `/painel/indicadores`: sem rolagem horizontal em 320px e 390px, e altura da barra do topo abaixo de 64px. Renomear o arquivo para `tests/indicadores.test.mjs`, ajustar o comentário do topo (que ainda fala em "painel do diretor") e **registrá-lo no script `test:e2e`** — teste que ninguém roda não protege nada.

- [ ] **Step 6: Rodar e commitar**

```bash
npm run typecheck && npm run build && node tests/indicadores.test.mjs && node tests/rotas.test.mjs
git add -A
git commit -m "o painel do diretor vira a seção Indicadores

A palavra 'diretor' some da interface; a leitura agregada continua inteira —
nada operacional, sem ranking de pessoas, toda métrica comparada no tempo.
Muda o endereço, não o conteúdo.

Desempenho continua ao lado, e separado: ele olha por pessoa, e é exatamente
isso que a §10 proíbe em Indicadores. São duas leituras com regras diferentes;
juntá-las quebraria uma das duas.

Mapa e Relatórios deixam de viver dentro da gaveta de uma sessão e viram seção,
sobre o período filtrado."
```

---

## Task 13: Cadastros e Sincronização

**Files:**
- Create: `src/app/painel/pessoas.ts`, `transportadoras.ts`, `rotas.ts`, `sincronizacao.ts`, `src/app/painel/index.ts`
- Delete: `src/app/gestor.ts`
- Modify: `index.html`

- [ ] **Step 1: Os quatro módulos**

`pintarCadastros` (`gestor.ts:721-824`) hoje pinta as três tabelas de cadastro num bloco só. Ela se divide em três módulos, um por seção, seguindo a regra de transformação da Task 11. A repartição das funções auxiliares:

| Módulo | Recebe |
|---|---|
| `pessoas.ts` | O cartão "Acessos", `avisoUsuario` (`863-870`), `limparFormUsuario` (`871-879`), `entrarEmEdicao` (`880-984`) |
| `transportadoras.ts` | O cartão "Transportadoras" e a parte de `pintarCadastros` que o alimenta |
| `rotas.ts` | O cartão "Códigos de rota", `donoDoCodigo` (`825-831`), `cadastrarRota` (`832-862`) |
| `sincronizacao.ts` | `pintarDispositivos` (`397-413`), `preencherConfigSupabase` (`985-991`), `pintarFila` (`992-1037`) e os botões `#btn-sync`, `#btn-retry`, `#btn-salvar-sup`, `#btn-testar-sup` |

`preencherSelects` (`695-720`) alimenta o `<select>` de transportadora do formulário de rota: vai para `rotas.ts`.

`avisoUsuario` vira `toast()` de `src/lib/ui/folha.js` — o aviso deixa de empurrar a tela e some sozinho.

`rotas.ts` precisa manter o aviso de que trocar a transportadora dona de um código vale **da próxima bipagem em diante**: leitura e sessão já gravadas carregam cópia congelada do dono, e relatório de ontem não muda. O CLAUDE.md §9 exige que a tela diga isso.

- [ ] **Step 2: `src/app/painel/index.ts` definitivo**

Substitui o provisório da Task 3:

```ts
// index.ts — a porta do painel: carrega os dados uma vez, monta o shell e
// entrega cada seção ao seu módulo.

import * as db from '../../lib/db.js';
import * as sync from '../../lib/sync.js';
import { montarShell, type ItemMenu, type Shell } from '../../lib/shell/index.js';
import { $ } from '../../lib/util.js';
import { baseVazia, type Base, type Contexto, type Modulo } from './contexto.js';
import type { Dispositivo, Usuario } from '../../types.js';
import type { Tela } from '../../lib/router.js';

import { montar as inicio } from './inicio.js';
import { montar as divergencias } from './divergencias.js';
// ... os outros dez

export const MENU: ItemMenu[] = [ /* os 13 itens da Task 8, Step 6 */ ];

const MODULOS: Record<string, Montar> = {
  inicio, divergencias, incompletos, conferencias, ocorrencias,
  desempenho, indicadores, mapa, relatorios, pessoas, transportadoras, rotas,
  sincronizacao
};
```

`MODULOS` precisa ter **exatamente** as mesmas chaves que `SECOES` de `router.ts`. Uma seção sem módulo produz uma região vazia sem erro nenhum — o pior tipo de defeito, porque a tela abre e não diz nada. Acrescentar esta asserção logo abaixo:

```ts
// Falha no boot, alto, em vez de deixar uma seção abrir vazia em silêncio.
for (const s of SECOES) {
  if (!MODULOS[s]) throw new Error(`seção sem módulo: ${s}`);
}
```

`montar(secao, amb)` carrega os dados, monta o shell na primeira vez, instancia o módulo da seção pedida **sob demanda** (guardando no mapa `secoes`), e chama `shell.mostrar(secao)`.

Apagar `src/app/gestor.ts`.

- [ ] **Step 3: Rodar e commitar**

```bash
npm run typecheck && npm run build && npm run test:e2e
git add -A
git commit -m "cadastros e sincronização viram módulos, e gestor.ts acaba

Eram 1040 linhas fazendo boot, login, carga de dados, tabelas, gráficos e
cadastro. Agora são treze módulos com um contrato só: montar(raiz, ctx) devolve
{ pintar }, e quem carrega dado é a porta do painel — nenhuma seção abre o
IndexedDB por conta própria."
```

---

## Task 14: A operação

**Files:**
- Modify: `index.html`, `src/app/operador.ts`, `src/styles/app.css`
- Test: `tests/operacao.test.mjs` (criar)

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/operacao.test.mjs`:

```js
// A barra do topo da bipagem tinha flex-wrap e quatro chips: quebrava em duas
// linhas e empurrava o conteúdo para fora de #view-bipagem, que não rola de
// propósito. O que sai da tela some.
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

const bipando = async (viewport) => {
  const ctx = await navegador.newContext({
    viewport, locale: 'pt-BR', permissions: ['camera']
  });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, '/entrar');
  await entrar(p, 'ana');
  await p.waitForSelector('#view-grupo:not([hidden])', { timeout: 8000 });
  await p.click('.grupo-btn >> nth=0');
  await p.waitForSelector('#view-bipagem:not([hidden])', { timeout: 8000 });
  return { ctx, p };
};

for (const vp of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  await passo(`a barra do topo cabe em uma linha em ${vp.width}px`, async () => {
    const { ctx, p } = await bipando(vp);
    const linhas = await p.evaluate(() => {
      const barra = document.querySelector('.bip-topo');
      const filhos = [...barra.children].filter((n) => n.offsetParent !== null);
      return new Set(filhos.map((n) => n.getBoundingClientRect().top)).size;
    });
    if (linhas > 1) throw new Error(`a barra ocupa ${linhas} linhas`);
    await ctx.close();
  });

  await passo(`a bipagem não corta conteúdo em ${vp.width}px`, async () => {
    const { ctx, p } = await bipando(vp);
    const sobra = await p.evaluate(() => {
      const v = document.querySelector('#view-bipagem');
      return v.scrollHeight - v.clientHeight;
    });
    if (sobra > 1) throw new Error(`${sobra}px de conteúdo fora da tela`);
    await ctx.close();
  });
}

await passo('a marca não ocupa espaço na tela de trabalho', async () => {
  const { ctx, p } = await bipando({ width: 390, height: 844 });
  if (await p.isVisible('.bip-topo .bip-marca')) throw new Error('o símbolo continua na barra');
  if (await p.isVisible('.bip-topo #btn-painel-bip')) throw new Error('o botão Painel continua na barra');
  await ctx.close();
});

await passo('o estado da sincronização aparece em texto, não só em cor', async () => {
  const { ctx, p } = await bipando({ width: 390, height: 844 });
  const t = (await p.textContent('#chip-sync')).trim();
  if (t.length < 4) throw new Error(`o chip mostra apenas "${t}"`);
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nOPERACAO_OK');
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm run build && node tests/operacao.test.mjs
```

Esperado: `FALHA` nos passos da barra — hoje ela tem quatro chips e `flex-wrap: wrap`.

- [ ] **Step 3: A barra nova**

Em `index.html`, substituir o `<div class="bip-topo">` inteiro por:

```html
    <div class="bip-topo">
      <div class="bip-carga">
        <strong id="bip-grupo">—</strong>
        <span id="bip-quem"></span>
      </div>
      <span class="bip-espaco"></span>
      <span id="chip-sync" class="chip chip-sync">—</span>
      <button id="btn-tocha" class="bip-icone" hidden aria-pressed="false" aria-label="Luz">☀</button>
      <span id="chip-geo" class="bip-icone bip-geo" role="img" aria-label="GPS">◎</span>
    </div>
```

`#bip-rotas` sai da barra: a lista de rotas da carga não é informação de ritmo, e é ela que fazia a linha crescer. Ela continua visível na tela de escolha da transportadora, que é onde a decisão acontece.

Em `src/app/operador.ts`:
- Trocar `bipRotas: $('#bip-rotas')` por `bipQuem: $('#bip-quem')`, e onde hoje escreve as rotas, escrever `usuario.nome`.
- `chipGeo` deixa de receber texto e passa a receber só a classe de tom; o texto vira `title` e `aria-label`, para o leitor de tela continuar tendo a informação.
- `#btn-painel-bip` é removido do HTML e do objeto `el`; o gestor volta ao painel pela folha de ações (`#btn-oc-entrega` ganha vizinhança) ou pelo botão da tela de transportadora, que continua existindo.

Em `src/styles/app.css`, na regra `.bip-topo-acoes`, **apagar** `flex-wrap: wrap` e substituir o bloco por:

```css
.bip-topo {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-top));
  background: var(--superficie); border-bottom: 1px solid var(--linha);
  flex: none; min-width: 0;
}
.bip-carga { min-width: 0; }
.bip-carga strong { display: block; font-size: var(--t-corpo); color: var(--tinta);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bip-carga span { font-size: var(--t-label); color: var(--tinta-2); }
.bip-espaco { flex: 1; }
.bip-icone {
  flex: none; width: 34px; height: 34px; display: grid; place-items: center;
  border: 1px solid var(--linha); border-radius: 9px; background: var(--superficie);
  font-size: 15px; color: var(--tinta-2); cursor: pointer;
}
```

- [ ] **Step 4: O login enxuto**

Em `index.html`, substituir o `<div class="aviso-lgpd">` por:

```html
      <div class="aviso-lgpd">
        <p>
          Com a conferência aberta, o app registra a <strong>localização</strong> de
          cada volume bipado, para comprovar onde e quando a carga foi entregue.
        </p>
        <details>
          <summary>Como isso funciona</summary>
          <p>
            O registro começa ao abrir a conferência e para no encerramento —
            nunca em segundo plano. A posição é gravada junto de cada volume e de
            cada ocorrência, com a hora. A finalidade é comprovar onde e quando a
            carga foi conferida e entregue à transportadora.
          </p>
        </details>
      </div>
```

A ciência prévia continua na tela antes de entrar, que é o que o CLAUDE.md §8 exige. O que deixa de existir é o paredão que a pessoa aprende a ignorar.

- [ ] **Step 5: Rodar e commitar**

```bash
npm run typecheck && npm run build && node tests/operacao.test.mjs && node tests/e2e.test.mjs
```

Esperado: `OPERACAO_OK` e o e2e da bipagem verde.

Registrar `node tests/operacao.test.mjs && ` no script `test:e2e` do `package.json`.

```bash
git add -A
git commit -m "a barra da bipagem cabe em uma linha, e diz o que importa

Eram quatro chips com flex-wrap: a barra quebrava em duas linhas e empurrava o
conteúdo para fora de #view-bipagem, que não rola de propósito. O que sai da
tela some.

Sem símbolo e sem botão Painel na tela de trabalho: quem está bipando já sabe em
que app está, e cada pixel gasto com logo é pixel que não é câmera. Fica o que a
pessoa erra se esquecer — qual carga está conferindo — e o estado da
sincronização em texto, não em bolinha.

O aviso de localização encolhe para uma frase com o detalhe atrás de <details>.
A ciência prévia continua antes de entrar; deixa de ser paredão."
```

---

## Task 15: CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: §3 e §5 — as rotas**

Em §5, substituir o diagrama de fluxo por um que mostre as rotas reais, e acrescentar a regra de entrada em quatro linhas (a mesma de `router.ts`).

- [ ] **Step 2: §9 — o painel**

- "O painel tem menu lateral" passa a "O painel tem menu lateral no desktop e barra inferior no celular", com a justificativa (zona do polegar; o badge visível sem abrir nada).
- Os grupos e os 13 itens, com a correspondência explícita entre as três perguntas que a §9 já faz e as seções que as respondem: "tem algo errado agora?" → Início, Divergências, Pedidos incompletos, Ocorrências; "o que aconteceu?" → Conferências, Mapa, Relatórios; "como está o desempenho?" → Desempenho.
- "Painel do gestor" vira "Painel".
- A trava da divergência passa a citar a aba `Alertas` além do item da lateral.

- [ ] **Step 3: §10 — o diretor**

Trocar o título "Painel do diretor" por "Indicadores — a leitura agregada". Trocar as frases que descrevem uma tela separada. **Manter intactas** as diretrizes: nada operacional, sem ranking de pessoas, toda métrica comparada no tempo, exportação em PDF do período.

- [ ] **Step 4: §11 — as regras novas**

Acrescentar três parágrafos:

- **Duas escalas tipográficas**, com a tabela e o motivo (a bipagem não encolhe).
- **Paleta por papel**: verde só em marca, ativo, ação principal e sucesso; superfície nunca verde.
- **Cor nunca sozinha**: todo status leva texto, e status de leitura leva forma.

Acrescentar também: componente novo nasce em `src/lib/ui/`; tela nenhuma monta tabela, estado vazio ou alerta por conta própria.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md acompanha a repaginação

O arquivo descrevia gaveta no celular, painel do diretor como tela separada e
uma escala tipográfica só. As três coisas deixaram de ser verdade."
```

---

## Task 16: Verificação final

**Files:** nenhum a modificar, a menos que algo falhe.

- [ ] **Step 1: A bateria inteira**

```bash
npm test && npm run test:e2e
```

Esperado, todos presentes na saída: `ROUTER_OK`, `UI_OK`, `ROTAS_OK`, `SHELL_OK`, `OPERACAO_OK`, `SANDRO_OK`, e nenhum `FALHA`.

- [ ] **Step 2: Conferir que o caminho crítico não foi tocado**

```bash
git diff --stat 072e70c..HEAD -- src/lib/db.ts src/lib/sync.ts src/lib/auth.ts \
  src/lib/scanner.ts src/lib/decoder.worker.ts src/lib/geo.ts src/lib/model.ts \
  src/lib/supabase.ts src/lib/relatorio.ts src/lib/graficos.ts src/lib/feedback.ts src/lib/marca.ts
```

Esperado: **saída vazia**. Qualquer linha aqui é uma violação da §9 do spec e precisa ser justificada ou revertida.

- [ ] **Step 3: Sem `.html` sobrando**

```bash
grep -rn "gestor\.html\|diretor\.html\|#bipar" src/ index.html tests/ --include="*.ts" --include="*.html" --include="*.mjs" | grep -v "ANTIGOS"
```

Esperado: nada, além do mapa `ANTIGOS` de `main.ts`, que é intencional.

- [ ] **Step 4: Capturar as telas novas**

```bash
node tests/e2e.test.mjs
```

O teste já grava em `tests/saida/`. Abrir `tela-gestor.png` e `tela-bipagem.png` e conferir à vista: uma faixa vermelha só, nenhum cabeçalho verde alto, nenhum cartão para dizer que não há dados, nenhum `(s)` de plural.

- [ ] **Step 5: Commit final**

```bash
git commit --allow-empty -m "fatia 1 da repaginação concluída

App único com rotas sem .html, shell com lateral no desktop e barra inferior no
celular, biblioteca de componentes tipada e linguagem visual densa.

Nenhum arquivo do caminho crítico da conferência foi tocado: db, sync, auth,
scanner, decoder.worker, geo, model, supabase, relatorio, graficos, feedback e
marca saem desta fatia com zero linhas de diferença.

Próxima fatia: dashboard e drill-down (itens 6, 8, 9, 10, 17 do pedido)."
```
