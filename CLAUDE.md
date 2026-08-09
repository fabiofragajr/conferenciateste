# CLAUDE.md — LogDis Entrega

Conferência de volumes por bipagem na expedição da Milfarma. Contexto e regras para o Claude atuar neste projeto. Leia antes de escrever ou alterar código.

> **Nome do produto:** LogDis Entrega (uso curto: **LogDis**). Confirmar a grafia final antes de aplicar em logo, título e exportações — a etiqueta do operador logístico traz `LOGDIS`.

---

## 1. O que é o projeto

Aplicativo **web mobile-first** que substitui o coletor/bipador físico na conferência de volumes da expedição. O operador usa a **câmera do próprio celular** para ler o QR Code da etiqueta de volume e validar, em tempo real, se aquela caixa pertence à rota/transportadora que ele está carregando.

**Problema resolvido:** hoje volumes de rotas diferentes acabam embarcados no veículo errado. A conferência é manual e só é detectada no confronto com o manifesto — tarde demais.

**Escopo da versão atual (v1):** conferência autônoma + relatório. **Não** há importação de manifesto ainda; o app gera o relatório do que foi bipado, e a comparação com o manifesto é feita fora do sistema.

---

## 2. Formato do QR Code da etiqueta

A etiqueta é emitida pelo operador logístico **LOGDIS / Zion Logtec**, com a Milfarma como depositante.

Conteúdo do QR — 4 campos separados por `;`, sem espaços em volta do separador:

```
EMB0008314147;FNOR 100;0001/0002;86945574
```

| Posição | Campo | Exemplo | Descrição |
|---|---|---|---|
| 1 | `codigoVolume` | `EMB0008314147` | Identificador único do volume (chave de deduplicação) |
| 2 | **`rota`** | `FNOR 100` | **Campo de validação principal.** Prefixo alfabético = rota (FNOR, FSUL...), sufixo numérico = sequência |
| 3 | `volume` | `0001/0002` | Volume atual / total de volumes do pedido |
| 4 | `pedido` | `86945574` | Número do pedido |

### Regras de parsing (obrigatórias)

- **Sempre** fazer parse defensivo: `split(';')` e validar que retornou 4 posições. Se não, marcar a leitura como `INVALIDO`, **nunca** descartar silenciosamente.
- Normalizar antes de comparar: `trim()` + `toUpperCase()`. Nunca comparar strings cruas do leitor.
- **Regra de comparação de rota (definida):** comparar **apenas o prefixo alfabético**, ignorando o sufixo numérico. O cadastro guarda `FNOR`; a leitura `FNOR 100`, `FNOR 200` ou `FNOR 15` casa com ele. Extrair as letras iniciais dos dois lados (`/^[A-Z]+/`) e comparar. Nunca usar `includes()` cru sobre a string inteira — `FNOR` não pode casar com uma rota `XFNORY` de outro operador.
- **O prefixo é a chave do cadastro.** O código lido é procurado na tabela de rotas, que diz qual transportadora é dona dele. A comparação final é entre a **transportadora dona do código** e a **transportadora que o operador escolheu** — não entre listas de strings.
- **Código sem cadastro não é divergência.** Se ninguém cadastrou o prefixo lido, o sistema não sabe de quem é a caixa: a leitura vira `DESTINO_NAO_MAPEADO` e a decisão sobe para o gestor. Fingir que sabe é pior do que dizer que não sabe.
- Nunca assumir que todo QR lido pela câmera é uma etiqueta válida. Códigos de terceiros vão aparecer.

---

## 3. Stack e bibliotecas

Restrição: **tudo gratuito, open source e client-side.** Roda em navegador de celular comum, sem app nativo, sem instalação.

