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
// `inicio` não tem caminho próprio — ele É /painel. Aceitar os dois criaria duas
// URLs para a mesma tela, e o item ativo do menu piscaria entre elas.
assert.equal(rotaDe('/painel/inicio'), null);

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
