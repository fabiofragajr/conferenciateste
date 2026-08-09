// icones.ts — o alfabeto visual da navegação, num lugar só.
//
// Antes existiam DOIS mapas de glifos — um na lateral, outro na barra do
// celular — e nada obrigava os dois a concordarem. Pior que a duplicação: eram
// caracteres Unicode emprestados (`☰` para Pessoas, `⬢` para Transportadoras,
// `⌗` para Códigos de rota). Isso não é ícone de coisa nenhuma. É uma forma
// abstrata que cada aparelho desenha com a fonte que tiver, num tamanho que
// ninguém controla, e que a pessoa precisa DECORAR em vez de reconhecer.
//
// Aqui são pictogramas: casa, caminhão, prancheta, alfinete de mapa. A regra
// de um ícone de menu é ser entendido antes da leitura do rótulo — desenho de
// coisa faz isso, quadrado com um canto cortado não faz.
//
// Traçado e monocromático: `currentColor` em tudo, então o ícone herda a cor do
// item (apagado em repouso, cheio quando ativo) sem uma segunda regra de CSS.
//
// Sem biblioteca de ícones. O app é precacheado inteiro e abre sem rede no
// galpão; fonte de ícone ou CDN não entram neste caminho.

/** O desenho de cada um, no quadro de 24×24. Só o miolo do `<svg>`. */
const TRACOS: Record<string, string> = {
  // casa — "o começo", a convenção mais antiga que existe numa navegação
  inicio: '<path d="M3 10.2 12 3l9 7.2"/><path d="M5.2 9.3V19a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V9.3"/><path d="M9.6 21v-5.6a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1V21"/>',

  // triângulo de atenção — a caixa que não pode embarcar
  divergencias: '<path d="M10.3 4.2 2.6 17.3a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.4v4.2"/><path d="M12 17.3h.01"/>',

  // caixa com a metade direita tracejada — o volume que foi declarado e não veio
  incompletos: '<path d="M12 2.9 3.4 7.4v9.2L12 21.1"/><path d="m3.4 7.4 8.6 4.6v9.1"/><path d="M12 2.9l8.6 4.5v9.2L12 21.1" stroke-dasharray="2.6 2.4"/><path d="M20.6 7.4 12 12" stroke-dasharray="2.6 2.4"/>',

  // prancheta com visto — conferir é exatamente isto
  conferencias: '<rect x="8.4" y="2.3" width="7.2" height="4" rx="1.2"/><path d="M15.6 4.3h1.9a2 2 0 0 1 2 2v13.4a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V6.3a2 2 0 0 1 2-2h1.9"/><path d="m9.2 13.9 2.1 2.1 4-4"/>',

  // balão com linhas — a ocorrência é, antes de tudo, texto escrito
  ocorrencias: '<path d="M20.6 14.7a2 2 0 0 1-2 2H7.9l-4.5 4V5.2a2 2 0 0 1 2-2h13.2a2 2 0 0 1 2 2Z"/><path d="M7.4 8.2h9.2"/><path d="M7.4 12h5.8"/>',

  // barras — desempenho é comparação entre pares
  desempenho: '<path d="M3.2 3v15.8a2 2 0 0 0 2 2H21"/><rect x="7.1" y="11.4" width="3.1" height="5.6" rx=".8"/><rect x="12.6" y="7.4" width="3.1" height="9.6" rx=".8"/><rect x="18.1" y="13.4" width="3.1" height="3.6" rx=".8"/>',

  // linha de tendência — indicadores é "melhorou ou piorou?", nunca um par
  indicadores: '<path d="M3 17.6 9.4 11l3.9 3.9L21 7.2"/><path d="M15.4 7.2H21v5.6"/>',

  // alfinete — onde a conferência aconteceu de fato
  mapa: '<path d="M20 10.4c0 5.4-6.5 10.5-7.6 11.4a.6.6 0 0 1-.8 0C10.5 20.9 4 15.8 4 10.4a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10.2" r="2.7"/>',

  // folha escrita — o entregável do sistema
  relatorios: '<path d="M14.3 2.4H7a2 2 0 0 0-2 2v15.2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.1Z"/><path d="M14.3 2.4v4.7H19"/><path d="M8.4 12.6h7.2"/><path d="M8.4 16.4h7.2"/><path d="M8.4 8.8h2.4"/>',

  // duas pessoas — quem bipa
  pessoas: '<path d="M15.4 20.4v-1.7a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.7v1.7"/><circle cx="9.2" cy="7.6" r="3.5"/><path d="M21 20.4v-1.7a3.6 3.6 0 0 0-2.7-3.5"/><path d="M15.6 4.3a3.6 3.6 0 0 1 0 6.8"/>',

  // caminhão — a transportadora que leva a partir daqui
  transportadoras: '<path d="M13.6 17.6V7a1.6 1.6 0 0 0-1.6-1.6H3.6A1.6 1.6 0 0 0 2 7v9a1.6 1.6 0 0 0 1.6 1.6h.8"/><path d="M13.6 9.4h3.5a1.6 1.6 0 0 1 1.3.6l2.3 3.1a1.6 1.6 0 0 1 .3 1v2.5a1 1 0 0 1-1 1h-.8"/><path d="M8.8 17.6h4.8"/><circle cx="6.6" cy="17.7" r="2.2"/><circle cx="17.4" cy="17.7" r="2.2"/>',

  // trajeto entre dois pontos — o código de rota é o caminho da caixa
  rotas: '<circle cx="6.2" cy="18.8" r="2.9"/><circle cx="17.8" cy="5.2" r="2.9"/><path d="M9.1 18.8h4.6a3.9 3.9 0 0 0 0-7.8h-3.4a3.9 3.9 0 0 1 0-7.8h4.6"/>',

  // setas em ciclo — a fila subindo e o cadastro descendo
  sincronizacao: '<path d="M20.7 11.4a8.7 8.7 0 0 0-14.9-5.5L2.4 9.2"/><path d="M2.4 4.3v4.9h4.9"/><path d="M3.3 12.6a8.7 8.7 0 0 0 14.9 5.5l3.4-3.3"/><path d="M21.6 19.7v-4.9h-4.9"/>',

  // ------------------------------------------------------------ operação ---
  // A doca usa o MESMO conjunto do painel, e não um próprio: quem é gestor
  // circula entre as duas telas o dia todo, e duas gramáticas de ícone no mesmo
  // app é a pessoa tendo que aprender duas vezes.

  // seta para a esquerda — a saída da bipagem, que antes não existia
  voltar: '<path d="M20 12H4.2"/><path d="m10.4 5.6-6.2 6.4 6.2 6.4"/>',

  // lanterna
  lanterna: '<path d="M6.4 2.8h11.2v3.4a2 2 0 0 1-.5 1.3l-2.2 2.6a2 2 0 0 0-.5 1.3v8a1.8 1.8 0 0 1-1.8 1.8h-1.2a1.8 1.8 0 0 1-1.8-1.8v-8a2 2 0 0 0-.5-1.3L6.9 7.5a2 2 0 0 1-.5-1.3Z"/><path d="M6.4 6.4h11.2"/><path d="M12 13.6v2.2"/>',

  // teclado — a entrada manual, o caminho de quando o QR está rasgado
  teclado: '<rect x="2.4" y="5.6" width="19.2" height="12.8" rx="2.2"/><path d="M6.4 9.6h.01"/><path d="M10 9.6h.01"/><path d="M13.6 9.6h.01"/><path d="M17.2 9.6h.01"/><path d="M6.4 12.8h.01"/><path d="M17.2 12.8h.01"/><path d="M9.4 15.6h5.2"/>',

  // bandeira de chegada — encerrar a conferência
  encerrar: '<path d="M5 21.4V3.2"/><path d="M5 4.2h11.6l-1.9 3.6 1.9 3.6H5"/>',

  // mira com a linha de leitura — o botão que sai do painel e abre a câmera.
  // Não pode ser a prancheta de `conferencias`: o mesmo desenho para "ver as
  // conferências" e "ir bipar agora" é o defeito que os glifos já tinham.
  bipagem: '<path d="M3.2 7.6V5.4a2.2 2.2 0 0 1 2.2-2.2h2.2"/><path d="M16.4 3.2h2.2a2.2 2.2 0 0 1 2.2 2.2v2.2"/><path d="M20.8 16.4v2.2a2.2 2.2 0 0 1-2.2 2.2h-2.2"/><path d="M7.6 20.8H5.4a2.2 2.2 0 0 1-2.2-2.2v-2.2"/><path d="M6.8 12h10.4"/>',

  // reticências — "Mais", só no celular
  mais: '<circle cx="5.4" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="1.7" fill="currentColor" stroke="none"/>',

  // a seta do grupo: aponta para a direita fechado, gira 90° aberto (CSS)
  seta: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>'
};

