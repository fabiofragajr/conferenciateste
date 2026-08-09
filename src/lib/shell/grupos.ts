// grupos.ts — quais grupos do menu estão recolhidos, e onde isso fica guardado.
//
// Funções puras primeiro, `localStorage` só na beirada: é o mesmo corte de
// `router.ts`, e pela mesma razão — dá para provar a regra em Node, sem subir
// navegador. A regra que mais precisa de prova é a do badge somado: recolher um
// grupo NÃO pode apagar a contagem de divergências da tela.

/**
 * Guarda os grupos FECHADOS, e não os abertos.
 *
 * Parece indiferente e não é. Com a lista dos abertos, um grupo que nasça numa
 * versão futura não estaria nela — e apareceria recolhido para todo mundo que
 * já tem estado salvo, escondendo uma seção nova que ninguém pediu para
 * esconder. Guardando os fechados, o padrão de quem nunca mexeu é "aberto", que
 * é o padrão seguro: o menu mostra tudo até a pessoa decidir o contrário.
 */
export const CHAVE = 'logdis.painel.grupos-fechados';

/** Lê o que veio do armazenamento. Lixo, versão antiga ou `null` viram "nada fechado". */
export function lerFechados(bruto: string | null | undefined): Set<string> {
  if (!bruto) return new Set();
  try {
    const v: unknown = JSON.parse(bruto);
    if (!Array.isArray(v)) return new Set();
    return new Set(v.filter((x): x is string => typeof x === 'string'));
  } catch {
    // Preferência de menu corrompida não é motivo para o painel não abrir.
    return new Set();
  }
}

export const serializar = (fechados: Set<string>): string => JSON.stringify([...fechados]);

export const estaAberto = (fechados: Set<string>, grupo: string): boolean => !fechados.has(grupo);

/** Novo conjunto, sem mutar o de entrada — quem chama compara antes e depois. */
export function alternar(fechados: Set<string>, grupo: string): Set<string> {
  const novo = new Set(fechados);
  if (novo.has(grupo)) novo.delete(grupo);
  else novo.add(grupo);
  return novo;
}

/**
 * Abre o grupo dono da seção que está sendo mostrada.
 *
 * Sem isto, chegar em `/painel/rotas` por URL colada com "Cadastros" recolhido
 * deixaria a página atual invisível no menu — a pessoa está numa tela que o
 * menu jura não existir. Vale para link de e-mail, para F5 e para o `popstate`.
 */
export function abrirGrupoDaSecao(fechados: Set<string>, grupoDaSecao: string | undefined): Set<string> {
  if (!grupoDaSecao || !fechados.has(grupoDaSecao)) return fechados;
  const novo = new Set(fechados);
  novo.delete(grupoDaSecao);
  return novo;
}

// A classe vem de `new RegExp` com escape em texto, e não de uma literal
// `/[…]/`: acento combinante escrito direto no código-fonte é invisível no
// editor e não sobrevive ao primeiro salvamento que normalize o arquivo.
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * `id` de DOM estável para um nome de grupo ("Operação" → "operacao").
 *
 * Precisa existir porque `aria-controls` liga o botão do cabeçalho à lista que
 * ele abre, e `aria-controls` é por id. Acentos e espaços fora; e o prefixo
 * separa a árvore da lateral da árvore da folha, que coexistem no mesmo
 * documento — id repetido faria o botão de uma abrir a lista da outra.
 */
export function idDoGrupo(prefixo: string, grupo: string): string {
  const limpo = grupo
    .normalize('NFD').replace(DIACRITICOS, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${prefixo}-grupo-${limpo || 'x'}`;
}

/** Lê a preferência do aparelho. Navegador sem `localStorage` (aba privada antiga) não quebra o painel. */
export function carregar(): Set<string> {
  try {
    return lerFechados(localStorage.getItem(CHAVE));
  } catch {
    return new Set();
  }
}

export function salvar(fechados: Set<string>): void {
  try {
    localStorage.setItem(CHAVE, serializar(fechados));
  } catch {
    // Cota estourada ou armazenamento bloqueado: a preferência não sobrevive ao
    // F5, e é só isso. Nada aqui justifica interromper o gestor.
  }
}
