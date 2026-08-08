import assert from 'node:assert/strict';
import {
  classificar, parseEtiqueta, pedidosIncompletos, prefixoRota, rotaPertence, derivarGrave
} from '../src/lib/model.ts';
import type { Leitura } from '../src/types.ts';

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

// classificação
const bipados = new Set<string>();
assert.equal(classificar('EMB1;FNOR 1;0001/0002;9', ['FNOR'], bipados).status, 'OK');
bipados.add('EMB1');
assert.equal(classificar('EMB1;FNOR 1;0001/0002;9', ['FNOR'], bipados).status, 'DUPLICADO');
assert.equal(classificar('EMB2;FSUL 1;0001/0001;9', ['FNOR'], bipados).status, 'ROTA_DIVERGENTE');
// divergente rebipado continua vermelho — divergência nunca vira âmbar
bipados.add('EMB2');
assert.equal(classificar('EMB2;FSUL 1;0001/0001;9', ['FNOR'], bipados).status, 'ROTA_DIVERGENTE');
assert.equal(classificar('lixo', ['FNOR'], bipados).status, 'INVALIDO');

// pedido incompleto derivado do próprio QR
const leitura = (cod: string, vol: string, atual: number, total: number): Leitura => ({
  id: cod, sessaoId: 's', codigoVolume: cod, rota: 'FNOR 1', rotaPrefixo: 'FNOR',
  volume: vol, volumeAtual: atual, volumeTotal: total, pedido: '86945574', status: 'OK',
  timestamp: new Date().toISOString(), rawData: '', origem: 'CAMERA', motivoInvalido: null,
  lat: null, lng: null, precisaoMetros: null, geoStatus: 'INDISPONIVEL',
  sync: 'PENDENTE', syncTentativas: 0, syncErro: null, atualizadoEm: ''
});
const inc = pedidosIncompletos([leitura('A', '0001/0003', 1, 3), leitura('B', '0003/0003', 3, 3)]);
assert.equal(inc.length, 1);
assert.deepEqual(inc[0].faltando, ['0002']);
assert.equal(pedidosIncompletos([leitura('A', '0001/0001', 1, 1)]).length, 0);

// grave é derivado da etiqueta
assert.equal(derivarGrave(['emb_amassada']), false);
assert.equal(derivarGrave(['emb_amassada', 'lacre_violado']), true);

console.log('MODEL_OK');
