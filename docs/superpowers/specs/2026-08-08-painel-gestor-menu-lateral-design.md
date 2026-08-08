# Painel do gestor — app único, menu lateral, gráficos e parametrização

Data: 2026-08-08
Estado: aprovado. **Revisão 2** — a arquitetura mudou de três páginas para app único depois que o painel foi visto em produção.

## 1. O problema

### 1.1 O que motivou a revisão

O painel foi aberto em produção (`/gestor.html`) e o veredito foi: mal feito, bagunçado, sem menu, URL com `.html` não parece sistema profissional, a bipagem estoura a tela, e o logout não funciona direito.

Parte disso é obra não feita — menu e gráficos são o resto deste spec. Mas duas queixas apontam para a **arquitetura**, não para o acabamento:

**Três páginas separadas.** `index.html`, `gestor.html` e `diretor.html` são documentos independentes. Toda troca é recarga completa: o estado morre, o boot recomeça e cada página precisa redescobrir quem está logado e para onde mandar a pessoa. Foi isso que obrigou a marca `#bipar` na URL para o gestor conseguir sair do painel e ir bipar — a recarga perde o clique, e só a URL atravessa. É também a origem da classe de bug do "não desloga": sair é `localStorage.removeItem` seguido de `location.reload()`, torcendo para o boot da outra página decidir certo.

**URL com `.html`.** É consequência da mesma escolha, e o usuário está certo: sistema não expõe nome de arquivo.

### 1.2 O que já estava errado antes

**O painel é uma rolagem infinita sem gráfico e sem celular.** `gestor.html` empilha cinco seções numeradas numa coluna só. Não há um gráfico sequer — gráficos existem apenas no painel do diretor (`src/lib/graficos.ts`, usado só por `src/app/diretor.ts`). O `@media (max-width: 720px)` de `painel.css` encolhe padding e nada mais: no celular as tabelas densas viram rolagem horizontal.

**Não dá para consertar o cadastro pelo painel.** O cadastro de transportadora não valida nome repetido, embora o CLAUDE.md declare o nome único — é o que produziu duas transportadoras "LOGDIS" na base. E não existe editar transportadora nem editar código de rota: só criar e desativar. Sem editar, a duplicata não tem conserto pela tela.

**A bipagem estoura em aparelho pequeno.** `#view-bipagem` tem `overflow: hidden` de propósito — câmera, resultado e contadores precisam ficar sempre no mesmo lugar, senão a pessoa perde o ritmo procurando o que mudou. Mas a `.bip-topo-acoes` tem `flex-wrap: wrap`, e cada chip novo na barra do topo a faz quebrar em mais uma linha, empurrando o resto para fora da área visível. Sem rolagem, o que sai da tela some.

## 2. Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Arquitetura | **App único** com rotas por History API | Acaba a recarga entre telas, a marca `#bipar` e a classe de bug do logout. O shell deixa de ser moldura repetida em três arquivos |
| URL | Sem `.html`: `/painel`, `/bipagem`, `/entrar` | Pedido explícito, e consequência natural do app único |
| `.html` antigos | **Redirecionam** para a rota nova | Atalho salvo na tela do celular da doca continua abrindo. Cortar seco deixaria gente parada sem entender por quê |
| Painel do diretor | Rota `/painel/diretor` dentro do mesmo app | Substitui a decisão anterior ("página separada"), revogada pelo usuário |
| Scroll da bipagem | **Topo compacto, tela continua sem rolagem** | Câmera e contadores no mesmo lugar é o que sustenta o ritmo; o defeito é a barra que cresce, não a ausência de rolagem |
| Biblioteca de gráficos | Nenhuma nova — estender `src/lib/graficos.ts` | O painel precisa abrir offline; SVG inline não tem custo de rede |
| Mesclar transportadoras duplicadas | Não implementar | Mexeria em sessões já congeladas, e relatório de ontem não muda (CLAUDE.md §4). Editar rota + desativar resolve o caso |

## 3. Rotas

```
/                      → redireciona conforme o papel
/entrar                → login
/bipagem               → escolher transportadora e bipar
/relatorio             → relatório da conferência encerrada
/painel                → Hoje
/painel/conferencias
/painel/ocorrencias
/painel/desempenho
/painel/pessoas
/painel/transportadoras
/painel/rotas
/painel/sincronizacao
/painel/diretor
```

**Regra de entrada, única:** quem tem `gestor: true` cai em `/painel`; quem não tem cai em `/bipagem`. **Conferência aberta ganha das duas** — quem tem sessão `ABERTA` vai para `/bipagem` e a retoma, independente do papel. Ninguém é tirado do meio de uma carga.

Rota de painel acessada por quem não é gestor redireciona para `/bipagem`. Erro não é beco sem saída — nunca "acesso negado" numa tela sem porta.

Rota desconhecida cai na regra de entrada, não em 404: o app tem dono conhecido e sempre sabe para onde mandar a pessoa.

**Sair** limpa a sessão e navega para `/entrar` sem recarregar a página. É uma chamada de router, não `location.reload()` torcendo para o boot decidir.

