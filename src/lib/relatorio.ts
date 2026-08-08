// relatorio.ts — o entregável do sistema. Documento oficial de conferência,
// não um dump de tela. Monta os dados, renderiza em HTML e exporta CSV/PDF.

import type { jsPDF } from 'jspdf';
import type {
  GrupoRota, Leitura, Momento, Ocorrencia, PedidoIncompleto,
  ResumoLeituras, Sessao, Usuario
} from '../types.js';
import * as db from './db.js';
import { MOMENTO_ROTULO, STATUS_INFO, etiquetaTexto, pedidosIncompletos, resumir } from './model.js';
import { baixarArquivo, dataHora, duracao, esc, hora, minutosEntre, paraCSV } from './util.js';

export interface DadosRelatorio {
  sessao: Sessao;
  usuario: Usuario | undefined;
  grupo: GrupoRota | undefined;
  leituras: Leitura[];
  ocorrencias: Ocorrencia[];
  resumo: ResumoLeituras;
  incompletos: PedidoIncompleto[];
  divergentes: Leitura[];
  porLeitura: Map<string, Ocorrencia[]>;
  ritmo: number;
}

export async function montarRelatorio(sessaoId: string): Promise<DadosRelatorio> {
  const sessao = await db.obter('sessoes', sessaoId);
  if (!sessao) throw new Error('Sessão não encontrada.');

  const [usuario, grupo, leiturasRaw, ocorrenciasRaw] = await Promise.all([
    db.obter('usuarios', sessao.usuarioId),
    db.obter('grupos', sessao.grupoRotaId),
    db.porIndice('leituras', 'sessaoId', sessaoId),
    db.porIndice('ocorrencias', 'sessaoId', sessaoId)
  ]);

  const leituras = leiturasRaw.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const ocorrencias = ocorrenciasRaw.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const porLeitura = new Map<string, Ocorrencia[]>();
  for (const o of ocorrencias) {
    if (!o.leituraId) continue;
    const lista = porLeitura.get(o.leituraId) ?? [];
    lista.push(o);
    porLeitura.set(o.leituraId, lista);
  }

  const minutos = minutosEntre(sessao.inicio, sessao.fim);

  return {
    sessao,
    usuario,
    grupo,
    leituras,
    ocorrencias,
    resumo: resumir(leituras),
    incompletos: pedidosIncompletos(leituras),
    divergentes: leituras.filter((l) => l.status === 'ROTA_DIVERGENTE'),
    porLeitura,
    ritmo: minutos > 0 ? Number((leituras.length / minutos).toFixed(1)) : 0
  };
}

const identificacao = (s: Sessao, u?: Usuario): string => {
  const extras = [u?.funcao, u?.placa].filter(Boolean);
  return `${u?.nome ?? s.usuarioNome}${extras.length ? ` (${extras.join(' • ')})` : ''}`;
};

/* ---------------------------------------------------------------- HTML ---- */

const cartao = (rotulo: string, valor: number | string, classe = ''): string =>
  `<div class="rel-cartao ${classe}"><span>${valor}</span><small>${rotulo}</small></div>`;

export function cardOcorrencia(o: Ocorrencia, extra = ''): string {
  const etiquetas = o.etiquetas.map((e) => `<span class="rel-et">${esc(etiquetaTexto(e))}</span>`).join('');
  const local = o.lat !== null && o.lng !== null
    ? `<a href="https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=18/${o.lat}/${o.lng}" target="_blank" rel="noopener">
         ${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}${o.precisaoMetros ? ` (±${o.precisaoMetros} m)` : ''}
       </a>`
    : 'sem local';
  const fotos = o.fotos.length
    ? `<div class="rel-fotos">${o.fotos.map((_, i) => `<img data-oc="${esc(o.id)}" data-idx="${i}" alt="Foto da ocorrência">`).join('')}</div>`
    : '';

  return `<div class="rel-oc ${o.grave ? 'grave' : ''}">
    <div class="rel-oc-topo">
      ${o.grave ? '<span class="rel-grave">GRAVE</span>' : ''}
      <span class="rel-oc-momento">${MOMENTO_ROTULO[o.momento]}</span>
      <span class="rel-oc-hora">${dataHora(o.timestamp)}</span>
      ${o.leituraId ? '' : '<span class="rel-oc-escopo">entrega inteira</span>'}
    </div>
    ${o.codigoVolume ? `<div class="rel-oc-vol">Volume <code>${esc(o.codigoVolume)}</code></div>` : ''}
    <p class="rel-oc-texto">${o.texto ? esc(o.texto) : '<em>sem descrição</em>'}</p>
    ${etiquetas ? `<div class="rel-ets">${etiquetas}</div>` : ''}
    ${fotos}
    <div class="rel-oc-local">${local}</div>
    ${extra}
  </div>`;
}

