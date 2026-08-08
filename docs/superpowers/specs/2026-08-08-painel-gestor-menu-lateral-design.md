# Painel do gestor — menu lateral, gráficos e parametrização

Data: 2026-08-08
Estado: aprovado (aguardando revisão do spec escrito)

## 1. O problema

Três queixas concretas, todas verificadas no código:

**O gestor cai na tela do operador.** `boot()` e o `submit` do formulário de login em
`src/app/operador.ts` mandam todo mundo para `irParaGrupos()`, sem olhar `usuario.gestor`.
Sandro entra para gerenciar e recebe "Qual transportadora você vai conferir?". O único
caminho para o painel é o link `#link-painel` no rodapé da tela de transportadora
(`index.html`) — pequeno, e some assim que a câmera abre. Daí "não tem botão de voltar".

**O painel é uma página de rolagem infinita, sem gráfico e sem celular.** `gestor.html`
empilha cinco seções numeradas numa coluna só. Não há um gráfico sequer: gráficos existem
apenas no painel do diretor (`src/lib/graficos.ts`, usado só por `src/app/diretor.ts`). O
`@media (max-width: 720px)` de `painel.css` encolhe padding e nada mais — no celular as
tabelas densas viram rolagem horizontal.

**Não dá para consertar o cadastro pelo painel.** O cadastro de transportadora não valida
nome repetido, embora o CLAUDE.md declare o nome único — é o que produziu duas
transportadoras "LOGDIS" na base. E não existe editar transportadora nem editar código de
rota: só criar e desativar. Sem editar, a duplicata não tem conserto pela tela.

## 2. Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Painel do diretor | Item no menu lateral, mas `diretor.html` continua página separada | Preserva o "uma tela, sem navegação profunda" do CLAUDE.md §10, não mexe no build do Vite nem na denylist do PWA |
| Login do gestor | Vai direto para o painel | O operador continua com duas telas até a câmera; o gestor não vê mais a tela de transportadora sem querer |
| Biblioteca de gráficos | Nenhuma nova — estender `src/lib/graficos.ts` | O painel precisa abrir offline; SVG inline não tem custo de rede |
| Mesclar transportadoras duplicadas | Não implementar | Mexeria em sessões já congeladas, e relatório de ontem não muda (CLAUDE.md §4). Editar rota + desativar resolve o caso |

## 3. Roteamento por papel

Regra única: **quem tem `gestor: true` começa no painel; quem não tem começa na bipagem.**
Conferência aberta ganha de tudo — ninguém é tirado do meio de uma carga.

`src/app/operador.ts`:

- No `boot()`, depois de resolver `usuarioLogado()`: se existe sessão `ABERTA` do usuário,
  retoma a bipagem (comportamento atual, inalterado). Senão, se `usuario.gestor`,
  redireciona para `gestor.html`.
- No `submit` do login: mesma regra, aplicada depois de `auth.entrar()` dar `ok`.
- Botão **Painel** no cabeçalho da tela de transportadora e no `.bip-topo` da bipagem,
  visível apenas quando `usuario.gestor`. O link `#link-painel` do rodapé sai.
- Sair da bipagem pelo botão **não** encerra a sessão: ela permanece `ABERTA` no IndexedDB
  e o `boot()` a retoma na volta. Nenhuma leitura se perde e nenhum diálogo de confirmação
  aparece — encerrar continua sendo a única ação irreversível, e só ela confirma.

`src/app/gestor.ts`:

- Usuário autenticado sem `gestor: true` deixa de receber "Este usuário não tem acesso ao
  painel" com a sessão derrubada (`auth.sair()`). Passa a ser redirecionado para
  `index.html`. Erro não é beco sem saída.
- A tela de bloqueio (`#bloqueio`) continua existindo para quem chega sem estar logado.

## 4. Shell do painel

Novo módulo `src/lib/painel-shell.ts`. Responsabilidade única: desenhar a moldura
(cabeçalho, lateral, gaveta, faixa de alerta), controlar qual seção está visível e avisar
quem precisa repintar. Não conhece regra de negócio nem toca no IndexedDB.

