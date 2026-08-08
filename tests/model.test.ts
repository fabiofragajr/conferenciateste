import assert from 'node:assert/strict';
import {
  classificar, parseEtiqueta, pedidosIncompletos, pendenciasDaCarga,
  prefixoRota, rotaPertence, derivarGrave, type ContextoConferencia, type PrimeiraLeitura
} from '../src/lib/model.ts';
import type { Leitura, Rota } from '../src/types.ts';

// parse feliz
const p = parseEtiqueta('EMB0008314147;FNOR 100;0001/0002;86945574');
assert.equal(p.valido, true);
assert.equal(p.codigoVolume, 'EMB0008314147');
assert.equal(p.rota, 'FNOR 100');
assert.equal(p.rotaPrefixo, 'FNOR');
assert.equal(p.volumeAtual, 1);
assert.equal(p.volumeTotal, 2);
assert.equal(p.pedido, '86945574');

// parse defensivo: nada é descartado em silêncio
assert.equal(parseEtiqueta('QUALQUER-QR-DE-TERCEIRO').valido, false);
assert.equal(parseEtiqueta('A;B;C').valido, false);
assert.equal(parseEtiqueta('EMB1;;0001/0001;123').valido, false);
assert.equal(parseEtiqueta(' emb1 ; fnor 12 ; 0001/0001 ; 9 ').codigoVolume, 'EMB1');

// rota compara só o prefixo, e compara exato
assert.equal(prefixoRota('FNOR 100'), 'FNOR');
assert.equal(rotaPertence('FNOR 100', ['FNOR']), true);
assert.equal(rotaPertence('FNOR 15', ['FNOR']), true);
assert.equal(rotaPertence('XFNORY 1', ['FNOR']), false, 'FNOR não pode casar com XFNORY');
assert.equal(rotaPertence('FSUL 2', ['FNOR']), false);

// classificação contra o cadastro de rotas
const rota = (codigo: string, transportadoraId: string): Rota => ({
  id: `rota-${codigo}`, codigo, nome: codigo, transportadoraId, descricao: '', ativo: true,
  sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: ''
});

const ALFA = 'transportadora-alfa';
const BETA = 'transportadora-beta';
const jaBipados = new Map<string, PrimeiraLeitura>();
const ctx: ContextoConferencia = {
  transportadoraId: ALFA,
  rotasPorCodigo: new Map([['FNOR', rota('FNOR', ALFA)], ['FSUL', rota('FSUL', BETA)]]),
  jaBipados
};

assert.equal(classificar('EMB1;FNOR 1;0001/0002;9', ctx).status, 'OK');

jaBipados.set('EMB1', { timestamp: '2026-08-08T10:32:00.000Z', usuarioNome: 'Carlos' });
const dup = classificar('EMB1;FNOR 1;0001/0002;9', ctx);
assert.equal(dup.status, 'DUPLICADO');
// o duplicado precisa dizer quem bipou primeiro e quando
assert.equal(dup.primeira?.usuarioNome, 'Carlos');

// código de outra transportadora: divergência que sabe apontar o dono
const div = classificar('EMB2;FSUL 1;0001/0001;9', ctx);
assert.equal(div.status, 'ROTA_DIVERGENTE');
assert.equal(div.rota?.transportadoraId, BETA);

// divergente rebipado continua vermelho — divergência nunca vira âmbar
jaBipados.set('EMB2', { timestamp: '', usuarioNome: 'João' });
assert.equal(classificar('EMB2;FSUL 1;0001/0001;9', ctx).status, 'ROTA_DIVERGENTE');

// código que ninguém cadastrou não pode virar divergência: o sistema não sabe
assert.equal(classificar('EMB3;R99 7;0001/0001;9', ctx).status, 'DESTINO_NAO_MAPEADO');

assert.equal(classificar('lixo', ctx).status, 'INVALIDO');

// pedido incompleto derivado do próprio QR
const leitura = (cod: string, vol: string, atual: number, total: number): Leitura => ({
  id: cod, sessaoId: 's', codigoVolume: cod, rota: 'FNOR 1', rotaPrefixo: 'FNOR',
  volume: vol, volumeAtual: atual, volumeTotal: total, pedido: '86945574', status: 'OK',
  timestamp: new Date().toISOString(), rawData: '', origem: 'CAMERA', motivoInvalido: null,
  rotaId: null, transportadoraDonaId: null, transportadoraDonaNome: null, dispositivoId: 'd1',
  lat: null, lng: null, precisaoMetros: null, geoStatus: 'INDISPONIVEL',
  sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: ''
});
const inc = pedidosIncompletos([leitura('A', '0001/0003', 1, 3), leitura('B', '0003/0003', 3, 3)]);
assert.equal(inc.length, 1);
assert.deepEqual(inc[0].faltando, ['0002']);
assert.equal(pedidosIncompletos([leitura('A', '0001/0001', 1, 1)]).length, 0);

// pendências da carga: é a mesma conta na doca, no relatório e no painel
const leituraStatus = (id: string, status: Leitura['status']): Leitura =>
  ({ ...leitura(id, '0001/0001', 1, 1), status });
assert.equal(pendenciasDaCarga([leituraStatus('A', 'OK')]).length, 0);
const comProblema = pendenciasDaCarga([
  leituraStatus('A', 'ROTA_DIVERGENTE'),
  leituraStatus('B', 'DESTINO_NAO_MAPEADO')
]);
assert.deepEqual(comProblema.map((p) => p.tipo).sort(), ['DESTINO_NAO_MAPEADO', 'DIVERGENCIA']);

// grave é derivado da etiqueta
assert.equal(derivarGrave(['emb_amassada']), false);
assert.equal(derivarGrave(['emb_amassada', 'lacre_violado']), true);

console.log('MODEL_OK');