export function renderizarHTML(r: DadosRelatorio): string {
  const { sessao, usuario, grupo, leituras, ocorrencias, resumo, incompletos, divergentes, porLeitura, ritmo } = r;

  const alerta = divergentes.length
    ? `<div class="rel-alerta">
         <strong>${divergentes.length} volume(s) de outra rota</strong>
         <span>Não podem embarcar nesta carga.</span>
         <ul>${divergentes.map((l) => `<li><code>${esc(l.codigoVolume)}</code> — rota ${esc(l.rota)} — pedido ${esc(l.pedido)} — ${hora(l.timestamp)}</li>`).join('')}</ul>
       </div>`
    : '<div class="rel-ok">Nenhum volume de outra rota nesta conferência.</div>';

  const blocoIncompletos = incompletos.length
    ? `<table class="rel-tab">
         <thead><tr><th>Pedido</th><th>Rota</th><th>Bipados</th><th>Declarado</th><th>Faltando</th></tr></thead>
         <tbody>${incompletos.map((p) => `<tr>
           <td>${esc(p.pedido)}</td><td>${esc(p.rota)}</td><td>${p.bipados}</td><td>${p.total}</td>
           <td>${p.faltando.map(esc).join(', ')}</td></tr>`).join('')}</tbody>
       </table>`
    : '<p class="rel-vazio">Nenhum pedido incompleto.</p>';

  const blocoOcorrencias = ocorrencias.length
    ? (['EXPEDICAO', 'TRANSPORTADORA'] as Momento[]).map((m) => {
        const lista = ocorrencias.filter((o) => o.momento === m);
        if (!lista.length) return '';
        const ordenada = [...lista].sort((a, b) => Number(b.grave) - Number(a.grave));
        return `<h4>${MOMENTO_ROTULO[m]} (${lista.length})</h4>
                <div class="rel-ocorrs">${ordenada.map((o) => cardOcorrencia(o)).join('')}</div>`;
      }).join('')
    : '<p class="rel-vazio">Nenhuma ocorrência registrada.</p>';

  const linhas = leituras.map((l) => {
    const info = STATUS_INFO[l.status];
    const ocs = porLeitura.get(l.id) ?? [];
    return `<tr>
      <td><code>${esc(l.codigoVolume ?? '—')}</code></td>
      <td>${esc(l.rota ?? '—')}</td>
      <td>${esc(l.pedido ?? '—')}</td>
      <td>${esc(l.volume ?? '—')}</td>
      <td><span class="rel-tag ${info.classe}">${info.curto}</span></td>
      <td>${ocs.length ? ocs.map((o) => esc(o.texto)).join(' | ') : '—'}</td>
      <td>${hora(l.timestamp)}</td>
    </tr>`;
  }).join('');

  return `
  <div class="relatorio">
    <header class="rel-cab">
      <div>
        <h2>Relatório de conferência</h2>
        <p class="rel-emp">Milfarma — LogDis Entrega</p>
      </div>
      <dl>
        <div><dt>Início</dt><dd>${dataHora(sessao.inicio)}</dd></div>
        <div><dt>Fim</dt><dd>${sessao.fim ? dataHora(sessao.fim) : 'em aberto'}</dd></div>
        <div><dt>Duração</dt><dd>${duracao(sessao.inicio, sessao.fim)}</dd></div>
        <div><dt>Conferente</dt><dd>${esc(identificacao(sessao, usuario))}</dd></div>
        <div><dt>Grupo de rota</dt><dd>${esc(grupo?.nome ?? sessao.grupoNome)}</dd></div>
        <div><dt>Rotas</dt><dd>${esc(sessao.rotas.join(', '))}</dd></div>
      </dl>
    </header>

    ${alerta}

    <div class="rel-resumo">
      ${cartao('Total bipado', resumo.total)}
      ${cartao('Liberados', resumo.ok, 'st-ok')}
      ${cartao('Outra rota', resumo.divergentes, 'st-div')}
      ${cartao('Duplicados', resumo.duplicados, 'st-dup')}
      ${cartao('Inválidos', resumo.invalidos, 'st-inv')}
      ${cartao('Pedidos distintos', resumo.qtdPedidos)}
      ${cartao('Ritmo (vol/min)', ritmo)}
    </div>

    <div class="rel-bloco">
      <h3>Pedidos com volume faltando (${incompletos.length})</h3>
      ${blocoIncompletos}
    </div>

    <div class="rel-bloco">
      <h3>Ocorrências registradas (${ocorrencias.length})</h3>
      ${blocoOcorrencias}
    </div>

    <div class="rel-bloco">
      <h3>Volumes conferidos (${leituras.length})</h3>
      <div class="rel-scroll">
        <table class="rel-tab">
          <thead><tr><th>Código</th><th>Rota</th><th>Pedido</th><th>Volume</th><th>Status</th><th>Ocorrência</th><th>Hora</th></tr></thead>
          <tbody>${linhas || '<tr><td colspan="7" class="rel-vazio">Nenhum volume bipado.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/** Preenche as fotos (Blob -> objectURL) depois que o HTML já está no DOM. */
export function hidratarFotos(container: HTMLElement, ocorrencias: Ocorrencia[]): void {
  const mapa = new Map(ocorrencias.map((o) => [o.id, o]));
  container.querySelectorAll<HTMLImageElement>('img[data-oc]').forEach((img) => {
    const o = mapa.get(img.dataset.oc ?? '');
    const blob = o?.fotos[Number(img.dataset.idx)];
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    img.src = url;
    img.addEventListener('click', () => window.open(url, '_blank'));
  });
}

/* ----------------------------------------------------------------- CSV ---- */

export function exportarCSV(r: DadosRelatorio): void {
  const { sessao, usuario, leituras, porLeitura } = r;
  const cabecalho = [
    'sessao', 'inicio_sessao', 'conferente', 'funcao', 'placa', 'grupo_rota', 'rotas_grupo',
    'codigo_volume', 'rota', 'pedido', 'volume', 'status', 'origem', 'horario',
    'lat', 'lng', 'precisao_m', 'geo_status', 'ocorrencias', 'raw_qr'
  ];
  const linhas = leituras.map((l) => [
    sessao.id, sessao.inicio, sessao.usuarioNome, usuario?.funcao ?? '', usuario?.placa ?? '',
    sessao.grupoNome, sessao.rotas.join('|'),
    l.codigoVolume ?? '', l.rota ?? '', l.pedido ?? '', l.volume ?? '', l.status, l.origem, l.timestamp,
    l.lat ?? '', l.lng ?? '', l.precisaoMetros ?? '', l.geoStatus,
    (porLeitura.get(l.id) ?? []).map((o) => o.texto).join(' | '),
    l.rawData
  ]);
  baixarArquivo(paraCSV(cabecalho, linhas), `conferencia_${sessao.id.slice(0, 8)}.csv`, 'text/csv;charset=utf-8');
}

export function exportarCSVOcorrencias(ocorrencias: Ocorrencia[], nomeArquivo = 'ocorrencias.csv'): void {
  const cabecalho = ['id', 'sessao', 'momento', 'grave', 'codigo_volume', 'texto', 'etiquetas', 'horario', 'lat', 'lng', 'fotos'];
  const linhas = ocorrencias.map((o) => [
    o.id, o.sessaoId, o.momento, o.grave ? 'SIM' : 'NAO', o.codigoVolume ?? '',
    o.texto, o.etiquetas.map(etiquetaTexto).join(' | '), o.timestamp,
    o.lat ?? '', o.lng ?? '', o.fotos.length
  ]);
  baixarArquivo(paraCSV(cabecalho, linhas), nomeArquivo, 'text/csv;charset=utf-8');
}

/* ----------------------------------------------------------------- PDF ---- */

const blobParaDataURL = (blob: Blob): Promise<string | null> =>
  new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
    fr.onerror = () => resolve(null);
    fr.readAsDataURL(blob);
  });

const finalY = (doc: jsPDF): number =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 20;

export async function exportarPDF(r: DadosRelatorio): Promise<void> {
  // jsPDF só entra quando alguém pede o PDF: na bipagem esse peso não se paga.
  // O chunk fica no precache do service worker, então funciona offline também.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);

  const { sessao, usuario, leituras, ocorrencias, resumo, incompletos, divergentes, porLeitura, ritmo } = r;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  let y = 14;

  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('Relatório de conferência de volumes', 14, y);
  y += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Milfarma — LogDis Entrega', 14, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    body: [
      ['Início', dataHora(sessao.inicio)],
      ['Fim', sessao.fim ? dataHora(sessao.fim) : 'em aberto'],
      ['Duração', duracao(sessao.inicio, sessao.fim)],
      ['Conferente', identificacao(sessao, usuario)],
      ['Grupo de rota', sessao.grupoNome],
      ['Rotas', sessao.rotas.join(', ')]
    ],
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 } }
  });
  y = finalY(doc) + 5;

  // A divergência é a informação mais importante da página.
  if (divergentes.length) {
    doc.setFillColor(217, 45, 32);
    doc.rect(14, y, larg - 28, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`ATENÇÃO: ${divergentes.length} volume(s) de outra rota — não podem embarcar`, 17, y + 6.2);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    y += 13;
    autoTable(doc, {
      startY: y,
      head: [['Código', 'Rota', 'Pedido', 'Volume', 'Hora']],
      body: divergentes.map((l) => [l.codigoVolume ?? '', l.rota ?? '', l.pedido ?? '', l.volume ?? '', hora(l.timestamp)]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [217, 45, 32] }
    });
    y = finalY(doc) + 5;
  }

  autoTable(doc, {
    startY: y,
    head: [['Total', 'Liberados', 'Outra rota', 'Duplicados', 'Inválidos', 'Pedidos', 'Vol/min']],
    body: [[resumo.total, resumo.ok, resumo.divergentes, resumo.duplicados, resumo.invalidos, resumo.qtdPedidos, ritmo]],
    styles: { fontSize: 9, halign: 'center' },
    headStyles: { fillColor: [30, 41, 59] }
  });
  y = finalY(doc) + 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Pedidos com volume faltando', 14, y);
  doc.setFont('helvetica', 'normal');
  autoTable(doc, {
    startY: y + 3,
    head: [['Pedido', 'Rota', 'Bipados', 'Declarado', 'Faltando']],
    body: incompletos.length
      ? incompletos.map((p) => [p.pedido, p.rota, p.bipados, p.total, p.faltando.join(', ')])
      : [['—', '—', '—', '—', 'Nenhum pedido incompleto']],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] }
  });
  y = finalY(doc) + 6;

  // Ocorrências: o texto na íntegra é a informação, não a etiqueta.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Ocorrências registradas (${ocorrencias.length})`, 14, y);
  doc.setFont('helvetica', 'normal');
  y += 5;

  const ordenadas = [...ocorrencias].sort((a, b) => {
    if (a.momento !== b.momento) return a.momento === 'EXPEDICAO' ? -1 : 1;
    return Number(b.grave) - Number(a.grave);
  });

  if (!ordenadas.length) {
    doc.setFontSize(9);
    doc.text('Nenhuma ocorrência registrada.', 14, y);
    y += 6;
  }

  for (const o of ordenadas) {
    if (y > 250) { doc.addPage(); y = 16; }
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    if (o.grave) doc.setTextColor(217, 45, 32);
    doc.text(`${MOMENTO_ROTULO[o.momento]}${o.grave ? ' — GRAVE' : ''} — ${dataHora(o.timestamp)}`, 14, y);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    y += 4.5;

    doc.text(o.codigoVolume ? `Volume: ${o.codigoVolume}` : 'Escopo: entrega inteira', 14, y);
    y += 4.5;

    const texto = doc.splitTextToSize(o.texto || '(sem descrição)', larg - 32) as string[];
    doc.text(texto, 18, y);
    y += texto.length * 4.2 + 1;

    if (o.etiquetas.length) {
      doc.setFontSize(8);
      const ets = doc.splitTextToSize(`Etiquetas: ${o.etiquetas.map(etiquetaTexto).join(' • ')}`, larg - 32) as string[];
      doc.text(ets, 18, y);
      doc.setFontSize(9);
      y += ets.length * 3.8 + 1;
    }

    if (o.lat !== null && o.lng !== null) {
      doc.setFontSize(8);
      doc.text(`Local: ${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}${o.precisaoMetros ? ` (±${o.precisaoMetros} m)` : ''}`, 18, y);
      doc.setFontSize(9);
      y += 4;
    }

    for (const foto of o.fotos) {
      const dataUrl = await blobParaDataURL(foto);
      if (!dataUrl) continue;
      if (y > 215) { doc.addPage(); y = 16; }
      try {
        doc.addImage(dataUrl, 'JPEG', 18, y, 45, 34);
        y += 37;
      } catch { /* foto ilegível não pode derrubar o relatório */ }
    }
    y += 3;
  }

  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Volumes conferidos', 14, 16);
  doc.setFont('helvetica', 'normal');
  autoTable(doc, {
    startY: 20,
    head: [['Código', 'Rota', 'Pedido', 'Volume', 'Status', 'Ocorrência', 'Hora']],
    body: leituras.map((l) => [
      l.codigoVolume ?? '—', l.rota ?? '—', l.pedido ?? '—', l.volume ?? '—',
      STATUS_INFO[l.status].curto,
      (porLeitura.get(l.id) ?? []).map((o) => o.texto).join(' | ') || '—',
      hora(l.timestamp)
    ]),
    styles: { fontSize: 7.5, cellPadding: 1.4 },
    headStyles: { fillColor: [30, 41, 59] },
    didParseCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 4) return;
      const v = String(d.cell.raw);
      if (v === 'Divergente') { d.cell.styles.textColor = [217, 45, 32]; d.cell.styles.fontStyle = 'bold'; }
      else if (v === 'Duplicado') d.cell.styles.textColor = [180, 110, 20];
      else if (v === 'OK') d.cell.styles.textColor = [18, 120, 60];
    }
  });

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(`LogDis Entrega — sessão ${sessao.id}`, 14, alt - 8);
    doc.text(`${i}/${total}`, larg - 20, alt - 8);
  }

  doc.save(`conferencia_${sessao.id.slice(0, 8)}.pdf`);
}
