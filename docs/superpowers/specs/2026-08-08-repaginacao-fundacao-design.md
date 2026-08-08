# Repaginação do LOGDIS — fatia 1: a fundação

Data: 2026-08-08
Estado: aprovado (aguardando revisão do spec escrito)

Cobre os itens **1, 2, 3, 4, 5, 18, 19 e 20** do pedido de repaginação de UX/UI. As demais
fatias estão listadas na §11.

**Substitui** `2026-08-08-painel-gestor-menu-lateral-design.md` no que diz respeito a rotas,
menu, painel do diretor e navegação no celular. O que aquele spec decidiu sobre cadastro
editável, nome único de transportadora e gráficos continua valendo e migra para as fatias
seguintes. O plano `2026-08-08-painel-gestor-menu-lateral.md` está **obsoleto**: foi escrito
antes da revisão 2 daquele spec e pressupõe três páginas com navegação por hash.

---

## 1. O problema

O painel foi para produção e o veredito foi que não parece um sistema profissional. Olhando
o código e as capturas em `tests/saida/`, a queixa se decompõe em coisas verificáveis.

**Três documentos independentes.** `index.html`, `gestor.html` e `diretor.html` são páginas
separadas. Toda troca é recarga completa: o estado morre e cada página redescobre quem está
logado. É a origem direta de duas classes de defeito — a marca `#bipar` na URL, que existe só
porque a recarga perde o clique, e o "não desloga" de `src/app/gestor.ts:191`, onde
`auth.sair()` é seguido de `location.reload()` torcendo para o boot da outra página decidir
certo. Também obriga a manter três formulários de login e três molduras duplicadas.

**URL com `.html`.** Consequência da mesma escolha.

**Vermelho repetido dilui o alarme.** Na seção Hoje há três blocos vermelhos seguidos dizendo
quase a mesma coisa: `#atencao`, `#faixa-divergencia` e a tabela dos volumes divergentes, cada
um com moldura completa. Quem aprende a passar por um aviso redundante passa também pelo aviso
que era a única notícia do problema.

**Cromo demais, hierarquia de menos.** Toda caixa tem borda completa. O título da seção é uma
pergunta em caixa alta ("TEM ALGO ERRADO AGORA?"). Um cartão inteiro para dizer "Nenhuma
conferência aberta agora." E texto de sistema onde devia haver texto de produto: `1 volume(s)`,
`9 só no aparelho`.

**O mesmo dado com quatro nomes.** O estado da sincronização aparece como `Fila`
(`src/lib/painel-shell.ts:80`), `Fila local` (`index.html:77`), `N no aparelho`
(`src/app/operador.ts:181`) e `N só no aparelho` (`src/app/gestor.ts:162`). Nenhum deles diz o
que são os N.

**Celular tratado como desktop estreito.** O painel só tem gaveta atrás de um hambúrguer no
canto superior esquerdo — o pior ponto de alcance de um celular grande — e todo destino custa
dois toques.

**Dois arquivos fazem tudo.** `src/app/gestor.ts` tem 1040 linhas cuidando de boot, login,
carga de dados, tabelas, gráficos e cadastro. `src/app/operador.ts` tem 850. Não há onde um
componente comum morar, então cada tela reinventa o seu.

---