Interface:

```ts
export interface ItemMenu {
  id: string;            // vira o hash da URL: #hoje, #conferencias, ...
  rotulo: string;
  grupo: string;         // 'Operação' | 'Análise' | 'Cadastros' | 'Sistema'
  href?: string;         // quando é outra página (diretor.html)
}

export interface Shell {
  aoTrocarSecao(fn: (id: string) => void): void;
  irPara(id: string): void;
  secaoAtual(): string;
  definirBadge(id: string, n: number): void;      // badge vermelho no item
  definirAlerta(html: string | null): void;       // faixa fixa acima do conteúdo
}

export function montarShell(itens: ItemMenu[], op: { ativo: string; usuario: string }): Shell;
```

Navegação por `location.hash`, com `hashchange`. Recarregar a página cai na mesma seção.
Sem hash, abre em `#hoje`.

### Itens do menu

| Grupo | Item | Hash | Conteúdo |
|---|---|---|---|
| Operação | Hoje | `#hoje` | Precisa de atenção, faixa de divergência, conferências abertas, pedidos incompletos, rotas não mapeadas, KPIs do dia |
| Operação | Conferências | `#conferencias` | Filtros de período/pessoa/rota/status, tabela de sessões, **liberação da carga**, gaveta de detalhe, CSV do período |
| Operação | Ocorrências | `#ocorrencias` | Lista com o texto na íntegra, filtros, busca livre, recorrentes por transportadora, CSV |
| Análise | Desempenho | `#desempenho` | Gráficos e tabelas por pessoa e por rota |
| Análise | Visão do diretor | `diretor.html` | Link para a outra página |
| Cadastros | Pessoas | `#pessoas` | Criar, editar, redefinir senha, ativar/desativar, busca |
| Cadastros | Transportadoras | `#transportadoras` | Criar, editar, ativar/desativar |
| Cadastros | Códigos de rota | `#rotas` | Criar, editar (inclusive trocar a dona), ativar/desativar |
| Sistema | Sincronização | `#sincronizacao` | Conexão Supabase, fila local, aparelhos em operação |

Rodapé da lateral: nome do usuário, **Abrir bipagem**, **Sair**.

Ocorrências aparecem em dois lugares com papéis diferentes, e isso é proposital: em *Hoje*
só a contagem de graves do dia, como KPI e como linha do bloco "Precisa de atenção", com
link para a lista; a lista completa com texto na íntegra, filtros e busca livre vive em
*Ocorrências*. Nenhuma métrica agregada substitui o texto — o bloco de *Hoje* leva até ele,
não o resume.

### A divergência não pode se esconder atrás do menu

Esta é a regra que o menu põe em risco, e ela tem duas travas:

1. **Badge vermelho permanente** no item *Hoje* com a contagem de `ROTA_DIVERGENTE` do dia.
   Visível em qualquer seção, inclusive na gaveta fechada do celular.
2. **Faixa de alerta fixa** acima do conteúdo de **todas** as seções quando houver
   divergência no dia — inclusive em Cadastros e Sincronização. Clicar leva a `#hoje`.

Sem divergência no dia, a faixa não aparece: alarme que toca sempre deixa de ser alarme.

## 5. Mobile

O painel deixa de ser exclusivo de desktop. Ponto de corte: **1024 px**.

- **≥ 1024 px** — lateral fixa de 248 px, conteúdo à direita, tabelas densas como hoje.
- **< 1024 px** — lateral vira gaveta sobre o conteúdo, aberta por botão hambúrguer. O topo
  fixo mostra: hambúrguer, título da seção atual, badge de divergência e chip de sync. O
  badge e a faixa de alerta aparecem **sem** abrir a gaveta.
- Tabelas de operação (conferências, ocorrências) viram cartões empilhados abaixo de
  1024 px — rótulo do campo em cima, valor embaixo. Tabelas de cadastro mantêm rolagem
  horizontal: são de consulta, não de urgência.