| Função | Biblioteca | Por quê |
|---|---|---|
| Leitura de código | **ZXing** (`@zxing/browser` + `@zxing/library`) | Lê QR **e** códigos de barras 1D (Code128) na mesma lib. A etiqueta tem os dois formatos. Suporte mobile sólido, MIT. |
| Alternativa/otimização | `BarcodeDetector` API nativa | Mais rápida no Chrome/Android, mas **não existe no iOS Safari** — usar apenas com fallback obrigatório para ZXing |
| Persistência local | IndexedDB (ou `localStorage` em protótipo) | Cadastros e sessões offline |
| Relatório PDF | jsPDF + autoTable | Exportação do relatório final |

### Requisitos de ambiente

- **HTTPS obrigatório.** `getUserMedia()` não funciona em HTTP (exceto `localhost`). Hospedar com certificado, mesmo em rede interna.
- Solicitar a câmera traseira: `{ video: { facingMode: { ideal: "environment" } } }`.
- Manter a tela ativa durante a conferência (Wake Lock API, com degradação silenciosa onde não houver suporte).
- Assumir conexão instável no galpão: **o app deve funcionar offline** e não perder leituras.

---

## 4. Modelo de dados

**Quem está logado é quem bipa, e é isso que fica gravado.** Não importa se cadastraram a pessoa como motorista, ajudante, conferente ou qualquer outra coisa: se ela logou e leu uma caixa, a leitura fica no nome dela. O cargo é só uma etiqueta descritiva para o gestor ler no relatório — **nunca** uma regra que libera ou bloqueia a bipagem.

A única distinção que o sistema faz é uma: **acessa o painel do gestor ou não.** Todo o resto é a mesma pessoa usando o mesmo app.

```
Usuario        { id, nome, login, senhaHash, gestor: boolean,
                 funcao, telefone, placa, ativo }             // funcao: texto livre, descritivo
                                                              // senhaHash vazio = escolhe na 1ª entrada
Transportadora { id, nome, cnpj, responsavel, telefone, email, ativo }  // nome único
Rota           { id, codigo, nome, transportadoraId, descricao, ativo }
Sessao         { id, transportadoraId, usuarioId, inicio, fim, status,
                 transportadoraNome, rotas, usuarioNome,      // cópias congeladas
                 geoInicio, geoFim,
                 liberadaEm, liberadaPor, liberadaComPendencias }
Leitura        { id, sessaoId, codigoVolume, rota, rotaPrefixo, rotaId,
                 transportadoraDonaId, transportadoraDonaNome,
                 volume, pedido, status, timestamp, rawData, origem,
                 dispositivoId,
                 lat, lng, precisaoMetros, geoStatus }        // rawData = string bruta do QR
```

**`Rota.codigo` é único no sistema inteiro.** Se `FNOR` pertence à Transportadora Alfa, nenhuma outra pode cadastrá-lo. Não é detalhe de banco: é essa unicidade que permite descobrir o dono do volume só a partir da etiqueta. Sem ela, a conferência não tem resposta.

**`Transportadora.nome` também é único**, e o cadastro precisa recusar repetido em vez de deixar passar. Duas "LOGDIS" na lista não são um incômodo estético: o operador escolhe uma das duas na doca sem ter como saber qual delas tem o código de rota, e a carga certa vira `DESTINO_NAO_MAPEADO` por causa da escolha. Comparar por nome normalizado (`trim()` + `toUpperCase()`), senão `Logdis` e `LOGDIS ` passam pela checagem.

Os campos `transportadoraNome`, `rotas` e `usuarioNome` da sessão são **cópias congeladas** do cadastro no momento da conferência. Renomear uma transportadora hoje não pode mudar o relatório de ontem.

`funcao`, `telefone` e `placa` são **opcionais**. Cadastro mínimo para alguém começar a bipar: **nome e login**. Não travar o cadastro exigindo documento, placa, e-mail ou confirmação — o ajudante que entrou hoje precisa conseguir bipar hoje.

**A senha também é opcional no cadastro**, e esse é o caminho normal: o gestor não precisa inventar senha pelos outros. Quem é cadastrado sem senha escolhe a dela na primeira entrada. No painel, **Redefinir senha** devolve essa escolha para a pessoa — é o "esqueci a senha", sem ninguém descobrir a antiga.

### Não existe cadastro de exemplo