export interface OpcoesIcone {
  /** Lado do quadro, em px. */
  tamanho?: number;
  /**
   * Espessura do traço. Precisa engrossar quando o ícone encolhe: 1.5 é o peso
   * certo a 18px e some a 22px na barra do celular, onde a tela é mais clara e
   * o olhar é de relance.
   */
  traco?: number;
  /** Classe extra, para o CSS pegar o ícone sem depender da estrutura em volta. */
  classe?: string;
}

/**
 * O `<svg>` pronto para `innerHTML`.
 *
 * `aria-hidden` sempre: o ícone acompanha um rótulo escrito em toda parte do
 * app, e um leitor de tela anunciando "imagem" antes de "Divergências" só
 * atrapalha. Ícone sem rótulo ao lado não existe nesta navegação — e não deve
 * passar a existir.
 */
export function icone(id: string, op: OpcoesIcone = {}): string {
  const { tamanho = 18, traco = 1.5, classe = '' } = op;
  // Id desconhecido devolve um ponto em vez de nada: item novo entra no menu
  // com um marcador discreto e alinhado, em vez de um buraco que desalinha a
  // coluna inteira até alguém lembrar de desenhar o ícone.
  const desenho = TRACOS[id] ?? '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>';
  return `<svg class="ui-icone${classe ? ` ${classe}` : ''}" viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" fill="none" stroke="currentColor" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${desenho}</svg>`;
}

/** Existe desenho próprio para este id? Usado só por teste. */
export const temIcone = (id: string): boolean => id in TRACOS;