### Hospedagem

`vercel.json` com duas coisas:

1. Redirecionamento permanente dos caminhos antigos: `/gestor.html` → `/painel`, `/diretor.html` → `/painel/diretor`, `/index.html` → `/`.
2. Reescrita de tudo o mais para `/index.html`, para o servidor entregar o app em qualquer rota.

No `vite.config.ts`: entrada única (some `gestor` e `diretor` do `rollupOptions.input`) e o `navigateFallbackDenylist` do PWA sai — ele existia para proteger as duas páginas que deixam de existir.

## 4. Shell do painel

`src/lib/painel-shell.ts` desenha a moldura (cabeçalho, lateral, gaveta, faixa de alerta) e mostra a seção da rota atual. Não conhece regra de negócio e não toca no IndexedDB.

### Itens do menu

| Grupo | Item | Rota |
|---|---|---|
| Operação | Hoje | `/painel` |
| Operação | Conferências | `/painel/conferencias` |
| Operação | Ocorrências | `/painel/ocorrencias` |
| Análise | Desempenho | `/painel/desempenho` |
| Análise | Visão do diretor | `/painel/diretor` |
| Cadastros | Pessoas | `/painel/pessoas` |
| Cadastros | Transportadoras | `/painel/transportadoras` |
| Cadastros | Códigos de rota | `/painel/rotas` |
| Sistema | Sincronização | `/painel/sincronizacao` |

Rodapé da lateral: nome do usuário, **Abrir bipagem** (vai para `/bipagem`, sem recarregar) e **Sair**.

### A divergência não pode se esconder atrás do menu

Esta é a regra que o menu põe em risco, e ela tem duas travas:

1. **Badge vermelho permanente** no item *Hoje* com a contagem de `ROTA_DIVERGENTE` do dia. Visível em qualquer seção, inclusive com a gaveta fechada no celular.
2. **Faixa de alerta fixa** acima do conteúdo de **todas** as seções quando houver divergência no dia — inclusive em Cadastros e Sincronização. Clicar leva a `/painel`.

Sem divergência no dia, a faixa não aparece: alarme que toca sempre deixa de ser alarme.

Ocorrências aparecem em dois lugares com papéis diferentes, e isso é proposital: em *Hoje* só a contagem de graves do dia, como KPI e como linha do bloco "Precisa de atenção", com link para a lista; a lista completa com texto na íntegra, filtros e busca livre vive em *Ocorrências*. Nenhuma métrica agregada substitui o texto — o bloco de *Hoje* leva até ele, não o resume.

## 5. Celular

O painel deixa de ser exclusivo de desktop. Ponto de corte: **1024 px**.

- **≥ 1024 px** — lateral fixa de 248 px, conteúdo à direita, tabelas densas.
- **< 1024 px** — lateral vira gaveta sobre o conteúdo, aberta por botão hambúrguer. O topo fixo mostra hambúrguer, título da seção, badge de divergência e chip de sync. Badge e faixa aparecem **sem** abrir a gaveta.
- Tabelas de operação (conferências, ocorrências) viram cartões empilhados abaixo de 1024 px. Tabelas de cadastro mantêm rolagem horizontal: são consulta, não urgência.
- KPIs em duas colunas no celular, seis em desktop.
- Alvos de toque no mínimo 44 px no painel. O app de bipagem continua em 56 px: lá a pessoa está de pé, com luva.

### A barra da bipagem

O topo da bipagem para de crescer: `flex-wrap` sai, os chips de GPS e fila viram ícone com rótulo acessível em vez de texto, e o botão **Painel** só existe para quem é gestor. A tela continua com `overflow: hidden` — é decisão de desenho, não descuido. O que estava errado era a barra empurrar o resto para fora.

Coberto por teste: viewport de 320×568 (o menor aparelho que a operação usa) com a barra inferior visível e nada cortado.

## 6. Gráficos e métricas

Hoje o painel do gestor não tem nenhum. Tudo em SVG por `src/lib/graficos.ts`.

**Hoje — fita de KPIs.** Volumes conferidos, divergências, rotas não mapeadas, pedidos incompletos, conferências abertas, ocorrências graves. Cada um comparado com a média dos sete dias anteriores. Número sozinho não sustenta decisão.

**Desempenho — período filtrado.**

| Gráfico | Forma | Por quê |
|---|---|---|
| Volumes conferidos por dia | Barras verticais | Volume da operação e dias sem conferência |
| Taxa de divergência por dia | Barras verticais, % | Responde "melhorou?" |
| Distribuição de status | Barra única empilhada | OK / divergente / não mapeado / duplicado / inválido de uma olhada |
| Divergência por rota | Barras horizontais | Onde o problema se concentra |
| Divergência por transportadora | Barras horizontais | Insumo da conversa com o parceiro |
| Ritmo por pessoa (vol/min) | Barras horizontais | Gargalo de operação ou etiqueta ruim |

Funções novas em `graficos.ts`: `graficoDiario()` e `barraEmpilhada()`.

