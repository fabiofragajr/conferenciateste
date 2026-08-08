LOGDIS — MELHORIAS

Documento para análise e ajuste do sistema existente

> **Objetivo deste arquivo:** orientar a IA a analisar a implementação atual do LOGDIS e aplicar melhorias de fluxo, usabilidade, gestão, operação offline e visualização geográfica, sem reconstruir o projeto do zero e sem remover funcionalidades que já estejam funcionando.

Instrução principal para a IA

Antes de alterar código:

1. analisar a arquitetura e os componentes já existentes;
2. identificar o que já está implementado e funcionando;
3. comparar a implementação atual com os requisitos deste documento;
4. preservar o que estiver correto;
5. propor e executar ajustes incrementais;
6. evitar duplicar telas, tabelas, serviços ou regras já existentes;
7. manter a solução simples, rápida e adequada a um MVP;
8. priorizar experiência real de operação logística, principalmente em celular/PWA;
9. não criar funcionalidades decorativas ou sem impacto operacional;
10. documentar qualquer decisão estrutural relevante.

────────

1. Visão do produto

O LOGDIS será um sistema simples e rápido para conferência de caixas durante a expedição.

A premissa principal é:

> **O operador não deve tomar decisões. Ele deve apenas selecionar/iniciar sua rota e bipar as caixas.**

Toda a inteligência de validação deve acontecer automaticamente no sistema.

O LOGDIS deve identificar, com base nos dados existentes na etiqueta da caixa, se aquele volume pertence ou não à rota que está sendo carregada. O gestor acompanha toda a operação em tempo real por um painel administrativo.

O foco do MVP é reduzir:

• caixas enviadas para rotas erradas;
• pedidos incompletos;
• volumes esquecidos;
• bipagens duplicadas;
• erros humanos na conferência;
• retrabalho na expedição.

────────

2. Conceito principal

Antes da operação começar, o sistema já deve possuir:

1. Transportadoras terceiras cadastradas
2. Códigos de rota cadastrados
3. Cada código de rota vinculado obrigatoriamente a uma única transportadora
4. Códigos de rota únicos no sistema — o mesmo código não pode existir em transportadoras diferentes
5. Regras/dados que permitam identificar o código de rota esperado para cada caixa

Depois disso, o operador:

1. entra no sistema;
2. escolhe a transportadora terceira que está sendo conferida;
3. acessa/inicia a operação de bipagem;
4. começa a bipar;
5. recebe feedback imediato informando se o código de rota daquela caixa é compatível com a transportadora/operação selecionada.

O operador não deve precisar informar manualmente:

• cliente;
• cidade;
• CEP;
• pedido;
• número da expedição;
• quantidade de volumes;
• destino da caixa.

Essas informações devem ser obtidas automaticamente a partir da leitura da etiqueta ou de dados previamente importados para o sistema.

────────

3. Exemplo real de etiqueta

Uma etiqueta pode conter informações como:

• Operador logístico: LOGDIS
• Depositante
• Cliente
• Endereço
• Cidade
• Estado
• CEP
• Número de expedição
• Número do pedido
• Volume atual
• Quantidade total de volumes
• QR Code
• Código de barras

Exemplo:

```text
Expedição: EMB0008314147
Pedido: 86945574
Volume: 0001/0002
Cliente: Drogaria Avenida Petri Ltda
Cidade: Mairiporã
UF: SP
CEP: 07661-435
```

O sistema deve transformar a leitura em dados estruturados.

Exemplo:

```json
{
  "expedicao": "EMB0008314147",
  "pedido": "86945574",
  "volume_atual": 1,
  "total_volumes": 2,
  "cliente": "Drogaria Avenida Petri Ltda",
  "cidade": "Mairiporã",
  "uf": "SP",
  "cep": "07661-435"
}
```

────────

4. Fluxo operacional

4.1 Preparação pelo gestor

Antes da expedição, o gestor configura:

Transportadora

Exemplo:

```text
LOGDIS
```

Usuários

O usuário operacional não precisa ficar fixamente preso a uma única transportadora terceira.

Ao iniciar a conferência, ele deve escolher qual transportadora está sendo trabalhada naquele momento.

Exemplo:

```text
Operador: João

[ Selecionar transportadora ]

- Transportadora Alfa
- Transportadora Beta
- Transportadora Gama
```

A escolha deve ficar gravada na operação e em todas as bipagens realizadas durante aquela sessão.

Códigos de rota

Os códigos de rota pertencem às transportadoras terceiras e são elementos centrais da validação.

Exemplo:

```text
Código: R07
Transportadora: Transportadora Alfa
Descrição: Mairiporã / Terra Preta
```

Regra obrigatória:

> **Um código de rota não pode se repetir em transportadoras diferentes.**

Portanto, se R07 já pertence à Transportadora Alfa, nenhuma outra transportadora poderá cadastrar R07.

O banco deve aplicar uma restrição UNIQUE ao campo codigo da rota, além do vínculo obrigatório com transportadora_id.

────────

5. Regras da rota

Uma rota pode ser identificada utilizando um ou mais critérios.

Exemplos:

```text
Rota 07 — Mairiporã / Terra Preta

Cidade:
- Mairiporã

CEP:
- 07600-000 até 07699-999

Clientes específicos:
- Drogaria Avenida Petri Ltda
- Cliente XYZ
```

O sistema deve suportar diferentes formas de associação.

────────

6. Seleção da transportadora antes da bipagem

A primeira decisão do operador na operação deve ser simples:

```text
QUAL TRANSPORTADORA VOCÊ VAI CONFERIR?
```

Exemplo:

```text
[ Transportadora Alfa ]
[ Transportadora Beta ]
[ Transportadora Gama ]
```

Depois da seleção:

```text
Transportadora ativa:
TRANSPORTADORA ALFA

[ INICIAR BIPAGEM ]
```

A transportadora selecionada passa a fazer parte do contexto da sessão.

Todas as bipagens seguintes devem ser validadas considerando:

```text
transportadora_selecionada
+
codigo_rota_identificado_na_caixa
+
cadastro_de_rotas
```

Se o código identificado na caixa pertencer à transportadora selecionada:

```text
✅ ROTA CORRETA
```

Se o código pertencer a outra transportadora ou não for compatível com a operação atual:

```text
🔴 DIVERGÊNCIA

Código da caixa:
R12

Pertence à:
Transportadora Beta

Transportadora selecionada:
Transportadora Alfa
```

A troca de transportadora durante uma operação ativa deve exigir encerramento ou confirmação explícita, para evitar mistura de bipagens entre transportadoras.

────────

7. Regra principal de validação por código de rota

O código de rota é o identificador principal para saber se a caixa está sendo direcionada corretamente.

Fluxo recomendado:

```text
BIPAR ETIQUETA
      ↓
Extrair código de rota
      ↓
Consultar código no IndexedDB
      ↓
Encontrar transportadora dona do código
      ↓
Comparar com transportadora selecionada
      ↓
CORRETO ou DIVERGENTE
```

Exemplo:

```text
Código lido: R07
R07 → Transportadora Alfa
Transportadora selecionada → Transportadora Alfa
```

Resultado:

```text
✅ CORRETO
```

Outro exemplo:

```text
Código lido: R21
R21 → Transportadora Beta
Transportadora selecionada → Transportadora Alfa
```

Resultado:

```text
🔴 ROTA / TRANSPORTADORA DIVERGENTE
```

CEP, cidade, cliente, pedido e expedição podem continuar sendo usados como informações complementares, auditoria ou fallback, mas não devem substituir o código de rota quando ele estiver disponível e válido.

────────

6. Hierarquia de validação

A validação deve usar a informação mais confiável disponível.

Ordem recomendada:

```text
1. Pedido / romaneio previamente vinculado à rota
2. Expedição previamente vinculada à rota
3. Cliente previamente vinculado à rota
4. CEP
5. Cidade
6. Região
```

Exemplo:

Se o sistema já possuir:

```text
Pedido 86945574 → Rota 07
```

não é necessário inferir a rota pelo CEP.

Se o pedido ainda não existir na base:

```text
CEP 07661-435 → Rota 07
```

pode ser usado como fallback.

────────

7. Tela do operador

A interface operacional deve ser extremamente simples.

O operador não deve visualizar um painel administrativo completo.

Primeira etapa:

```text
LOGDIS

Selecione a transportadora

[ Transportadora Alfa ]
[ Transportadora Beta ]
[ Transportadora Gama ]
```

Depois da seleção:

```text
LOGDIS

TRANSPORTADORA ALFA

Operação em andamento
391 volumes bipados

[ BIPAR CAIXAS ]
[ TROCAR TRANSPORTADORA ]
```

A opção de trocar transportadora deve ficar protegida contra troca acidental enquanto houver uma operação ativa.

Ao abrir o leitor, ele deve permanecer disponível para bipagens consecutivas.

Evitar:

• abrir uma nova página depois de cada leitura;
• exigir confirmação manual;
• obrigar o operador a clicar em “salvar”;
• pedir preenchimento de campos;
• abrir modais desnecessários.

O objetivo é permitir:

```text
BIP → resultado → BIP → resultado → BIP → resultado
```

com a maior velocidade possível.

────────

8. Caixa correta

Quando o código de rota da caixa pertencer à transportadora selecionada:

```text
✅ CAIXA CORRETA

Transportadora: Transportadora Alfa
Código de rota: R07
Pedido: 86945574
Volume: 1/2
Expedição: EMB0008314147
```

Comportamento recomendado:

• feedback visual verde;
• som curto de confirmação;
• vibração curta no celular;
• registro automático;
• voltar imediatamente para leitura da próxima caixa.

Não exigir confirmação.

────────

9. Divergência de rota

Se o código da caixa pertencer a outra transportadora ou não corresponder ao contexto selecionado:

```text
🔴 DIVERGÊNCIA DE ROTA

Pedido: 86945574
Código lido: R21

Pertence à:
TRANSPORTADORA BETA

Selecionada:
TRANSPORTADORA ALFA
```

Comportamento recomendado:

• tela vermelha;
• som diferente do sucesso;
• vibração forte;
• registro da ocorrência;
• mostrar claramente a rota correta.

A divergência nunca deve passar silenciosamente.

────────

10. Bipagem duplicada

Caso a mesma caixa seja bipada novamente:

```text
🟠 VOLUME JÁ BIPADO

Pedido: 86945574
Volume: 1/2

Primeira leitura:
10:38:21

Operador:
João
```

Não contabilizar o volume duas vezes.

Registrar a tentativa de duplicidade para auditoria.

────────

11. Controle de volumes do pedido

A etiqueta possui uma informação muito importante:

```text
0001/0002
```

Isso significa:

```text
Volume atual: 1
Total esperado: 2
```

O LOGDIS deve utilizar isso para controlar pedidos incompletos.

Exemplo:

```text
Pedido 86945574
Esperado: 2 volumes
Bipados: 1
Status: INCOMPLETO
```

Ao encontrar o segundo volume:

```text
Pedido 86945574
Esperado: 2 volumes
Bipados: 2
Status: COMPLETO
```

────────

12. Status dos pedidos

Sugestão:

```text
PENDENTE
EM CONFERÊNCIA
COMPLETO
INCOMPLETO
COM DIVERGÊNCIA
```

O status deve ser calculado automaticamente sempre que houver nova bipagem.

────────

13. Status da rota

Sugestão:

```text
NÃO INICIADA
EM CONFERÊNCIA
COM PENDÊNCIAS
CONFERIDA
LIBERADA
```

Exemplo:

```text
ROTA 07 — MAIRIPORÃ

Previstos: 427
Bipados: 423

Pedidos incompletos: 3
Divergências: 1

Status:
COM PENDÊNCIAS
```

────────

14. Regra de liberação da carga

Idealmente, a carga não deve ser considerada liberada enquanto existirem problemas.

Exemplo:

```text
🔴 CARGA NÃO LIBERADA

3 pedidos incompletos
1 divergência de rota
4 volumes pendentes
```

Quando tudo estiver resolvido:

```text
🟢 ROTA CONFERIDA

427 / 427 volumes

Nenhuma divergência
Nenhum pedido incompleto

LIBERADA PARA EXPEDIÇÃO
```

No MVP, a liberação pode ser:

Automática

Quando todas as regras forem atendidas.

ou

Manual

O gestor clica:

```text
[ LIBERAR CARGA ]
```

Mas o sistema deve avisar caso existam pendências.

────────

15. Painel do gestor

O painel de gestão deve concentrar toda a inteligência da operação.

Dashboard principal

Exemplo:

```text
OPERAÇÃO DE HOJE

Rotas
12

Em conferência
5

Conferidas
4

Com pendências
3

Volumes previstos
4.820

Volumes bipados
4.315

Divergências
8

Pedidos incompletos
17
```

────────

16. Acompanhamento por rota

Cada rota deve possuir um painel próprio.

Exemplo:

```text
ROTA 07 — MAIRIPORÃ

96% concluída

427 volumes previstos
411 volumes bipados
16 pendentes

Pedidos completos: 182
Pedidos incompletos: 7
Divergências: 3
Duplicidades: 2

Operadores ativos: 4
```

────────

17. Feed em tempo real

O gestor deve conseguir acompanhar as leituras.

Exemplo:

```text
10:38:21
✅ EMB0008314147
João

10:38:24
✅ EMB0008314201
Carlos

10:38:27
🔴 EMB0008314255
ROTA ERRADA
João

10:38:31
🟠 EMB0008314147
DUPLICADO
Carlos
```

────────

18. Tela de divergências

Criar uma área específica:

```text
DIVERGÊNCIAS
```

Cada ocorrência deve mostrar:

• data;
• hora;
• operador;
• transportadora;
• rota em operação;
• rota correta;
• pedido;
• expedição;
• volume;
• cliente;
• cidade;
• CEP.

Exemplo:

```text
Pedido 86945574
Volume 1/2

Bipado na:
Rota 03 — Atibaia

Pertence à:
Rota 07 — Mairiporã

Operador:
João

Horário:
10:38:27
```

────────

19. Pedidos incompletos

Criar uma tela específica:

```text
PEDIDOS INCOMPLETOS
```

Exemplo:

```text
86945574

Esperado:
2 volumes

Encontrado:
1 volume

Falta:
Volume 2
```

Isso deve permitir ao gestor localizar rapidamente caixas que ficaram fora da carga.

────────

20. Produtividade dos operadores

O sistema pode registrar:

• quantidade de bipagens;
• bipagens por minuto;
• primeiro registro;
• último registro;
• tempo ativo;
• divergências detectadas;
• duplicidades.

Exemplo:

```text
João

Volumes bipados: 842
Tempo ativo: 2h14
Média: 6,3 volumes/min
Divergências detectadas: 4
```

Esse indicador deve servir para acompanhamento operacional, não para dificultar a bipagem.

────────

21. Cadastro de transportadoras

Campos mínimos:

```text
Nome
CNPJ (opcional no MVP)
Status
Responsável
Telefone
E-mail
```

Status:

```text
ATIVA
INATIVA
```

────────

22. Cadastro de rotas

Campos recomendados:

```text
Nome da rota
Código
Transportadora
Descrição
Status
```

Exemplo:

```text
Código: R07
Nome: Mairiporã / Terra Preta
Transportadora: LOGDIS
```

────────

23. Regras geográficas

Cada rota pode possuir:

```text
Cidades
CEPs
Faixas de CEP
Bairros
Clientes
```

Exemplo:

```text
Rota 07

Cidade:
Mairiporã

Faixa CEP:
07600-000 → 07699-999
```

────────

24. Importação de dados

O sistema deve ser preparado para futuramente receber:

```text
CSV
XLSX
API
ERP
WMS
```

Exemplo de arquivo:

```text
pedido,expedicao,cliente,cep,rota,total_volumes
86945574,EMB0008314147,Drogaria Avenida,07661435,R07,2
```

Isso aumenta muito a precisão da conferência.

────────

25. MVP sem integração com ERP

A primeira versão não deve depender obrigatoriamente de ERP.

O sistema deve funcionar utilizando:

```text
Etiqueta
+
Cadastro de rotas
+
Regras de CEP/cidade
```

Posteriormente a integração pode aumentar a precisão.

────────

26. Cadastro/aprendizado de destinos

Caso seja lida uma caixa cuja rota não possa ser determinada:

```text
🟠 DESTINO NÃO MAPEADO

CEP: 07661-435
Cidade: Mairiporã
```

O operador não deve decidir a rota.

A ocorrência vai para o gestor.

O gestor pode definir:

```text
Associar este destino à:
ROTA 07
```

Depois disso, leituras futuras podem utilizar essa regra.

────────

27. Auditoria

Toda leitura deve gerar registro.

Guardar:

```text
id
timestamp
usuário
transportadora
rota_atual
pedido
expedicao
volume
total_volumes
cliente
cidade
uf
cep
resultado
rota_identificada
origem_da_regra
```

Exemplo de resultado:

```text
CORRETO
ROTA_DIVERGENTE
DUPLICADO
DESTINO_DESCONHECIDO
ERRO_LEITURA
```

Exemplo de origem_da_regra:

```text
PEDIDO
EXPEDICAO
CLIENTE
CEP
CIDADE
REGIAO
```

────────

28. Perfis de acesso

ADMIN

Pode acessar tudo.

GESTOR

Pode:

• cadastrar transportadoras;
• cadastrar usuários;
• cadastrar rotas;
• visualizar operação;
• visualizar divergências;
• visualizar pedidos incompletos;
• liberar cargas;
• gerar relatórios.

OPERADOR

Pode:

• visualizar suas rotas autorizadas;
• iniciar uma operação;
• bipar caixas;
• visualizar apenas feedback operacional necessário.

O operador não deve acessar configurações administrativas.

────────

29. Multi-tenant / isolamento

Caso o sistema seja utilizado por várias empresas:

Toda informação operacional deve pertencer a uma organização/tenant.

Exemplo conceitual:

```text
tenant_id
transportadora_id
rota_id
usuario_id
```

Nenhum usuário de uma empresa pode visualizar dados de outra.

Se utilizado Supabase:

• RLS deve permanecer habilitado;
• políticas devem usar tenant_id ou organization_id;
• campos utilizados pelas policies devem possuir índices;
• evitar policies complexas desnecessariamente.

────────

30. Estrutura de dados sugerida

organizations

```text
id
name
created_at
```

transportadoras

```text
id
organization_id
nome
cnpj
status
created_at
```

usuarios

```text
id
organization_id
transportadora_id
nome
email
role
status
```

rotas

```text
id
organization_id
transportadora_id
codigo
nome
descricao
status
created_at
updated_at
```

Regras obrigatórias:

```text
transportadora_id NOT NULL
codigo NOT NULL
UNIQUE (codigo)
```

O codigo é globalmente único dentro da operação LOGDIS e não pode se repetir entre transportadoras diferentes.

rota_regras

```text
id
rota_id
tipo
valor_inicial
valor_final
prioridade
```

Tipos:

```text
PEDIDO
EXPEDICAO
CLIENTE
CEP
FAIXA_CEP
CIDADE
BAIRRO
REGIAO
```

operacoes

Representa uma conferência/carregamento.

A transportadora_id deve ser definida pela transportadora selecionada pelo usuário ao iniciar a operação.

```text
id
organization_id
transportadora_id
usuario_iniciou_id
data
status
iniciado_em
finalizado_em
liberado_em
liberado_por
```

Se houver necessidade de trabalhar uma rota/operação específica, pode existir também rota_id, mas a seleção da transportadora é obrigatória antes da bipagem.

pedidos

```text
id
organization_id
numero_pedido
numero_expedicao
cliente
cep
cidade
uf
total_volumes
rota_prevista_id
status
```

volumes

```text
id
pedido_id
numero_volume
codigo_unico
status
```

bipagens

```text
id
operation_id
pedido_id
volume_id
usuario_id
rota_atual_id
rota_identificada_id
resultado
raw_code
created_at
```

divergencias

```text
id
bipagem_id
tipo
status
resolvido_por
resolvido_em
observacao
```

────────

31. Regra de bipagem

Pseudo-fluxo:

```text
Usuário seleciona transportadora
        ↓
Receber leitura
        ↓
Interpretar etiqueta
        ↓
Extrair código de rota
        ↓
Identificar pedido/expedição/volume
        ↓
Verificar se volume já foi bipado
        ↓
SE duplicado
    → alertar duplicidade
SENÃO
        ↓
Consultar código de rota no IndexedDB
        ↓
Descobrir transportadora dona do código
        ↓
Comparar com transportadora selecionada
        ↓
SE compatível
    → registrar CORRETO
SENÃO
    → registrar DIVERGÊNCIA
        ↓
Atualizar pedido
        ↓
Verificar volumes faltantes
        ↓
Atualizar progresso da rota
        ↓
Enviar atualização ao painel gestor
```

────────

32. Performance

A bipagem precisa parecer instantânea.

Objetivo:

```text
Leitura → resposta visual:
preferencialmente < 300 ms
```

Evitar chamadas desnecessárias.

Sempre que possível:

1. ler código;
2. consultar dados necessários;
3. validar;
4. salvar;
5. responder.

O operador não deve esperar carregamento de página.

────────

33. Arquitetura Offline-First — Requisito obrigatório do MVP

O LOGDIS deve ser desenvolvido como offline-first.

A bipagem não pode depender de uma requisição ao servidor para validar cada caixa. A resposta ao operador precisa acontecer localmente, usando os dados previamente sincronizados no IndexedDB do navegador.

A regra principal é:

> **Ao abrir o sistema, se houver conexão, o LOGDIS deve sincronizar automaticamente os dados operacionais necessários com o IndexedDB antes de iniciar a operação.**

Como o operador escolherá a transportadora somente depois de abrir o sistema, a sincronização inicial deve trazer pelo menos:

```text
transportadoras ativas disponíveis ao usuário
todos os códigos de rota necessários
vínculo código de rota → transportadora
regras essenciais de validação
```

Assim, a escolha da transportadora e a validação das primeiras bipagens também funcionam offline.

O fluxo deve ser:

```text
ABRIU O SISTEMA
        ↓
Verificar conexão
        ↓
SE ONLINE
    → autenticar usuário
    → consultar alterações no servidor
    → atualizar IndexedDB
    → enviar bipagens locais ainda não sincronizadas
    → confirmar sincronização
    → liberar operação
        ↓
SE OFFLINE
    → verificar se existe base local válida
        ↓
    SE existe
        → permitir operação offline
    SENÃO
        → informar que é necessária uma primeira sincronização
```

────────

34. Dados que devem ficar no IndexedDB

Não é necessário copiar todo o banco de dados para o navegador.

Sincronizar apenas os dados necessários para a operação daquele usuário/transportadora.

Manter localmente, no mínimo:

```text
usuario_atual
transportadoras_ativas
codigos_de_rota
vinculo_codigo_rota_transportadora
regras das rotas
pedidos/expedições da operação atual
volumes esperados
clientes necessários para validação
CEPs/cidades/faixas de CEP
operações abertas
bipagens ainda não sincronizadas
metadados de sincronização
```

Não baixar histórico antigo desnecessariamente.

A sincronização deve priorizar os dados da operação atual e das rotas que aquele usuário pode executar.

────────

35. Sincronização ao abrir o sistema

Sempre que o aplicativo for aberto:

```text
1. Abrir IndexedDB
2. Ler data/hora da última sincronização
3. Verificar internet
4. Enviar primeiro os registros locais pendentes
5. Buscar alterações realizadas no servidor desde a última sincronização
6. Atualizar dados locais
7. Registrar nova data/hora de sincronização
8. Liberar a tela operacional
```

A interface pode exibir rapidamente:

```text
SINCRONIZANDO OPERAÇÃO...
```

e depois:

```text
✅ DADOS ATUALIZADOS

Última sincronização:
10:42
```

A sincronização deve ser incremental sempre que possível.

Evitar baixar novamente toda a base a cada abertura.

Utilizar campos como:

```text
updated_at
version
deleted_at
sync_version
```

para descobrir quais registros mudaram.

────────

36. Primeira utilização do dispositivo

Na primeira vez que o operador utilizar aquele navegador/dispositivo, ele ainda não terá os dados locais necessários.

Nesse caso:

```text
PRIMEIRO ACESSO
        ↓
Login online obrigatório
        ↓
Sincronização inicial
        ↓
Criação da base IndexedDB
        ↓
Download dos dados operacionais
        ↓
Dispositivo preparado para trabalhar offline
```

Depois da primeira sincronização, o sistema poderá abrir e trabalhar mesmo sem internet, desde que os dados locais ainda sejam válidos.

────────

37. Bipagem deve acontecer primeiro no dispositivo

Durante a operação, cada bipagem deve ser processada localmente.

Fluxo:

```text
BIP
 ↓
Ler código
 ↓
Consultar IndexedDB
 ↓
Identificar pedido/volume
 ↓
Descobrir rota esperada
 ↓
Comparar com rota atual
 ↓
Registrar bipagem local
 ↓
Mostrar resultado imediatamente
```

Somente depois:

```text
SE ONLINE
    → enviar bipagem ao servidor em segundo plano

SE OFFLINE
    → manter bipagem na fila de sincronização
```

Portanto:

> **A internet não pode estar no caminho crítico entre a bipagem e o feedback ao operador.**

Isso é essencial para manter velocidade e funcionamento dentro de galpões com sinal ruim.

────────

38. Fila local de sincronização

Toda bipagem deve possuir um identificador único gerado no dispositivo.

Exemplo:

```text
event_id: UUID
status_sync: PENDING
created_at_device: timestamp
device_id: identificador do dispositivo
```

Estados possíveis:

```text
PENDING
SYNCING
SYNCED
ERROR
```

Quando houver conexão:

```text
PENDING
   ↓
Enviar servidor
   ↓
Servidor confirma
   ↓
SYNCED
```

Se ocorrer erro:

```text
ERROR
```

e o sistema deve tentar novamente automaticamente.

────────

39. Idempotência e prevenção de duplicidade na sincronização

É obrigatório impedir que a mesma bipagem seja gravada duas vezes quando:

• a internet cair durante o envio;
• o dispositivo repetir uma requisição;
• o navegador for fechado durante uma sincronização;
• o operador abrir novamente o sistema;
• houver retry automático.

Cada evento deve possuir um event_id único.

O backend deve tratar esse campo como idempotente.

Exemplo:

```text
event_id:
550e8400-e29b-41d4-a716-446655440000
```

Se o mesmo evento chegar novamente:

```text
Servidor encontra event_id existente
→ não cria outra bipagem
→ retorna confirmação
```

────────

40. Conflitos offline

Pode acontecer de dois operadores biparem o mesmo volume em dispositivos diferentes enquanto ambos estiverem offline.

O dispositivo deve alertar duplicidade com base no que conhece localmente, porém a validação definitiva também precisa ocorrer no servidor durante a sincronização.

Exemplo:

```text
Operador A → Volume 1 → offline
Operador B → Volume 1 → offline
```

Ao sincronizar:

```text
Primeira bipagem válida
Segunda bipagem marcada como conflito/duplicidade
```

O painel do gestor deve mostrar a ocorrência.

Nunca apagar silenciosamente um evento.

────────

41. Sincronização em segundo plano durante a operação

Além da sincronização obrigatória ao abrir o sistema, enquanto houver internet o aplicativo deve sincronizar automaticamente em segundo plano.

Exemplo:

```text
BIP
BIP
BIP
     ↘ sincronização silenciosa
BIP
BIP
     ↘ sincronização silenciosa
```

Não bloquear o leitor enquanto os registros são enviados.

A interface do operador pode mostrar apenas um indicador discreto:

```text
● Sincronizado
```

ou:

```text
● 12 registros aguardando sincronização
```

────────

42. Reentrada no aplicativo

Sempre que o operador fechar e abrir novamente o PWA:

```text
1. verificar registros pendentes;
2. tentar enviá-los;
3. buscar atualizações;
4. atualizar IndexedDB;
5. continuar a operação.
```