## 2. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Arquitetura | **App único** com rotas por History API | Acaba a recarga entre telas, a marca `#bipar` e a classe de bug do logout |
| URL | Sem `.html`: `/entrar`, `/bipagem`, `/painel/...` | Pedido explícito e consequência natural do app único |
| `.html` antigos | Redirecionam `301` para a rota nova | O atalho salvo na tela do celular da doca continua abrindo |
| Hospedagem | **Vercel/Netlify**, na raiz de um domínio | Confirmado com o usuário. Rewrite trivial e HTTPS incluído, que a câmera exige |
| Painel do diretor | Vira a seção **Indicadores**, dentro do painel único | A palavra "diretor" some da interface; a leitura agregada continua existindo |
| Menu | 12 itens em 4 grupos (§4.2) | `Divergências` e `Pedidos incompletos` ganham destino próprio: é para onde o drill-down leva |
| Celular do painel | **Barra inferior** de 5 abas + folha "Mais" | Zona do polegar; e o badge da divergência fica visível sem abrir nada |
| Celular da operação | **Nenhuma navegação** | Quem está com caixa na mão não navega, bipa |
| Linguagem visual | **Linhas, não caixas** — seção é título + régua | Densidade de sistema de gestão; menos cromo por bloco |
| Escala tipográfica | **Duas**, por modo (§5.2) | Encolher a fonte da bipagem quebraria a conferência |
| Componentes | Funções tipadas que devolvem HTML, em `src/lib/ui/` | O compilador cobra o uso certo, e testam em Node sem navegador |
| Framework | **Nenhum novo** | O app precisa abrir offline; e adotar Preact/Lit seria reescrita ampla no caminho crítico |

---

## 3. Rotas

```
/                          redireciona pela regra de entrada
/entrar                    login — o único do sistema
/bipagem                   escolher transportadora → bipar
/relatorio                 relatório da conferência encerrada
/painel                    Início
/painel/divergencias       destino do drill-down
/painel/incompletos        destino do drill-down
/painel/conferencias
/painel/ocorrencias
/painel/indicadores        o ex-painel do diretor
/painel/mapa
/painel/relatorios
/painel/pessoas
/painel/transportadoras
/painel/rotas
/painel/sincronizacao
```

**Regra de entrada, única e nesta ordem:**

1. Sem usuário logado → `/entrar`.
2. Sessão `ABERTA` do usuário → `/bipagem`, retomando-a. **Ganha do papel** — ninguém é tirado
   do meio de uma carga.
3. `gestor: true` → `/painel`.
4. Caso contrário → `/bipagem`.

Rota de painel acessada por quem não é gestor redireciona para `/bipagem`. Rota desconhecida
cai na regra de entrada, não em 404: o app sempre sabe para onde mandar a pessoa. Nunca existe
"acesso negado" numa tela sem porta.

**Sair** limpa a sessão e navega para `/entrar` pelo roteador. Nada de `location.reload()`.

### 3.1 Hospedagem

`vercel.json` (equivalente `_redirects` no Netlify) com, nesta ordem:

1. Redirect permanente `301`: `/gestor.html` → `/painel`, `/diretor.html` → `/painel/indicadores`,
   `/index.html` → `/`.
2. Rewrite de todo o resto para `/index.html`, para o servidor entregar o app em qualquer rota.

Sem o item 2, abrir `/painel` direto — ou dar F5 nela — dá 404. E o gestor dá F5.

Em `vite.config.ts`: entrada única (some `gestor` e `diretor` de `rollupOptions.input`),
`base: '/'` em vez de `'./'`, e o `navigateFallbackDenylist` do PWA sai — ele protegia as duas
páginas que deixam de existir. `navigateFallback: 'index.html'` continua, e agora vale para
todas as rotas.

**Por que `base` precisa mudar:** com `base: './'`, em `/painel/conferencias` o navegador
resolve `./assets/app.js` como `/painel/assets/app.js` e o app não carrega. Caminho relativo é
incompatível com rota de mais de um nível.

---

## 4. Shell — um módulo, dois modos

`src/lib/shell/` desenha a moldura. Não conhece regra de negócio e não toca no IndexedDB.

Modo **`painel`** e modo **`operacao`** compartilham tokens, cabeçalho de página e o chip de
sincronização. Divergem só na navegação — e é essa divergência que faz o item 2 e o item 3
conviverem sem virar dois produtos.

### 4.1 Formas