Cores: as mesmas variáveis de status já usadas pelo operador (`--ok`, `--div`, `--dup`, `--inv`) e `--logdis-green` para séries neutras. Verde e vermelho precisam significar a mesma coisa nas duas telas. **Na implementação, carregar a skill `dataviz` antes de escrever a primeira linha de código de gráfico.**

Sem ranking de pessoas por produtividade: ritmo entra como diagnóstico de gargalo, na mesma tela que a taxa de divergência, nunca como placar (CLAUDE.md §9).

## 7. Cadastros — parametrizar tudo pelo painel

| Cadastro | Existe hoje | Entra |
|---|---|---|
| Pessoas | criar, editar, redefinir senha, ativar/desativar | busca por nome/login |
| Transportadoras | criar, ativar/desativar | **editar** (nome, CNPJ, responsável, telefone, e-mail) e **recusa de nome repetido** |
| Códigos de rota | criar, ativar/desativar | **editar**: nome, descrição e **troca da transportadora dona** |

O campo `email` de `Transportadora` existe em `src/types.ts` e nunca esteve no formulário — entra junto.

**Nome de transportadora passa a ser único**, com a mesma checagem que `criarUsuario` já faz para login. Vale para criar e para editar, comparando por nome normalizado (`trim()` + `toUpperCase()`), senão "Logdis" e "LOGDIS " passam.

Trocar a dona de um código de rota **não** reescreve leitura nem sessão anterior: `transportadoraDonaId` e `transportadoraDonaNome` são cópias congeladas na leitura. A troca vale da próxima bipagem em diante, e a tela diz isso.

**Novo aviso em "Precisa de atenção":** *"N transportadora(s) sem código de rota"*, com link para `/painel/rotas`. É a situação que produziu os quatro "sem rota cadastrada" na tela do operador — transportadora escolhível cujas leituras vão todas cair em `DESTINO_NAO_MAPEADO`.

## 8. Arquivos

```
index.html                         única página; moldura vazia
vercel.json                        redirecionamentos e reescrita
src/app/main.ts                    entrada única: boot, sessão, router
src/lib/router.ts                  History API, rotas, guarda por papel
src/app/login.ts                   tela de entrar
src/app/operador.ts                bipagem e relatório (existe; perde o roteamento)
src/lib/painel-shell.ts            lateral, gaveta, faixa de alerta
src/app/gestor/contexto.ts         Base, Contexto, helper de tabela
src/app/gestor/hoje.ts             seção Hoje + KPIs
src/app/gestor/conferencias.ts     histórico, filtros, gaveta de detalhe
src/app/gestor/ocorrencias.ts      lista, filtros, recorrentes
src/app/gestor/desempenho.ts       gráficos e tabelas
src/app/gestor/cadastros.ts        pessoas, transportadoras, rotas
src/app/gestor/sincronizacao.ts    Supabase, fila, aparelhos
src/app/gestor/diretor.ts          painel do diretor (era src/app/diretor.ts)
```

`gestor.html` e `diretor.html` são apagados. `src/app/gestor.ts` e `src/app/diretor.ts` deixam de ser entradas e viram módulos de seção.

Contrato de cada seção do painel:

```ts
export function montar(raiz: HTMLElement, ctx: Contexto): { pintar: () => void };
```

`montar()` prende os listeners uma vez; `pintar()` redesenha com os dados atuais. O router chama `pintar()` só da seção visível — hoje `recarregarTudo()` repinta as cinco a cada 15 s, inclusive as que ninguém está vendo.

## 9. Testes

- **Roteamento**: gestor entra e cai em `/painel`; operador em `/bipagem`; conferência aberta ganha das duas; rota de painel acessada por não-gestor manda para `/bipagem`; rota desconhecida não dá 404.
- **Logout**: sair de qualquer rota leva a `/entrar`, e voltar pelo botão do navegador não devolve a sessão. Este teste não existe hoje — é o que deixou o defeito passar.
- **URL**: nenhuma navegação do app produz URL com `.html`; `/gestor.html` redireciona para `/painel`.
- **Navegação do painel**: cada item mostra sua seção, a URL acompanha, recarregar mantém a seção, e o botão voltar do navegador funciona.
- **Trava de divergência**: com divergência no dia, navegar até `/painel/sincronizacao` e afirmar que a faixa continua visível.
- **Celular**: viewport 390×844 no painel — gaveta abre e fecha, badge visível com ela fechada, sem rolagem horizontal. Viewport 320×568 na bipagem — barra inferior visível, nada cortado.
- **Cadastro**: nome de transportadora repetido é recusado; editar código de rota troca a dona sem alterar `transportadoraDonaNome` de leitura já gravada.
- `npm test` e `npm run test:e2e` verdes.

## 10. Fora de escopo

- Formato do QR, classificação de leitura, relatório e exportações ficam intactos.
- Mesclar transportadoras duplicadas.
- Autenticação Supabase de verdade (`senha_hash` continua como está, com a ressalva já documentada no CLAUDE.md §4).
- Service worker e estratégia de cache além de remover o `navigateFallbackDenylist`.
