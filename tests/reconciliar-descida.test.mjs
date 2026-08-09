// A descida tira do aparelho o cadastro que o gestor excluiu.
//
// O caso que gerou este teste aconteceu de verdade: a base foi zerada e passou
// a ter só a DHM AWAY, e a tela do operador continuou oferecendo LOGDIS,
// Transportadora Sul, Beta e Carga Sul. A descida é incremental
// (`atualizado_em > desde`) e uma linha apagada não ganha carimbo novo — ela só
// deixa de vir, e o aparelho a guardava para sempre.
//
// Não é defeito de aparência. `sessoes.transportadora_id` tem chave estrangeira
// no servidor: uma conferência aberta sobre uma dessas fantasmas bate em
// violação no envio e fica presa no celular — a carga foi conferida e a base
// nunca fica sabendo.
//
// O servidor aqui é simulado, e é de propósito. A alternativa seria falar com o
// projeto do `.env`, que (a) escreveria um aparelho de teste na tabela
// `dispositivos` de produção e (b) quebraria no dia em que alguém cadastrasse
// outra transportadora. Aqui o cenário é fixo e a prova é do encanamento:
// baixou, varreu, apagou o que não existe mais.

import { chromium } from 'playwright';
import { subirServidor, opcoesNavegador } from './servidor.mjs';
import { prepararAparelho, T_LOGDIS } from './cadastro.mjs';

const servidor = await subirServidor();
const BASE = servidor.base;
const navegador = await chromium.launch(opcoesNavegador);
let falhou = false;

const passo = async (nome, fn) => {
  try { await fn(); console.log('ok  -', nome); }
  catch (e) { console.log('FALHA -', nome, '\n     ', e.message); falhou = true; }
};

/** O estado da base depois da limpeza: uma transportadora e seis rotas. */
const T_DHM = '00000000-0000-4000-8000-00000000d001';
const U_SANDRO = '00000000-0000-4000-8000-000000000001';
const CODIGOS = ['FCEN', 'FSUL', 'FNOR', 'FOES', 'FABC', 'FLES'];

const SERVIDOR = {
  transportadoras: [{
    id: T_DHM, nome: 'DHM AWAY', cnpj: null, responsavel: null, telefone: null,
    email: null, ativo: true, atualizado_em: '2026-08-09T12:00:00.000Z'
  }],
  rotas: CODIGOS.map((codigo, i) => ({
    id: `00000000-0000-4000-8000-9000000000${i}${i}`,
    codigo, nome: codigo, transportadora_id: T_DHM,
    descricao: null, ativo: true, atualizado_em: '2026-08-09T12:00:00.000Z'
  })),
  // O Sandro do cadastro de teste, com o MESMO id: é quem continua entrando.
  usuarios: [{
    id: U_SANDRO, nome: 'Sandro', login: 'sandro', senha_hash: null, gestor: true,
    funcao: 'Gestor de transporte', telefone: null, placa: null,
    ativo: true, atualizado_em: '2026-01-01T00:00:00.000Z'
  }]
};

/**
 * Faz o papel do PostgREST para as três tabelas de cadastro.
 *
 * Registrado DEPOIS de `prepararAparelho`, que corta a produção: no Playwright
 * a rota registrada por último é a que atende, então este stub vence o `abort`
 * sem desfazê-lo — o que não casar aqui continua sendo cortado.
 */
const simularServidor = async (contexto) => {
  await contexto.route('**://*.supabase.co/**', (rota) => {
    const url = new URL(rota.request().url());
    const tabela = url.pathname.split('/').pop();
    const cabecalhos = {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*'
    };

    if (rota.request().method() === 'OPTIONS') {
      return rota.fulfill({ status: 204, headers: cabecalhos, body: '' });
    }

    // Só leitura passa. Escrita é recusada de propósito: o registro criado
    // offline precisa continuar PENDENTE para o teste ter o que provar — se o
    // upsert fosse aceito ele viraria ENVIADO, e aí a varredura o removeria
    // com toda a razão, porque o servidor de fato não o teria.
    if (rota.request().method() !== 'GET') {
      return rota.fulfill({ status: 503, headers: cabecalhos, body: '{"message":"servidor de teste não aceita escrita"}' });
    }

    const linhas = SERVIDOR[tabela];
    // Tabela fora do cadastro (dispositivos, por exemplo): responde vazio em
    // vez de abortar, senão o erro de rede mascararia a falha que se quer ver.
    if (!linhas) return rota.fulfill({ status: 200, headers: cabecalhos, body: '[]' });

    // `select=id` é a consulta da varredura; `select=*` é a descida incremental.
    const soIds = url.searchParams.get('select') === 'id';
    const corpo = soIds ? linhas.map((l) => ({ id: l.id })) : linhas;
    return rota.fulfill({ status: 200, headers: cabecalhos, body: JSON.stringify(corpo) });
  });
};