O app **não cria** usuário, transportadora nem rota. Nunca. Tudo vem da base: o gestor cadastra uma vez e o cadastro desce para os aparelhos.

Isso não é preferência de estilo. Semear cadastro no cliente gerava um id novo por aparelho, e `rotas.codigo` é único no servidor: do segundo celular em diante o envio batia em 409 para sempre. Como a fila parava na primeira tabela que falhava, e `rotas` vem antes de `leituras`, **nenhuma conferência daquele aparelho chegava ao servidor**. Ao mesmo tempo, a base acumulava uma cópia da mesma pessoa e da mesma transportadora por aparelho.

Consequências que precisam ser respeitadas:

- Aparelho sem cadastro **avisa** ("ainda não recebeu o cadastro; conecte-se uma vez"), em vez de recusar a senha certa. Ele não tem contra o que conferir — fingir "senha incorreta" manda a pessoa procurar um erro que não existe.
- O primeiro gestor de um projeto novo nasce no `supabase/schema.sql`, sem senha.
- Falha ao enviar uma tabela **nunca** pode impedir o envio das outras. A leitura é o dado que não pode se perder; cadastro emperrado não prende caixa bipada.

### A senha acompanha o cadastro

`senhaHash` é PBKDF2-SHA256 (210.000 iterações, salt por usuário) e **sobe e desce junto com o usuário** — antes ele ficava só no aparelho. Trocou-se um problema pelo outro conscientemente:

- Sem viajar, a senha definida pelo gestor no desktop não valeria no celular da doca; e, sem cadastro de exemplo, qualquer um reivindicaria um login num aparelho novo digitando uma senha qualquer.
- Viajando, quem tem a chave anônima consegue **ler** a coluna. É proteção contra uso indevido casual, não contra um atacante.

O caminho definitivo continua sendo autenticação Supabase de verdade, com políticas por usuário. Até lá, não trate `senha_hash` como segredo forte.

Toda leitura carrega `usuarioId` via `sessaoId`. O gestor sempre consegue responder "quem bipou esta caixa" sem depender de como a pessoa foi classificada no cadastro.

`geoStatus`: `OK` | `NEGADO` (usuário recusou a permissão) | `INDISPONIVEL` (sem sinal/timeout) | `IMPRECISO` (precisão acima do limite aceitável).

### Status de leitura (canônicos — usar exatamente estes)

| Status | Cor | Significado |
|---|---|---|
| `OK` | Verde | Rota pertence ao grupo selecionado |
| `ROTA_DIVERGENTE` | Vermelho | Volume de outra transportadora — **não pode embarcar**. A tela diz de quem é a caixa |
| `DESTINO_NAO_MAPEADO` | Laranja | Código de rota que ninguém cadastrou — separar e avisar o gestor |
| `DUPLICADO` | Âmbar | `codigoVolume` já bipado nesta sessão |
| `INVALIDO` | Cinza | QR não segue o formato de 4 campos |

---

## 5. Fluxo da aplicação

```
Login → Escolher transportadora → Bipar volumes → Encerrar → Relatório
                                        ↑______|
```

**Duas telas até a câmera abrir. Esse é o teto.** Cada passo a mais é um passo feito de pé, com caixa na mão.

**Cada um começa onde trabalha.** Quem tem `gestor: true` entra no painel; quem não tem entra na bipagem. Conferência aberta ganha das duas regras — ninguém é tirado do meio de uma carga, e voltar ao painel com sessão aberta não encerra nada: a sessão fica `ABERTA` e é retomada. **Toda tela de bipagem tem uma saída que não encerra a carga:** o `←` do topo. O destino muda com quem está usando — painel para quem tem painel, escolha de transportadora para quem não tem — e o rótulo acessível diz qual é, porque uma seta sozinha não conta para onde aponta. Antes só o gestor tinha saída (um botão "Painel"); para todo o resto a única forma de deixar a tela era **Encerrar**, que é irreversível — quem entrasse na carga errada precisava encerrar uma conferência de verdade para escapar. Voltar avisa a fila pendente por *toast*, nunca por diálogo: sair não põe leitura nenhuma em risco, então ali há informação, não decisão. E ninguém apanha da tela errada: usuário sem acesso ao painel que chegar nele vai para a bipagem, em vez de tomar "acesso negado" sem saída.