| | Desktop (≥1024px) | Celular (<1024px) |
|---|---|---|
| **Painel** | Lateral fixa de 248px com 4 grupos e badge no item; cabeçalho de página; conteúdo em largura total | Topo compacto; conteúdo; **barra inferior** com 5 abas; "Mais" abre folha com os 8 itens restantes |
| **Operação** | Mesma tela do celular, centralizada com largura máxima | Topo de uma linha; sem navegação nenhuma |

Barra inferior: **Início · Alertas · Conferências · Mapa · Mais**. `Alertas` leva a
`/painel/divergencias` e carrega o badge.

`env(safe-area-inset-*)` em topo e barra inferior — em `display: standalone` não há barra do
navegador para absorver o entalhe.

### 4.2 Itens do menu

| Grupo | Item | Rota | Já existe como |
|---|---|---|---|
| Operação | Início | `/painel` | `pintarAgora`, `pintarAtencao` |
| Operação | Divergências | `/painel/divergencias` | `#faixa-divergencia` |
| Operação | Pedidos incompletos | `/painel/incompletos` | `#incompletos-hoje` |
| Operação | Conferências | `/painel/conferencias` | `pintarHistorico`, `abrirGaveta` |
| Operação | Ocorrências | `/painel/ocorrencias` | `pintarOcorrencias`, `pintarRecorrentes` |
| Análise | Indicadores | `/painel/indicadores` | `src/app/diretor.ts` inteiro |
| Análise | Mapa | `/painel/mapa` | `renderMapa` |
| Análise | Relatórios | `/painel/relatorios` | exportações CSV/PDF existentes |
| Cadastros | Pessoas | `/painel/pessoas` | `pintarCadastros` |
| Cadastros | Transportadoras | `/painel/transportadoras` | `pintarCadastros` |
| Cadastros | Códigos de rota | `/painel/rotas` | `pintarCadastros` |
| Sistema | Sincronização | `/painel/sincronizacao` | `pintarFila`, `pintarDispositivos` |

**Nenhum item de menu é funcionalidade nova.** Todos os doze têm código escrito hoje. Esta
fatia muda onde eles moram, como se navega até eles e como se parecem. É o que a torna
executável sem risco para bipagem, sincronização e offline.

Dois deles mudam de lugar e por isso merecem ser explícitos, para nenhum item de menu levar a
uma tela vazia:

- **Mapa** hoje só é desenhado dentro da gaveta de detalhe de uma sessão. Na fatia 1 vira
  seção, mostrando `renderMapa` sobre as leituras do período filtrado. O mapa com base
  cartográfica é fatia 4 (§12).
- **Relatórios** reúne num lugar só as exportações que hoje estão espalhadas: PDF por sessão e
  CSV do período. Nenhum formato novo.

Rodapé da lateral (e da folha "Mais" no celular): nome do usuário, **Abrir bipagem** e **Sair**.

### 4.3 A divergência não se esconde atrás do menu

Duas travas, válidas nos dois tamanhos:

1. **Badge** com a contagem de `ROTA_DIVERGENTE` do dia no item `Divergências` da lateral e na
   aba `Alertas` da barra inferior. Visível de qualquer seção, sem abrir nada.
2. **Faixa vermelha fixa** acima do conteúdo de todas as seções enquanto houver divergência no
   dia — inclusive em Cadastros e Sincronização. Silenciada apenas dentro de
   `/painel/divergencias`, onde seria redundante com o conteúdo logo abaixo.

Sem divergência, badge e faixa somem. Alarme que toca sempre deixa de ser alarme.

---

## 5. Linguagem visual

### 5.1 Linhas, não caixas

Seção é **título pequeno em caixa alta + régua horizontal + conteúdo na largura toda**. Tabela
sem moldura própria. Cartão branco fica reservado ao que precisa mesmo se destacar do fluxo.

No celular, onde os blocos empilham e ficam colados, a separação vem de **espaçamento maior e
régua de largura total** — não de virar cartão. Um padrão só, como pede o item 4.

Alerta é **faixa lateral de 4px + fundo tênue**, nunca moldura de quatro lados. Um por tela.