- KPIs em duas colunas no celular, seis em desktop.
- Alvos de toque no mínimo 44 px no painel (o app de bipagem continua em 56 px: lá a pessoa
  está de pé, com luva).

## 6. Gráficos e métricas

Hoje o painel do gestor não tem nenhum. O que entra, tudo em SVG por `src/lib/graficos.ts`:

**Seção Hoje — fita de KPIs.** Volumes conferidos, divergências, rotas não mapeadas,
pedidos incompletos, conferências abertas, ocorrências graves. Cada um comparado com a
média dos sete dias anteriores. Número sozinho não sustenta decisão — a comparação é
obrigatória, igual ao painel do diretor.

**Seção Desempenho — período filtrado.**

| Gráfico | Forma | Por quê |
|---|---|---|
| Volumes conferidos por dia | Barras verticais | Volume da operação e dias sem conferência |
| Taxa de divergência por dia | Barras verticais, % | Responde "melhorou?" |
| Distribuição de status | Barra única empilhada | OK / divergente / não mapeado / duplicado / inválido de uma olhada |
| Divergência por rota | Barras horizontais | Onde o problema se concentra |
| Divergência por transportadora | Barras horizontais | Insumo da conversa com o parceiro |
| Ritmo por pessoa (vol/min) | Barras horizontais | Gargalo de operação ou etiqueta ruim |

Funções novas em `graficos.ts`: `graficoDiario()` (barras por dia, reaproveitando o corpo
de `graficoMensal`) e `barraEmpilhada()`. `ranking()` e `graficoMensal()` ficam como estão.

Cores: as mesmas variáveis de status já usadas pelo operador (`--ok`, `--div`, `--dup`,
`--inv`) e `--logdis-green` para séries neutras. Verde e vermelho precisam significar a
mesma coisa nas duas telas. **Na implementação, carregar a skill `dataviz` antes de
escrever a primeira linha de código de gráfico.**

Sem ranking de pessoas por produtividade: ritmo entra como diagnóstico de gargalo, na
mesma tela que a taxa de divergência, nunca como placar (CLAUDE.md §9).

## 7. Cadastros — parametrizar tudo pelo painel

| Cadastro | Existe hoje | Entra |
|---|---|---|
| Pessoas | criar, editar, redefinir senha, ativar/desativar | busca por nome/login na lista |
| Transportadoras | criar, ativar/desativar | **editar** (nome, CNPJ, responsável, telefone, e-mail) e **recusa de nome repetido** |
| Códigos de rota | criar, ativar/desativar | **editar**: nome, descrição e **troca da transportadora dona** |

O campo `email` de `Transportadora` existe em `src/types.ts` e nunca esteve no formulário —
entra junto.

**Nome de transportadora passa a ser único**, com a mesma checagem que `criarUsuario` já
faz para login: busca antes de gravar, e a mensagem diz qual já existe. Vale para criar e
para editar. Comparação por nome normalizado (`trim()` + `toUpperCase()`), senão "Logdis" e
"LOGDIS " passam pela validação.

Trocar a dona de um código de rota **não** reescreve leitura nem sessão anterior:
`transportadoraDonaId` e `transportadoraDonaNome` são cópias congeladas na leitura, e
relatório de ontem não muda. A troca vale da próxima bipagem em diante. A tela diz isso.

**Novo aviso em "Precisa de atenção":** *"N transportadora(s) sem código de rota"*, com link
para `#rotas`. É exatamente a situação que produziu os quatro "sem rota cadastrada" na tela
do operador — transportadora escolhível cujas leituras vão todas cair em
`DESTINO_NAO_MAPEADO`. Hoje o painel não avisa.

## 8. Arquivos

`src/app/gestor.ts` tem 1003 linhas. Com menu, gráficos e cadastros editáveis passaria de
1600 — grande demais para editar com segurança. A divisão acompanha os itens do menu:

```
src/app/gestor.ts                  boot, login, roteamento, carga dos dados
src/app/gestor/contexto.ts         interface Base e interface Contexto (hoje Base é local)
src/app/gestor/hoje.ts             seção Hoje + KPIs do dia
src/app/gestor/conferencias.ts     histórico, filtros, gaveta de detalhe
src/app/gestor/ocorrencias.ts      lista, filtros, recorrentes
src/app/gestor/desempenho.ts       gráficos e tabelas do período
src/app/gestor/cadastros.ts        pessoas, transportadoras, rotas
src/app/gestor/sincronizacao.ts    Supabase, fila, aparelhos
src/lib/painel-shell.ts            lateral, gaveta, hash, faixa de alerta
src/styles/painel.css              + estilos do shell e do modo celular
```

Contrato de cada módulo de seção:

```ts
export interface Contexto {
  usuario: Usuario;
  base: Base;                    // dados já carregados pelo gestor.ts
  recarregar: () => Promise<void>;
  irPara: (secao: string) => void;
}

export function montar(raiz: HTMLElement, ctx: Contexto): { pintar: () => void };
```

`montar()` prende os listeners uma vez; `pintar()` redesenha com os dados atuais. O
`gestor.ts` chama `pintar()` da seção visível — e só dela. Hoje `recarregarTudo()` repinta
as cinco seções a cada 15 s, inclusive as que ninguém está vendo.

O HTML de `gestor.html` encolhe para a moldura vazia: cada seção passa a ser montada pelo
seu módulo. Isso mantém marcação e comportamento no mesmo arquivo.

## 9. Ajustes no CLAUDE.md

O CLAUDE.md proibia coisas que este desenho faz. **Já ajustado** — as edições abaixo estão
aplicadas no arquivo e entram no mesmo commit deste spec:

- **§9, diretrizes de UI do painel** — "É uma tela de desktop, ao contrário do resto do app"
  passa a "desktop-first, mas precisa abrir no celular", com o ponto de corte de 1024 px e a
  regra dos cartões empilhados.
- **§9** — entra o menu lateral como estrutura do painel, com a regra explícita de que
  divergência não pode ficar atrás de item de menu (badge + faixa fixa).
- **§9** — entra que o painel é onde se parametriza tudo: pessoas, transportadoras, códigos
  de rota e conexão.
- **§11** — "Nada de menu, aba, engrenagem ou tela de configuração" passa a dizer
  explicitamente **no app de bipagem**, para não valer para o painel.
- **§5** — entra a regra de roteamento por papel: gestor começa no painel, operador na
  bipagem, conferência aberta ganha de ambos.
- **§4** — reforço de que o nome da transportadora é único e o cadastro recusa repetido.

## 10. Testes

- `tests/login-sandro.mjs` já cobre login de gestor: estender para afirmar que Sandro cai em
  `gestor.html` e que a tela de transportadora não aparece.
- Novo teste de navegação do painel: cada item do menu mostra sua seção, o hash acompanha,
  e recarregar mantém a seção.
- Novo teste da trava de divergência: com divergência no dia, navegar para `#sincronizacao`
  e afirmar que a faixa de alerta continua visível.
- Novo teste de mobile: viewport de 390 px — a gaveta abre e fecha, o badge fica visível com
  ela fechada, e o `document.body` não rola na horizontal.
- Novo teste de cadastro: nome de transportadora repetido é recusado; editar código de rota
  troca a dona sem alterar `transportadoraDonaNome` de leitura já gravada.
- `npm run test` e `npm run test:e2e` verdes.

## 11. Fora de escopo

- Nada muda na tela de bipagem além do botão **Painel** para gestor.
- Formato do QR, classificação de leitura, relatório e exportações ficam intactos.
- Mesclar transportadoras duplicadas.
- Autenticação Supabase de verdade (`senha_hash` continua como está, com a ressalva já
  documentada no CLAUDE.md §4).