1. **Login** — simples, local. Sem OAuth, sem backend externo nesta versão. Manter a sessão logada no aparelho; ninguém digita senha toda manhã.
2. **Transportadora** — escolhe a transportadora terceira que está carregando agora. Botões grandes, não `<select>`. Se só existe uma cadastrada, pular a tela e já abrir a câmera. Trocar de transportadora com conferência aberta exige encerrar antes — misturar bipagem de duas transportadoras invalida a conferência.
3. **Bipagem** — leitura contínua pela câmera, com feedback **imediato**:
   - Cor de tela cheia (verde/vermelho/âmbar) + som + vibração (`navigator.vibrate`)
   - Contadores ao vivo: total, OK, divergentes, duplicados
   - Lista rolável das últimas leituras
   - Permitir **entrada manual** do código como fallback (QR danificado, luz ruim)
   - **Sem confirmação por leitura.** Bipou, mostrou, próximo. Diálogo a cada caixa mata o ritmo.
   - **A câmera é a maior coisa da tela, e isso é medido** — no mínimo 40% da altura, com teste que falha se encolher. Ela é elástica, não uma fatia fixa: o topo tem uma linha só (52 px), o status da leitura flutua sobre a imagem em vez de ocupar faixa própria, e a lista de leituras não reserva espaço enquanto está vazia.
   - **Contadores são quatro, não cinco:** Lidos, Liberados, Separar, Problemas. Duplicado e inválido somam em "Problemas" porque, para quem está com a caixa na mão, a reação é a mesma — bipe de novo ou siga. **"Separar" nunca se junta a outra coluna:** é a única que manda tirar a caixa do caminhão. Tocar numa coluna filtra a lista; é ali que a distinção agrupada reaparece.
   - **Só o que é apontar e bipar fica na tela.** O resto — ver rotas, digitar código, registrar ocorrência, status da sincronização, encerrar — mora na folha do `⋯`. Encerrar foi para lá de propósito: era um botão vermelho permanente ao lado dos de uso diário, sendo a única ação irreversível da tela.
   - **Registrar ocorrência** no volume lido — ver seção 6
4. **Encerrar sessão** — trava novas leituras e libera o relatório. Fica na folha do `⋯`, a dois toques, e confirma — é a única ação irreversível da tela. A confirmação mostra as **pendências da carga** (divergência, rota não cadastrada, pedido incompleto) antes de encerrar.
5. **Liberação da carga** — ação do **gestor**, no painel, depois de encerrada. O sistema avisa as pendências e registra se a liberação saiu com ressalva; ele não decide sozinho parar um caminhão.

---

## 6. Ocorrências

### Onde isso acontece

A Milfarma **não entrega ao cliente final**. Ela leva os volumes até a transportadora, que executa a etapa seguinte da entrega. O app cobre esse trecho: conferir a carga na saída e registrar o que aconteceu na entrega dos volumes na transportadora.

Por isso as ocorrências são de dois momentos distintos:

- **Na expedição** — problema com o volume antes de sair: caixa amassada, lacre violado, etiqueta ilegível.
- **Na transportadora** — problema no repasse: demora na recepção, doca fechada, recusa de volume, divergência na conferência deles.

O segundo momento é o mais valioso e o menos documentado hoje. Quando a transportadora atrasa a entrega final e a culpa vem para a Milfarma, o registro com hora, local e descrição é o que decide a discussão.

### Texto livre é o campo principal

**A ocorrência é, antes de tudo, um campo de texto aberto.** A pessoa escreve o que quiser, do jeito dela. Nada de forçar enquadramento numa lista — a realidade da doca sempre inventa uma situação que não estava prevista, e obrigar a escolher uma categoria faz a pessoa marcar "outro" e não descrever nada.

