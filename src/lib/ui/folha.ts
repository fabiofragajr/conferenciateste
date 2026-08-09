// folha.ts — a folha que sobe de baixo (bottom sheet) e o aviso passageiro.
//
// No celular, o que no desktop é menu lateral ou diálogo vira folha: ela nasce
// perto do polegar e fecha arrastando ou tocando fora. Modal centralizado num
// aparelho grande obriga a mão a subir até o meio da tela.

export interface Folha {
  abrir: (conteudoHtml: string) => void;
  fechar: () => void;
  aberta: () => boolean;
  raiz: HTMLElement;
}

export function criarFolha(rotulo: string): Folha {
  const fundo = document.createElement('div');
  fundo.className = 'ui-folha-fundo';
  fundo.hidden = true;

  const folha = document.createElement('div');
  folha.className = 'ui-folha';
  folha.setAttribute('role', 'dialog');
  folha.setAttribute('aria-label', rotulo);
  folha.innerHTML = '<div class="ui-folha-alca"></div><div class="ui-folha-corpo"></div>';

  document.body.append(fundo, folha);

  const fechar = (): void => {
    folha.classList.remove('aberta');
    fundo.hidden = true;
  };

  fundo.addEventListener('click', fechar);
  // Escolher um item fecha: ninguém quer tocar duas vezes para chegar num lugar.
  folha.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('a, button')) fechar();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fechar(); });

  return {
    abrir: (html) => {
      const corpo = folha.querySelector('.ui-folha-corpo');
      if (corpo) corpo.innerHTML = html;
      folha.classList.add('aberta');
      fundo.hidden = false;
    },
    fechar,
    aberta: () => folha.classList.contains('aberta'),
    raiz: folha
  };
}

/** Aviso passageiro. Some sozinho: confirmação que exige toque interrompe. */
export function toast(texto: string, tom: 'ok' | 'erro' = 'ok'): void {
  const t = document.createElement('div');
  t.className = `ui-toast ui-toast-${tom}`;
  t.setAttribute('role', 'status');
  t.textContent = texto;
  document.body.append(t);
  window.setTimeout(() => t.remove(), 4000);
}
