// mapa.ts — onde as conferências do período aconteceram.
//
// O desenho continua relativo e offline, como em `lib/mapa.ts`. Esta seção só
// acrescenta o recorte de período e a cobertura por conferência: um mapa vazio
// precisa dizer se não houve leitura ou se houve leitura sem posição.

import { renderMapa } from '../../lib/mapa.js';
import { campo, filtros, kpis, pageHeader, plural, secao, tabela } from '../../lib/ui/index.js';
import { $, dataHora, pct } from '../../lib/util.js';
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
    pageHeader({ titulo: 'Mapa', sub: 'Posição registrada durante as conferências' }),
    filtros([
      campo({ id: 'm-de', rotulo: 'De', tipo: 'date', valor: padrao.de }),
      campo({ id: 'm-ate', rotulo: 'Até', tipo: 'date', valor: padrao.ate })
    ], 'últimos 30 dias'),
    '<div id="mapa-resultado"></div>'
  ].join('');

  const de = $<HTMLInputElement>('#m-de', raiz);
  const ate = $<HTMLInputElement>('#m-ate', raiz);
  const resultado = $('#mapa-resultado', raiz);

  const pintar = (): void => {
    const { inicio, fim } = intervalo(de.value, ate.value);
    const b = ctx.base();
    const sessoes = b.sessoes.filter((s) => dentro(s.inicio, inicio, fim));
    const ids = new Set(sessoes.map((s) => s.id));
    const leituras = b.leituras.filter((l) => ids.has(l.sessaoId));
    const localizadas = leituras.filter(
      (l) => l.lat !== null && l.lng !== null && l.geoStatus !== 'NEGADO'
    );
    const imprecisas = localizadas.filter((l) => l.geoStatus === 'IMPRECISO');

    resultado.innerHTML = [
      kpis([
        { rotulo: 'Conferências', valor: sessoes.length },
        { rotulo: 'Leituras', valor: leituras.length },
        { rotulo: 'Com posição', valor: `${localizadas.length} (${pct(localizadas.length, leituras.length)}%)` },
        { rotulo: 'Posição imprecisa', valor: imprecisas.length, tom: imprecisas.length ? 'atencao' : 'neutro' }
      ]),
      secao({
        titulo: 'Dispersão das leituras',
        meta: plural(localizadas.length, 'posição', 'posições'),
        corpo: renderMapa(leituras)
      }),
      secao({
        titulo: 'Cobertura por conferência',
        meta: plural(sessoes.length, 'conferência', 'conferências'),
        corpo: tabela({
          colunas: [
            { chave: 'inicio', rotulo: 'Início' },
            { chave: 'pessoa', rotulo: 'Conferente' },
            { chave: 'carga', rotulo: 'Transportadora' },
            { chave: 'rotas', rotulo: 'Rotas' },
            { chave: 'leituras', rotulo: 'Leituras', alinhar: 'direita' },
            { chave: 'posicoes', rotulo: 'Com posição', alinhar: 'direita' },
            { chave: 'cobertura', rotulo: 'Cobertura', alinhar: 'direita' }
          ],
          linhas: sessoes.map((s) => {
            const ls = b.porSessao.get(s.id) ?? [];
            const comPosicao = ls.filter(
              (l) => l.lat !== null && l.lng !== null && l.geoStatus !== 'NEGADO'
            ).length;
            return {
              inicio: dataHora(s.inicio),
              pessoa: s.usuarioNome,
              carga: s.transportadoraNome,
              rotas: s.rotas.join(', '),
              leituras: ls.length,
              posicoes: comPosicao,
              cobertura: `${pct(comPosicao, ls.length)}%`
            };
          }),
          vazio: 'Nenhuma conferência no período selecionado.'
        })
      })
    ].join('');
  };

  de.addEventListener('change', pintar);
  ate.addEventListener('change', pintar);
  raiz.querySelector('.ui-filtros-abrir')?.addEventListener('click', () => {
    raiz.querySelector('.ui-filtros-campos')?.classList.toggle('aberto');
  });

  return { pintar };
};
