// As regras do menu recolhível, sem navegador.
//
// A que mais importa não é o abre-e-fecha: é a de que recolher um grupo não
// pode apagar a contagem de divergências da tela. Aqui se prova a metade pura
// dela (o estado); a outra metade — o badge somado aparecendo no cabeçalho —
// é DOM, e vive em `painel-shell.test.mjs`.

import assert from 'node:assert/strict';
import {
  abrirGrupoDaSecao, alternar, estaAberto, idDoGrupo, lerFechados, serializar
} from '../src/lib/shell/grupos.ts';

let falhou = false;
const passo = (nome: string, fn: () => void): void => {
  try { fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', (e as Error).message); falhou = true; }
};

passo('sem nada salvo, todo grupo nasce aberto', () => {
  const f = lerFechados(null);
  assert.equal(f.size, 0);
  assert.ok(estaAberto(f, 'Operação'));
  assert.ok(estaAberto(f, 'Cadastros'));
});

passo('grupo que ninguém salvou aparece aberto, mesmo com estado antigo guardado', () => {
  // A razão de guardar os FECHADOS e não os abertos: um grupo criado numa
  // versão futura não estaria na lista dos abertos e nasceria recolhido para
  // todo mundo que já tem preferência salva — escondendo uma seção nova que
  // ninguém pediu para esconder.
  const f = lerFechados(JSON.stringify(['Cadastros']));
  assert.ok(!estaAberto(f, 'Cadastros'));
  assert.ok(estaAberto(f, 'Grupo Que Ainda Não Existia'));
});

passo('preferência corrompida não impede o painel de abrir', () => {
  for (const lixo of ['{', 'null', '"texto"', '{"a":1}', '', undefined]) {
    assert.equal(lerFechados(lixo).size, 0, `entrada: ${JSON.stringify(lixo)}`);
  }
  // Lista com sujeira dentro: fica o que presta, o resto some.
  const f = lerFechados(JSON.stringify(['Análise', 7, null, { a: 1 }]));
  assert.deepEqual([...f], ['Análise']);
});

passo('alternar não muda o conjunto recebido', () => {
  const antes = new Set(['Sistema']);
  const depois = alternar(antes, 'Análise');
  assert.deepEqual([...antes], ['Sistema'], 'o conjunto de entrada foi mutado');
  assert.deepEqual([...depois].sort(), ['Análise', 'Sistema']);
  assert.deepEqual([...alternar(depois, 'Sistema')], ['Análise']);
});

passo('o grupo da seção visível é aberto à força', () => {
  // Chegar em /painel/rotas por URL colada com "Cadastros" recolhido deixaria a
  // página atual invisível no menu.
  const fechados = new Set(['Cadastros', 'Sistema']);
  const abertos = abrirGrupoDaSecao(fechados, 'Cadastros');
  assert.ok(estaAberto(abertos, 'Cadastros'));
  assert.ok(!estaAberto(abertos, 'Sistema'), 'abriu um grupo que não era o da seção');
});

passo('sem nada a abrir, devolve o MESMO conjunto', () => {
  // Identidade, e não igualdade: é com `!==` que o shell decide se precisa
  // gravar no armazenamento e repintar. Devolver uma cópia nova a cada troca de
  // seção faria o painel escrever em disco em toda navegação.
  const f = new Set(['Cadastros']);
  assert.equal(abrirGrupoDaSecao(f, 'Operação'), f);
  assert.equal(abrirGrupoDaSecao(f, undefined), f);
});

passo('ida e volta pelo armazenamento preserva o estado', () => {
  const f = new Set(['Operação', 'Análise']);
  assert.deepEqual([...lerFechados(serializar(f))].sort(), ['Análise', 'Operação']);
});

passo('o id do grupo é estável, sem acento, e separado por árvore', () => {
  assert.equal(idDoGrupo('lat', 'Operação'), 'lat-grupo-operacao');
  assert.equal(idDoGrupo('folha', 'Operação'), 'folha-grupo-operacao');
  assert.equal(idDoGrupo('lat', 'Análise'), 'lat-grupo-analise');
  assert.equal(idDoGrupo('lat', 'Códigos & Rotas'), 'lat-grupo-codigos-rotas');
  // Nome só de símbolos não pode gerar `lat-grupo-`, que é `aria-controls` quebrado.
  assert.equal(idDoGrupo('lat', '···'), 'lat-grupo-x');
});

passo('os quatro grupos do painel geram ids distintos', () => {
  const ids = ['Operação', 'Análise', 'Cadastros', 'Sistema'].map((g) => idDoGrupo('lat', g));
  assert.equal(new Set(ids).size, 4, `ids colidiram: ${ids.join(', ')}`);
});

process.exit(falhou ? 1 : 0);
