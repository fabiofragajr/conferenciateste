// Cadastro dos testes de ponta a ponta.
//
// O app não inventa mais cadastro nenhum: pessoas, transportadoras e códigos de
// rota vêm da base e descem para o aparelho. Aqui o teste faz o papel da base —
// grava no IndexedDB exatamente o que a descida gravaria — e desliga o Supabase
// neste contexto. Os testes operacionais restauram uma sessão já autenticada;
// o fluxo real de senha pertence exclusivamente ao Supabase Auth.
//
// Desligar não é para "mockar" nada: o código de sincronização é o mesmo, e a
// descida de verdade continua coberta por `tests/base-real.test.mjs`, que fala
// com o projeto de produção. É para uma rodada de teste não virar sessão de
// mentira no painel do gestor, nem fixar a senha do Sandro no repositório.

/** Valor ignorado pelo helper; mantido para compatibilidade das chamadas E2E. */
export const SENHA = 'teste-e2e';

const id = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

export const TENANT = id(9);
export const T_LOGDIS = id(10);
export const T_SUL = id(11);

const sincronizavel = { sync: 'ENVIADO', syncTentativas: 0, syncErro: null, atualizadoEm: '2026-01-01T00:00:00.000Z' };

const pessoa = (n, nome, login, gestor, funcao) => ({
  ...sincronizavel,
  id: id(n),
  authUserId: id(n + 30),
  tenantId: TENANT,
  nome,
  login,
  gestor,
  funcao,
  telefone: '',
  placa: '',
  ativo: true
});

const transportadora = (idT, nome) => ({
  ...sincronizavel, id: idT, tenantId: TENANT, nome, cnpj: '', responsavel: '', telefone: '', email: '', ativo: true
});

const rota = (n, codigo, nome, transportadoraId) => ({
  ...sincronizavel, id: id(n), tenantId: TENANT, codigo, nome, transportadoraId, descricao: '', ativo: true
});

/**
 * Duas transportadoras de propósito: é o que dá sentido à divergência. FNOR é
 * da carga que o operador escolhe, FSUL é de outra dona — a caixa de FSUL não
 * pode embarcar, e a tela precisa dizer de quem ela é.
 */
export const CADASTRO = {
  usuarios: [
    pessoa(1, 'Sandro', 'sandro', true, 'Gestor de transporte'),
    pessoa(2, 'Ana Paula', 'ana', false, 'Conferente')
  ],
  transportadoras: [
    transportadora(T_LOGDIS, 'LOGDIS'),
    transportadora(T_SUL, 'Transportadora Sul')
  ],
  rotas: [
    rota(20, 'FNOR', 'Carga Norte', T_LOGDIS),
    rota(21, 'FSUL', 'Carga Sul', T_SUL)
  ]
};

/**
 * Corta o caminho até a produção neste contexto.
 *
 * Não dá para usar `setOffline`: ele derrubaria também o servidor local que
 * serve o app. O que precisa cair é só o projeto do `.env` — e o corte fica de
 * pé o teste inteiro, como garantia de que nenhuma rodada escreve lá.
 */
export async function isolarDaProducao(contexto) {
  await contexto.route('**://*.supabase.co/**', (rota) => rota.abort());
}

/**
 * Abre a página, entrega o cadastro ao aparelho e recarrega.
 *
 * Duas ordens importam aqui:
 *
 * 1. Quem cria o IndexedDB é o app, com a versão e os índices certos. Escrever
 *    antes de a página abrir criaria um banco vazio na versão errada, e o
 *    upgrade do app pularia a criação das stores.
 * 2. A produção é cortada ANTES do primeiro boot. Sem isso ele desceria o
 *    cadastro de lá antes de o teste gravar o dele — e `FNOR` chegaria duas
 *    vezes, com ids diferentes, contra um índice único.
 */
export async function prepararAparelho(pagina, base, rota = '/entrar') {
  const contexto = pagina.context();
  await isolarDaProducao(contexto);

  await pagina.goto(`${base}${rota}`);
  await pagina.waitForFunction(() => indexedDB.databases().then((l) => l.some((d) => d.name === 'logdis')));

  await pagina.evaluate(async (cadastro) => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok, falhou) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falhou(req.error);
    });

    await new Promise((ok, falhou) => {
      const tx = bd.transaction(['usuarios', 'transportadoras', 'rotas', 'config'], 'readwrite');
      for (const [store, registros] of Object.entries(cadastro)) {
        for (const r of registros) tx.objectStore(store).put(r);
      }
      // Aparelho sem projeto: guarda tudo local, como no galpão sem sinal.
      tx.objectStore('config').put({
        chave: 'supabase.config',
        valor: { url: '', anonKey: '', bucket: 'ocorrencias' }
      });
      tx.oncomplete = ok;
      tx.onerror = () => falhou(tx.error);
    });

    bd.close();
  }, CADASTRO);

  // Daqui em diante o aparelho está sem projeto configurado: ele nem tenta a
  // rede, e o corte acima passa a ser só uma rede de segurança.
  await pagina.reload();
}

/** Restaura uma sessão previamente autenticada para testes de operação. */
export async function entrar(pagina, login, _senha = SENHA) {
  const usuarioId = await pagina.evaluate(async (loginDesejado) => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok, falhou) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falhou(req.error);
    });
    const q = bd.transaction('usuarios').objectStore('usuarios').index('login').get(loginDesejado);
    const usuario = await new Promise((ok, falhou) => {
      q.onsuccess = () => ok(q.result);
      q.onerror = () => falhou(q.error);
    });
    bd.close();
    return usuario?.id ?? null;
  }, login);
  if (!usuarioId) throw new Error(`Usuário de teste não encontrado: ${login}`);
  await pagina.evaluate((idUsuario) => localStorage.setItem('logdis.usuarioLogado', idUsuario), usuarioId);
  await pagina.reload();
}

/**
 * Abre a folha "Mais ações" e encerra a conferência.
 *
 * Encerrar saiu da barra fixa da bipagem: era um botão vermelho permanente ao
 * lado dos de uso diário, sendo a única ação irreversível da tela. Agora são
 * dois toques de propósito, e o caminho mora aqui para não se repetir em
 * quatro testes.
 */
export async function encerrarConferencia(pagina) {
  await pagina.click('#btn-mais-bip');
  await pagina.waitForSelector('#modal-mais:not([hidden])', { timeout: 4000 });
  await pagina.click('#mais-encerrar');
}
