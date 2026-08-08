// model.ts — regras de domínio: parsing da etiqueta, classificação da leitura
// e catálogo de etiquetas de ocorrência.
//
// O formato do QR vem do operador logístico (LOGDIS / Zion Logtec) e NÃO pode
// ser alterado. Qualquer mudança aqui precisa continuar aceitando:
//   EMB0008314147;FNOR 100;0001/0002;86945574

import type {
  Classificacao, EtiquetaOcorrencia, EtiquetaParseada, Leitura,
  Momento, PedidoIncompleto, ResumoLeituras, StatusLeitura
} from '../types.js';

export const STATUS = {
  OK: 'OK',
  ROTA_DIVERGENTE: 'ROTA_DIVERGENTE',
  DUPLICADO: 'DUPLICADO',
  INVALIDO: 'INVALIDO'
} as const satisfies Record<string, StatusLeitura>;

export const STATUS_INFO: Record<StatusLeitura, { rotulo: string; curto: string; cor: string; classe: string }> = {
  OK: { rotulo: 'Volume liberado', curto: 'OK', cor: '#12a150', classe: 'st-ok' },
  ROTA_DIVERGENTE: { rotulo: 'Volume de outra rota', curto: 'Divergente', cor: '#d92d20', classe: 'st-div' },
  DUPLICADO: { rotulo: 'Já bipado nesta conferência', curto: 'Duplicado', cor: '#e8a33d', classe: 'st-dup' },
  INVALIDO: { rotulo: 'Etiqueta não reconhecida', curto: 'Inválido', cor: '#8a8f98', classe: 'st-inv' }
};

export const MOMENTO_ROTULO: Record<Momento, string> = {
  EXPEDICAO: 'Na expedição',
  TRANSPORTADORA: 'Na transportadora'
};

/** Etiquetas rápidas de ocorrência. Nenhuma é obrigatória. */
export const ETIQUETAS: EtiquetaOcorrencia[] = [
  { id: 'emb_amassada', momento: 'EXPEDICAO', texto: 'Embalagem amassada', grave: false },
  { id: 'lacre_violado', momento: 'EXPEDICAO', texto: 'Lacre violado', grave: true },
  { id: 'volume_molhado', momento: 'EXPEDICAO', texto: 'Volume molhado / vazamento', grave: true },
  { id: 'volume_aberto', momento: 'EXPEDICAO', texto: 'Volume aberto', grave: true },
  { id: 'etiqueta_ilegivel', momento: 'EXPEDICAO', texto: 'Etiqueta ilegível', grave: false },
  { id: 'termica_comprometida', momento: 'EXPEDICAO', texto: 'Embalagem térmica comprometida', grave: true },

  { id: 'demora_recepcao', momento: 'TRANSPORTADORA', texto: 'Demora na recepção', grave: false },
  { id: 'doca_fechada', momento: 'TRANSPORTADORA', texto: 'Doca fechada / sem atendimento', grave: false },
  { id: 'recusou_volume', momento: 'TRANSPORTADORA', texto: 'Transportadora recusou o volume', grave: true },
  { id: 'divergencia_conferencia', momento: 'TRANSPORTADORA', texto: 'Divergência na conferência deles', grave: true },
  { id: 'sem_canhoto', momento: 'TRANSPORTADORA', texto: 'Sem comprovante / canhoto', grave: true },
  { id: 'avariado_chegada', momento: 'TRANSPORTADORA', texto: 'Volume avariado na chegada', grave: true }
];

export const ETIQUETA_POR_ID: Record<string, EtiquetaOcorrencia> =
  Object.fromEntries(ETIQUETAS.map((e) => [e.id, e]));

export const etiquetasDoMomento = (momento: Momento): EtiquetaOcorrencia[] =>
  ETIQUETAS.filter((e) => e.momento === momento);

export const etiquetaTexto = (id: string): string => ETIQUETA_POR_ID[id]?.texto ?? id;

/** `grave` é derivado das etiquetas marcadas — nunca digitado. */
export const derivarGrave = (ids: string[]): boolean =>
  ids.some((id) => ETIQUETA_POR_ID[id]?.grave === true);

export const normalizar = (s: unknown): string =>
  String(s ?? '').trim().toUpperCase();

/** Prefixo alfabético da rota: 'FNOR 100' -> 'FNOR'. O sufixo é sequência de carga. */
export function prefixoRota(rota: unknown): string {
  const m = normalizar(rota).match(/^[A-Z]+/);
  return m ? m[0] : '';
}

/**
 * Comparação de rota: só o prefixo alfabético, igualdade exata.
 * Nunca usar includes() sobre a string inteira — 'FNOR' não pode casar com
 * 'XFNORY' de outro operador.
 */
