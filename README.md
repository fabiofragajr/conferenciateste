# LogDis Entrega

Conferência de volumes por bipagem na expedição da **Milfarma**. Substitui o
coletor físico: o operador usa a câmera do próprio celular para ler o QR da
etiqueta e descobre **na hora** se aquela caixa pertence à carga que ele está
carregando.

Web app mobile-first, **offline-first**, em TypeScript. Roda no navegador do
celular, sem instalação e sem app nativo. A conferência funciona sem rede; o
Supabase recebe os dados depois.

---

## Como rodar

```bash
npm install
npm run dev       # servidor de desenvolvimento (http://localhost:5173)
npm run build     # typecheck + build de produção em dist/
npm run preview   # serve o dist/ para testar o build
```

### Não existe cadastro de exemplo

O app não cria usuário, transportadora nem rota. Tudo vem da base: o gestor
cadastra uma vez, e o cadastro desce para os aparelhos.

Num projeto Supabase novo, `supabase/schema.sql` insere o primeiro gestor (troque
nome e login antes de rodar). Ele entra **sem senha**: a primeira senha digitada
é a dele, e a partir daí vale em qualquer aparelho.

Aparelho que ainda não baixou o cadastro diz isso na tela de login, em vez de
recusar a senha certa — ele não tem contra o que conferir.

### HTTPS não é opcional

`getUserMedia()` (câmera) e a geolocalização só funcionam em contexto seguro.
`localhost` já conta como seguro; em rede interna, publique com certificado —
sem isso a câmera não abre em nenhum celular.

### Testes

```bash
npm test           # typecheck + regras de domínio + decodificação real de um QR
npm run test:e2e   # navegador de verdade: bipagem, painéis e operação offline
npm run test:carga # retoma 3.000 caixas offline sem inflar a tela
npm run test:base  # confere a base de produção do .env — só leitura
```

O `test:e2e` sobe o build e usa Chromium com câmera e GPS simulados. Na primeira
vez, instale o navegador: `npx playwright install chromium`. Os testes cobrem o
caminho crítico — divergência, duplicado, ocorrência, relatório, acessos — e o
cenário offline: 25 volumes bipados sem rede, recarregar no meio da conferência
e gerar o PDF com a conexão desligada.

O teste de carga mantém **3.000 leituras** no IndexedDB, recarrega o PWA sem
rede e confirma os contadores, a deduplicação em memória e o limite de itens no
DOM. Ele existe separado do E2E comum para deixar a verificação diária rápida.

**Nada de teste chega à base de produção.** Cada aparelho de teste recebe seu
cadastro por `tests/cadastro.mjs` — gravado no IndexedDB exatamente como a
descida gravaria — e o caminho até o projeto do `.env` é cortado no contexto do
navegador. Não é para "mockar" a sincronização: o código é o mesmo, e sem isso
cada rodada viraria sessão de mentira no painel de quem está operando, além de
fixar num arquivo do repositório a senha real do gestor (agora que o hash
acompanha o cadastro).

O que precisa da base de verdade fica em `npm run test:base`, que só lê: confere
que o cadastro desce, que existe um gestor ativo, que a migração v3 foi aplicada
e que não há login, nome de transportadora ou código de rota repetido.

---

## Estrutura

```
index.html        app do operador (login → carga → bipagem → relatório)
gestor.html       painel do gestor de transporte
diretor.html      painel do diretor
src/
  types.ts        modelo de dados
  lib/
    db.ts         IndexedDB — a fonte da verdade da operação
    model.ts      parsing da etiqueta, classificação, pedidos incompletos
    auth.ts       login local (sem backend)
    scanner.ts    câmera + BarcodeDetector com fallback ZXing
    decoder.worker.ts   decodificação fora da thread principal
    geo.ts        posição durante a sessão
    feedback.ts   cor, som e vibração por status
    relatorio.ts  relatório em HTML, CSV e PDF
    mapa.ts       dispersão das bipagens de uma sessão
    graficos.ts   SVG dos painéis (sem biblioteca de gráfico)
    supabase.ts   cliente do destino de sincronização
    sync.ts       fila de saída (outbox)
  app/            controladores das três telas
supabase/
  schema.sql              tabelas, índices, RLS, storage, views, primeiro gestor
  migracao-v1-para-v2.sql grupo de rota -> transportadora + código com dono único
  migracao-v2-para-v3.sql junta cadastro duplicado, unique em login/nome, senha
tests/
  cadastro.mjs            cadastro dos testes e isolamento da base de produção
  base-real.test.mjs      confere a base de produção (só leitura)
```

