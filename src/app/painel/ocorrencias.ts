// ocorrencias.ts — o que aconteceu na doca, escrito por quem estava lá.
//
// O texto vem na íntegra, nunca resumido em etiqueta: é ali que está a
// informação, e o CLAUDE.md §9 exige que o gestor leia sem precisar abrir. Por
// isso `tabela()` não serve aqui — isto é uma lista de blocos com texto
// corrido, não uma grade.
//
// A moldura (filtros) é montada uma vez e os listeners ficam nela; `pintar()`
// só troca a lista. Redesenhar a moldura a cada ciclo apagaria o que o gestor
// digitou na busca — o painel se repinta sozinho a cada 15 segundos.

import { type Montar } from './contexto.js';
import { secao, tabela, vazio, plural, filtros, campo, selecao, botao } from '../../lib/ui/index.js';
import { pageHeader } from '../../lib/ui/index.js';
import { ETIQUETAS, etiquetaTexto } from '../../lib/model.js';
import { cardOcorrencia, exportarCSVOcorrencias, hidratarFotos } from '../../lib/relatorio.js';
import type { Momento, Ocorrencia } from '../../types.js';
import { $, esc } from '../../lib/util.js';

export const montar: Montar = (raiz, ctx) => {
  raiz.innerHTML = [
    pageHeader({ titulo: 'Ocorrências' }),
    filtros([
      selecao({
        id: 'oc-momento',
        rotulo: 'Momento',
        opcoes: [
          { valor: '', rotulo: 'Todos' },
          { valor: 'EXPEDICAO', rotulo: 'Na expedição' },
          { valor: 'TRANSPORTADORA', rotulo: 'Na transportadora' }
        ]
      }),
      selecao({ id: 'oc-etiqueta', rotulo: 'Etiqueta', opcoes: [{ valor: '', rotulo: 'Todas' }] }),
      campo({ id: 'oc-busca', rotulo: 'Busca no texto', tipo: 'search' }),
      selecao({
        id: 'oc-dias',
        rotulo: 'Período',
        opcoes: [
          { valor: '1', rotulo: 'Hoje' },
          { valor: '7', rotulo: 'Últimos 7 dias' },
          { valor: '30', rotulo: 'Últimos 30 dias' }
        ]
      }),
      botao({ id: 'btn-oc-csv', rotulo: 'Exportar CSV' })
    ]),
    '<div id="oc-secao-lista"></div>',
    '<div id="oc-secao-recorrentes"></div>'
  ].join('');

  // A etiqueta é a única opção que vem do domínio; as outras são fixas.
  $<HTMLSelectElement>('#oc-etiqueta', raiz).innerHTML =
    '<option value="">Todas</option>'
    + ETIQUETAS.map((e) => `<option value="${esc(e.id)}">${esc(e.texto)}</option>`).join('');

  const filtradas = (): Ocorrencia[] => {
    const dias = Number($<HTMLSelectElement>('#oc-dias', raiz).value);
    const momento = $<HTMLSelectElement>('#oc-momento', raiz).value as Momento | '';
    const etiqueta = $<HTMLSelectElement>('#oc-etiqueta', raiz).value;
    const busca = $<HTMLInputElement>('#oc-busca', raiz).value.trim().toLowerCase();

    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    desde.setDate(desde.getDate() - (dias - 1));
    const desdeIso = desde.toISOString();

    return ctx.base().ocorrencias
      .filter((o) => o.timestamp >= desdeIso)
      .filter((o) => !momento || o.momento === momento)
      .filter((o) => !etiqueta || o.etiquetas.includes(etiqueta))
      // Busca no texto livre: o gestor precisa achar "doca fechada" sem depender
      // de alguém ter marcado a etiqueta certa.
      .filter((o) => !busca || o.texto.toLowerCase().includes(busca))
      .sort((a, b) => Number(b.grave) - Number(a.grave) || b.timestamp.localeCompare(a.timestamp));
  };

  const pintarLista = (): void => {
    const lista = filtradas();
    $('#oc-secao-lista', raiz).innerHTML = secao({
      titulo: 'Ocorrências do período',
      meta: plural(lista.length, 'ocorrência', 'ocorrências'),
      corpo: lista.length
        ? `<div id="oc-lista" class="p-oc-lista">${lista.map((o) => {
            const s = ctx.base().sessoes.find((x) => x.id === o.sessaoId);
            const quem = s ? `${s.usuarioNome} • ${s.transportadoraNome}` : '';
            return cardOcorrencia(o, `<div class="rel-oc-local">${esc(quem)}</div>`);
          }).join('')}</div>`
        : `<div id="oc-lista" class="p-oc-lista">${vazio('Nenhuma ocorrência no filtro atual.')}</div>`
    });
    hidratarFotos($('#oc-lista', raiz), lista);
  };

  const pintarRecorrentes = (): void => {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    const contagem = new Map<string, { total: number; graves: number; etiquetas: Map<string, number> }>();

    for (const o of ctx.base().ocorrencias) {
      if (o.timestamp < desde || o.momento !== 'TRANSPORTADORA') continue;
      const s = ctx.base().sessoes.find((x) => x.id === o.sessaoId);
      const chave = s?.transportadoraNome || 'Sem identificação';
      const atual = contagem.get(chave) ?? { total: 0, graves: 0, etiquetas: new Map<string, number>() };
      atual.total++;
      if (o.grave) atual.graves++;
      for (const e of o.etiquetas) atual.etiquetas.set(e, (atual.etiquetas.get(e) ?? 0) + 1);
      contagem.set(chave, atual);
    }

    const linhas = [...contagem.entries()]
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([nome, v]) => {
        const top = [...v.etiquetas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([e, n]) => `${etiquetaTexto(e)} (${n})`).join(', ');
        return {
          nome,
          total: v.total,
          graves: v.graves ? `<b style="color:var(--alarme)">${v.graves}</b>` : '0',
          etiquetas: top || '—'
        };
      });

    $('#oc-secao-recorrentes', raiz).innerHTML = secao({
      titulo: 'Ocorrências repetidas por transportadora',
      meta: 'Sinal de que o problema virou rotina',
      corpo: tabela({
        colunas: [
          { chave: 'nome', rotulo: 'Transportadora / carga' },
          { chave: 'total', rotulo: 'Ocorrências (30 dias)', alinhar: 'direita' },
          { chave: 'graves', rotulo: 'Graves', html: true, alinhar: 'direita' },
          { chave: 'etiquetas', rotulo: 'Etiquetas mais frequentes' }
        ],
        linhas,
        vazio: 'Nenhuma repetição na transportadora nos últimos 30 dias.'
      })
    });
  };

  const pintar = (): void => {
    pintarLista();
    pintarRecorrentes();
  };

  for (const id of ['#oc-momento', '#oc-etiqueta', '#oc-dias']) {
    $<HTMLSelectElement>(id, raiz).addEventListener('change', pintarLista);
  }
  $<HTMLInputElement>('#oc-busca', raiz).addEventListener('input', pintarLista);
  $('#btn-oc-csv', raiz).addEventListener('click', () => exportarCSVOcorrencias(filtradas()));

  return { pintar };
};
