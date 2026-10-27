import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { eventosSite, leads, visitantes } from "@/db/schema";

/** Visitantes anônimos do urutau.io e o caminho de cada um no site. */

export interface DadosDaVisita {
  id: string;
  cidade: string | null;
  regiao: string | null;
  pais: string | null;
  aparelho: string | null;
  origem: string;
  meio: string | null;
  campanha: string | null;
}

/**
 * Cria ou atualiza o visitante. A origem e a campanha ficam as da primeira visita (quem trouxe
 * a pessoa); cidade, aparelho e a data da última visita acompanham a visita atual.
 */
export async function registrarVisitante(db: BancoDeDados, v: DadosDaVisita, novaVisita: boolean) {
  await db
    .insert(visitantes)
    .values({ ...v, visitas: novaVisita ? 1 : 0 })
    .onConflictDoUpdate({
      target: visitantes.id,
      set: {
        ultimaVisita: sql`now()`,
        visitas: novaVisita ? sql`${visitantes.visitas} + 1` : visitantes.visitas,
        cidade: sql`coalesce(excluded.cidade, ${visitantes.cidade})`,
        regiao: sql`coalesce(excluded.regiao, ${visitantes.regiao})`,
        pais: sql`coalesce(excluded.pais, ${visitantes.pais})`,
        aparelho: sql`coalesce(excluded.aparelho, ${visitantes.aparelho})`,
        // Primeiro toque: a origem só é trocada se a primeira visita veio "Direto" e esta tem etiqueta.
        origem: sql`case when ${visitantes.origem} = 'Direto' and excluded.origem <> 'Direto' then excluded.origem else ${visitantes.origem} end`,
        meio: sql`coalesce(${visitantes.meio}, excluded.meio)`,
        campanha: sql`coalesce(${visitantes.campanha}, excluded.campanha)`,
      },
    });
}

export async function ligarVisitanteAoLead(db: BancoDeDados, visitanteId: string, leadId: string) {
  await db.update(visitantes).set({ leadId }).where(eq(visitantes.id, visitanteId));
}

const desde = (dias: number, agora: Date) => new Date(agora.getTime() - dias * 86_400_000);

/** Visitantes recentes com o que fizeram: seções vistas, clique no WhatsApp, diagnóstico e lead. */
export async function visitantesRecentes(db: BancoDeDados, opcoes: { dias?: number; limite?: number; agora?: Date; soQuemAgiu?: boolean } = {}) {
  const agora = opcoes.agora ?? new Date();
  return db
    .select({
      id: visitantes.id,
      primeiraVisita: visitantes.primeiraVisita,
      ultimaVisita: visitantes.ultimaVisita,
      visitas: visitantes.visitas,
      cidade: visitantes.cidade,
      regiao: visitantes.regiao,
      aparelho: visitantes.aparelho,
      origem: visitantes.origem,
      campanha: visitantes.campanha,
      leadId: visitantes.leadId,
      lead: leads.nome,
      secoes: sql<string[]>`coalesce((select array_agg(distinct e.pagina) from eventos_site e where e.visitante_id = "visitantes"."id" and e.tipo = 'secao' and e.pagina is not null), '{}')`,
      cliquesWhatsapp: sql<number>`(select count(*)::int from eventos_site e where e.visitante_id = "visitantes"."id" and e.tipo = 'whatsapp')`,
      diagnosticos: sql<number>`(select count(*)::int from eventos_site e where e.visitante_id = "visitantes"."id" and e.tipo = 'diagnostico')`,
    })
    .from(visitantes)
    .leftJoin(leads, eq(leads.id, visitantes.leadId))
    .where(
      and(
        gte(visitantes.ultimaVisita, desde(opcoes.dias ?? 7, agora)),
        opcoes.soQuemAgiu
          ? sql`exists (select 1 from eventos_site e where e.visitante_id = "visitantes"."id" and e.tipo in ('whatsapp', 'diagnostico', 'contato'))`
          : undefined,
      ),
    )
    .orderBy(desc(visitantes.ultimaVisita))
    .limit(opcoes.limite ?? 100);
}

export type VisitanteRecente = Awaited<ReturnType<typeof visitantesRecentes>>[number];

/** Os números do site nos últimos `dias`: quantos vieram, de onde, de qual cidade, e quantos agiram. */
export async function resumoDeVisitantes(db: BancoDeDados, dias = 7, agora = new Date()) {
  const inicio = desde(dias, agora);
  const janela = gte(visitantes.ultimaVisita, inicio);
  const conta = sql<number>`count(*)::int`;
  const [[total], porOrigem, porCidade, porAparelho, [agiram], porSecao] = await Promise.all([
    db
      .select({ n: conta, novos: sql<number>`count(*) filter (where ${visitantes.primeiraVisita} >= ${inicio.toISOString()})::int`, voltaram: sql<number>`count(*) filter (where ${visitantes.visitas} > 1)::int`, viraramLead: sql<number>`count(${visitantes.leadId})::int` })
      .from(visitantes)
      .where(janela),
    db.select({ nome: sql<string>`coalesce(${visitantes.origem}, 'Direto')`, n: conta }).from(visitantes).where(janela).groupBy(sql`1`).orderBy(desc(conta)).limit(8),
    db.select({ nome: visitantes.cidade, n: conta }).from(visitantes).where(and(janela, isNotNull(visitantes.cidade))).groupBy(visitantes.cidade).orderBy(desc(conta)).limit(8),
    db.select({ nome: sql<string>`coalesce(${visitantes.aparelho}, 'não sei')`, n: conta }).from(visitantes).where(janela).groupBy(sql`1`).orderBy(desc(conta)),
    db
      .select({
        whatsapp: sql<number>`count(distinct ${eventosSite.visitanteId}) filter (where ${eventosSite.tipo} = 'whatsapp')::int`,
        diagnostico: sql<number>`count(distinct ${eventosSite.visitanteId}) filter (where ${eventosSite.tipo} = 'diagnostico')::int`,
      })
      .from(eventosSite)
      .where(and(gte(eventosSite.criadoEm, inicio), isNotNull(eventosSite.visitanteId))),
    db
      .select({ nome: eventosSite.pagina, n: sql<number>`count(distinct ${eventosSite.visitanteId})::int` })
      .from(eventosSite)
      .where(and(gte(eventosSite.criadoEm, inicio), eq(eventosSite.tipo, "secao")))
      .groupBy(eventosSite.pagina)
      .orderBy(desc(sql`count(distinct ${eventosSite.visitanteId})`)),
  ]);
  return { ...total, porOrigem, porCidade, porAparelho, clicaramWhatsapp: agiram.whatsapp, mandaramDiagnostico: agiram.diagnostico, porSecao };
}

/** O caminho de um lead no site: os navegadores ligados a ele e tudo o que fizeram, do mais novo ao mais antigo. */
export async function caminhoDoLead(db: BancoDeDados, leadId: string) {
  const lista = await db.select().from(visitantes).where(eq(visitantes.leadId, leadId)).orderBy(visitantes.primeiraVisita);
  if (!lista.length) return { visitantes: [], eventos: [] };
  const eventos = await db
    .select({ id: eventosSite.id, tipo: eventosSite.tipo, pagina: eventosSite.pagina, criadoEm: eventosSite.criadoEm })
    .from(eventosSite)
    .where(inArray(eventosSite.visitanteId, lista.map((v) => v.id)))
    .orderBy(desc(eventosSite.criadoEm))
    .limit(200);
  return { visitantes: lista, eventos };
}