---

## Transportadora e código de rota

O que o operador escolhe antes de bipar é a **transportadora terceira** que está
carregando. Cada código de rota pertence a uma transportadora — e a uma só:

```
FNOR → Transportadora Alfa
FSUL → Transportadora Sul
```

`Rota.codigo` é único no sistema inteiro (índice único no IndexedDB e no
Postgres). Não é detalhe de banco: é essa unicidade que permite descobrir o dono
do volume só a partir da etiqueta. Tentar cadastrar um código que já tem dono é
recusado com o nome de quem já o tem.

A validação inteira acontece em memória, com o cadastro já sincronizado — a
resposta ao operador não passa pela rede.

---

## A etiqueta

QR do operador logístico (LOGDIS / Zion Logtec), quatro campos separados por `;`:

```
EMB0008314147;FNOR 100;0001/0002;86945574
   volume        rota    vol/total   pedido
```

O formato **não pode ser alterado** — vem de fora. Regras de leitura:

- Parse defensivo: sem os 4 campos, a leitura vira `INVALIDO` e é gravada assim
  mesmo, com o motivo e o `rawData` original. Nada é descartado em silêncio.
- A rota compara **só o prefixo alfabético**: o cadastro guarda `FNOR`, e
  `FNOR 100`, `FNOR 200` e `FNOR 15` casam com ele. Comparação exata de
  prefixo — `FNOR` nunca casa com `XFNORY` de outro operador.
- O prefixo é procurado no **cadastro de rotas**, que diz qual transportadora é
  dona dele. A comparação final é entre essa dona e a transportadora que o
  operador escolheu.

| Status | Cor | Significado |
|---|---|---|
| `OK` | Verde | O código é da transportadora que está sendo conferida |
| `ROTA_DIVERGENTE` | Vermelho | É de outra transportadora — a tela diz de quem |
| `DESTINO_NAO_MAPEADO` | Laranja | Ninguém cadastrou esse código; a decisão sobe para o gestor |
| `DUPLICADO` | Âmbar | Já bipado — a tela diz por quem e a que horas |
| `INVALIDO` | Cinza | QR fora do formato de 4 campos |

Divergência é avaliada **antes** de duplicado: rebipar um volume de outra
transportadora volta vermelho, não âmbar. Divergência nunca fica escondida.

Código sem cadastro **não vira divergência**: o sistema não sabe de quem é a
caixa, e fingir que sabe é pior do que dizer que não sabe. O operador separa o
volume e segue; quem decide a rota é o gestor, em um clique no painel.

Cada status tem cor, som e vibração próprios — o resultado é entendido sem ler,
a um braço de distância.

---

## Offline e sincronização

São muitas caixas por carga e o galpão tem sinal ruim. Por isso:

1. **Tudo grava primeiro no IndexedDB** e já sai marcado como `PENDENTE`.
   A bipagem nunca espera rede — nem para gravar, nem para classificar.
2. O **motor de sync** (`src/lib/sync.ts`) drena a fila em lotes de 200 via
   `upsert` por `id`: ao voltar a rede, ao voltar para a tela, a cada minuto e
   ao encerrar a conferência. Cada lote também é confirmado no IndexedDB em
   uma única transação, para o envio de milhares de caixas não disputar o
   aparelho com a câmera.
3. Falha de envio **não perde nada**: o registro continua `PENDENTE` e é tentado
   de novo (8 tentativas antes de virar `ERRO`, que o gestor reenvia num botão).
