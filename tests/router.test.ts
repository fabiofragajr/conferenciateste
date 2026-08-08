import assert from 'node:assert/strict';
import {
  rotaDe, caminhoDe, destinoDeEntrada, resolver, telaDoClique
} from '../src/lib/router.ts';
import type { Tela, CliqueBruto, LinkBruto } from '../src/lib/router.ts';

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

// `/painel/inicio` É aceito (não devolve null), mesmo sendo o mesmo lugar que
// `/painel`: um caminho que ninguém reconhece sai do interceptador de clique
// e recarrega o app inteiro — pior do que aceitar e deixar `caminhoDe`
// canonizar. `caminhoDe` nunca PRODUZ `/painel/inicio`, só `/painel` — então
// `ir()` e a normalização de abertura corrigem a barra sozinhas, sem caso
// especial aqui.
const painelInicio = rotaDe('/painel/inicio');
assert.deepEqual(painelInicio, { tela: 'painel', secao: 'inicio' });
assert.ok(painelInicio);
assert.equal(caminhoDe(painelInicio), '/painel', 'canonização: rotaDe aceita, caminhoDe devolve pro único caminho válido');

/* -------------------------------------------------------- caminhoDe ------ */

assert.equal(caminhoDe({ tela: 'entrar' }), '/entrar');
assert.equal(caminhoDe({ tela: 'painel', secao: 'inicio' }), '/painel');
assert.equal(caminhoDe({ tela: 'painel', secao: 'ocorrencias' }), '/painel/ocorrencias');

