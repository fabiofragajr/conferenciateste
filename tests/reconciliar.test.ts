// A varredura que tira do aparelho o cadastro excluído no servidor.
//
// Existe porque a descida é incremental (`atualizado_em > desde`) e uma linha
// apagada não ganha carimbo novo — ela só deixa de vir. Sem varredura, o
// aparelho guarda para sempre o que o gestor excluiu, e a tela do operador
// oferece transportadora que não existe mais.
//
// O custo de errar aqui é assimétrico: deixar sobra é feio, apagar demais é
// perder trabalho de alguém ou trancar o aparelho fora do app. Por isso as duas
// travas abaixo são o grosso deste arquivo.

import assert from 'node:assert/strict';
import { idsParaRemover } from '../src/lib/reconciliar.ts';

let falhou = false;
const passo = (nome: string, fn: () => void): void => {
  try { fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', (e as Error).message); falhou = true; }
};

const enviado = (id: string) => ({ id, sync: 'ENVIADO' as const });
const pendente = (id: string) => ({ id, sync: 'PENDENTE' as const });
const comErro = (id: string) => ({ id, sync: 'ERRO' as const });

passo('some o que o servidor não tem mais', () => {
  // O caso real: a base ficou só com a DHM AWAY, e o aparelho ainda mostrava
  // LOGDIS, Transportadora Sul, Beta e Carga Sul na tela do operador.
  const locais = ['dhm', 'logdis', 'sul', 'beta', 'carga-sul'].map(enviado);
  assert.deepEqual(
    idsParaRemover(locais, new Set(['dhm'])).sort(),
    ['beta', 'carga-sul', 'logdis', 'sul']
  );
});

passo('o que o servidor tem fica', () => {
  const locais = ['a', 'b', 'c'].map(enviado);
  assert.deepEqual(idsParaRemover(locais, new Set(['a', 'b', 'c'])), []);
});

passo('registro que ainda não subiu nunca é apagado', () => {
  // `PENDENTE` não está no servidor porque ainda não CHEGOU lá, não porque foi
  // excluído. Apagar seria destruir o cadastro que alguém acabou de criar no
  // aparelho, offline — e é justamente o caso do galpão sem sinal.
  const locais = [enviado('velho'), pendente('recem-criado'), comErro('tentou-e-falhou')];
  assert.deepEqual(idsParaRemover(locais, new Set(['outro'])), ['velho']);
});

passo('lista vazia do servidor não apaga nada', () => {
  // "O servidor não tem nenhum" é indistinguível de "a consulta voltou vazia
  // por política de acesso". No segundo caso, obedecer limparia o cadastro
  // inteiro — inclusive os usuários, e aí ninguém mais entra neste aparelho.
  const locais = ['a', 'b', 'c'].map(enviado);
  assert.deepEqual(idsParaRemover(locais, new Set()), []);
});

passo('aparelho sem cadastro local não inventa remoção', () => {
  assert.deepEqual(idsParaRemover([], new Set(['a'])), []);
});

passo('não muda a lista recebida', () => {
  const locais = [enviado('a'), enviado('b')];
  idsParaRemover(locais, new Set(['a']));
  assert.equal(locais.length, 2);
  assert.equal(locais[1].sync, 'ENVIADO');
});

process.exit(falhou ? 1 : 0);
