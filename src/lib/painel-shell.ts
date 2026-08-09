// painel-shell.ts — a moldura dos painéis: barra do topo, menu lateral (gaveta
// no celular), navegação por hash, badge e faixa de alerta.
//
// Não conhece regra de negócio e não toca no IndexedDB. Recebe os itens do
// menu, diz qual seção está visível e avisa quem precisa repintar.
//
// A regra que justifica o badge e a faixa: com menu, a divergência do dia
// passaria a viver atrás de um item — e divergência escondida é exatamente o
// que este sistema existe para evitar. A faixa se cala na seção que já mostra o
// alarme inteiro (ver `redundanteEm`); o badge, nunca — ele é a contagem, e
// contagem não é aviso repetido.

import { $, $$, esc } from './util.js';
import { caminhoDe, type Secao } from './router.js';

export interface ItemMenu {
  /** Vira o hash da URL e o `data-secao` da seção correspondente. */
  id: string;
  rotulo: string;
  grupo: string;
  /** Preenchido só quando o item leva a outra página (o painel do diretor). */
  href?: string;
}

export interface OpcoesShell {
  titulo: string;
  usuario: string;
  /** Seção mostrada quando a URL não traz hash. */
  inicial: string;
}

export interface OpcoesAlerta {
  /**
   * Seção onde a faixa é redundante: ela se cala enquanto essa seção estiver
   * visível. A faixa existe para quem está LONGE do alarme — dentro da seção
   * que já mostra o problema inteiro, o aviso repetido só ensina a ignorá-lo.
   */
  redundanteEm?: string;
}

export interface Shell {
  aoTrocarSecao(fn: (id: string) => void): void;
  irPara(id: string): void;
  secaoAtual(): string;
  definirBadge(id: string, n: number): void;
  definirAlerta(html: string | null, op?: OpcoesAlerta): void;
}

