/**
 * Comercial da Urutau contra um Postgres real: importação de prospecção, lead do site,
 * funil e números do mês.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { eventosSite, interacoes, leads, propostas, usuarios, visitantes } from "@/db/schema";
import { prospectosDoCsv } from "@/lib/comercial";
import { caminhoDoLead, registrarVisitante, resumoDeVisitantes, visitantesRecentes } from "@/lib/servidor/visitantes";
import { contagemPorEtapa, importarProspectos, leadDoSite, leadsNoMapa, listarLeads, lotesDeProspeccao, obterLead, proximosContatos, resumoComercial } from "@/lib/servidor/comercial";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");
let gabriel: { id: string };

const CSV = [
  "title,phone,category,address,latitude,longitude,place_id",
  `Clínica A,21999990001,Dentista,"Rua 1 - Centro, Maricá - RJ",-22.91,-42.81,P1`,
  `Clínica B,21999990002,Dentista,"Rua 2 - Centro, Maricá - RJ",,,P2`,
].join("\n");

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
  [gabriel] = await db.insert(usuarios).values({ nome: "Gabriel", email: "g@urutau.dev", senhaHash: "x", superadmin: true }).returning({ id: usuarios.id });
});

afterAll(async () => {
  await cliente.end();
});

describe("prospecção", () => {
  it("importa o lote e não duplica na segunda vez", async () => {
    const { prospectos } = prospectosDoCsv(CSV);
    expect(await importarProspectos(db, prospectos, { lote: "dentistas", responsavelId: gabriel.id, criadoPor: gabriel.id })).toEqual({ novos: 2, repetidos: 0 });
    expect(await importarProspectos(db, prospectos, { lote: "dentistas de novo", responsavelId: null, criadoPor: gabriel.id })).toEqual({ novos: 0, repetidos: 2 });
    const [lote] = await lotesDeProspeccao(db);
    expect(lote).toMatchObject({ lote: "dentistas", total: 2, trabalhados: 0, comMapa: 1 });
    expect((await leadsNoMapa(db, "dentistas")).map((p) => p.nome)).toEqual(["Clínica A"]);
    const [a] = await listarLeads(db, { busca: "Clínica A" });
    expect(a).toMatchObject({ origem: "prospeccao", etapa: "novo", responsavel: "Gabriel", cidade: "Maricá" });
  });
});

describe("lead do site", () => {
  it("diagnóstico vira lead com as dores e o histórico", async () => {
    const r = await leadDoSite(db, { tipo: "diagnostico", nome: "Ana", negocio: "Clínica Mar", telefone: "5521991234567", email: null, mensagem: null, dores: ["Respondo cliente até tarde."], tamanho: "2 a 5 pessoas", pagina: "/" });
    expect(r).toMatchObject({ novo: true });
    const d = await obterLead(db, r!.id);
    expect(d?.lead).toMatchObject({ nome: "Clínica Mar", contato: "Ana", origem: "diagnostico", dores: ["Respondo cliente até tarde."], tamanho: "2 a 5 pessoas" });
    expect(d?.historico[0].texto).toContain("Marcou no diagnóstico");
  });

  it("o mesmo telefone voltando não duplica: entra no histórico", async () => {
    const r = await leadDoSite(db, { tipo: "contato", nome: "Ana", negocio: null, telefone: "5521991234567", email: null, mensagem: "Quero o orçamento", dores: [], tamanho: null, pagina: "/contato" });
    expect(r).toMatchObject({ novo: false });
    const d = await obterLead(db, r!.id);
    expect(d?.historico).toHaveLength(2);
    expect(d?.historico[0].texto).toContain("Quero o orçamento");
  });

  it("sem nome, telefone nem e-mail não cria nada", async () => {
    expect(await leadDoSite(db, { tipo: "contato", nome: null, negocio: null, telefone: null, email: null, mensagem: "oi", dores: [], tamanho: null, pagina: null })).toBeNull();
  });
});

describe("funil e números", () => {
  it("conta por etapa, retornos marcados e o fechado no mês", async () => {
    const [b] = await db.select({ id: leads.id }).from(leads).where(eq(leads.nome, "Clínica B"));
    await db.update(leads).set({ etapa: "ganho", valorEstimadoCentavos: 100_000 }).where(eq(leads.id, b.id));
    await db.insert(interacoes).values({ leadId: b.id, tipo: "nota", etapaDe: "proposta", etapaPara: "ganho", criadoEm: new Date("2026-10-20T12:00:00-03:00") });
    await db.insert(propostas).values([
      { leadId: b.id, titulo: "Site", valorMensalCentavos: 50_000, valorUnicoCentavos: 200_000, status: "aceita", respondidaEm: new Date("2026-10-20T12:00:00-03:00") },
      { leadId: b.id, titulo: "Ads", valorMensalCentavos: 80_000, status: "enviada" },
      { leadId: b.id, titulo: "Velha", valorMensalCentavos: 10_000, status: "aceita", respondidaEm: new Date("2026-09-10T12:00:00-03:00") },
    ]);
    const [a] = await db.select({ id: leads.id }).from(leads).where(eq(leads.nome, "Clínica A"));
    await db.update(leads).set({ proximoContato: "2026-10-26" }).where(eq(leads.id, a.id));

    const c = await contagemPorEtapa(db);
    expect(c.n).toMatchObject({ novo: 2, ganho: 1 });
    expect(c.valor.ganho).toBe(100_000);

    expect((await proximosContatos(db, "2026-10-27")).map((r) => r.nome)).toEqual(["Clínica A"]);
    expect(await proximosContatos(db, "2026-10-25")).toEqual([]);

    const r = await resumoComercial(db, "2026-10");
    expect(r.propostasAbertas).toMatchObject({ n: 1, mensal: 80_000 });
    expect(r.aceitasNoMes).toMatchObject({ n: 1, mensal: 50_000, unico: 200_000 });
    expect(r.ganhosNoMes).toBe(1);
  });

  it("filtro 'abertos' deixa de fora quem fechou ou perdeu", async () => {
    const nomes = (await listarLeads(db, { etapa: "abertos" })).map((l) => l.nome).sort();
    expect(nomes).toEqual(["Clínica A", "Clínica Mar"]);
  });
});

describe("visitantes do site", () => {
  const V = "aaaaaaaa-1111-4111-8111-000000000001";
  const visita = (extra: Partial<Parameters<typeof registrarVisitante>[1]> = {}) => ({ id: V, cidade: "Niterói", regiao: "RJ", pais: "BR", aparelho: "celular", origem: "Instagram", meio: "social", campanha: "outubro", ...extra });

  it("primeira origem fica; cidade e contagem de visitas acompanham", async () => {
    await registrarVisitante(db, visita(), true);
    await registrarVisitante(db, visita({ origem: "Google", campanha: "outra", cidade: "Maricá" }), true);
    await registrarVisitante(db, visita({ cidade: null }), false);
    const [v] = await db.select().from(visitantes).where(eq(visitantes.id, V));
    expect(v).toMatchObject({ visitas: 2, origem: "Instagram", campanha: "outubro", cidade: "Maricá" });
  });

  it("quem chegou Direto e volta por um anúncio passa a ter a origem do anúncio", async () => {
    const D = "bbbbbbbb-1111-4111-8111-000000000002";
    await registrarVisitante(db, { ...visita(), id: D, origem: "Direto", meio: null, campanha: null }, true);
    await registrarVisitante(db, { ...visita(), id: D, origem: "Google", campanha: "busca" }, true);
    const [v] = await db.select().from(visitantes).where(eq(visitantes.id, D));
    expect(v).toMatchObject({ origem: "Google", campanha: "busca" });
  });

  it("o diagnóstico liga o caminho do visitante ao lead", async () => {
    await db.insert(eventosSite).values([
      { tipo: "visita", visitanteId: V },
      { tipo: "secao", pagina: "gestao", visitanteId: V },
      { tipo: "whatsapp", visitanteId: V },
    ]);
    const r = await leadDoSite(db, { tipo: "diagnostico", nome: "Leo", negocio: "Loja Leo", telefone: "5521970000000", email: null, mensagem: null, dores: [], tamanho: null, pagina: "/", visitanteId: V });
    const caminho = await caminhoDoLead(db, r!.id);
    expect(caminho.visitantes.map((v) => v.id)).toEqual([V]);
    expect(caminho.eventos.map((e) => e.tipo).sort()).toEqual(["secao", "visita", "whatsapp"]);
  });

  it("resumo e lista mostram quem agiu", async () => {
    const r = await resumoDeVisitantes(db, 7);
    expect(r).toMatchObject({ n: 2, voltaram: 2, viraramLead: 1, clicaramWhatsapp: 1 });
    expect(r.porSecao).toEqual([{ nome: "gestao", n: 1 }]);
    const agiram = await visitantesRecentes(db, { soQuemAgiu: true });
    expect(agiram.map((v) => v.lead)).toEqual(["Loja Leo"]);
    expect(agiram[0]).toMatchObject({ secoes: ["gestao"], cliquesWhatsapp: 1 });
  });
});
