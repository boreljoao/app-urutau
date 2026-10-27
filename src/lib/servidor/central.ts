import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { BancoDeDados } from "@/db";
import { afazeres, auditoria, clientes, empresaUsuarios, empresas, eventosSite, fontesReceita, metas, notasEquipe, usuarios, vendas } from "@/db/schema";
import { type Data, diasNoMes, intervaloDoMes, type Mes, somarMeses } from "@/lib/datas";
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
export async function empresasDaCentral(db: BancoDeDados, mes: Mes, responsavelId?: string, hojeData?: Data) {
  const { inicio, fim } = intervaloDoMes(mes);
  // Mesmo período do mês anterior: do dia 1 até o dia de hoje (ou o mês inteiro, se o mês já fechou).
  const anterior = somarMeses(mes, -1);
  const dia = hojeData && hojeData.startsWith(mes) ? Number(hojeData.slice(8, 10)) : diasNoMes(mes);
  const inicioAnt = intervaloDoMes(anterior).inicio;
  const fimAnt = `${anterior}-${String(Math.min(dia, diasNoMes(anterior))).padStart(2, "0")}`;
  return db
    .select({
      id: empresas.id,
      nome: empresas.nome,
      perfil: empresas.perfil,
      cidade: empresas.cidade,
      uf: empresas.uf,
      criadoEm: empresas.criadoEm,
      responsavelId: empresas.responsavelId,
      vendasMesAnterior: sql<number>`(select coalesce(sum(v.valor_centavos), 0)::bigint from vendas v where v.empresa_id = "empresas"."id" and v.excluido_em is null and v.data between ${inicioAnt} and ${fimAnt})`.mapWith(Number),
      conferirDesde: sql<Date | null>`(select min(v.criado_em) from vendas v where v.empresa_id = "empresas"."id" and v.conferido_em is null and v.excluido_em is null)`.mapWith((v) => (v ? new Date(v) : null)),
      vendasMes: sql<number>`(select coalesce(sum(v.valor_centavos), 0)::bigint from vendas v where v.empresa_id = "empresas"."id" and v.excluido_em is null and v.data >= ${inicio} and v.data < ${fim})`.mapWith(Number),
      aConferir: sql<number>`(select count(*)::int from vendas v where v.empresa_id = "empresas"."id" and v.conferido_em is null and v.excluido_em is null)`,
      // Último sinal de alguém do cliente (a equipe Urutau não conta).
      ultimoAcesso: sql<Date | null>`(select max(u.visto_em) from empresa_usuarios eu join usuarios u on u.id = eu.usuario_id where eu.empresa_id = "empresas"."id" and not u.superadmin)`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(empresas)
    .where(responsavelId ? eq(empresas.responsavelId, responsavelId) : undefined)
    .orderBy(asc(empresas.nome));
}

export type EmpresaDaCentral = Awaited<ReturnType<typeof empresasDaCentral>>[number];

export async function notasRecentes(db: BancoDeDados, opcoes: { sobreUsuarioId?: string; empresaId?: string; limite?: number } = {}) {
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
    .where(
      and(
        isNull(notasEquipe.excluidoEm),
        opcoes.sobreUsuarioId ? eq(notasEquipe.sobreUsuarioId, opcoes.sobreUsuarioId) : undefined,
        opcoes.empresaId ? eq(notasEquipe.empresaId, opcoes.empresaId) : undefined,
      ),
    )
    .orderBy(desc(notasEquipe.fixada), desc(notasEquipe.criadoEm))
    .limit(opcoes.limite ?? 8);
}

export type NotaDaEquipe = Awaited<ReturnType<typeof notasRecentes>>[number];

export async function atividadeRecente(db: BancoDeDados, opcoes: { usuarioId?: string; empresaId?: string; limite?: number } = {}) {
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
    .where(and(opcoes.usuarioId ? eq(auditoria.usuarioId, opcoes.usuarioId) : undefined, opcoes.empresaId ? eq(auditoria.empresaId, opcoes.empresaId) : undefined))
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

/**
 * Vendas de todos os clientes por dia do mês, ao lado do mesmo dia do mês anterior.
 * Dias que ainda não chegaram ficam com `atual` null (o gráfico não desenha zero no futuro).
 */
export async function movimentoDiario(db: BancoDeDados, mes: Mes, hojeData: Data) {
  const anterior = somarMeses(mes, -1);
  const de = intervaloDoMes(anterior).inicio;
  const ate = intervaloDoMes(mes).fim;
  const linhas = await db
    .select({ data: vendas.data, total: sql<number>`coalesce(sum(${vendas.valorCentavos}), 0)::bigint`.mapWith(Number) })
    .from(vendas)
    .where(and(isNull(vendas.excluidoEm), sql`${vendas.data} between ${de} and ${ate}`))
    .groupBy(vendas.data);
  const porData = new Map(linhas.map((l) => [l.data, l.total]));
  const ultimoDia = hojeData.startsWith(mes) ? Number(hojeData.slice(8, 10)) : diasNoMes(mes);
  return Array.from({ length: diasNoMes(mes) }, (_, i) => {
    const dia = i + 1;
    const dd = String(dia).padStart(2, "0");
    return {
      dia,
      atual: dia <= ultimoDia ? (porData.get(`${mes}-${dd}`) ?? 0) : null,
      anterior: dia <= diasNoMes(anterior) ? (porData.get(`${anterior}-${dd}`) ?? 0) : null,
    };
  });
}

export type DiaDoMovimento = Awaited<ReturnType<typeof movimentoDiario>>[number];

export async function listarAfazeres(db: BancoDeDados, opcoes: { responsavelId?: string; empresaId?: string; feitos?: boolean; limite?: number } = {}) {
  const resp = alias(usuarios, "resp");
  return db
    .select({
      id: afazeres.id,
      titulo: afazeres.titulo,
      prazo: afazeres.prazo,
      feitoEm: afazeres.feitoEm,
      responsavelId: afazeres.responsavelId,
      responsavel: resp.nome,
      empresaId: afazeres.empresaId,
      empresa: empresas.nome,
      criadoEm: afazeres.criadoEm,
    })
    .from(afazeres)
    .leftJoin(resp, eq(resp.id, afazeres.responsavelId))
    .leftJoin(empresas, eq(empresas.id, afazeres.empresaId))
    .where(
      and(
        opcoes.feitos ? isNotNull(afazeres.feitoEm) : isNull(afazeres.feitoEm),
        opcoes.responsavelId ? eq(afazeres.responsavelId, opcoes.responsavelId) : undefined,
        opcoes.empresaId ? eq(afazeres.empresaId, opcoes.empresaId) : undefined,
      ),
    )
    .orderBy(opcoes.feitos ? desc(afazeres.feitoEm) : sql`${afazeres.prazo} asc nulls last`, asc(afazeres.criadoEm))
    .limit(opcoes.limite ?? 50);
}

export type Afazer = Awaited<ReturnType<typeof listarAfazeres>>[number];

/** Quantas tarefas a equipe fechou nos últimos `dias`. */
export async function afazeresFeitosDesde(db: BancoDeDados, dias: number, agora = new Date()) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(afazeres)
    .where(gte(afazeres.feitoEm, new Date(agora.getTime() - dias * 86_400_000)));
  return r.n;
}

/** Contatos e cliques no WhatsApp do site nas últimas `horas` (para a fila de atenção). */
export async function contatosRecentesDoSite(db: BancoDeDados, horas = 48, agora = new Date()) {
  return db
    .select({ id: eventosSite.id, tipo: eventosSite.tipo, nome: eventosSite.nome, contato: eventosSite.contato, criadoEm: eventosSite.criadoEm })
    .from(eventosSite)
    .where(and(sql`${eventosSite.tipo} <> 'visita'`, gte(eventosSite.criadoEm, new Date(agora.getTime() - horas * 3_600_000))))
    .orderBy(desc(eventosSite.criadoEm))
    .limit(10);
}

/** O que a página do cliente na Central mostra além do painel financeiro. */
export async function detalhesDoCliente(db: BancoDeDados, empresaId: string) {
  const [membros, ultimasVendas, [base]] = await Promise.all([
    db
      .select({ usuarioId: usuarios.id, nome: usuarios.nome, email: usuarios.email, papel: empresaUsuarios.papel, vistoEm: usuarios.vistoEm, ondeEsta: usuarios.ondeEsta })
      .from(empresaUsuarios)
      .innerJoin(usuarios, eq(usuarios.id, empresaUsuarios.usuarioId))
      .where(eq(empresaUsuarios.empresaId, empresaId))
      .orderBy(asc(empresaUsuarios.papel), asc(usuarios.nome)),
    db
      .select({ id: vendas.id, data: vendas.data, valor: vendas.valorCentavos, descricao: vendas.descricao, fonte: fontesReceita.nome, origem: vendas.origem, conferidoEm: vendas.conferidoEm })
      .from(vendas)
      .innerJoin(fontesReceita, and(eq(fontesReceita.id, vendas.fonteReceitaId), eq(fontesReceita.empresaId, vendas.empresaId)))
      .where(and(eq(vendas.empresaId, empresaId), isNull(vendas.excluidoEm)))
      .orderBy(desc(vendas.data), desc(vendas.criadoEm))
      .limit(6),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(clientes)
      .where(and(eq(clientes.empresaId, empresaId), isNull(clientes.excluidoEm))),
  ]);
  return { membros, ultimasVendas, clientesCadastrados: base.n };
}
