import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { BancoDeDados } from "@/db";
import { type EtapaLead, type OrigemLead, type StatusProposta, empresas, interacoes, leads, propostas, usuarios } from "@/db/schema";
import { ETAPAS_ABERTAS, type Prospecto } from "@/lib/comercial";
import { type Data, intervaloDoMes, type Mes } from "@/lib/datas";

/** Consultas do Comercial da Urutau. Quem chama já passou por exigirSuperadmin (ou é a rota do site). */

const vivo = isNull(leads.excluidoEm);

export async function listarLeads(
  db: BancoDeDados,
  f: { etapa?: EtapaLead | "abertos"; origem?: OrigemLead; responsavelId?: string; busca?: string; lote?: string; limite?: number } = {},
) {
  const resp = alias(usuarios, "resp");
  const termo = f.busca?.trim();
  return db
    .select({
      id: leads.id,
      nome: leads.nome,
      contato: leads.contato,
      telefone: leads.telefone,
      email: leads.email,
      categoria: leads.categoria,
      cidade: leads.cidade,
      origem: leads.origem,
      etapa: leads.etapa,
      interesses: leads.interesses,
      valorEstimado: leads.valorEstimadoCentavos,
      proximoContato: leads.proximoContato,
      responsavelId: leads.responsavelId,
      responsavel: resp.nome,
      lote: leads.lote,
      nota: leads.nota,
      criadoEm: leads.criadoEm,
      ultimoContato: sql<Date | null>`(select max(i.criado_em) from interacoes i where i.lead_id = "leads"."id" and i.tipo <> 'nota')`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(leads)
    .leftJoin(resp, eq(resp.id, leads.responsavelId))
    .where(
      and(
        vivo,
        f.etapa === "abertos" ? inArray(leads.etapa, ETAPAS_ABERTAS) : f.etapa ? eq(leads.etapa, f.etapa) : undefined,
        f.origem ? eq(leads.origem, f.origem) : undefined,
        f.responsavelId ? eq(leads.responsavelId, f.responsavelId) : undefined,
        f.lote ? eq(leads.lote, f.lote) : undefined,
        termo
          ? or(ilike(leads.nome, `%${termo}%`), ilike(leads.contato, `%${termo}%`), ilike(leads.categoria, `%${termo}%`), ilike(leads.cidade, `%${termo}%`), ilike(leads.telefone, `%${termo.replace(/\D/g, "") || termo}%`))
          : undefined,
      ),
    )
    .orderBy(desc(leads.criadoEm))
    .limit(f.limite ?? 300);
}

export type LeadDaLista = Awaited<ReturnType<typeof listarLeads>>[number];

export async function obterLead(db: BancoDeDados, id: string) {
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), vivo)).limit(1);
  if (!lead) return null;
  const autor = alias(usuarios, "autor");
  const [historico, lista] = await Promise.all([
    db
      .select({ id: interacoes.id, tipo: interacoes.tipo, texto: interacoes.texto, etapaDe: interacoes.etapaDe, etapaPara: interacoes.etapaPara, criadoEm: interacoes.criadoEm, autorId: interacoes.autorId, autor: autor.nome })
      .from(interacoes)
      .leftJoin(autor, eq(autor.id, interacoes.autorId))
      .where(eq(interacoes.leadId, id))
      .orderBy(desc(interacoes.criadoEm))
      .limit(100),
    db.select().from(propostas).where(eq(propostas.leadId, id)).orderBy(desc(propostas.criadoEm)),
  ]);
  return { lead, historico, propostas: lista };
}

export async function contagemPorEtapa(db: BancoDeDados) {
  const linhas = await db
    .select({ etapa: leads.etapa, n: sql<number>`count(*)::int`, valor: sql<number>`coalesce(sum(${leads.valorEstimadoCentavos}), 0)::bigint`.mapWith(Number) })
    .from(leads)
    .where(vivo)
    .groupBy(leads.etapa);
  const n = Object.fromEntries(linhas.map((l) => [l.etapa, l.n])) as Partial<Record<EtapaLead, number>>;
  const valor = Object.fromEntries(linhas.map((l) => [l.etapa, l.valor])) as Partial<Record<EtapaLead, number>>;
  return { n, valor };
}