Estado vazio é **uma linha de texto** no lugar onde o conteúdo estaria. Nunca um cartão.
"Nenhuma conferência aberta.", não "Nenhuma conferência aberta agora." dentro de uma caixa
com título.

### 5.2 Duas escalas tipográficas

Esta é a única parte em que o spec diverge da letra do pedido, conscientemente. "Reduzir
tamanhos exagerados no mobile" vale para o painel. **Não vale para a bipagem**: o CLAUDE.md §11
exige legibilidade a um braço de distância, com luva, sob luz de galpão, e encolher a fonte
quebraria a conferência — que é a prioridade número um do produto.

Uma escala com dois valores, trocados por `body.painel` / `body.operacao`:

| Papel | Painel (desktop / celular) | Operação |
|---|---|---|
| Título de página | 20 / 18px · 700 | 22px · 700 |
| Título de seção | 11px · 700 · caixa alta · `.08em` | 15px · 700 |
| Indicador | 26 / 22px · 700 · tabular-nums | 34px · 800 |
| Texto principal | 14 / 15px | 17px |
| Texto secundário | 12.5px | 15px |
| Label | 11px · 600 · caixa alta | 14px · 600 |

Alvo de toque: **40px no painel**, **56px na operação** (`--toque`, regra atual mantida).

Campos de formulário mantêm no mínimo 16px de fonte nos dois modos — abaixo disso o iOS dá
zoom automático ao focar.

### 5.3 Paleta por papel

O verde sai das superfícies e fica só onde significa algo.

| Cor | Papel |
|---|---|
| Verde (`--logdis-*`) | marca, item ativo, ação principal, sucesso |
| Vermelho (`--div`) | divergência, erro |
| Laranja (`--dup`, `--mapa`) | atenção, pendência |
| Cinza claro (`--fundo`) | fundo da página |
| Branco (`--fundo-2`) | superfície |

Nenhum cabeçalho verde alto. A barra do topo é uma faixa fina, e no modo operação ela é branca.

**Cor nunca sozinha.** Todo status carrega texto. Status de leitura carrega também forma
própria — verde/vermelho é o pior par para daltonismo, e `src/lib/mapa.ts` já resolve isso com
círculo, triângulo, quadrado e losango. Isso passa a ser regra da biblioteca, não detalhe de
um arquivo.

### 5.4 Texto de produto, não de sistema

- `1 volume(s)` → `1 volume` / `3 volumes`. Plural resolvido, nunca `(s)`.
- `9 só no aparelho` → `8 leituras pendentes`.
- `Tem algo errado agora?` como título → título é `Início`; a pergunta vira o nome do bloco,
  `Precisa de atenção`.
- Nunca `IndexedDB`, `fila`, `queue`, `payload`, `sync` na tela.

---

## 6. A barra do topo da operação

Hoje `.bip-topo-acoes` tem `flex-wrap: wrap` e quatro chips. A barra quebra em duas linhas e
empurra o conteúdo para fora de `#view-bipagem`, que tem `overflow: hidden` de propósito — o
que sai da tela some.

Nova barra, **uma linha, sem chance de quebrar**:

```
LOGDIS · FNOR          🟢 Sincronizado   ☀
Ana Paula
```

- **Sem símbolo da marca e sem botão "Painel"** na tela de trabalho. Quem está bipando já sabe
  em que app está; cada pixel gasto com logo é pixel que não é câmera. A identidade se
  estabelece no login e na seleção de transportadora.
- Fica o que a pessoa erra se esquecer: **qual carga está conferindo** e quem está logado.
- **Estado da sincronização em texto**, não em bolinha.
- Luz e GPS viram ícone. `Painel`, para quem é gestor, migra para a folha de ações.

O restante da tela de bipagem — câmera, banner de status, contadores, lista, barra inferior de
ações — mantém posição e comportamento. Nada de confirmação por leitura, nada de passo novo.

---

## 7. Login