// Ida e volta: todo caminho gerado precisa ser reconhecido de volta — para
// TODA tela, não só as seções do painel. Uma tela nova (`entrar`, `bipagem`,
// `relatorio` inclusive) que gere caminho que `rotaDe` não reconhece de volta
// recarregaria a página inteira em produção, sem erro de tipo e sem teste
// vermelho se só as seções fossem cobertas aqui.
const todasAsTelas: Tela[] = [
  { tela: 'entrar' },
  { tela: 'bipagem' },
  { tela: 'relatorio' },
  ...(['inicio', 'divergencias', 'incompletos', 'conferencias', 'ocorrencias',
    'desempenho', 'indicadores', 'mapa', 'relatorios', 'pessoas', 'transportadoras',
    'rotas', 'sincronizacao'] as const).map((secao): Tela => ({ tela: 'painel', secao }))
];
for (const t of todasAsTelas) {
  assert.deepEqual(rotaDe(caminhoDe(t)), t, `ida e volta falhou em ${JSON.stringify(t)}`);
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

/* -------------------------------------------------------- telaDoClique --- */
//
// A única lógica deste módulo cujo defeito não aparece como teste vermelho
// nem como erro de tipo — aparece como "a página piscou". Por isso cada regra
// do predicado de clique tem caso próprio, um de cada vez.

const ORIGEM = 'https://app.exemplo.com';

const clique = (p: Partial<CliqueBruto> = {}): CliqueBruto =>
  ({ defaultPrevented: false, botao: 0, meta: false, ctrl: false, shift: false, alt: false, ...p });

const link = (href: string, p: Partial<LinkBruto> = {}): LinkBruto =>
  ({ href, alvo: '', temDownload: false, hrefEscrito: null, ...p });

// Caso normal: clique simples num link interno reconhecido navega.
assert.deepEqual(
  telaDoClique(clique(), link(`${ORIGEM}/painel/rotas`), ORIGEM, '/painel'),
  { tela: 'painel', secao: 'rotas' }
);

// preventDefault já resolvido por outra coisa: o roteador não pisa em nada.
assert.equal(telaDoClique(clique({ defaultPrevented: true }), link(`${ORIGEM}/painel/rotas`), ORIGEM, '/painel'), null);

// Só botão esquerdo (0). Botão do meio (1) normalmente abre em aba nova.
assert.equal(telaDoClique(clique({ botao: 1 }), link(`${ORIGEM}/painel/rotas`), ORIGEM, '/painel'), null);

// Cada modificador sozinho já libera o navegador — nenhum é interceptado.
assert.equal(telaDoClique(clique({ meta: true }), link(`${ORIGEM}/painel/rotas`), ORIGEM, '/painel'), null, 'meta+clique abre aba/janela nova');
assert.equal(telaDoClique(clique({ ctrl: true }), link(`${ORIGEM}/painel/rotas`), ORIGEM, '/painel'), null, 'ctrl+clique abre aba nova');
assert.equal(telaDoClique(clique({ shift: true }), link(`${ORIGEM}/painel/rotas`), ORIGEM, '/painel'), null, 'shift+clique abre janela nova');
// alt/option+clique é "salvar link como" no Chrome e no Firefox — interceptar
// rouba um download legítimo.
assert.equal(telaDoClique(clique({ alt: true }), link(`${ORIGEM}/painel/rotas`), ORIGEM, '/painel'), null, 'alt+clique é "salvar link como"');

// Alvo vazio ou "_self" continua sendo a mesma aba — não muda nada.
assert.deepEqual(
  telaDoClique(clique(), link(`${ORIGEM}/painel/rotas`, { alvo: '_self' }), ORIGEM, '/painel'),
  { tela: 'painel', secao: 'rotas' }
);
// Qualquer outro alvo o app não controla — não só "_blank".
assert.equal(telaDoClique(clique(), link(`${ORIGEM}/painel/rotas`, { alvo: '_blank' }), ORIGEM, '/painel'), null);
assert.equal(telaDoClique(clique(), link(`${ORIGEM}/painel/rotas`, { alvo: '_top' }), ORIGEM, '/painel'), null, '_top não é o app que decide');
assert.equal(telaDoClique(clique(), link(`${ORIGEM}/painel/rotas`, { alvo: '_parent' }), ORIGEM, '/painel'), null, '_parent idem');
assert.equal(telaDoClique(clique(), link(`${ORIGEM}/painel/rotas`, { alvo: 'janelaNomeada' }), ORIGEM, '/painel'), null, 'alvo nomeado idem');

// Link de download é download, não navegação.
assert.equal(telaDoClique(clique(), link(`${ORIGEM}/painel/rotas`, { temDownload: true }), ORIGEM, '/painel'), null);

// Âncora pura ("#topo", sem caminho escrito): não troca de tela, só rola.
assert.equal(
  telaDoClique(clique(), link(`${ORIGEM}/painel/rotas#topo`, { hrefEscrito: '#topo' }), ORIGEM, '/painel/rotas'),
  null
);

// Origem diferente da do app: link externo, e o mesmo teste cobre mailto:,
// tel: e javascript:, que o navegador resolve com origem opaca ("null").
assert.equal(telaDoClique(clique(), link('https://outro-site.com/painel/rotas'), ORIGEM, '/painel'), null);
assert.equal(telaDoClique(clique(), link('mailto:contato@logdis.com.br'), ORIGEM, '/painel'), null);
assert.equal(telaDoClique(clique(), link('tel:+551140028922'), ORIGEM, '/painel'), null);
assert.equal(telaDoClique(clique(), link('javascript:void(0)'), ORIGEM, '/painel'), null);

// Caminho que rotaDe não reconhece: sem tela pra ir, deixa o navegador agir.
assert.equal(telaDoClique(clique(), link(`${ORIGEM}/painel/nao-existe`), ORIGEM, '/painel'), null);

// <a> sem href (usada só como gancho de clique — botão de fechar modal, por
// exemplo) tem `a.href === ''` no DOM. Não é hyperlink de verdade: nada pra
// navegar, e não pode lançar (new URL('') lança "Invalid URL").
assert.equal(telaDoClique(clique(), link(''), ORIGEM, '/painel'), null);

// Âncora NUMA rota ("/painel/rotas#topo"): se o caminho resolve pra tela que
// já está na barra, é rolagem dentro da própria página — devolve null e
// deixa o navegador rolar. Interceptar aqui chama preventDefault e mata a
// rolagem: o link "não faz nada".
assert.equal(
  telaDoClique(
    clique(),
    link(`${ORIGEM}/painel/rotas#topo`, { hrefEscrito: '/painel/rotas#topo' }),
    ORIGEM,
    '/painel/rotas'
  ),
  null,
  'âncora pra tela onde já estou é rolagem, não navegação'
);
// Âncora para OUTRA tela ainda é navegação de verdade.
assert.deepEqual(
  telaDoClique(
    clique(),
    link(`${ORIGEM}/painel/pessoas#topo`, { hrefEscrito: '/painel/pessoas#topo' }),
    ORIGEM,
    '/painel/rotas'
  ),
  { tela: 'painel', secao: 'pessoas' },
  'âncora pra OUTRA tela ainda navega'
);

console.log('ROUTER_OK');
