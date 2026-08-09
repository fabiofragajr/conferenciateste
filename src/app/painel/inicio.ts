// inicio.ts — a primeira tela responde uma pergunta só: existe alguma carga que
// precisa da minha atenção agora?
//
// O bloco de atenção deixou de ser uma lista vermelha com moldura e virou lista
// de linhas que levam à seção que resolve cada problema. É por isso que
// Divergências e Pedidos incompletos viraram rotas: aviso sem destino obriga o
// gestor a caçar o problema pelo painel.

import { dentro, type Montar } from './contexto.js';
import { cadastrarRota } from './cadastro-rotas.js';
import { pageHeader, kpis, secao, tabela, vazio, alerta, plural } from '../../lib/ui/index.js';
import { pedidosIncompletos } from '../../lib/model.js';
import { $, dataHora, duracao, esc, limitesDoDia } from '../../lib/util.js';

interface Aviso {
  texto: string;
  rotulo: string;
  href: string;
}

export const montar: Montar = (raiz, ctx) => {
  const pintar = (): void => {
    const { inicio, fim } = limitesDoDia();
    const b = ctx.base();
    const hoje = b.leituras.filter((l) => dentro(l.timestamp, inicio, fim));
    const divergentes = hoje.filter((l) => l.status === 'ROTA_DIVERGENTE');
    const abertas = b.sessoes.filter((s) => s.status === 'ABERTA');
    const incompletos = pedidosIncompletos(hoje);

    /* ------------------------------------------------- precisa de atenção */
    const avisos: Aviso[] = [];

    if (divergentes.length) {
      avisos.push({
        texto: plural(divergentes.length, 'volume de outra transportadora', 'volumes de outra transportadora'),
        rotulo: 'Ver volumes',
        href: '/painel/divergencias'
      });
    }

    const naoMapeados = new Set(
      hoje.filter((l) => l.status === 'DESTINO_NAO_MAPEADO').map((l) => l.rotaPrefixo ?? '?')
    );
    if (naoMapeados.size) {
      avisos.push({
        texto: plural(naoMapeados.size, 'código de rota sem cadastro', 'códigos de rota sem cadastro'),
        rotulo: 'Decidir',
        href: '/painel'
      });
    }

    if (incompletos.length) {
      avisos.push({
        texto: plural(incompletos.length, 'pedido com volume faltando', 'pedidos com volume faltando'),
        rotulo: 'Ver pedidos',
        href: '/painel/incompletos'
      });
    }

    const aguardando = b.sessoes.filter(
      (s) => s.status === 'ENCERRADA' && !s.liberadaEm && dentro(s.inicio, inicio, fim)
    ).length;
    if (aguardando) {
      avisos.push({
        texto: plural(aguardando, 'carga aguardando liberação', 'cargas aguardando liberação'),
        rotulo: 'Liberar',
        href: '/painel/conferencias'
      });
    }

    const paradas = ctx.dispositivos().filter((d) => d.pendentes > 0);
    if (paradas.length) {
      const total = paradas.reduce((n, d) => n + d.pendentes, 0);
      avisos.push({
        texto: plural(total, 'leitura ainda num aparelho', 'leituras ainda num aparelho'),
        rotulo: 'Ver aparelhos',
        href: '/painel/sincronizacao'
      });
    }

    /* ------------------------------------------ códigos sem dono conhecido */
    const porCodigo = new Map<string, { codigo: string; volumes: number; ultima: string; transportadoras: Set<string> }>();
    for (const l of b.leituras) {
      if (l.status !== 'DESTINO_NAO_MAPEADO' || !l.rotaPrefixo) continue;
      const atual = porCodigo.get(l.rotaPrefixo)
        ?? { codigo: l.rotaPrefixo, volumes: 0, ultima: l.timestamp, transportadoras: new Set<string>() };
      atual.volumes++;
      if (l.timestamp > atual.ultima) atual.ultima = l.timestamp;
      const s = b.sessoes.find((x) => x.id === l.sessaoId);
      if (s) atual.transportadoras.add(s.transportadoraNome);
      porCodigo.set(l.rotaPrefixo, atual);
    }
    // Já cadastrado depois da leitura? Some da lista: o problema foi resolvido.
    const cadastrados = new Set(b.rotas.map((r) => r.codigo));
    const pendentes = [...porCodigo.values()]
      .filter((c) => !cadastrados.has(c.codigo))
      .sort((a, b2) => b2.volumes - a.volumes);

    const opcoes = b.transportadoras.filter((t) => t.ativo)
      .map((t) => `<option value="${esc(t.id)}">${esc(t.nome)}</option>`).join('');

    raiz.innerHTML = [
      pageHeader({ titulo: 'Início', sub: 'Tem algo errado agora?' }),

      divergentes.length
        ? alerta({
            tom: 'alarme',
            titulo: plural(divergentes.length, 'volume de outra transportadora', 'volumes de outra transportadora'),
            texto: 'Não podem embarcar. Confira antes de liberar a carga.',
            acao: { rotulo: 'Ver volumes', href: '/painel/divergencias' }
          })
        : '',

      kpis([
        { rotulo: 'Volumes hoje', valor: hoje.length },
        { rotulo: 'Divergências', valor: divergentes.length, tom: divergentes.length ? 'alarme' : 'neutro' },
        { rotulo: 'Conferências abertas', valor: abertas.length },
        { rotulo: 'Pedidos incompletos', valor: incompletos.length, tom: incompletos.length ? 'atencao' : 'neutro' }
      ]),

      secao({
        titulo: 'Precisa de atenção',
        meta: avisos.length ? plural(avisos.length, 'item', 'itens') : '',
        corpo: avisos.length
          ? `<ul class="p-atencao-lista">${avisos.map((a) => `
              <li><span>${esc(a.texto)}</span>
              <a class="ui-acao" href="${esc(a.href)}">${esc(a.rotulo)} ›</a></li>`).join('')}</ul>`
          : vazio('Operação normal: nenhuma pendência hoje.')
      }),

      secao({
        titulo: 'Conferências abertas agora',
        corpo: tabela({
          colunas: [
            { chave: 'pessoa', rotulo: 'Pessoa' },
            { chave: 'carga', rotulo: 'Carga' },
            { chave: 'rotas', rotulo: 'Rotas' },
            { chave: 'volumes', rotulo: 'Volumes', alinhar: 'direita' },
            { chave: 'divergentes', rotulo: 'Divergentes', html: true, alinhar: 'direita' },
            { chave: 'tempo', rotulo: 'Aberta há', alinhar: 'direita' }
          ],
          linhas: abertas.map((s) => {
            const ls = b.porSessao.get(s.id) ?? [];
            const div = ls.filter((l) => l.status === 'ROTA_DIVERGENTE').length;
            return {
              pessoa: s.usuarioNome,
              carga: s.transportadoraNome,
              rotas: s.rotas.join(', '),
              volumes: ls.length,
              divergentes: div ? `<b style="color:var(--alarme)">${div}</b>` : '0',
              tempo: duracao(s.inicio)
            };
          }),
          vazio: 'Nenhuma conferência aberta agora.'
        })
      }),

      secao({
        titulo: 'Rotas lidas que ninguém cadastrou',
        meta: pendentes.length ? plural(pendentes.length, 'código', 'códigos') : '',
        corpo: `<p class="ui-vazio">O operador não decide a rota. Cada código aqui é uma
          caixa que ficou parada esperando você dizer de quem ela é.</p>` + tabela({
          colunas: [
            { chave: 'codigo', rotulo: 'Código', html: true },
            { chave: 'volumes', rotulo: 'Volumes', alinhar: 'direita' },
            { chave: 'onde', rotulo: 'Apareceu conferindo' },
            { chave: 'ultima', rotulo: 'Última leitura' },
            { chave: 'acao', rotulo: 'Cadastrar como rota de', html: true }
          ],
          linhas: pendentes.map((c) => ({
            codigo: `<code>${esc(c.codigo)}</code>`,
            volumes: c.volumes,
            onde: [...c.transportadoras].join(', ') || '—',
            ultima: dataHora(c.ultima),
            acao: `<span class="p-acao-inline">
                <select data-mapear="${esc(c.codigo)}">${opcoes}</select>
                <button class="btn btn-primario" data-cadastrar="${esc(c.codigo)}"
                        style="min-height:32px;font-size:12px">Cadastrar</button>
              </span>`
          })),
          vazio: 'Nenhum código de rota pendente de cadastro.'
        })
      })
    ].join('');

    for (const btn of raiz.querySelectorAll<HTMLButtonElement>('button[data-cadastrar]')) {
      btn.addEventListener('click', async () => {
        const codigo = btn.dataset.cadastrar as string;
        const select = $<HTMLSelectElement>(`select[data-mapear="${codigo}"]`, raiz);
        const r = await cadastrarRota(
          { codigo, nome: codigo, transportadoraId: select.value },
          ctx.base().transportadoras
        );
        if (!r.ok) {
          alert(r.erro);
          return;
        }
        await ctx.recarregar();
      });
    }
  };

  return { pintar };
};