Um formulário só, em `/entrar`. Os três de hoje (`index.html`, `gestor.html`, `diretor.html`)
viram um.

O aviso de LGPD encolhe de cinco linhas de texto corrido para uma frase com o essencial —
**o que é registrado, e para quê** — mais um "Como isso funciona ›" que abre o detalhe completo.

A ciência prévia continua na tela antes de entrar, que é o que o CLAUDE.md §8 exige. O que muda
é deixar de ser um paredão que a pessoa aprende a ignorar.

---

## 8. Biblioteca de componentes

`src/lib/ui/`, sem framework.

**Funções puras que devolvem HTML.** Entra dado tipado, sai string. Testáveis com
`node --experimental-strip-types`, sem navegador — o mesmo mecanismo que `tests/model.test.ts`
já usa.

`pageHeader` · `secao` · `tabela` · `kpis` · `alerta` · `badge` · `status` · `vazio` ·
`esqueleto` · `filtros` · `botao` · `campo` · `selecao`

**Classes com ciclo de vida**, para o que tem comportamento:

`Lateral` · `BarraInferior` · `Folha` (bottom sheet) · `Modal` · `Toast`

`tabela()` recebe a mesma chamada nos dois tamanhos e decide sozinha: tabela densa no desktop,
linhas empilhadas no celular. É isso que impede a divergência entre as duas telas de nascer de
novo — hoje ela nasce porque cada função monta o seu `innerHTML` do zero.

Toda função escapa o que vem do cadastro. `esc()` já existe em `src/lib/util.ts`.

### 8.1 Estado da sincronização: uma função, cinco estados

```
🟢 Sincronizado
🔵 Sincronizando
🟠 Offline
🟠 8 leituras pendentes
🔴 Falha ao sincronizar
```

Uma função `estadoSync()` devolve `{ tom, texto, icone }`, e é a única fonte desse texto no
sistema inteiro. Substitui as quatro strings espalhadas hoje.

---

## 9. Arquivos

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `src/app/main.ts` | Entrada única: boot, regra de entrada, roteador |
| `src/lib/router.ts` | History API, navegação sem recarga, guarda de papel |
| `src/lib/shell/` | `index.ts`, `topo.ts`, `lateral.ts`, `barra-inferior.ts` |
| `src/lib/ui/` | Um arquivo por família de componente |
| `src/styles/tokens.css` | Tokens e as duas escalas |
| `vercel.json` | Redirects e rewrite |

**Dividir**

- `src/app/gestor.ts` (1040 linhas) → `src/app/painel/`, um módulo por seção com o contrato
  `montar(raiz, ctx) → { pintar }`. `ctx` traz os dados já carregados: nenhuma seção abre o
  IndexedDB por conta própria, senão a mesma tela lê o banco doze vezes a cada ciclo.
- `src/app/diretor.ts` → `src/app/painel/indicadores.ts`
- `src/app/operador.ts` (850 linhas) → `src/app/operacao/`: login, transportadora, bipagem,
  relatório

**Apagar**

`gestor.html` · `diretor.html` · `src/lib/painel-menu.ts` — este último existe apenas para
ligar duas páginas que deixam de existir.

`src/lib/painel-shell.ts` é **renomeado e reescrito** como `src/lib/shell/`. O que ele já
resolve bem — badge, faixa de alerta, a regra de silenciar a faixa onde ela é redundante,
fechar a gaveta ao escolher — é preservado. O que muda é a navegação por hash, que vira
roteador, e o ganho do modo `operacao` e da barra inferior.

**Não tocar**

`db.ts` · `sync.ts` · `auth.ts` · `scanner.ts` · `decoder.worker.ts` · `geo.ts` · `model.ts` ·
`supabase.ts` · `relatorio.ts` · `graficos.ts` · `feedback.ts`

Nenhum arquivo do caminho crítico da conferência entra nesta fatia. Offline-first, IndexedDB,
fila de sincronização, leitura de QR e geolocalização saem intactos — é a garantia pedida no
item 22.

