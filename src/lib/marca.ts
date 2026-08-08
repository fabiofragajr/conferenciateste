// marca.ts — identidade LOGDIS nas exportações.
//
// O PDF é o que sai da empresa e chega na mão do gestor e da transportadora.
// Cor, nome e assinatura vêm daqui, nunca escritos à mão em cada relatório.
// Os valores espelham os tokens de src/styles/base.css: mudou lá, muda aqui.

import type { jsPDF } from 'jspdf';

export type RGB = [number, number, number];

export const MARCA = 'LOGDIS Connect';
export const EMPRESA = 'Milfarma';
export const ASSINATURA = `${EMPRESA} — ${MARCA}`;

/* ------------------------------------------------------------- marca --- */
export const FOREST: RGB = [16, 89, 69];    // --logdis-forest
export const GREEN: RGB = [16, 153, 118];   // --logdis-green
export const MINT: RGB = [46, 181, 141];    // --logdis-mint
// A menta da tela não tem contraste para texto pequeno sobre o verde escuro
// (~3,3:1). Esta é a versão clara, para leitura no papel e na tela.
export const MINT_CLARO: RGB = [154, 220, 199];

/* Operação: no papel não há cor de fundo para sustentar contraste, então
   verde e âmbar entram escurecidos. Vermelho de divergência não muda. */
export const DIV: RGB = [220, 38, 38];      // --div
export const OK_TEXTO: RGB = [21, 128, 61];
export const DUP_TEXTO: RGB = [161, 98, 7];

export const TEXTO: RGB = [34, 38, 37];
export const TEXTO_2: RGB = [102, 112, 109];
export const LINHA: RGB = [220, 228, 225];  // --borda

let simbolo: string | null | undefined;

// O jsPDF embute o bitmap pixel a pixel: o PNG de 256 px vira ~190 KB dentro do
// arquivo. A 14 mm bastam 96 px (~175 dpi), e o relatório volta a caber num
// e-mail de galpão.
const LADO_PDF = 96;

/** Símbolo oficial em data URL, reduzido. `null` se não carregar — o PDF nunca depende dele. */
export async function carregarSimbolo(): Promise<string | null> {
  if (simbolo !== undefined) return simbolo;
  try {
    const resp = await fetch(new URL('./logdis-simbolo.png', document.baseURI));
    if (!resp.ok) throw new Error(String(resp.status));
    const bitmap = await createImageBitmap(await resp.blob());
    const canvas = document.createElement('canvas');
    canvas.width = LADO_PDF;
    canvas.height = LADO_PDF;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sem canvas 2d');
    ctx.drawImage(bitmap, 0, 0, LADO_PDF, LADO_PDF);
    bitmap.close();
    simbolo = canvas.toDataURL('image/png');
  } catch {
    simbolo = null; // sem rede e sem precache: sai sem logo, mas sai
  }
  return simbolo;
}

/** Faixa institucional no topo da página. Devolve o y onde o conteúdo começa. */
export async function cabecalhoPDF(doc: jsPDF, titulo: string, subtitulo: string): Promise<number> {
  const larg = doc.internal.pageSize.getWidth();
  doc.setFillColor(...FOREST);
  doc.rect(0, 0, larg, 26, 'F');

  let x = 14;
  const png = await carregarSimbolo();
  if (png) {
    try {
      doc.addImage(png, 'PNG', 14, 6, 14, 14, 'logdis', 'FAST');
      x = 33;
    } catch { /* logo ilegível não segura o documento */ }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(titulo, x, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MINT_CLARO);
  doc.text(subtitulo, x, 20);

  doc.setTextColor(...TEXTO);
  doc.setFontSize(10);
  return 34;
}

/** Rodapé de todas as páginas: quem emitiu, sobre o quê, e a paginação. */
export function rodapePDF(doc: jsPDF, referencia: string): void {
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();

  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINHA);
    doc.setLineWidth(0.2);
    doc.line(14, alt - 12, larg - 14, alt - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXTO_2);
    doc.text(`${ASSINATURA} — ${referencia}`, 14, alt - 8);
    doc.text(`${i}/${total}`, larg - 20, alt - 8);
  }
  doc.setTextColor(...TEXTO);
}