- Campo de texto grande, sempre visível ao abrir a ocorrência, com foco automático.
- Sem limite prático de caracteres. Sem formato exigido.
- Nenhuma etiqueta é obrigatória. Texto sozinho já é uma ocorrência válida.

### Etiquetas rápidas (atalho, não formulário)

Acima do campo de texto, botões que a pessoa toca se quiser — servem para o gestor filtrar depois, e para quem está com pressa registrar em um toque. São **múltipla escolha e todas opcionais**.

**Na expedição**
| Etiqueta | Grave |
|---|---|
| Embalagem amassada | |
| Lacre violado | ● |
| Volume molhado / vazamento | ● |
| Volume aberto | ● |
| Etiqueta ilegível | |
| Embalagem térmica comprometida | ● |

**Na transportadora**
| Etiqueta | Grave |
|---|---|
| Demora na recepção | |
| Doca fechada / sem atendimento | |
| Transportadora recusou o volume | ● |
| Divergência na conferência deles | ● |
| Sem comprovante / canhoto | ● |
| Volume avariado na chegada | ● |

**Contexto farma:** a carga é medicamento. Lacre violado, volume molhado ou térmica comprometida têm implicação sanitária, não estética — a tela sinaliza isso ao marcar, e o relatório separa as graves das demais. Nunca bloquear o registro por causa disso; a função do app é documentar, não impedir.

### Regra de ouro

**Ocorrência é opcional e nunca interrompe a bipagem.** O caminho normal é bipar e seguir. Registrar é uma ação secundária, a um toque da leitura que acabou de aparecer na lista — nunca um passo entre uma caixa e a próxima. Se virar pergunta a cada volume, a operação para de usar o app.

### Dados

```
Ocorrencia     { id, sessaoId, leituraId, momento, texto, etiquetas: [string],
                 grave, fotos: [blob], timestamp, lat, lng, usuarioId }
```

- `momento`: `EXPEDICAO` | `TRANSPORTADORA`
- `leituraId` é **nullable**. Ocorrência pode ser do volume específico ou **da entrega inteira** ("cheguei 7h, só me atenderam 9h20") — nesse caso vale para a sessão. Ambos os casos precisam existir.
- `grave` é derivado das etiquetas marcadas, nunca digitado.
- **Foto opcional** (até 3), via `<input type="file" capture="environment">`. Comprimir client-side antes de gravar.
- Herda geolocalização e hora do momento do registro, não da leitura. É isso que prova onde e quando.
- **Imutável.** Correção se faz adicionando outra, nunca editando a anterior — o valor do registro está em não poder ser reescrito depois que o problema aparece.

### Na tela

- Botão de ocorrência na última leitura, grande, ao lado do código.
- Botão separado e sempre acessível para **ocorrência da entrega** (sem volume vinculado).
- Etiquetas como grade de botões grandes, agrupadas pelos dois momentos. Nada de `<select>`.
- Volume com ocorrência ganha marcador visual próprio, distinto da cor de status da rota — são duas informações diferentes e não podem se confundir.

---

## 7. Relatório

O relatório é o entregável do sistema — trate-o como documento oficial de conferência, não como um dump de tela.

Deve conter:

- **Cabeçalho:** Milfarma, data/hora de início e fim, duração, quem bipou (nome + função e placa, se cadastrados), grupo de rota e rotas incluídas
- **Resumo:** total bipado, OK, divergentes, duplicados, inválidos, e nº de pedidos distintos
- **Alerta de divergências em destaque** — se houver `ROTA_DIVERGENTE`, isso é a informação mais importante da página
- **Volumes incompletos:** pedidos onde o total bipado ≠ total declarado no campo `volume` (ex.: bipou `0001/0002` mas nunca apareceu o `0002/0002`). Essa checagem é derivável do próprio QR, sem manifesto — **implementar**
- **Ocorrências registradas:** em bloco próprio, separadas por momento (expedição / transportadora) e com as graves em destaque. Mostrar o **texto escrito na íntegra**, nunca só as etiquetas — é ali que está a informação. Com foto, hora e local.
- **Tabela detalhada:** código, rota, pedido, volume, status, ocorrência, horário
- **Exportação:** PDF e CSV