export function rotaPertence(rotaLida: unknown, rotasDoGrupo: string[]): boolean {
  const p = prefixoRota(rotaLida);
  if (!p) return false;
  return rotasDoGrupo.some((r) => prefixoRota(r) === p);
}

/**
 * Parse defensivo. Nada é descartado em silêncio: o que não bate o formato
 * volta com valido=false e vira INVALIDO, com o motivo preservado.
 */
export function parseEtiqueta(raw: unknown): EtiquetaParseada {
  const bruto = String(raw ?? '');
  const partes = bruto.split(';');

  if (partes.length !== 4) {
    return { valido: false, rawData: bruto, motivo: `esperado 4 campos, veio ${partes.length}` };
  }

  const codigoVolume = normalizar(partes[0]);
  const rota = normalizar(partes[1]);
  const volume = normalizar(partes[2]);
  const pedido = normalizar(partes[3]);

  if (!codigoVolume || !rota || !volume || !pedido) {
    return { valido: false, rawData: bruto, motivo: 'campo vazio na etiqueta' };
  }
  if (!prefixoRota(rota)) {
    return { valido: false, rawData: bruto, motivo: 'rota sem prefixo alfabético' };
  }

  // '0001/0002' -> atual 1, total 2. Sem esse formato o volume segue válido,
  // só não entra na checagem de pedido incompleto.
  const mv = volume.match(/^(\d+)\s*\/\s*(\d+)$/);

  return {
    valido: true,
    rawData: bruto,
    codigoVolume,
    rota,
    rotaPrefixo: prefixoRota(rota),
    volume,
    volumeAtual: mv ? Number(mv[1]) : null,
    volumeTotal: mv ? Number(mv[2]) : null,
    pedido
  };
}

/**
 * Classifica a leitura. A ordem é proposital:
 *   INVALIDO -> ROTA_DIVERGENTE -> DUPLICADO -> OK
 * Divergência vem antes de duplicado porque rebipar um volume de outra rota
 * tem que voltar vermelho, não âmbar. Divergência nunca fica escondida.
 */
export function classificar(raw: unknown, rotasDoGrupo: string[], jaBipados: Set<string>): Classificacao {
  const dados = parseEtiqueta(raw);

  if (!dados.valido) return { status: STATUS.INVALIDO, dados };
  if (!rotaPertence(dados.rota, rotasDoGrupo)) return { status: STATUS.ROTA_DIVERGENTE, dados };
  if (jaBipados.has(dados.codigoVolume as string)) return { status: STATUS.DUPLICADO, dados };
  return { status: STATUS.OK, dados };
}

/**
 * Pedidos com volume faltando, derivado do próprio QR — sem manifesto:
 * bipou 0001/0002 e o 0002/0002 nunca apareceu.
 */
export function pedidosIncompletos(leituras: Leitura[]): PedidoIncompleto[] {
  type Acc = { pedido: string; total: number; bipados: Set<number>; rota: string };
  const porPedido = new Map<string, Acc>();

  for (const l of leituras) {
    if (l.status === STATUS.INVALIDO) continue;
    if (!l.pedido || !l.volumeTotal) continue;
    let p = porPedido.get(l.pedido);
    if (!p) {
      p = { pedido: l.pedido, total: 0, bipados: new Set(), rota: l.rota ?? '' };
      porPedido.set(l.pedido, p);
    }
    p.total = Math.max(p.total, l.volumeTotal);
    if (l.volumeAtual) p.bipados.add(l.volumeAtual);
  }

  const incompletos: PedidoIncompleto[] = [];
  for (const p of porPedido.values()) {
    if (p.bipados.size >= p.total) continue;
    const faltando: string[] = [];
    for (let i = 1; i <= p.total; i++) {
      if (!p.bipados.has(i)) faltando.push(String(i).padStart(4, '0'));
    }
    incompletos.push({ pedido: p.pedido, rota: p.rota, total: p.total, bipados: p.bipados.size, faltando });
  }
  return incompletos.sort((a, b) => a.pedido.localeCompare(b.pedido));
}

export function resumir(leituras: Leitura[]): ResumoLeituras {
  const pedidos = new Set<string>();
  let ok = 0;
  let divergentes = 0;
  let duplicados = 0;
  let invalidos = 0;

  for (const l of leituras) {
    if (l.status === STATUS.OK) ok++;
    else if (l.status === STATUS.ROTA_DIVERGENTE) divergentes++;
    else if (l.status === STATUS.DUPLICADO) duplicados++;
    else invalidos++;
    if (l.pedido) pedidos.add(l.pedido);
  }

  return { total: leituras.length, ok, divergentes, duplicados, invalidos, qtdPedidos: pedidos.size };
}