/** Os números do mês do Comercial. */
export async function resumoComercial(db: BancoDeDados, mes: Mes) {
  const { inicio, fim } = intervaloDoMes(mes);
  const de = new Date(`${inicio}T00:00:00-03:00`);
  const ate = new Date(`${fim}T23:59:59.999-03:00`);
  const [[novos], porOrigem, [abertas], [aceitas], [ganhos]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(vivo, gte(leads.criadoEm, de), lte(leads.criadoEm, ate))),
    db
      .select({ origem: leads.origem, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(vivo, gte(leads.criadoEm, de), lte(leads.criadoEm, ate)))
      .groupBy(leads.origem),
    db
      .select({ n: sql<number>`count(*)::int`, mensal: sql<number>`coalesce(sum(${propostas.valorMensalCentavos}), 0)::bigint`.mapWith(Number), unico: sql<number>`coalesce(sum(${propostas.valorUnicoCentavos}), 0)::bigint`.mapWith(Number) })
      .from(propostas)
      .where(eq(propostas.status, "enviada")),
    db
      .select({ n: sql<number>`count(*)::int`, mensal: sql<number>`coalesce(sum(${propostas.valorMensalCentavos}), 0)::bigint`.mapWith(Number), unico: sql<number>`coalesce(sum(${propostas.valorUnicoCentavos}), 0)::bigint`.mapWith(Number) })
      .from(propostas)
      .where(and(eq(propostas.status, "aceita"), gte(propostas.respondidaEm, de), lte(propostas.respondidaEm, ate))),
    db
      .select({ n: sql<number>`count(distinct ${interacoes.leadId})::int` })
      .from(interacoes)
      .where(and(eq(interacoes.etapaPara, "ganho"), gte(interacoes.criadoEm, de), lte(interacoes.criadoEm, ate))),
  ]);
  return {
    novos: novos.n,
    porOrigem: porOrigem.sort((a, b) => b.n - a.n),
    propostasAbertas: abertas,
    aceitasNoMes: aceitas,
    ganhosNoMes: ganhos.n,
  };
}

/** Leads abertos com retorno marcado até `ate` (os vencidos primeiro). */
export async function proximosContatos(db: BancoDeDados, ate: Data, limite = 8) {
  const resp = alias(usuarios, "resp");
  return db
    .select({ id: leads.id, nome: leads.nome, etapa: leads.etapa, telefone: leads.telefone, proximoContato: leads.proximoContato, responsavelId: leads.responsavelId, responsavel: resp.nome })
    .from(leads)
    .leftJoin(resp, eq(resp.id, leads.responsavelId))
    .where(and(vivo, inArray(leads.etapa, ETAPAS_ABERTAS), isNotNull(leads.proximoContato), lte(leads.proximoContato, ate)))
    .orderBy(asc(leads.proximoContato))
    .limit(limite);
}

export async function leadsNoMapa(db: BancoDeDados, lote?: string) {
  return db
    .select({ id: leads.id, nome: leads.nome, etapa: leads.etapa, categoria: leads.categoria, telefone: leads.telefone, nota: leads.nota, latitude: leads.latitude, longitude: leads.longitude })
    .from(leads)
    .where(and(vivo, isNotNull(leads.latitude), isNotNull(leads.longitude), lote ? eq(leads.lote, lote) : undefined))
    .limit(3000);
}

export type PontoNoMapa = Awaited<ReturnType<typeof leadsNoMapa>>[number];

/** Lotes de prospecção: quantos vieram e quantos já foram trabalhados. */
export async function lotesDeProspeccao(db: BancoDeDados) {
  return db
    .select({
      lote: leads.lote,
      total: sql<number>`count(*)::int`,
      trabalhados: sql<number>`count(*) filter (where ${leads.etapa} <> 'novo')::int`,
      ganhos: sql<number>`count(*) filter (where ${leads.etapa} = 'ganho')::int`,
      comMapa: sql<number>`count(${leads.latitude})::int`,
      criadoEm: sql<Date>`min(${leads.criadoEm})`.mapWith((v) => new Date(v)),
    })
    .from(leads)
    .where(and(vivo, isNotNull(leads.lote)))
    .groupBy(leads.lote)
    .orderBy(desc(sql`min(${leads.criadoEm})`));
}

