// model.ts — regras de domínio: parsing da etiqueta, classificação da leitura
// e catálogo de etiquetas de ocorrência.
//
// O formato do QR vem do operador logístico (LOGDIS / Zion Logtec) e NÃO pode
// ser alterado. Qualquer mudança aqui precisa continuar aceitando:
//   EMB0008314147;FNOR 100;0001/0002;86945574

import type {
  Classificacao, EtiquetaOcorrencia, EtiquetaParseada, Leitura,
  Momento, PedidoIncompleto, ResumoLeituras, Rota, StatusLeitura
} from '../types.js';

export const STATUS = {
  OK: 'OK',
  ROTA_DIVERGENTE: 'ROTA_DIVERGENTE',
  DESTINO_NAO_MAPEADO: 'DESTINO_NAO_MAPEADO',
  DUPLICADO: 'DUPLICADO',
  INVALIDO: 'INVALIDO'
} as const satisfies Record<string, StatusLeitura>;

export const STATUS_INFO: Record<StatusLeitura, { rotulo: string; curto: string; cor: string; classe: string }> = {
  // `cor` espelha os tokens --ok/--div/--dup/--inv de base.css. É a mesma cor no
  // flash de tela cheia, no mapa do gestor e na etiqueta de status: se divergir
  // aqui, o operador vê um vermelho e o gestor vê outro.
  OK: { rotulo: 'Volume liberado', curto: 'OK', cor: '#16a34a', classe: 'st-ok' },
  ROTA_DIVERGENTE: { rotulo: 'Volume de outra rota', curto: 'Divergente', cor: '#dc2626', classe: 'st-div' },
  // Código que ninguém cadastrou. Não é divergência — o sistema simplesmente
  // não sabe de quem é a caixa, e quem decide isso é o gestor, não a doca.
  DESTINO_NAO_MAPEADO: { rotulo: 'Rota não cadastrada', curto: 'Não mapeado', cor: '#ea580c', classe: 'st-mapa' },
  DUPLICADO: { rotulo: 'Já bipado nesta conferência', curto: 'Duplicado', cor: '#d97706', classe: 'st-dup' },
  INVALIDO: { rotulo: 'Etiqueta não reconhecida', curto: 'Inválido', cor: '#6b7280', classe: 'st-inv' }
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

/** Tudo que a classificação precisa saber, já em memória — nada de rede aqui. */
export interface ContextoConferencia {
  /** Transportadora escolhida pelo operador ao abrir a conferência. */
  transportadoraId: string;
  /** Cadastro de rotas indexado pelo código (prefixo alfabético). */
  rotasPorCodigo: Map<string, Rota>;
  /** codigoVolume já lido nesta conferência -> primeira leitura. */
  jaBipados: Map<string, PrimeiraLeitura>;
}

export interface PrimeiraLeitura {
  timestamp: string;
  usuarioNome: string;
}

/**
 * Classifica a leitura consultando só o que está na memória do aparelho.
 *
 * A ordem é proposital:
 *   INVALIDO -> DESTINO_NAO_MAPEADO -> ROTA_DIVERGENTE -> DUPLICADO -> OK
 *
 * Divergência vem antes de duplicado porque rebipar um volume de outra
 * transportadora tem que voltar vermelho, não âmbar — divergência nunca fica
 * escondida. E código sem cadastro não pode virar divergência: o sistema não
 * sabe de quem é a caixa, e fingir que sabe é pior do que dizer que não sabe.
 */
export function classificar(raw: unknown, ctx: ContextoConferencia): Classificacao {
  const dados = parseEtiqueta(raw);

  if (!dados.valido) return { status: STATUS.INVALIDO, dados };

  const rota = ctx.rotasPorCodigo.get(dados.rotaPrefixo as string);
  if (!rota) return { status: STATUS.DESTINO_NAO_MAPEADO, dados };

  if (rota.transportadoraId !== ctx.transportadoraId) {
    return { status: STATUS.ROTA_DIVERGENTE, dados, rota };
  }

  const primeira = ctx.jaBipados.get(dados.codigoVolume as string);
  if (primeira) return { status: STATUS.DUPLICADO, dados, rota, primeira };

  return { status: STATUS.OK, dados, rota };
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
  let naoMapeados = 0;
  let duplicados = 0;
  let invalidos = 0;

  for (const l of leituras) {
    if (l.status === STATUS.OK) ok++;
    else if (l.status === STATUS.ROTA_DIVERGENTE) divergentes++;
    else if (l.status === STATUS.DESTINO_NAO_MAPEADO) naoMapeados++;
    else if (l.status === STATUS.DUPLICADO) duplicados++;
    else invalidos++;
    if (l.pedido) pedidos.add(l.pedido);
  }

  return {
    total: leituras.length,
    ok, divergentes, naoMapeados, duplicados, invalidos,
    qtdPedidos: pedidos.size
  };
}

/**
 * O que impede a carga de sair. É a mesma conta na tela do operador, no
 * relatório e no painel — uma regra só, para os três não discordarem.
 */
export function pendenciasDaCarga(leituras: Leitura[]): import('../types.js').Pendencia[] {
  const resumo = resumir(leituras);
  const incompletos = pedidosIncompletos(leituras);
  const pendencias: import('../types.js').Pendencia[] = [];

  if (resumo.divergentes > 0) {
    pendencias.push({
      tipo: 'DIVERGENCIA',
      quantidade: resumo.divergentes,
      descricao: `${resumo.divergentes} volume(s) de outra transportadora`
    });
  }
  if (resumo.naoMapeados > 0) {
    pendencias.push({
      tipo: 'DESTINO_NAO_MAPEADO',
      quantidade: resumo.naoMapeados,
      descricao: `${resumo.naoMapeados} volume(s) com rota não cadastrada`
    });
  }
  if (incompletos.length > 0) {
    pendencias.push({
      tipo: 'PEDIDO_INCOMPLETO',
      quantidade: incompletos.length,
      descricao: `${incompletos.length} pedido(s) com volume faltando`
    });
  }
  return pendencias;
}