---

## 8. Geolocalização

Toda leitura registra **onde** foi bipada. Serve para provar que a conferência aconteceu na doca (e não no estacionamento, ou depois, no fim do dia).

- Capturar com `navigator.geolocation`, usando `watchPosition` durante a sessão em vez de uma chamada por leitura — economiza bateria e evita travar a bipagem esperando o GPS.
- **A geolocalização nunca bloqueia a bipagem.** Se o GPS falhar ou for negado, a leitura é registrada mesmo assim com o `geoStatus` correspondente. Conferência é a função crítica; localização é evidência complementar.
- Registrar `precisaoMetros`. Dentro de galpão o sinal degrada muito — acima de ~100 m, marcar como `IMPRECISO` e não tratar o ponto como confiável.
- Guardar também o ponto de **abertura** e de **encerramento** da sessão, que costumam ser mais confiáveis que os pontos individuais.
- **Transparência é obrigatória.** A tela deve deixar claro para o operador que a posição está sendo registrada durante a sessão, e o registro acontece **apenas com a sessão aberta** — nunca em segundo plano. Isso não é só boa prática: é rastreamento de trabalhador, sujeito à LGPD, e precisa de ciência prévia e finalidade declarada. Documente a finalidade na tela de login e no cadastro do operador.

---

## 9. Painel do gestor de transporte

Tela de supervisão, separada da tela de bipagem. Acesso restrito a quem tem `gestor: true`.

O painel responde a três perguntas, nesta ordem de importância:

**1. Tem algo errado agora?**
- Sessões abertas em tempo real: quem está bipando, grupo de rota, quantos volumes já lidos
- Divergências do dia em destaque — volume de outra rota é o alarme principal
- **Ocorrências do dia**, com o texto escrito visível direto na lista, sem precisar abrir. Graves no topo. Filtro por momento (expedição / transportadora) e por etiqueta
- Ocorrências recorrentes na mesma transportadora — é o sinal que antecede o problema virar rotina
- Pedidos com volume faltando (bipou `0001/0002`, nunca veio o `0002/0002`)

**2. O que aconteceu?**
- Histórico de sessões com filtros: período, pessoa, rota, status
- Detalhe da sessão: linha do tempo das leituras e ocorrências com horário, status e ponto no mapa
- Busca por texto livre dentro das ocorrências — o gestor precisa achar "doca fechada" sem depender de ninguém ter marcado a etiqueta certa
- Mapa das bipagens da sessão, com os pontos coloridos pelo status da leitura (mesma paleta da tela do operador) e os pontos `IMPRECISO` visualmente distintos — não desenhar precisão que não existe

**3. Como está o desempenho?**
- Por pessoa: sessões, volumes conferidos, taxa de divergência
- Por rota: volume médio, onde as divergências se concentram
- Ritmo de bipagem (volumes/minuto) — indica gargalo de operação ou etiqueta ruim

### Diretrizes de UI do painel