export function montarShell(itens: ItemMenu[], op: OpcoesShell): Shell {
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  const ouvintes: ((id: string) => void)[] = [];

  const lista = grupos.map((g) => `
    <div class="p-lateral-grupo">
      <h2>${esc(g)}</h2>
      ${itens.filter((i) => i.grupo === g).map((i) => `
        <a class="p-item" href="${i.href ? esc(i.href) : caminhoDe({ tela: 'painel', secao: esc(i.id) as Secao })}" data-item="${esc(i.id)}">
          <span>${esc(i.rotulo)}</span>
          <span class="p-badge" data-badge="${esc(i.id)}" hidden></span>
        </a>`).join('')}
    </div>`).join('');

  // A grade com lateral só vale onde o menu existe: o painel do diretor divide
  // esta folha de estilo e ainda usa o cabeçalho antigo, sem gaveta.
  document.body.classList.add('p-com-menu');

  document.body.insertAdjacentHTML('afterbegin', `
    <header class="p-topo">
      <button class="p-hamburguer" type="button" aria-expanded="false" aria-label="Abrir menu">
        <span></span><span></span><span></span>
      </button>
      <h1 class="marca-logdis">
        <img src="./logdis-simbolo.png" alt="" width="34" height="34" />
        <span class="marca-nome">LOGDIS <i>Connect</i></span>
      </h1>
      <span class="p-titulo-painel">${esc(op.titulo)}</span>
      <span class="p-titulo-secao"></span>
      <span class="p-espaco"></span>
      <span class="p-badge p-badge-topo" data-badge-topo hidden></span>
      <span id="chip-sync-painel" class="chip chip-sync">Fila</span>
    </header>

    <div class="p-fundo-gaveta" hidden></div>

    <nav class="p-lateral" aria-label="Seções do painel">
      ${lista}
      <div class="p-lateral-rodape">
        <span id="p-usuario" class="p-usuario">${esc(op.usuario)}</span>
        <a class="btn btn-secundario" id="btn-bipar" href="/bipagem">Abrir bipagem</a>
        <button id="btn-sair" class="btn btn-fantasma" type="button">Sair</button>
      </div>
    </nav>`);

  const lateral = $('.p-lateral');
  const fundo = $('.p-fundo-gaveta');
  const hamburguer = $<HTMLButtonElement>('.p-hamburguer');
  const tituloSecao = $('.p-titulo-secao');
  const alerta = document.createElement('div');
  alerta.className = 'p-alerta-fixo';
  alerta.hidden = true;
  $('.p-corpo').prepend(alerta);

  const fecharGaveta = (): void => {
    lateral.classList.remove('aberta');
    fundo.hidden = true;
    hamburguer.setAttribute('aria-expanded', 'false');
  };

  hamburguer.addEventListener('click', () => {
    const abrindo = !lateral.classList.contains('aberta');
    lateral.classList.toggle('aberta', abrindo);
    fundo.hidden = !abrindo;
    hamburguer.setAttribute('aria-expanded', String(abrindo));
  });
  fundo.addEventListener('click', fecharGaveta);

  // Tocar em qualquer coisa que navegue fecha a gaveta. `mostrar()` já fazia
  // isso ao trocar de seção, mas o que SAI do painel — "Abrir bipagem",
  // "Sair", o painel do diretor — não passa por ele: a gaveta continuava
  // aberta por cima da tela seguinte, engolindo o toque, e na volta o painel
  // abria com o menu deslizando sozinho.
  lateral.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('a, button')) fecharGaveta();
  });
  // Voltar pelo botão do navegador sai do painel sem passar por clique nenhum.
  window.addEventListener('popstate', fecharGaveta);

  // Quem decide se a faixa aparece é a seção visível, não quem chama
  // `definirAlerta` — o painel repinta a cada 15s e trocaria de seção no meio.
  let visivel = op.inicial;
  let alertaHtml: string | null = null;
  let alertaRedundanteEm: string | undefined;

  const pintarAlerta = (): void => {
    alerta.innerHTML = alertaHtml ?? '';
    alerta.hidden = !alertaHtml || alertaRedundanteEm === visivel;
  };

  const mostrar = (id: string): void => {
    visivel = id;
    pintarAlerta();
    for (const secao of $$<HTMLElement>('[data-secao]')) {
      secao.hidden = secao.dataset.secao !== id;
    }
    for (const item of $$<HTMLAnchorElement>('.p-item')) {
      item.classList.toggle('ativo', item.dataset.item === id);
      if (item.dataset.item === id) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    tituloSecao.textContent = itens.find((i) => i.id === id)?.rotulo ?? '';
    fecharGaveta();
    // O conteúdo troca inteiro: continuar na rolagem da seção anterior confunde.
    window.scrollTo(0, 0);
    for (const fn of ouvintes) fn(id);
  };

  // O shell não escreve mais na URL. Duas coisas donas do endereço — o roteador
  // no caminho e o shell no hash — se desfaziam mutuamente: o clique no menu
  // trocava o hash, o roteador relia o caminho e devolvia a seção para a
  // inicial. Agora o caminho manda, e o shell só desenha o que mandarem.
  mostrar(op.inicial);

  return {
    aoTrocarSecao: (fn) => { ouvintes.push(fn); },
    irPara: (id) => mostrar(id),
    secaoAtual: () => visivel,
    definirBadge: (id, n) => {
      const b = document.querySelector<HTMLElement>(`[data-badge="${id}"]`);
      if (!b) return;
      b.textContent = String(n);
      b.hidden = n <= 0;

      // O badge da barra repete o da seção inicial: com a gaveta fechada, ele é
      // a única coisa que denuncia problema sem a pessoa abrir o menu.
      if (id !== op.inicial) return;
      const topo = document.querySelector<HTMLElement>('[data-badge-topo]');
      if (!topo) return;
      topo.textContent = String(n);
      topo.hidden = n <= 0;
    },
    definirAlerta: (html, opAlerta) => {
      alertaHtml = html;
      alertaRedundanteEm = opAlerta?.redundanteEm;
      pintarAlerta();
    }
  };
}
