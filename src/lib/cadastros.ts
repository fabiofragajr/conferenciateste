// Cadastros estruturais são ONLINE e de mão única.
//
// A gravação acontece primeiro no Supabase, sob RLS. Só a resposta confirmada
// entra no IndexedDB como cache ENVIADO. Nunca nasce uma rota/transportadora
// PENDENTE no celular.

import type { Rota, Transportadora } from '../types.js';
import * as db from './db.js';
import { prefixoRota } from './model.js';
import { obterCliente, sessaoAutenticada } from './supabase.js';
import { uid } from './util.js';

export type ResultadoCadastro = { ok: true } | { ok: false; erro: string };

async function clienteAdministrativo() {
  if (!navigator.onLine) {
    throw new Error('Para criar ou alterar cadastros é necessário estar conectado à internet.');
  }
  const cliente = await obterCliente();
  if (!cliente) throw new Error('Configure o Supabase antes de alterar cadastros.');
  if (!(await sessaoAutenticada())) {
    throw new Error('Entre novamente com internet para alterar cadastros.');
  }
  return cliente;
}

const transpLocal = (l: Record<string, unknown>): Transportadora => ({
  id: String(l.id),
  tenantId: l.tenant_id ? String(l.tenant_id) : undefined,
  nome: String(l.nome),
  cnpj: String(l.cnpj ?? ''),
  responsavel: String(l.responsavel ?? ''),
  telefone: String(l.telefone ?? ''),
  email: String(l.email ?? ''),
  ativo: l.ativo !== false,
  sync: 'ENVIADO', syncTentativas: 0, syncErro: null,
  atualizadoEm: String(l.atualizado_em ?? new Date().toISOString())
});

const rotaLocal = (l: Record<string, unknown>): Rota => ({
  id: String(l.id),
  tenantId: l.tenant_id ? String(l.tenant_id) : undefined,
  codigo: String(l.codigo),
  nome: String(l.nome),
  transportadoraId: String(l.transportadora_id),
  descricao: String(l.descricao ?? ''),
  ativo: l.ativo !== false,
  sync: 'ENVIADO', syncTentativas: 0, syncErro: null,
  atualizadoEm: String(l.atualizado_em ?? new Date().toISOString())
});

function mensagemDoBanco(prefixo: string, erro: { code?: string; message: string }): string {
  if (erro.code === '23505' || /duplicate key|unique/i.test(erro.message)) {
    return `${prefixo} já existe neste tenant.`;
  }
  if (/row-level security|permission denied/i.test(erro.message)) {
    return 'Seu acesso não permite alterar cadastros deste tenant.';
  }
  return erro.message;
}

export async function criarTransportadora(dados: {
  nome: string; cnpj?: string; responsavel?: string; telefone?: string; email?: string;
}): Promise<Transportadora> {
  const cliente = await clienteAdministrativo();
  const nome = dados.nome.trim();
  if (!nome) throw new Error('Informe o nome da transportadora.');
  const { data, error } = await cliente.from('transportadoras').insert({
    id: uid(), nome, cnpj: dados.cnpj?.trim() || null,
    responsavel: dados.responsavel?.trim() || null,
    telefone: dados.telefone?.trim() || null, email: dados.email?.trim() || null,
    ativo: true
  }).select('*').single();
  if (error || !data) throw new Error(mensagemDoBanco('Esta transportadora', error ?? { message: 'Resposta vazia da base.' }));
  const local = transpLocal(data as Record<string, unknown>);
  await db.salvarDoServidor('transportadoras', [local]);
  return local;
}

export async function definirTransportadoraAtiva(t: Transportadora, ativo: boolean): Promise<void> {
  const cliente = await clienteAdministrativo();
  const { data, error } = await cliente.from('transportadoras')
    .update({ ativo, atualizado_em: new Date().toISOString() }).eq('id', t.id).select('*').single();
  if (error || !data) throw new Error(mensagemDoBanco('A transportadora', error ?? { message: 'Resposta vazia da base.' }));
  await db.salvarDoServidor('transportadoras', [transpLocal(data as Record<string, unknown>)]);
}

export async function criarRota(dados: {
  codigo: string; nome: string; transportadoraId: string; descricao?: string;
}): Promise<ResultadoCadastro> {
  try {
    const cliente = await clienteAdministrativo();
    const codigo = prefixoRota(dados.codigo);
    if (!codigo) return { ok: false, erro: 'O código precisa começar com letras (ex.: FNOR).' };
    if (!dados.transportadoraId) return { ok: false, erro: 'Escolha a transportadora dona do código.' };
    const { data, error } = await cliente.from('rotas').insert({
      id: uid(), codigo, nome: dados.nome.trim() || codigo,
      transportadora_id: dados.transportadoraId,
      descricao: dados.descricao?.trim() || null, ativo: true
    }).select('*').single();
    if (error || !data) return { ok: false, erro: mensagemDoBanco(`O código ${codigo}`, error ?? { message: 'Resposta vazia da base.' }) };
    await db.salvarDoServidor('rotas', [rotaLocal(data as Record<string, unknown>)]);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Não foi possível cadastrar a rota.' };
  }
}

export async function definirRotaAtiva(r: Rota, ativo: boolean): Promise<void> {
  const cliente = await clienteAdministrativo();
  const { data, error } = await cliente.from('rotas')
    .update({ ativo, atualizado_em: new Date().toISOString() }).eq('id', r.id).select('*').single();
  if (error || !data) throw new Error(mensagemDoBanco('A rota', error ?? { message: 'Resposta vazia da base.' }));
  await db.salvarDoServidor('rotas', [rotaLocal(data as Record<string, unknown>)]);
}

export async function excluirCadastroOnline(tipo: 'usuarios' | 'transportadoras' | 'rotas', id: string): Promise<void> {
  const cliente = await clienteAdministrativo();
  if (tipo === 'usuarios') {
    const { error } = await cliente.functions.invoke('admin-users', { body: { acao: 'excluir', id } });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await cliente.from(tipo).delete().eq('id', id).select('id').single();
    if (error) throw new Error(mensagemDoBanco('O cadastro', error));
  }
  await db.remover(tipo, id);
}

export function administracaoDisponivel(): boolean {
  return navigator.onLine;
}