- **Desktop-first, mas abre no celular.** Aqui o gestor senta, tem teclado e tempo: aproveite a largura com tabela densa, filtros persistentes, sem card gigante com um número só. Abaixo de **1024 px** a mesma tela precisa funcionar — o gestor confere pelo celular no meio da doca. Nesse tamanho, as tabelas de operação (conferências, ocorrências) viram cartões empilhados; as de cadastro podem manter rolagem lateral, porque são consulta e não urgência.
- **O painel tem menu lateral.** É o oposto do app de bipagem, e de propósito: aqui há muita coisa e a pessoa tem tempo de escolher. Lateral fixa no desktop; no celular, barra de abas na zona do polegar mais folha "Mais". Agrupado por Operação / Análise / Cadastros / Sistema.
- **Os grupos recolhem, e o aparelho lembra.** Quem só usa Operação abre o painel já enxuto. Duas regras acompanham: a preferência guarda os grupos **fechados** (assim um grupo criado depois nasce aberto, em vez de sumir para quem já tinha estado salvo), e **o grupo da seção visível é aberto à força** — chegar por URL colada num grupo recolhido deixaria a página atual invisível no próprio menu.
- **Divergência nunca fica escondida — nem atrás de filtro, nem atrás de item de menu, nem atrás de grupo recolhido.** São três travas: badge com a contagem no item, visível de qualquer seção; **badge somado no cabeçalho do grupo enquanto ele estiver fechado**, porque item recolhido leva o badge junto; e faixa de alerta fixa acima do conteúdo de **todas** as seções enquanto houver divergência no dia. Sem divergência, a faixa some: alarme que toca sempre deixa de ser alarme.
- **Ícone de menu é pictograma, e vem de um lugar só.** `src/lib/shell/icones.ts` atende a coluna do desktop, a barra do celular e a folha — mapa por tela era o jeito de a mesma seção ganhar desenhos diferentes em cada uma. Duas regras que o teste cobre: **desenho de coisa** (casa, caminhão, prancheta, alfinete), nunca forma abstrata que a pessoa tenha de decorar — foi por isso que os glifos Unicode saíram, além de cada aparelho desenhá-los com a fonte que tivesse; e **um desenho por destino**, contando o botão "Abrir bipagem". Cor só por `currentColor`: ícone com cor fixa ignora o estado ativo e o fundo verde da coluna.
- **Cabeçalho de grupo não ganha ícone próprio** — só a seta. Ícone de grupo alinhado com ícone de item apaga a diferença de nível que o recolhimento existe para criar.
- **A barra do topo mostra a trilha (`Operação › Conferências`), não o título da seção.** Título solto repetia ao pé da letra o `<h2>` logo abaixo; a trilha usa a mesma linha para dizer onde a pessoa está na hierarquia — que é justamente o que um menu com grupos recolhíveis pode deixar de mostrar. No celular fica só o nome da seção: não há largura para os dois níveis, e o grupo continua no DOM para o leitor de tela.
- **O painel é onde se parametriza tudo.** Pessoas, transportadoras, códigos de rota e conexão com o Supabase. Se o gestor precisa pedir para alguém mexer no banco, o painel está incompleto.
- Trocar a transportadora dona de um código de rota vale **da próxima bipagem em diante**. Leitura e sessão já gravadas carregam cópia congelada do dono — relatório de ontem não muda. A tela precisa dizer isso.
- Exportação do período inteiro em CSV, além do PDF por sessão.
- Nada de "engajamento" ou ranking de pessoas. A tela é operacional: mostra o que aconteceu e onde está o problema. Ritmo de bipagem entra como diagnóstico de gargalo, ao lado da taxa de divergência — nunca como placar.

---

## 10. Painel do diretor

Mesma base de dados do painel do gestor, leitura diferente. O gestor de transporte precisa **agir hoje**: qual caixa está errada, qual carga não pode sair. O diretor precisa **decidir**: onde está o dinheiro vazando, qual transportadora está pior, se está melhorando ou piorando.

A diferença não é ter menos informação — é ter informação agregada no tempo. Um painel que só mostra o dia é inútil para ele.

### O que o diretor vê

**Indicadores de topo, sempre comparados com o período anterior** (mês vs. mês, não número solto):
- Volumes conferidos
- Taxa de divergência de rota (%) — volume que quase embarcou errado
- Taxa de ocorrência (%) e, separada, a **taxa de ocorrência grave** (avaria, violação, cadeia fria)
- Pedidos embarcados incompletos
- Cobertura de conferência: % das cargas que passaram pelo app. Se ninguém usa, os outros números não valem nada — este indicador vem primeiro.

**Tendência ao longo do tempo:** série mensal das taxas acima. A pergunta que ele faz é "melhorou?", e isso só uma linha no tempo responde.

**Ranking por rota e por transportadora:** onde a divergência, a avaria e a demora se concentram. É o insumo direto pra conversa comercial e pra renegociação de contrato com a transportadora.

