// types.ts — modelo de dados do LogDis Entrega.
//
// O IndexedDB é a fonte da verdade durante a operação. O Supabase é destino de
// sincronização, nunca dependência da bipagem: toda entidade nasce PENDENTE
// localmente e só depois vira ENVIADO.

export type StatusLeitura = 'OK' | 'ROTA_DIVERGENTE' | 'DUPLICADO' | 'INVALIDO';

export type GeoStatus = 'OK' | 'NEGADO' | 'INDISPONIVEL' | 'IMPRECISO';

export type Momento = 'EXPEDICAO' | 'TRANSPORTADORA';

export type StatusSessao = 'ABERTA' | 'ENCERRADA';

export type OrigemLeitura = 'CAMERA' | 'MANUAL';

/** Estado do registro na fila de envio para o Supabase. */
export type StatusSync = 'PENDENTE' | 'ENVIADO' | 'ERRO';

export interface Sincronizavel {
  /** 'PENDENTE' assim que grava; o motor de sync cuida do resto. */
  sync: StatusSync;
  syncTentativas: number;
  syncErro: string | null;
  /** Última alteração local — usado como desempate no upsert. */
  atualizadoEm: string;
}

export interface Usuario extends Sincronizavel {
  id: string;
  nome: string;
  login: string;
  /** Nunca sai do aparelho: o hash não é enviado ao Supabase. */
  senhaHash: string;
  gestor: boolean;
  /** Texto livre e descritivo. Não é regra de acesso. */
  funcao: string;
  telefone: string;
  placa: string;
  ativo: boolean;
}

export interface GrupoRota extends Sincronizavel {
  id: string;
  nome: string;
  /** Prefixos aceitos: ['FNOR', 'FSUL']. */
  rotas: string[];
  /** Opcional — alimenta o ranking por transportadora no painel do diretor. */
  transportadora: string;
  ativo: boolean;
}

export interface PontoGeo {
  lat: number | null;
  lng: number | null;
  precisaoMetros: number | null;
  geoStatus: GeoStatus;
}

export interface Sessao extends Sincronizavel {
  id: string;
  grupoRotaId: string;
  usuarioId: string;
  inicio: string;
  fim: string | null;
  status: StatusSessao;
  /** Cópias congeladas: o relatório não pode mudar se o cadastro mudar depois. */
  grupoNome: string;
  rotas: string[];
  transportadora: string;
  usuarioNome: string;
  geoInicio: PontoGeo | null;
  geoFim: PontoGeo | null;
}

export interface Leitura extends Sincronizavel, PontoGeo {
  id: string;
  sessaoId: string;
  codigoVolume: string | null;
  rota: string | null;
  rotaPrefixo: string | null;
  volume: string | null;
  volumeAtual: number | null;
  volumeTotal: number | null;
  pedido: string | null;
  status: StatusLeitura;
  timestamp: string;
  /** Prova do que foi lido de fato. Nunca normalizar, nunca perder. */
  rawData: string;
  origem: OrigemLeitura;
  motivoInvalido: string | null;
}

export interface Ocorrencia extends Sincronizavel {
  id: string;
  sessaoId: string;
  /** Nulo quando a ocorrência é da entrega inteira, não de um volume. */
  leituraId: string | null;
  /** Redundância proposital: o relatório não precisa cruzar tabela. */
  codigoVolume: string | null;
  usuarioId: string;
  momento: Momento;
  texto: string;
  etiquetas: string[];
  /** Derivado das etiquetas, nunca digitado. */
  grave: boolean;
  fotos: Blob[];
  /** Caminhos no Storage do Supabase depois do upload. */
  fotosRemotas: string[];
  timestamp: string;
  lat: number | null;
  lng: number | null;
  precisaoMetros: number | null;
  geoStatus: GeoStatus;
}

export interface EtiquetaOcorrencia {
  id: string;
  momento: Momento;
  texto: string;
  grave: boolean;
}

export interface EtiquetaParseada {
  valido: boolean;
  rawData: string;
  motivo?: string;
  codigoVolume?: string;
  rota?: string;
  rotaPrefixo?: string;
  volume?: string;
  volumeAtual?: number | null;
  volumeTotal?: number | null;
  pedido?: string;
}

export interface Classificacao {
  status: StatusLeitura;
  dados: EtiquetaParseada;
}

export interface ResumoLeituras {
  total: number;
  ok: number;
  divergentes: number;
  duplicados: number;
  invalidos: number;
  qtdPedidos: number;
}

export interface PedidoIncompleto {
  pedido: string;
  rota: string;
  total: number;
  bipados: number;
  faltando: string[];
}

export interface ConfigSupabase {
  url: string;
  anonKey: string;
  bucket: string;
}

export interface EstadoSync {
  pendentes: number;
  online: boolean;
  configurado: boolean;
  enviando: boolean;
  ultimoEnvio: string | null;
  ultimoErro: string | null;
}
