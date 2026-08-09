// divergencias.ts — o destino do alarme.
//
// Era um cartão dentro de Início. Virou seção própria porque é para cá que o
// badge e a faixa fixa apontam: alarme precisa de endereço, senão "ver quais
// são" não tem para onde levar.
//
// Aqui a faixa fixa do shell se cala — é a única tela em que ela seria
// redundante com o conteúdo logo abaixo.

import { dentro, type Montar } from './contexto.js';
import { pageHeader, tabela, alerta, plural, status } from '../../lib/ui/index.js';
import { dataHora, esc, limitesDoDia } from '../../lib/util.js';

export const montar: Montar = (raiz, ctx) => {
  const pintar = (): void => {
    const { inicio, fim } = limitesDoDia();
    const divergentes = ctx.base().leituras.filter(
      (l) => dentro(l.timestamp, inicio, fim) && l.status === 'ROTA_DIVERGENTE'
    );

    raiz.innerHTML = [
      pageHeader({ titulo: 'Divergências', sub: 'Volumes de outra transportadora, hoje' }),
      divergentes.length
        ? alerta({
            tom: 'alarme',
            titulo: plural(
              divergentes.length,
              'volume de outra transportadora',
              'volumes de outra transportadora'
            ),
            texto: 'Não podem embarcar. Confira antes de liberar a carga.'
          })
        : '',
      tabela({
        colunas: [
          { chave: 'codigo', rotulo: 'Código', html: true },
          { chave: 'rota', rotulo: 'Rota lida' },
          // De quem a caixa é de verdade. Sem esta coluna a tela diz que algo
          // está errado, mas não diz para onde o volume deveria ir.
          { chave: 'dono', rotulo: 'Dono do código' },
          { chave: 'pedido', rotulo: 'Pedido' },
          { chave: 'conferente', rotulo: 'Conferente' },
          { chave: 'carga', rotulo: 'Carga' },
          { chave: 'situacao', rotulo: 'Situação', html: true },
          { chave: 'hora', rotulo: 'Hora', alinhar: 'direita' }
        ],
        linhas: divergentes.map((l) => {
          const s = ctx.base().sessoes.find((x) => x.id === l.sessaoId);
          return {
            codigo: `<code>${esc(l.codigoVolume ?? '—')}</code>`,
            rota: l.rota ?? '—',
            dono: l.transportadoraDonaNome ?? '—',
            pedido: l.pedido ?? '—',
            conferente: s?.usuarioNome ?? '—',
            carga: s ? `${s.transportadoraNome} (${s.rotas.join(', ')})` : '—',
            situacao: status(l.status),
            hora: dataHora(l.timestamp)
          };
        }),
        vazio: 'Nenhum volume divergente hoje.'
      })
    ].join('');
  };

  return { pintar };
};
