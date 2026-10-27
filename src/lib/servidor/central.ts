import "server-only";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { BancoDeDados } from "@/db";
import { auditoria, empresas, eventosSite, metas, notasEquipe, usuarios } from "@/db/schema";
import { intervaloDoMes, type Mes } from "@/lib/datas";
import { ONLINE_MS } from "@/lib/central";

/**
 * Consultas da Central Urutau. Quem chama já passou por exigirSuperadmin.
 * A equipe é quem tem superadmin; a ordem de cadastro decide o tom de cada pessoa.
 */

export async function listarEquipe(db: BancoDeDados) {
  return db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      vistoEm: usuarios.vistoEm,
      ondeEsta: usuarios.ondeEsta,
      senhaProvisoria: usuarios.senhaProvisoria,
    })
    .from(usuarios)
    .where(eq(usuarios.superadmin, true))
    .orderBy(asc(usuarios.criadoEm), asc(usuarios.nome));
}

export type PessoaDaEquipe = Awaited<ReturnType<typeof listarEquipe>>[number];

export async function metasDoMes(db: BancoDeDados, mes: Mes, usuarioId?: string) {
  return db
    .select({ id: metas.id, usuarioId: metas.usuarioId, titulo: metas.titulo, tipo: metas.tipo, alvo: metas.alvo, atual: metas.atual, atualizadoEm: metas.atualizadoEm })
    .from(metas)
    .where(and(eq(metas.mes, intervaloDoMes(mes).inicio), usuarioId ? eq(metas.usuarioId, usuarioId) : undefined))
    .orderBy(asc(metas.criadoEm), asc(metas.titulo));
}

export type MetaDoMes = Awaited<ReturnType<typeof metasDoMes>>[number];

/**
 * Empresas atendidas com o movimento do mês. Colunas de fora das subconsultas vão com o nome da
 * tabela por extenso: dentro delas, "id" seria a coluna de dentro.
 */
export async function empresasDaCentral(db: BancoDeDados, mes: Mes, responsavelId?: string) {
  const { inicio, fim } = intervaloDoMes(mes);
  return db
    .select({
      id: empresas.id,
      nome: empresas.nome,
      perfil: empresas.perfil,
      cidade: empresas.cidade,
      responsavelId: empresas.responsavelId,
      vendasMes: sql<number>`(select coalesce(sum(v.valor_centavos), 0)::bigint from vendas v where v.empresa_id = "empresas"."id" and v.excluido_em is null and v.data between ${inicio} and ${fim})`.mapWith(Number),
      aConferir: sql<number>`(select count(*)::int from vendas v where v.empresa_id = "empresas"."id" and v.conferido_em is null and v.excluido_em is null)`,
      // Último sinal de alguém do cliente (a equipe Urutau não conta).
      ultimoAcesso: sql<Date | null>`(select max(u.visto_em) from empresa_usuarios eu join usuarios u on u.id = eu.usuario_id where eu.empresa_id = "empresas"."id" and not u.superadmin)`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(empresas)
    .where(responsavelId ? eq(empresas.responsavelId, responsavelId) : undefined)
    .orderBy(asc(empresas.nome));
}

export type EmpresaDaCentral = Awaited<ReturnType<typeof empresasDaCentral>>[number];

export async function notasRecentes(db: BancoDeDados, opcoes: { sobreUsuarioId?: string; limite?: number } = {}) {
  const autor = alias(usuarios, "autor");
  return db
    .select({
      id: notasEquipe.id,
      texto: notasEquipe.texto,
      fixada: notasEquipe.fixada,
      criadoEm: notasEquipe.criadoEm,
      autorId: notasEquipe.autorId,
      autor: autor.nome,
      sobreUsuarioId: notasEquipe.sobreUsuarioId,
      empresaId: notasEquipe.empresaId,
      empresa: empresas.nome,
    })
    .from(notasEquipe)
    .leftJoin(autor, eq(autor.id, notasEquipe.autorId))
    .leftJoin(empresas, eq(empresas.id, notasEquipe.empresaId))
    .where(and(isNull(notasEquipe.excluidoEm), opcoes.sobreUsuarioId ? eq(notasEquipe.sobreUsuarioId, opcoes.sobreUsuarioId) : undefined))
    .orderBy(desc(notasEquipe.fixada), desc(notasEquipe.criadoEm))
    .limit(opcoes.limite ?? 8);
}

export type NotaDaEquipe = Awaited<ReturnType<typeof notasRecentes>>[number];

export async function atividadeRecente(db: BancoDeDados, opcoes: { usuarioId?: string; limite?: number } = {}) {
  return db
    .select({
      id: auditoria.id,
      acao: auditoria.acao,
      dados: auditoria.dados,
      ator: auditoria.ator,
      criadoEm: auditoria.criadoEm,
      usuarioId: auditoria.usuarioId,
      quem: usuarios.nome,
      daEquipe: usuarios.superadmin,
      empresaId: auditoria.empresaId,
      empresa: empresas.nome,
    })
    .from(auditoria)
    .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
    .leftJoin(empresas, eq(empresas.id, auditoria.empresaId))
    .where(opcoes.usuarioId ? eq(auditoria.usuarioId, opcoes.usuarioId) : undefined)
    .orderBy(desc(auditoria.criadoEm))
    .limit(opcoes.limite ?? 12);
}

export type Acontecimento = Awaited<ReturnType<typeof atividadeRecente>>[number];

/** Clientes (não equipe) com uma aba aberta agora. */
export async function pessoasOnlineNasEmpresas(db: BancoDeDados, agora = new Date()) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(usuarios)
    .where(and(eq(usuarios.superadmin, false), gte(usuarios.vistoEm, new Date(agora.getTime() - ONLINE_MS))));
  return r.n;
}

/** Resumo do site urutau.io nos últimos `dias`: quantos de cada tipo e os últimos contatos. */
export async function resumoDoSite(db: BancoDeDados, dias = 7, agora = new Date()) {
  const desde = new Date(agora.getTime() - dias * 86_400_000);
  const [porTipo, contatos] = await Promise.all([
    db
      .select({ tipo: eventosSite.tipo, n: sql<number>`count(*)::int` })
      .from(eventosSite)
      .where(gte(eventosSite.criadoEm, desde))
      .groupBy(eventosSite.tipo),
    db
      .select({ id: eventosSite.id, tipo: eventosSite.tipo, nome: eventosSite.nome, contato: eventosSite.contato, mensagem: eventosSite.mensagem, pagina: eventosSite.pagina, criadoEm: eventosSite.criadoEm })
      .from(eventosSite)
      .where(sql`${eventosSite.tipo} <> 'visita'`)
      .orderBy(desc(eventosSite.criadoEm))
      .limit(4),
  ]);
  const conta = (t: string) => porTipo.find((p) => p.tipo === t)?.n ?? 0;
  return { visitas: conta("visita"), contatos: conta("contato"), whatsapp: conta("whatsapp"), ultimos: contatos, algumDia: porTipo.length > 0 || contatos.length > 0 };
}