const cadastroLocal = (pagina) => pagina.evaluate(async () => {
  const req = indexedDB.open('logdis');
  const bd = await new Promise((ok, falhou) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falhou(req.error);
  });
  const ler = (store) => new Promise((ok, falhou) => {
    const p = bd.transaction(store, 'readonly').objectStore(store).getAll();
    p.onsuccess = () => ok(p.result);
    p.onerror = () => falhou(p.error);
  });
  const r = {
    transportadoras: (await ler('transportadoras')).map((t) => t.nome).sort(),
    rotas: (await ler('rotas')).map((x) => x.codigo).sort(),
    usuarios: (await ler('usuarios')).map((u) => u.login).sort()
  };
  bd.close();
  return r;
});

/** Relê o cadastro até bater com o esperado. Espaçado de propósito: ver nota acima. */
const esperarCadastro = async (pagina, condicao, oQue) => {
  for (let i = 0; i < 40; i++) {
    const atual = await cadastroLocal(pagina);
    if (condicao(atual)) return atual;
    await pagina.waitForTimeout(300);
  }
  throw new Error(`${oQue} — último estado: ${JSON.stringify(await cadastroLocal(pagina))}`);
};

/** Liga o Supabase neste aparelho e espera a descida terminar. */
const ligarESincronizar = async (pagina) => {
  await pagina.evaluate(async () => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    await new Promise((ok) => {
      const tx = bd.transaction('config', 'readwrite');
      tx.objectStore('config').put({
        chave: 'supabase.config',
        valor: { url: 'https://fake.supabase.co', anonKey: 'chave-de-teste', bucket: 'ocorrencias' }
      });
      // A descida é incremental: sem zerar o marco, o servidor simulado
      // (carimbado em 2026-08-09) não voltaria para um aparelho que já
      // "desceu" depois disso, e o teste passaria sem baixar nada.
      tx.objectStore('config').put({ chave: 'sync.ultimaDescida', valor: '1970-01-01T00:00:00.000Z' });
      tx.oncomplete = ok;
    });
    bd.close();
  });
  await pagina.reload();
};

await passo('a transportadora excluída some do aparelho, e a nova fica', async () => {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, '/entrar');

  const antes = await cadastroLocal(p);
  if (!antes.transportadoras.includes('LOGDIS')) throw new Error('o aparelho não começou com o cadastro antigo');

  await simularServidor(ctx);
  await ligarESincronizar(p);

  // A descida acontece no boot, antes de a tela de login liberar.
  await esperarCadastro(p, (c) => c.transportadoras.join() === 'DHM AWAY', 'a varredura não rodou');

  const depois = await cadastroLocal(p);
  if (depois.transportadoras.join() !== 'DHM AWAY') {
    throw new Error(`sobrou cadastro velho: ${depois.transportadoras.join(', ')}`);
  }
  if (depois.rotas.join() !== [...CODIGOS].sort().join()) {
    throw new Error(`rotas erradas: ${depois.rotas.join(', ')}`);
  }
  if (depois.usuarios.join() !== 'sandro') {
    throw new Error(`sobrou acesso velho: ${depois.usuarios.join(', ')}`);
  }
  await ctx.close();
});

await passo('registro que ainda não subiu sobrevive à varredura', async () => {
  // O cadastro criado offline, no galpão sem sinal, não está no servidor porque
  // ainda não CHEGOU lá. Apagá-lo seria destruir o que a pessoa acabou de fazer.
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  await prepararAparelho(p, BASE, '/entrar');

  await p.evaluate(async (idLogdis) => {
    const req = indexedDB.open('logdis');
    const bd = await new Promise((ok) => { req.onsuccess = () => ok(req.result); });
    await new Promise((ok) => {
      const tx = bd.transaction('transportadoras', 'readwrite');
      tx.objectStore('transportadoras').put({
        id: idLogdis.replace('10', '99'),
        nome: 'Criada Offline', cnpj: '', responsavel: '', telefone: '', email: '',
        ativo: true, sync: 'PENDENTE', syncTentativas: 0, syncErro: null,
        atualizadoEm: new Date().toISOString()
      });
      tx.oncomplete = ok;
    });
    bd.close();
  }, T_LOGDIS);

  await simularServidor(ctx);
  await ligarESincronizar(p);
  await esperarCadastro(p, (c) => !c.transportadoras.includes('LOGDIS'), 'a varredura não removeu a excluída');

  const depois = await cadastroLocal(p);
  if (!depois.transportadoras.includes('Criada Offline')) {
    throw new Error('a varredura apagou cadastro que ainda não tinha subido');
  }
  if (depois.transportadoras.includes('LOGDIS')) throw new Error('a varredura não removeu a excluída');
  await ctx.close();
});

await navegador.close();
servidor.parar();
if (falhou) { process.exitCode = 1; console.log('\nFALHAS ACIMA'); }
else console.log('\nRECONCILIAR_OK');