**Atenção ao `tsconfig.json`:** `noUnusedLocals` e `noUnusedParameters` estão ligados, e `$()`
lança quando o elemento não existe. Apagar markup antes de mover a função que o usa quebra o
typecheck e o boot no mesmo commit. Mover markup e função sempre juntos.

---

## 10. Execução e testes

### 10.1 Ordem

1. **Roteador e app único, sem mudar um pixel.** Se os e2e passam aqui, a arquitetura está
   certa e todo o resto é aparência. É o passo que carrega o risco; isolá-lo é o que permite
   confiar nos seguintes.
2. Tokens e as duas escalas tipográficas.
3. `src/lib/ui/` com testes de unidade.
4. Shell: topo, lateral, barra inferior, folha.
5. Seções do painel, uma por commit. O painel funciona o tempo todo.
6. Operação: login, transportadora, bipagem.

### 10.2 Testes

Os seis e2e Playwright que já existem — `e2e`, `e2e-offline`, `sync-fila`, `pdf`,
`login-sandro`, `painel-shell` — **precisam passar com mudança apenas de URL**, sem mudança de
comportamento esperado. Esse é o contrato de que nada quebrou.

Entram:

- `tests/ui.test.ts` — unidade das funções de `src/lib/ui/`: escape, estado vazio, plural,
  os cinco estados de sincronização, status com texto e forma.
- `tests/router.test.ts` — regra de entrada nas quatro ordens, rota desconhecida, guarda de
  papel.
- No e2e: F5 em rota profunda (`/painel/rotas`) devolve a mesma seção; barra inferior navega e
  a folha "Mais" fecha ao escolher; badge de divergência visível em **todas** as seções;
  `/gestor.html` redireciona para `/painel`; zero rolagem horizontal em 390px de largura.

---

## 11. CLAUDE.md — o que muda

- **§3 e §5:** as rotas novas e o app único.
- **§9:** grupos e itens do menu; barra inferior no celular em vez de gaveta; "Painel do
  gestor" passa a ser "Painel".
- **§10:** deixa de descrever uma tela separada. Vira a seção Indicadores, com todas as
  diretrizes preservadas — nada operacional, sem ranking de pessoas, toda métrica comparada no
  tempo.
- **§11:** as duas escalas tipográficas, a paleta por papel e a regra "cor nunca sozinha".

---

## 12. Fora desta fatia

| Fatia | Itens do pedido |
|---|---|
| 2 — Dashboard e drill-down | 6, 8, 9, 10, 17 |
| 3 — Operador | 12, 13, 14 |
| 4 — Tabelas, filtros e mapa | 15, 16 |
| 5 — Revisão Nielsen | 21 |

Três pontos do pedido não têm resposta hoje e ficam registrados para não se perderem:

1. **Leaflet + OpenStreetMap (item 16).** Tile precisa de rede, e o painel abre offline na
   doca. `src/lib/mapa.ts` evita base cartográfica de propósito. Proposta para a fatia 4: tiles
   quando houver rede, com o SVG relativo de hoje como fallback. Decisão adiada, não tomada.
2. **Busca por Cliente e CEP (item 15).** Esses campos não existem no modelo — o QR tem quatro:
   `codigoVolume`, `rota`, `volume`, `pedido`. A busca alcança pedido, código de volume, rota,
   transportadora e pessoa. Cliente e CEP dependem da importação de manifesto, que é v2 no
   roadmap (CLAUDE.md §12). Pela mesma razão, "destinos", "volumes por região" e "concentração
   de pedidos" no mapa não são deriváveis: o app sabe onde a caixa **foi bipada**, não para
   onde ela vai.
3. **`[BIPAR CAIXA]` (item 13).** Do jeito desenhado é um toque por caixa; a câmera hoje lê
   contínuo, sem toque nenhum. O desenho seria mais lento que o comportamento atual. Tratado
   na fatia 3.