**Concentração de ocorrências por etiqueta e por momento:** se a maioria é de embalagem na expedição, o problema é interno (paletização, armazenagem). Se é demora e recusa na transportadora, o problema é do parceiro. Essa separação é a que muda a decisão dele.

**Ocorrências em texto, por amostragem:** um bloco com as ocorrências graves do período, texto na íntegra. Métrica agregada diz que piorou; o texto do pessoal na doca diz por quê. Não substituir isso por contagem.

**Mapa de calor das conferências:** onde as cargas estão sendo conferidas de fato, agregado — não o rastro individual de uma pessoa.

### Diretrizes

- **Nada operacional aqui.** Sem lista de leitura individual, sem "quem bipou a caixa X". Se ele precisar desse nível, manda pro painel do gestor com filtro aplicado — mas a tela dele não abre nisso.
- **Sem ranking de pessoas.** Ranking por rota e transportadora, que são processos. Pessoa em placar vira pressão por velocidade, e velocidade é exatamente o que faz a conferência ser mal feita.
- Toda métrica precisa de comparação temporal ou não entra. Número sozinho não sustenta decisão.
- Uma tela, sem navegação profunda. Ele abre no celular entre uma reunião e outra — o painel tem que responder em dez segundos.
- Exportação em PDF do período, formatada para apresentação.

---

## 11. Diretrizes para o Claude

### Simplicidade é o requisito, não um enfeite

Quem usa o app na ponta é **quem está na doca** — motorista, ajudante, conferente, tanto faz. De pé, com pressa, caixa na mão, celular próprio, luz ruim e às vezes luva. Não foi treinado no sistema e não vai ler manual. Se hesitar na tela, abandona, e conferência não acontece.

Regras que valem para todo o app de bipagem:

- **Uma decisão por tela.** Nunca duas perguntas juntas.
- **Zero digitação** no caminho normal. Teclado só no login e na entrada manual de código.
- **Nada de menu, aba, engrenagem ou tela de configuração no app de bipagem.** Cadastro e parametrização são coisa do gestor, e o lugar deles é o painel — que tem menu lateral justamente porque é a tela oposta a esta.
- Alvos de toque grandes (mín. 56 px), texto grande, contraste alto. Legível a um braço de distância.
- O status da leitura tem que ser entendido **sem ler**: cor, som e vibração diferentes por status. Alguém de longe deve saber se deu problema.
- Erro nunca é beco sem saída. Sempre há saída óbvia: bipar de novo, digitar o código, seguir.
- Se você está prestes a adicionar um passo, um aviso ou uma opção na tela de bipagem, o padrão é **não adicionar**.

O painel do gestor pode ser denso — ele senta, tem tempo e teclado. Mas denso não é confuso: a informação mais importante (divergência) continua vindo primeiro, sem precisar de filtro para aparecer.

**Prioridades, nesta ordem:** correção da conferência > velocidade de bipagem > estética.

- **Nunca** deixe uma leitura passar sem status. Volume não classificado é falha de conferência.
- **Nunca** normalize um código divergente para fazê-lo "caber" na rota. Divergência é o valor do sistema.
- Feedback tem que ser legível **a um braço de distância, com luva, sob luz de galpão**. Fonte grande, cor de alto contraste, área de toque generosa.
- Escreva copy em **português do Brasil**, direta e operacional. "Volume de outra rota", não "Erro de validação". Sem jargão de sistema na tela do operador.
- Ao propor mudanças, mantenha compatibilidade com o formato do QR — ele vem do operador logístico e **não podemos alterá-lo**.
- Se precisar mudar o modelo de dados, preserve `rawData`: é a única prova do que foi lido de fato.

## 12. Roadmap (fora do escopo v1)

- Importação do manifesto e confronto automático
- Integração com o ERP Senior / GeneXus para puxar rotas e pedidos
- Multiusuário com backend e sincronização entre coletores
- Histórico de sessões e dashboard de divergências por rota/período
