// incompletos.ts — pedidos que saíram sem todos os volumes.
//
// A checagem é derivável da própria etiqueta, sem manifesto: o QR traz
// `0001/0002`, então o sistema sabe que faltou o `0002/0002` sem precisar
// perguntar a ninguém. É o único lugar do painel que acusa falta de caixa.

import { dentro, type Montar } from './contexto.js';
import { pageHeader, tabela, plural, secao } from '../../lib/ui/index.js';
import { pedidosIncompletos } from '../../lib/model.js';
import { limitesDoDia } from '../../lib/util.js';

export const montar: Montar = (raiz, ctx) => {
  const pintar = (): void => {
    const { inicio, fim } = limitesDoDia();
    const hoje = ctx.base().leituras.filter((l) => dentro(l.timestamp, inicio, fim));
    const incompletos = pedidosIncompletos(hoje);

    raiz.innerHTML = [
      pageHeader({ titulo: 'Pedidos incompletos', sub: 'Hoje' }),
      secao({
        titulo: 'Volume declarado que não foi bipado',
        meta: plural(incompletos.length, 'pedido', 'pedidos'),
        corpo: tabela({
          colunas: [
            { chave: 'pedido', rotulo: 'Pedido' },
            { chave: 'rota', rotulo: 'Rota' },
            { chave: 'bipados', rotulo: 'Bipados', alinhar: 'direita' },
            { chave: 'total', rotulo: 'Declarado', alinhar: 'direita' },
            { chave: 'faltando', rotulo: 'Faltando' }
          ],
          linhas: incompletos.map((p) => ({
            pedido: p.pedido,
            rota: p.rota,
            bipados: p.bipados,
            total: p.total,
            faltando: p.faltando.join(', ')
          })),
          vazio: 'Nenhum pedido incompleto hoje.'
        })
      })
    ].join('');
  };

  return { pintar };
};
