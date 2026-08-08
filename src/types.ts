// types.ts — modelo de dados do LogDis Entrega.
//
// O IndexedDB é a fonte da verdade durante a operação. O Supabase é destino de
// sincronização, nunca dependência da bipagem: toda entidade nasce PENDENTE
// localmente e só depois vira ENVIADO.

export type StatusLeitura =
  | 'OK'
  | 'ROTA_DIVERGENTE'
  /** Código de rota que ninguém cadastrou: o sistema não sabe de quem é. */
  | 'DESTINO_NAO_MAPEADO'
  | 'DUPLICADO'
  | 'INVALIDO';

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

/**
 * Transportadora terceira que recebe a carga. É o que o operador escolhe antes
 * de bipar, e o que define se um volume pode ou não entrar naquele veículo.
 */
export interface Transportadora extends Sincronizavel {
  id: string;
  nome: string;
  cnpj: string;
  responsavel: string;
  telefone: string;
  email: string;
  ativo: boolean;
}

/**
 * Código de rota. O código é ÚNICO em todo o sistema: se FNOR pertence à
 * Transportadora Alfa, nenhuma outra pode cadastrá-lo — é essa unicidade que
 * permite descobrir o dono do volume só a partir da etiqueta.
 *
 * `codigo` guarda o prefixo alfabético que aparece na etiqueta ('FNOR'), sem o
 * sufixo numérico de sequência ('FNOR 100', 'FNOR 15' casam com o mesmo código).
 */
export interface Rota extends Sincronizavel {
  id: string;
  codigo: string;
  nome: string;
  transportadoraId: string;
  descricao: string;
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
  transportadoraId: string;
  usuarioId: string;
  inicio: string;
  fim: string | null;
  status: StatusSessao;
  /** Cópias congeladas: o relatório não pode mudar se o cadastro mudar depois. */
  transportadoraNome: string;
  /** Códigos de rota da transportadora no momento da conferência. */
  rotas: string[];
  usuarioNome: string;
  geoInicio: PontoGeo | null;
  geoFim: PontoGeo | null;
  /** Quem liberou a carga, e quando — só depois de encerrada. */
  liberadaEm: string | null;
  liberadaPor: string | null;
  /** Pendências no momento da liberação, congeladas para auditoria. */
  liberadaComPendencias: boolean;
}

export interface Leitura extends Sincronizavel, PontoGeo {
  id: string;
  sessaoId: string;
  codigoVolume: string | null;
  /** Campo 2 da etiqueta, cru: 'FNOR 100'. */
  rota: string | null;
  /** Código comparável, sem o sufixo de sequência: 'FNOR'. */
  rotaPrefixo: string | null;
  /** Rota cadastrada que casou com o código lido, quando existe. */
  rotaId: string | null;
  /** Dona do código lido — é o que explica a divergência para quem está na doca. */
  transportadoraDonaId: string | null;
  transportadoraDonaNome: string | null;
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
  /** Aparelho que gerou a leitura — desempata conflito entre operadores offline. */
  dispositivoId: string;
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
  /** Rota cadastrada que casou com o código lido, quando existe. */
  rota?: Rota;
  /** Quando é duplicado: quem bipou primeiro e a que horas. */
  primeira?: { timestamp: string; usuarioNome: string };
}

export interface ResumoLeituras {
  total: number;
  ok: number;
  divergentes: number;
  naoMapeados: number;
  duplicados: number;
  invalidos: number;
  qtdPedidos: number;
}

/** Aparelho que já operou — o gestor precisa saber se os números estão completos. */
export interface Dispositivo {
  id: string;
  apelido: string;
  ultimaSync: string | null;
  pendentes: number;
  ultimoUsuario: string;
  atualizadoEm: string;
}

/** O que impede a carga de sair. Vazio = liberada. */
export interface Pendencia {
  tipo: 'DIVERGENCIA' | 'PEDIDO_INCOMPLETO' | 'DESTINO_NAO_MAPEADO';
  descricao: string;
  quantidade: number;
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
  /** Última vez que o cadastro desceu do servidor para este aparelho. */
  ultimaDescida: string | null;
  ultimoErro: string | null;
  usuarioAtual: string;
}