Nenhuma bipagem pendente pode ser perdida ao:

• fechar navegador;
• bloquear celular;
• reiniciar aparelho;
• perder internet;
• atualizar o PWA.

────────

43. Atualização das regras de rota

Como as regras ficam disponíveis offline, mudanças realizadas pelo gestor precisam ser sincronizadas.

Exemplo:

```text
Gestor altera:
CEP 07661-435
Rota 03 → Rota 07
```

Ao próximo ciclo de sincronização:

```text
Servidor
↓
IndexedDB
↓
Nova regra entra em vigor no dispositivo
```

Guardar:

```text
updated_at
version
```

para garantir que o dispositivo saiba qual é a regra mais recente.

────────

44. Exclusões também precisam sincronizar

Não basta sincronizar apenas registros criados ou alterados.

Se o gestor:

```text
desativar uma rota
remover uma regra
cancelar uma operação
remover um pedido
```

o dispositivo também precisa receber essa informação.

Preferencialmente usar exclusão lógica/sinalização:

```text
deleted_at
active = false
```

em dados que participam da sincronização.

────────

45. Status de sincronização para o operador

Não mostrar informações técnicas.

Utilizar mensagens simples.

Tudo atualizado

```text
🟢 Sincronizado
```

Trabalhando sem internet

```text
🟠 Offline

As bipagens estão sendo salvas
neste dispositivo.
```

Registros aguardando envio

```text
🟠 Offline

37 leituras aguardando sincronização.
```

Erro persistente

```text
🔴 Não foi possível sincronizar

Suas leituras continuam salvas
neste dispositivo.
```

Nunca assustar o operador com erros técnicos do IndexedDB ou da API.

────────

46. Status de sincronização para o gestor

O gestor deve ter mais detalhes.

Por dispositivo/operador:

```text
João
Online
Última sincronização: 10:43
Pendentes: 0

Carlos
Offline
Última sincronização: 10:27
Pendentes conhecidas: 34
```

Isso permite saber se os números do dashboard podem ter bipagens locais que ainda não chegaram ao servidor.

────────

47. Banco local sugerido

Estrutura conceitual do IndexedDB:

```text
app_metadata
users
transportadoras
rotas
rota_regras
operacoes
pedidos
volumes
bipagens
sync_queue
```

app_metadata

```text
last_sync_at
sync_version
device_id
schema_version
```

sync_queue

```text
id
event_id
entity
operation
payload
created_at
status
retry_count
last_error
```

────────

48. Estratégia recomendada de sincronização

O modelo recomendado é:

```text
SERVER
  ↓ alterações
INDEXEDDB
  ↓
VALIDAÇÃO LOCAL
  ↓
BIPAGEM LOCAL
  ↓
SYNC_QUEUE
  ↓ quando online
SERVER
```

Ou seja:

> **Servidor = fonte central de verdade**

mas

> **IndexedDB = fonte operacional imediata durante a bipagem**

A arquitetura deve permitir que o operador continue trabalhando mesmo quando o servidor estiver temporariamente inacessível.

────────

49. Regra de atualização da página/PWA

O Service Worker pode armazenar:

• shell da aplicação;
• HTML base;
• CSS;
• JavaScript;
• ícones;
• assets essenciais.

O IndexedDB deve armazenar:

• dados operacionais;
• rotas;
• regras;
• pedidos;
• volumes;
• bipagens;
• fila de sincronização.

Não confundir:

```text
Service Worker / Cache Storage
→ arquivos do aplicativo

IndexedDB
→ dados da operação
```

────────

50. Critério de performance offline

A validação local deve ser extremamente rápida.

Meta:

```text
BIP
→ consulta IndexedDB
→ validação
→ feedback visual/sonoro

preferencialmente < 100 ms
```

O envio ao backend não deve interferir nesse tempo.

────────

51. Regra crítica do projeto

Considerar como requisito obrigatório:

> **Nenhuma bipagem deve depender de conexão com a internet para ser aceita, validada localmente e armazenada.**

E:

> **Sempre que houver conexão na abertura do sistema, os dados devem ser sincronizados antes do início da operação para que o IndexedDB tenha a versão mais atual possível das rotas, regras, pedidos e volumes.**

52. Feedback visual

Sugestão:

Verde

```text
CORRETO
```

Vermelho

```text
DIVERGÊNCIA
```

Laranja

```text
ATENÇÃO
DUPLICADO
PEDIDO INCOMPLETO
DESTINO NÃO MAPEADO
```

A leitura precisa ser compreendida pelo operador sem que ele precise ler textos longos.

────────

53. Feedback sonoro

Sugestão:

```text
CORRETO
→ bip curto

DIVERGÊNCIA
→ som grave/duplo

DUPLICADO
→ alerta diferente
```

Isso é importante em ambiente de depósito, pois o funcionário pode estar olhando para a caixa e não para a tela.

────────

54. Dashboard em tempo real

Se possível, atualizar automaticamente:

```text
Volumes bipados
%
Pedidos completos
Pedidos incompletos
Divergências
Operadores ativos
```

Tecnologias possíveis:

```text
Supabase Realtime
WebSocket
Server-Sent Events
Polling leve
```

Para o MVP, utilizar a solução mais simples e confiável disponível na stack atual.

────────

55. Indicadores do gestor

Indicadores realmente úteis:

```text
% da rota conferida
Volumes previstos
Volumes bipados
Volumes faltantes
Pedidos completos
Pedidos incompletos
Divergências
Duplicidades
Tempo de conferência
Média de bipagens/minuto
```

Evitar dashboards com indicadores sem impacto operacional.

────────

56. Relatório final da rota

Ao finalizar a operação, permitir gerar relatório.

Exemplo:

```text
ROTA 07 — MAIRIPORÃ

Data:
08/08/2026

Transportadora:
LOGDIS

Volumes previstos:
427

Volumes conferidos:
427

Pedidos:
186

Pedidos completos:
186

Divergências:
3

Divergências resolvidas:
3

Operadores:
João
Carlos
Marcos

Início:
08:13

Fim:
10:42

Status:
LIBERADA
```

────────

57. Histórico

O gestor deve conseguir consultar:

```text
Hoje
Ontem
Últimos 7 dias
Últimos 30 dias
Período personalizado
```

Filtros:

```text
Transportadora
Rota
Operador
Cliente
Pedido
Expedição
Status
```

────────

58. Busca rápida

O gestor deve conseguir pesquisar diretamente:

```text
Pedido
Expedição
Cliente
CEP
Código do volume
```

Exemplo:

```text
86945574
```

Resultado:

```text
Pedido 86945574

Rota:
07 — Mairiporã

Volumes:
2/2

Status:
COMPLETO

Operação:
08/08/2026

Última leitura:
10:38:31
```

────────

59. Mapa para gestão

O mapa não é necessário para o operador.

Ele pode ser útil no painel do gestor para:

• visualizar cobertura das rotas;
• identificar cidades atendidas;
• visualizar concentração de destinos;
• entender rapidamente a área de atuação de cada rota;
• apoiar criação e ajuste de rotas.

O mapa deve ser uma ferramenta de gestão, não um enfeite.

Pode ser implementado com:

```text
OpenStreetMap
Leaflet
```

evitando custos desnecessários no MVP.

────────

60. O que NÃO fazer

Não transformar o sistema em um ERP.

Evitar no MVP:

• financeiro;
• emissão fiscal;
• estoque completo;
• gestão de frota complexa;
• manutenção de veículos;
• CRM;
• controle de combustível;
• otimizador sofisticado de rotas;
• dezenas de dashboards sem função operacional.

O LOGDIS deve resolver muito bem:

> **A caixa certa precisa entrar na rota certa.**

────────

61. Prioridades do MVP

P0 — Obrigatório

• autenticação;
• usuários;
• transportadoras;
• rotas;
• vínculo usuário/transportadora;
• regras de rota;
• tela de bipagem;
• leitura QR/barcode;
• interpretação da etiqueta;
• identificação automática de rota;
• caixa correta;
• rota divergente;
• prevenção de duplicidade;
• registro das bipagens;
• painel do gestor;
• acompanhamento da rota;
• histórico;
• PWA instalável;
• IndexedDB;
• sincronização automática ao abrir;
• validação local das bipagens;
• fila offline de sincronização;
• idempotência dos eventos;
• funcionamento sem internet após a primeira sincronização.

P1 — Muito importante

• controle de volumes 1/2, 2/2;
• pedidos incompletos;
• liberação da carga;
• feedback sonoro;
• sincronização incremental;
• status de sincronização por dispositivo;
• tratamento de conflitos offline;
• relatório final.

P2 — Evolução

• integração ERP/WMS;
• importação CSV/XLSX;
• mapa;
• produtividade;
• notificações;
• analytics avançado.

────────

62. Critério de sucesso do MVP

O MVP estará cumprindo seu objetivo quando for possível executar este fluxo:

```text
GESTOR
↓
Cadastra transportadora
↓
Cadastra rota
↓
Define destinos da rota
↓
Vincula operadores
↓

OPERADOR
↓
Entra no sistema
↓
Escolhe a transportadora terceira
↓
Inicia a bipagem
↓
Bipa a caixa
↓

LOGDIS
↓
Lê a etiqueta
↓
Extrai o código de rota
↓
Consulta localmente qual transportadora é dona do código
↓
Compara com a transportadora selecionada
↓

CORRETO
ou
DIVERGENTE
↓

GESTOR
↓
Acompanha toda a operação em tempo real
```

────────

63. Princípio de UX

Sempre utilizar esta pergunta para decidir qualquer nova funcionalidade:

> **Isso ajuda o operador a bipar mais rápido ou ajuda o gestor a evitar um erro de expedição?**

Se a resposta for não, provavelmente não pertence ao MVP.

────────

64. Resumo do posicionamento

O LOGDIS não deve ser apresentado apenas como um leitor de código de barras.

O produto deve ser apresentado como:

> **Plataforma inteligente de conferência de expedição que garante que cada volume seja carregado na rota correta e identifica pedidos incompletos antes da saída do veículo.**

Valor principal:

```text
Menos erro
Menos retrabalho
Mais velocidade
Mais rastreabilidade
Carga conferida antes de sair
```

A simplicidade deve estar no operador.

A inteligência deve estar no sistema.

E a visão completa deve estar no painel do gestor.

────────

Regra de negócio consolidada — Transportadora x Código de rota

Esta regra deve ser tratada como central e obrigatória em toda a implementação:

```text
TRANSPORTADORA TERCEIRA
        ↓
possui
        ↓
CÓDIGOS DE ROTA ÚNICOS
```

Exemplo:

```text
R07 → Transportadora Alfa
R12 → Transportadora Alfa
R21 → Transportadora Beta
R35 → Transportadora Gama
```

Não permitido:

```text
R07 → Transportadora Alfa
R07 → Transportadora Beta
```

Ao iniciar:

```text
Usuário escolhe:
TRANSPORTADORA ALFA
```

Na bipagem:

```text
Etiqueta → código R07
IndexedDB → R07 pertence à Transportadora Alfa
Resultado → ✅ CORRETO
```

ou:

```text
Etiqueta → código R21
IndexedDB → R21 pertence à Transportadora Beta
Usuário está conferindo → Transportadora Alfa
Resultado → 🔴 DIVERGÊNCIA
```

Essa comparação deve ocorrer localmente no IndexedDB, sem depender da internet, para manter a resposta instantânea durante a operação.

────────

Diretriz obrigatória de UX — Heurísticas de Nielsen

Toda a experiência do LOGDIS deve seguir as 10 heurísticas de usabilidade de Jakob Nielsen, adaptadas ao contexto operacional de logística.

A aplicação deve parecer simples mesmo quando existir bastante inteligência por trás.

1. Visibilidade do estado do sistema

O usuário precisa saber imediatamente o que está acontecendo.

Exemplos obrigatórios:

```text
🟢 Sincronizado
🟠 Trabalhando offline
🟠 24 leituras aguardando sincronização
🔵 Sincronizando dados...
🔴 Erro de sincronização
```

Durante a operação:

```text
Transportadora ativa
Operação atual
Quantidade bipada
Última leitura
Status da última leitura
```

No painel de gestão:

```text
Rotas em andamento
Rotas finalizadas
Pendências
Divergências
Dispositivos offline
Última atualização
```

Nunca deixar o usuário em dúvida se uma ação foi salva ou processada.

────────

2. Correspondência entre sistema e mundo real

Usar linguagem da operação logística.

Preferir:

```text
Bipar caixa
Transportadora
Código de rota
Carga
Rota
Pedido
Volume
Divergência
Pedido incompleto
Liberar carga
```

Evitar termos técnicos como:

```text
event_id
sync_queue
IndexedDB
payload
mutation
cache
```

Esses termos podem existir internamente, mas não devem aparecer para o operador.

────────

3. Controle e liberdade do usuário

O usuário deve conseguir corrigir ações sem medo.

Exemplos:

• voltar antes de iniciar uma operação;
• trocar transportadora antes da primeira bipagem;
• encerrar operação;
• corrigir uma seleção realizada por engano;
• gestor resolver uma divergência;
• gestor reabrir uma operação quando autorizado.

A troca de transportadora durante uma operação com bipagens deve exigir confirmação explícita.

────────

4. Consistência e padrões

Manter padrões em todas as telas.

Exemplo:

```text
Verde = correto / concluído
Vermelho = divergência / erro
Laranja = atenção / pendência
Azul ou neutro = informação / ação principal
```

Botões equivalentes devem sempre ter o mesmo texto, posição e comportamento.

Não usar um termo como Finalizar em uma tela e Concluir carga em outra para a mesma ação.

────────

5. Prevenção de erros

O sistema deve impedir o erro antes de depender de mensagens posteriores.

Exemplos:

• código de rota não pode ser cadastrado duas vezes;
• volume já bipado não pode ser contabilizado novamente;
• impedir troca acidental de transportadora;
• não liberar carga com pendências sem alerta;
• validar campos ao cadastrar rota;
• confirmar ações destrutivas;
• impedir operação sem sincronização inicial quando o dispositivo nunca foi preparado.

────────

6. Reconhecimento em vez de memorização