3.1. A sincronização também **desce**: transportadoras, rotas e usuários
   alterados no servidor entram no aparelho a cada ciclo (incremental por
   `atualizado_em`). Sem isso, a transportadora cadastrada no desktop nunca
   chegaria ao celular da doca.
4. Fotos de ocorrência sobem para o Storage antes da linha da ocorrência; se a
   foto falhar, o texto sobe do mesmo jeito — o texto é a informação principal.
5. O app é PWA com precache: abre e opera **sem conexão nenhuma**, inclusive a
   geração de PDF.

Os IDs são UUID gerados no cliente, então reenviar é idempotente e não duplica
nada no Supabase.

### Configurar o Supabase

1. Projeto novo: rode `supabase/schema.sql` no SQL Editor. Só isso.

   Projeto existente, na ordem, pulando o que já rodou:

   - `supabase/migracao-v1-para-v2.sql` — só para quem ainda tem a tabela
     `grupos_rota`. Preserva o histórico: o id do grupo vira o id da
     transportadora, os mesmos UUIDs que o aparelho usa ao migrar o IndexedDB.
     As leituras antigas mantêm o status com que foram classificadas na doca —
     reescrever isso seria apagar o que aconteceu.
   - `supabase/migracao-v2-para-v3.sql` — **obrigatória.** Junta as cópias que o
     antigo cadastro de exemplo espalhou (a mesma pessoa e a mesma transportadora
     uma vez por aparelho), passa a barrar repetição com `unique` em
     `usuarios.login` e `transportadoras.nome`, e cria a coluna `senha_hash`.
     Sessões, leituras e ocorrências das cópias são repontadas para a
     sobrevivente: nada de histórico se perde. O fim do arquivo traz consultas
     prontas, comentadas, para você decidir o que fazer com o que sobrou das
     rodadas de teste.

   As duas rodam inteiras numa transação e são idempotentes: rodar de novo não
   faz nada na segunda vez. Confira com `npm run test:base`.
