// relatorios.ts — os documentos que saem de cada conferência.
//
// PDF e CSV já existiam na gaveta de detalhe. Esta seção os reúne por período,
// com um CSV consolidado para análise e os documentos individuais para
// auditoria. Nenhum formato paralelo é criado aqui.

import type { Sessao } from '../../types.js';
import {
  exportarCSV, exportarCSVPeriodo, exportarPDF, montarRelatorio
} from '../../lib/relatorio.js';
import {
  botao, campo, filtros, kpis, pageHeader, plural, secao, selecao, tabela
} from '../../lib/ui/index.js';
import { $, dataHora, duracao, esc } from '../../lib/util.js';
import { dentro, type Montar } from './contexto.js';

const dataLocal = (d: Date): string => {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

const periodoInicial = (): { de: string; ate: string } => {
  const ate = new Date();
  const de = new Date(ate);
  de.setDate(de.getDate() - 29);
  return { de: dataLocal(de), ate: dataLocal(ate) };
};

const intervalo = (de: string, ate: string): { inicio: string; fim: string } => ({
  inicio: new Date(`${de || '2000-01-01'}T00:00:00`).toISOString(),
  fim: new Date(`${ate || '2100-01-01'}T23:59:59.999`).toISOString()
});

export const montar: Montar = (raiz, ctx) => {
  const padrao = periodoInicial();

  raiz.innerHTML = [
    pageHeader({ titulo: 'Relatórios', sub: 'Documentos e dados das conferências' }),
    filtros([
      campo({ id: 'rel-de', rotulo: 'De', tipo: 'date', valor: padrao.de }),
      campo({ id: 'rel-ate', rotulo: 'Até', tipo: 'date', valor: padrao.ate }),
      selecao({
        id: 'rel-transportadora',
        rotulo: 'Transportadora',
        opcoes: [{ valor: '', rotulo: 'Todas' }]
      }),
      botao({ id: 'rel-csv-periodo', rotulo: 'Baixar CSV do período', tipo: 'primario' })
    ], 'últimos 30 dias'),
    '<div id="relatorios-resultado"></div>'
  ].join('');

  const de = $<HTMLInputElement>('#rel-de', raiz);
  const ate = $<HTMLInputElement>('#rel-ate', raiz);
  const transportadora = $<HTMLSelectElement>('#rel-transportadora', raiz);
  const resultado = $('#relatorios-resultado', raiz);

  const atualizarTransportadoras = (): void => {
    const manter = transportadora.value;
    transportadora.innerHTML = '<option value="">Todas</option>'
      + ctx.base().transportadoras.map((t) =>
        `<option value="${esc(t.id)}">${esc(t.nome)}</option>`
      ).join('');
    transportadora.value = manter;
  };

  const filtradas = (): Sessao[] => {
    const { inicio, fim } = intervalo(de.value, ate.value);
    return ctx.base().sessoes.filter((s) =>
      dentro(s.inicio, inicio, fim)
      && (!transportadora.value || s.transportadoraId === transportadora.value)
    );
  };

  const abrirExportacao = async (id: string, formato: 'pdf' | 'csv', btn: HTMLButtonElement): Promise<void> => {
    const texto = btn.textContent ?? formato.toUpperCase();
    btn.disabled = true;
    btn.textContent = formato === 'pdf' ? 'Gerando…' : 'Preparando…';
    try {
      const relatorio = await montarRelatorio(id);
      if (formato === 'pdf') await exportarPDF(relatorio);
      else exportarCSV(relatorio);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível gerar o relatório.');
    } finally {
      btn.disabled = false;
      btn.textContent = texto;
    }
  };

  const ligarAcoes = (): void => {
    for (const btn of resultado.querySelectorAll<HTMLButtonElement>('button[data-rel-pdf]')) {
      btn.addEventListener('click', () => void abrirExportacao(btn.dataset.relPdf as string, 'pdf', btn));
    }
    for (const btn of resultado.querySelectorAll<HTMLButtonElement>('button[data-rel-csv]')) {
      btn.addEventListener('click', () => void abrirExportacao(btn.dataset.relCsv as string, 'csv', btn));
    }
  };

  const pintar = (): void => {
    atualizarTransportadoras();
    const sessoes = filtradas();
    const ids = new Set(sessoes.map((s) => s.id));
    const leituras = ctx.base().leituras.filter((l) => ids.has(l.sessaoId));
    const ocorrencias = ctx.base().ocorrencias.filter((o) => ids.has(o.sessaoId));
    const divergencias = leituras.filter((l) => l.status === 'ROTA_DIVERGENTE').length;

    resultado.innerHTML = [
      kpis([
        { rotulo: 'Conferências', valor: sessoes.length },
        { rotulo: 'Volumes', valor: leituras.length },
        { rotulo: 'Ocorrências', valor: ocorrencias.length, tom: ocorrencias.length ? 'atencao' : 'neutro' },
        { rotulo: 'Divergências', valor: divergencias, tom: divergencias ? 'alarme' : 'neutro' }
      ]),
      secao({
        titulo: 'Relatórios por conferência',
        meta: plural(sessoes.length, 'conferência', 'conferências'),
        corpo: tabela({
          colunas: [
            { chave: 'inicio', rotulo: 'Início' },
            { chave: 'pessoa', rotulo: 'Conferente' },
            { chave: 'carga', rotulo: 'Transportadora' },
            { chave: 'rotas', rotulo: 'Rotas' },
            { chave: 'duracao', rotulo: 'Duração' },
            { chave: 'volumes', rotulo: 'Volumes', alinhar: 'direita' },
            { chave: 'ocorrencias', rotulo: 'Ocorrências', alinhar: 'direita' },
            { chave: 'acoes', rotulo: 'Baixar', html: true }
          ],
          linhas: sessoes.map((s) => ({
            inicio: dataHora(s.inicio),
            pessoa: s.usuarioNome,
            carga: s.transportadoraNome,
            rotas: s.rotas.join(', '),
            duracao: duracao(s.inicio, s.fim),
            volumes: (ctx.base().porSessao.get(s.id) ?? []).length,
            ocorrencias: (ctx.base().ocPorSessao.get(s.id) ?? []).length,
            acoes: `<span class="p-acao-inline">
                <button class="btn btn-secundario" data-rel-pdf="${esc(s.id)}" type="button">PDF</button>
                <button class="btn btn-fantasma" data-rel-csv="${esc(s.id)}" type="button">CSV</button>
              </span>`
          })),
          vazio: 'Nenhuma conferência no período selecionado.'
        })
      })
    ].join('');
    ligarAcoes();
  };

  for (const controle of [de, ate, transportadora]) controle.addEventListener('change', pintar);
  $('#rel-csv-periodo', raiz).addEventListener('click', () => {
    const sessoes = filtradas();
    exportarCSVPeriodo(sessoes, ctx.base().leituras, ctx.base().ocorrencias);
  });
  raiz.querySelector('.ui-filtros-abrir')?.addEventListener('click', () => {
    raiz.querySelector('.ui-filtros-campos')?.classList.toggle('aberto');
  });

  return { pintar };
};