O usuário não deve decorar códigos ou procedimentos.

Exemplo:

Em vez de exigir:

```text
Digite o código da transportadora
```

mostrar:

```text
Transportadora Alfa
Transportadora Beta
Transportadora Gama
```

Ao exibir uma rota:

```text
R07
Mairiporã / Terra Preta
Transportadora Alfa
```

Não mostrar apenas R07 quando houver espaço para contexto.

────────

7. Flexibilidade e eficiência de uso

O operador precisa de máxima velocidade.

Fluxo ideal:

```text
Abrir
↓
Sincronizar
↓
Selecionar transportadora
↓
Bipar
↓
Bipar
↓
Bipar
```

Não abrir modais ou telas intermediárias após cada leitura.

No painel do gestor, permitir:

• filtros rápidos;
• busca;
• atalhos;
• agrupamento por status;
• ordenação;
• ações em lote quando fizer sentido.

────────

8. Design estético e minimalista

Cada tela deve mostrar somente o necessário para aquela função.

Na operação:

• código lido;
• resultado;
• transportadora;
• contador;
• status da conexão.

Na gestão:

• visão geral;
• exceções;
• tendências úteis;
• ações necessárias.

Não encher o dashboard com gráficos que não ajudam uma decisão.

────────

9. Ajudar a reconhecer, diagnosticar e recuperar erros

Mensagens devem explicar:

```text
O que aconteceu
Por que aconteceu
O que fazer
```

Ruim:

```text
Erro 409
```

Bom:

```text
Este volume já foi bipado por Carlos às 10:32.
```

Ruim:

```text
Rota inválida
```

Bom:

```text
O código R21 pertence à Transportadora Beta.
Você está conferindo a Transportadora Alfa.
```

────────

10. Ajuda e documentação

O sistema deve ser simples o suficiente para quase não precisar de manual.

Mesmo assim, disponibilizar:

• ajuda curta nas telas administrativas;
• tooltip em campos menos óbvios;
• instrução inicial no primeiro acesso;
• explicação simples para status;
• FAQ ou ajuda rápida para gestores.

Evitar tutoriais longos para operadores.

────────

Experiência do operador

A parte operacional deve ser projetada para uso em celular e ambientes de depósito.

Características:

• botões grandes;
• alto contraste;
• tipografia legível;
• leitura rápida;
• pouco texto;
• feedback visual + sonoro + vibração;
• navegação com uma mão;
• sem menus complexos;
• sem campos pequenos;
• sem dependência de hover;
• evitar teclado virtual durante a operação;
• preservar o leitor aberto para bipagens consecutivas.

A tela deve continuar funcional mesmo sob conexão instável ou inexistente.

────────

Experiência do gestor

A gestão precisa ser simples, fluida e muito mais visual que a operação.

O gestor deve conseguir entender a situação geral em poucos segundos.

Home do gestor

Priorizar:

```text
Operações em andamento
% concluído
Volumes pendentes
Pedidos incompletos
Divergências
Transportadoras com problemas
Última sincronização dos dispositivos
```

A primeira tela deve responder:

> **Existe alguma carga que precisa da minha atenção agora?**

Se não houver problema:

```text
🟢 Operação normal
```

Se houver:

```text
🔴 3 rotas precisam de atenção
```

────────

Estrutura recomendada para o painel de gestão

Navegação simples:

```text
Visão geral
Operações
Transportadoras
Rotas
Divergências
Pedidos incompletos
Mapa
Histórico
Relatórios
Configurações
```

Evitar menu com dezenas de itens.

No mobile/tablet, utilizar navegação adaptada ao tamanho de tela.

────────

Dashboard orientado a exceções

O painel não deve obrigar o gestor a procurar problemas.

Problemas devem aparecer primeiro.

Exemplo:

```text
PRECISA DE ATENÇÃO

3 divergências de rota
7 pedidos incompletos
1 dispositivo sem sincronizar há 35 min
2 operações aguardando liberação
```

Depois:

```text
OPERAÇÃO GERAL

4.315 / 4.820 volumes
89,5% concluído
```

Esse modelo é preferível a dashboards cheios de gráficos genéricos.

────────

Filtros do gestor

Filtros devem ser rápidos e persistentes quando fizer sentido.

Exemplos:

```text
Hoje
Ontem
7 dias
30 dias
```

e:

```text
Transportadora
Rota
Status
Operador
Cidade
```

Permitir busca por:

```text
Pedido
Expedição
Código de rota
Cliente
CEP
Volume
```

────────

Drill-down

Todos os indicadores importantes devem permitir aprofundamento.

Exemplo:

```text
7 pedidos incompletos
```

Ao clicar:

```text
→ abrir lista dos 7 pedidos
```

Ao clicar em um pedido:

```text
→ mostrar volumes encontrados e faltantes
```

Evitar cards que mostram informação, mas não permitem agir sobre ela.

────────

OpenStreetMap no painel de gestão

A parte de mapas deve ser voltada exclusivamente à gestão e análise, não ao operador que está bipando.

Utilizar preferencialmente:

```text
OpenStreetMap
+
Leaflet
```

ou outra biblioteca aberta compatível com a arquitetura atual.

O mapa não deve ser colocado apenas por estética.

Ele deve responder perguntas operacionais.

────────

Objetivos do mapa

O gestor deve conseguir visualizar:

• cobertura geográfica das transportadoras;
• rotas cadastradas;
• cidades e regiões atendidas;
• concentração de entregas;
• destinos de uma rota;
• divergências geográficas;
• pedidos por região;
• volume de operação por localidade.

────────

Tela Mapa

Criar uma área dedicada:

```text
MAPA OPERACIONAL
```

Filtros:

```text
Transportadora
Rota
Data
Status
Cidade
```

Camadas sugeridas:

```text
Rotas
Destinos
Divergências
Volumes
```

Não habilitar todas por padrão se isso deixar o mapa poluído.

────────

Visualização de rotas no mapa

Ao selecionar uma transportadora:

```text
Transportadora Alfa
```

mostrar apenas as rotas dela.

Ao selecionar:

```text
R07 — Mairiporã / Terra Preta
```

destacar:

• área atendida;
• destinos;
• quantidade de pedidos;
• quantidade de volumes;
• divergências relacionadas.

────────

Pins e clusters

Quando houver muitos pontos próximos, utilizar agrupamento de marcadores.

Exemplo:

```text
[ 38 ]
```

em vez de desenhar 38 pins sobrepostos.

Ao aproximar o zoom, o cluster se divide.

Isso melhora desempenho e legibilidade.

────────

Heatmap

Heatmap pode ser utilizado se houver volume de dados suficiente.

Exemplo:

```text
Concentração de entregas
Concentração de divergências
Concentração de volumes
```

Não implementar heatmap apenas para deixar o dashboard “bonito”.

Só utilizar quando ajudar uma análise real.

────────

Popup do mapa

Ao clicar em um destino, exibir informações úteis:

```text
Mairiporã/SP

Transportadora:
Transportadora Alfa

Código de rota:
R07

Pedidos:
32

Volumes:
76

Divergências:
2
```

Adicionar ação:

```text
[ Ver operação ]
```

────────

Mapa e divergências

Uma visualização útil:

```text
Divergências por localização
```

Exemplo:

O gestor seleciona:

```text
Últimos 7 dias
```

e consegue identificar visualmente se uma cidade, região ou rota está apresentando erros recorrentes.

Isso pode indicar:

• cadastro de rota incorreto;
• separação incorreta;
• operador selecionando transportadora errada;
• etiqueta com informação errada;
• alteração necessária na operação.

────────

Geocodificação

Quando necessário converter endereço/CEP em coordenadas:

Priorizar serviços abertos compatíveis com OpenStreetMap.

Para MVP e baixo volume, considerar Nominatim com uso responsável.

Regras importantes:

• armazenar latitude/longitude depois de geocodificar;
• não geocodificar o mesmo endereço repetidamente;
• criar cache;
• não depender de uma chamada ao serviço durante a bipagem;
• respeitar limites e políticas do provedor utilizado.

Geocodificação deve acontecer no cadastro/importação/sincronização, nunca no caminho crítico da bipagem.

────────

Tiles do OpenStreetMap

A implementação deve respeitar a política de uso dos servidores públicos de tiles do OpenStreetMap.

Para MVP de baixo tráfego pode ser suficiente utilizar a infraestrutura pública dentro das regras permitidas.

Se o volume crescer, preparar a aplicação para utilizar:

• provedor de tiles compatível;
• infraestrutura própria;
• outro serviço baseado em OpenStreetMap.

Não acoplar o sistema a um único provedor.

────────

Mapa offline

Não é necessário tornar o mapa totalmente offline no primeiro MVP.

A operação de bipagem deve funcionar offline.

O mapa é ferramenta de gestão e pode exigir conexão.

Prioridade:

```text
Bipagem offline → obrigatório
Mapa offline → não obrigatório no MVP
```

────────

Responsividade da gestão

O painel deve funcionar muito bem em:

```text
Desktop
Notebook
Tablet
Celular
```

Desktop deve aproveitar o espaço para:

• tabela + filtros;
• mapa;
• painel lateral;
• cards.

No celular:

• uma coluna;
• cards empilhados;
• filtros em painel recolhível;
• tabelas adaptadas;
• ações principais sempre acessíveis.

────────

Tabelas administrativas

Tabelas devem seguir boas práticas:

• cabeçalho fixo quando houver muitas linhas;
• ordenação;
• busca;
• filtros;
• paginação ou virtualização quando necessário;
• estados vazios claros;
• loading skeleton;
• ações agrupadas;
• evitar excesso de colunas.

Em celular, considerar cards ou linhas expansíveis em vez de tabela horizontal impossível de usar.

────────

Estados vazios

Nunca mostrar uma página branca.

Exemplo:

```text
Nenhuma divergência encontrada.

Tudo certo nesta operação.
```

ou:

```text
Nenhuma rota cadastrada.

Cadastre a primeira rota para começar.
[ Cadastrar rota ]
```

────────

Loading e sincronização

Não utilizar loaders longos bloqueando toda a aplicação quando não for necessário.

Preferir:

• skeletons;
• atualização otimista;
• sincronização em segundo plano;
• feedback discreto.

Na bipagem, nunca bloquear o leitor enquanto outra bipagem está sendo sincronizada.

────────

Login

A tela de login deve ser simples e direta.

Mostrar somente:

```text
Logo LOGDIS

E-mail
Senha

[ Entrar ]
```

Opcional:

```text
Esqueci minha senha
```

Evitar textos comerciais dentro do sistema operacional.

Após login:

```text
Sincronizando dados...
```

e depois direcionar o usuário para a experiência adequada ao seu perfil.

Operador

```text
Selecionar transportadora
→ iniciar bipagem
```

Gestor

```text
Dashboard
```

Admin

```text
Dashboard administrativo
```

────────

Primeiro acesso no dispositivo

Se o dispositivo ainda não possuir base local:

```text
Preparando este dispositivo
```

Mostrar progresso simples:

```text
Transportadoras
Rotas
Pedidos
Volumes
```

Ao concluir:

```text
✅ Dispositivo pronto para operar offline
```

Não exibir detalhes técnicos.

────────

Acessibilidade

Implementar no mínimo:

• contraste adequado;
• foco visível;
• labels em inputs;
• tamanho de área clicável confortável;
• suporte a teclado no painel de gestão;
• não depender apenas de cor;
• ícone + texto para status importantes;
• aria-label onde necessário;
• mensagens compreensíveis por leitores de tela.

Exemplo:

Não usar apenas:

```text
🔴
```

Usar:

```text
🔴 Divergência de rota
```

────────

Performance percebida

Além da performance técnica, priorizar performance percebida.

A aplicação deve responder imediatamente ao toque.

Meta operacional:

```text
Bipagem → feedback local < 100 ms, quando possível
```

Gestão:

• abrir dashboard rapidamente;
• carregar dados essenciais primeiro;
• carregar mapas e dados secundários depois;
• evitar consultas gigantes na abertura.

────────

Regra para qualquer alteração visual

Antes de criar ou modificar uma tela, responder:

1. Qual tarefa o usuário quer concluir?
2. Qual informação ele precisa para tomar decisão?
3. Qual é a ação principal?
4. O que pode ser removido?
5. O fluxo exige menos cliques que a versão anterior?
6. A tela continua utilizável em celular?
7. Existe feedback claro?
8. O usuário consegue recuperar um erro?

────────

Checklist obrigatório para a IA antes de considerar a melhoria concluída

Operação

☐ usuário consegue escolher a transportadora rapidamente;
☐ bipagem não depende da internet;
☐ código da rota é validado localmente;
☐ resposta correta/divergente é imediata;
☐ duplicidade é detectada;
☐ status offline é claro;
☐ fila pendente não bloqueia operação.

Gestão

☐ dashboard destaca exceções;
☐ filtros são fáceis de usar;
☐ indicadores possuem drill-down;
☐ divergências são fáceis de localizar;
☐ mapa possui função operacional;
☐ interface funciona em desktop e celular;
☐ nenhuma tela possui informação desnecessária.

Nielsen

☐ estado do sistema visível;
☐ linguagem da operação;
☐ ações reversíveis quando possível;
☐ padrões consistentes;
☐ prevenção de erros;
☐ reconhecimento em vez de memorização;
☐ eficiência para usuários recorrentes;
☐ design minimalista;
☐ erros explicativos;
☐ ajuda contextual quando necessária.

Offline

☐ sincronização automática ao abrir;
☐ IndexedDB atualizado;
☐ primeira sincronização tratada;
☐ fila local persistente;
☐ idempotência no backend;
☐ retries seguros;
☐ conflitos tratados;
☐ nenhuma bipagem perdida ao fechar o navegador.

────────

Princípio final de produto

O LOGDIS deve passar a sensação de:

> **“Eu abro, escolho a transportadora e bipo. O sistema cuida do resto.”**

Para o gestor:

> **“Eu abro o painel e em poucos segundos sei onde existe problema e o que precisa ser resolvido.”**

A complexidade deve existir na arquitetura, não na experiência do usuário.