2. Informe URL e chave anônima — de duas formas:
   - build: copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL`,
     `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_BUCKET`;
   - ou em **Painel do gestor → Sincronização**, que grava no aparelho e
     sobrepõe o `.env` (útil para apontar outro projeto sem recompilar).
3. Use "Testar conexão" para confirmar.

**Sobre segurança:** a autenticação desta versão é local. As políticas RLS do
schema liberam `insert`/`update` para a chave anônima (que fica no celular e é,
na prática, pública) e o `select` apenas do cadastro que o aparelho precisa para
validar offline: transportadoras, rotas, usuários e a lista de aparelhos.
Leitura, ocorrência e sessão continuam fechadas para `anon`.

**O hash da senha acompanha o cadastro** (PBKDF2-SHA256, 210.000 iterações, salt
por usuário). É uma troca consciente, e vale entender os dois lados:

- *Por que ele viaja:* sem isso a senha definida pelo gestor no desktop não
  valeria no celular da doca. Pior: como o app não tem mais cadastro de exemplo,
  todo aparelho novo começa vazio — e sem hash para conferir, qualquer pessoa
  reivindicaria um login só digitando uma senha qualquer.
- *O que isso custa:* quem tiver a chave anônima consegue **ler** a coluna. Trate
  como proteção contra uso indevido casual, não contra um atacante.

Antes de produção, troque por autenticação Supabase de verdade e políticas por
usuário — aí o hash sai da tabela e essa conversa acaba.

**Primeiro acesso:** quem o gestor cadastra sem senha (o caminho normal — não
precisa inventar senha pelos outros) escolhe a dela na primeira entrada. O botão
**Redefinir senha**, no painel, devolve essa escolha para a pessoa: é o caminho
do "esqueci a senha", sem ninguém descobrir a antiga.

---

## Ocorrências

Dois momentos, porque são problemas diferentes: **na expedição** (caixa
amassada, lacre violado) e **na transportadora** (demora na recepção, doca
fechada, recusa de volume). O segundo é o mais valioso e o menos documentado —
é o registro com hora e local que decide a discussão quando a entrega atrasa e
a culpa volta para a Milfarma.

- O campo principal é **texto livre**, com foco automático e sem limite. As
  etiquetas rápidas são atalho opcional, nunca formulário obrigatório.
- `grave` é **derivado** das etiquetas (lacre violado, molhado, térmica
  comprometida, recusa, avaria...) — nunca digitado. Carga farmacêutica: essas
  marcações têm implicação sanitária e saem destacadas no relatório.
- Podem ser de um volume ou **da entrega inteira** (`leituraId` nulo).
- Até 3 fotos, comprimidas no cliente antes de gravar.
- Herdam hora e local **do registro**, não da leitura.
- São **imutáveis**: correção se faz adicionando outra.
- Registrar nunca interrompe a bipagem — é uma ação secundária, a um toque da
  leitura que acabou de aparecer na lista.

---

## Geolocalização e LGPD

Toda leitura carrega onde foi bipada, para comprovar que a conferência
aconteceu na doca. Com `watchPosition` durante a sessão (não uma chamada por
leitura), `precisaoMetros` registrado e acima de 100 m marcado como
`IMPRECISO` — dentro de galpão o sinal degrada e ponto ruim não é tratado como
confiável.

**A geolocalização nunca bloqueia a bipagem.** GPS negado ou sem sinal grava a
leitura do mesmo jeito, com `geoStatus` correspondente.

O registro acontece **apenas com a sessão aberta**, nunca em segundo plano, e a
finalidade está declarada na tela de login. Isso é rastreamento de trabalhador
sujeito à LGPD: exige ciência prévia e finalidade declarada.

---

## Relatório

Documento oficial de conferência, não um dump de tela: cabeçalho com quem/quando
/qual carga, resumo, **alerta de divergência em destaque**, pedidos com volume
faltando (derivados do próprio QR — bipou `0001/0002` e o `0002/0002` nunca
apareceu), ocorrências com o **texto na íntegra** separadas por momento, tabela
detalhada e exportação em **PDF e CSV**.

## Painéis

- **Gestor** (`gestor.html`): abre com o bloco **Precisa de atenção** —
  divergências, códigos sem cadastro, pedidos incompletos, cargas aguardando
  liberação e leitura presa em aparelho sem sincronizar, cada item levando ao
  lugar onde se resolve. Depois: conferências abertas ao vivo, ocorrências com
  o texto visível e busca livre, histórico filtrável com mapa da sessão,
  desempenho, cadastro de transportadoras e rotas, aparelhos e sincronização.
  A **liberação da carga** também é daqui: o sistema mostra as pendências e
  registra se a liberação saiu com ressalva — ele não decide sozinho parar um
  caminhão.
- **Diretor** (`diretor.html`): mesma base, leitura agregada no tempo — toda
  métrica comparada com o mês anterior, tendência mensal, ranking por rota e por
  transportadora, concentração por etiqueta e por momento, amostra das
  ocorrências graves em texto e mapa de calor agregado. Sem nada operacional e
  **sem ranking de pessoas**.

A cobertura de conferência (% das cargas que passaram pelo app) depende de um
número que a v1 não tem como saber sozinha — quantas cargas saíram. O painel
pede esse número em vez de inventar um percentual.

---

## Fora do escopo desta versão

Importação do manifesto e confronto automático, integração com o ERP
Senior/GeneXus, autenticação com backend e sincronização em tempo real entre
aparelhos.

**Mapa de cobertura geográfica** (rotas desenhadas sobre OpenStreetMap) depende
de cidade, CEP e cliente por pedido — dados que o QR de 4 campos não carrega e
que só chegam com a importação de manifesto/CSV. Enquanto não houver esse dado,
o único mapa honesto é o que já existe: a dispersão real das bipagens de uma
conferência, com os pontos imprecisos marcados como tal. Desenhar cobertura de
rota sem dado de destino seria enfeite.

**Hierarquia de validação por pedido/CEP/cidade** tem o mesmo bloqueio: com o
código de rota presente na etiqueta, ela não é necessária hoje; sem dados
importados, ela não é possível.
