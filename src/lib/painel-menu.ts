// painel-menu.ts — os itens de menu dos painéis.
//
// Gestor e diretor mostram a mesma lista: quem aprendeu a navegar num não
// reaprende no outro, e o caminho de volta existe dos dois lados. Enquanto forem
// páginas separadas, o item que mora na outra página vira link — é isso que
// `menuDoPainel` resolve, recebendo a página atual.

import type { ItemMenu } from './painel-shell.js';

interface ItemDePainel extends ItemMenu {
  /** Página que hospeda a seção. */
  pagina: string;
}

const ITENS: ItemDePainel[] = [
  { id: 'hoje', rotulo: 'Hoje', grupo: 'Operação', pagina: 'gestor.html' },
  { id: 'conferencias', rotulo: 'Conferências', grupo: 'Operação', pagina: 'gestor.html' },
  { id: 'ocorrencias', rotulo: 'Ocorrências', grupo: 'Operação', pagina: 'gestor.html' },
  { id: 'desempenho', rotulo: 'Desempenho', grupo: 'Análise', pagina: 'gestor.html' },
  { id: 'diretor', rotulo: 'Visão do diretor', grupo: 'Análise', pagina: 'diretor.html' },
  { id: 'pessoas', rotulo: 'Pessoas', grupo: 'Cadastros', pagina: 'gestor.html' },
  { id: 'transportadoras', rotulo: 'Transportadoras', grupo: 'Cadastros', pagina: 'gestor.html' },
  { id: 'rotas', rotulo: 'Códigos de rota', grupo: 'Cadastros', pagina: 'gestor.html' },
  { id: 'sincronizacao', rotulo: 'Sincronização', grupo: 'Sistema', pagina: 'gestor.html' }
];

export function menuDoPainel(pagina: string): ItemMenu[] {
  return ITENS.map(({ pagina: dele, ...item }) => (
    dele === pagina ? item : { ...item, href: `${dele}#${item.id}` }
  ));
}