export async function listarPropostas(db: BancoDeDados, status?: StatusProposta) {
  return db
    .select({
      id: propostas.id,
      titulo: propostas.titulo,
      servicos: propostas.servicos,
      mensal: propostas.valorMensalCentavos,
      unico: propostas.valorUnicoCentavos,
      status: propostas.status,
      validade: propostas.validade,
      enviadaEm: propostas.enviadaEm,
      respondidaEm: propostas.respondidaEm,
      criadoEm: propostas.criadoEm,
      leadId: propostas.leadId,
      lead: leads.nome,
      empresaId: propostas.empresaId,
      empresa: empresas.nome,
    })
    .from(propostas)
    .leftJoin(leads, eq(leads.id, propostas.leadId))
    .leftJoin(empresas, eq(empresas.id, propostas.empresaId))
    .where(status ? eq(propostas.status, status) : undefined)
    .orderBy(desc(propostas.criadoEm))
    .limit(300);
}

/**
 * Grava os prospectos de um lote. O mesmo lugar (mesma chave) não entra duas vezes,
 * nem dentro do arquivo nem em relação a importações anteriores.
 */
export async function importarProspectos(db: BancoDeDados, lista: Prospecto[], c: { lote: string; responsavelId: string | null; criadoPor: string }) {
  if (!lista.length) return { novos: 0, repetidos: 0 };
  let novos = 0;
  for (let i = 0; i < lista.length; i += 200) {
    const parte = lista.slice(i, i + 200);
    const r = await db
      .insert(leads)
      .values(parte.map((p) => ({ ...p, origem: "prospeccao" as const, lote: c.lote, responsavelId: c.responsavelId, criadoPor: c.criadoPor })))
      .onConflictDoNothing({ target: leads.chave })
      .returning({ id: leads.id });
    novos += r.length;
  }
  return { novos, repetidos: lista.length - novos };
}

export interface DadosDoSite {
  tipo: "contato" | "diagnostico" | "whatsapp";
  nome: string | null;
  negocio: string | null;
  telefone: string | null;
  email: string | null;
  mensagem: string | null;
  dores: string[];
  tamanho: string | null;
  pagina: string | null;
}

/**
 * Quem deixou contato ou mandou o diagnóstico pelo site vira lead. Se já existe um lead aberto
 * com o mesmo telefone ou e-mail, a mensagem entra no histórico dele em vez de duplicar.
 */
export async function leadDoSite(db: BancoDeDados, d: DadosDoSite) {
  if (!d.nome && !d.telefone && !d.email) return null;
  const iguais = [d.telefone ? eq(leads.telefone, d.telefone) : undefined, d.email ? eq(leads.email, d.email) : undefined].filter(Boolean);
  const [existente] = iguais.length
    ? await db.select({ id: leads.id }).from(leads).where(and(vivo, inArray(leads.etapa, ETAPAS_ABERTAS), or(...iguais))).limit(1)
    : [];
  const resumo = [d.mensagem, d.dores.length ? `Marcou no diagnóstico: ${d.dores.join(" · ")}` : null, d.tamanho ? `Equipe: ${d.tamanho}` : null]
    .filter(Boolean)
    .join("\n");
  if (existente) {
    await db.insert(interacoes).values({ leadId: existente.id, tipo: "nota", texto: `Voltou pelo site${d.pagina ? ` (${d.pagina})` : ""}.\n${resumo}`.trim() });
    return { id: existente.id, novo: false };
  }
  const [l] = await db
    .insert(leads)
    .values({
      nome: d.negocio || d.nome || d.telefone || d.email || "Contato do site",
      contato: d.negocio ? d.nome : null,
      telefone: d.telefone,
      email: d.email,
      origem: d.tipo === "diagnostico" ? "diagnostico" : d.tipo === "whatsapp" ? "whatsapp" : "site",
      dores: d.dores,
      tamanho: d.tamanho,
      observacao: d.mensagem,
    })
    .returning({ id: leads.id });
  if (resumo) await db.insert(interacoes).values({ leadId: l.id, tipo: "nota", texto: resumo });
  return { id: l.id, novo: true };
}
