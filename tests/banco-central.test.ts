/**
 * Central Urutau contra um Postgres real: equipe, metas, notas, clientes por responsável e site.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { criarPadroesDaEmpresa } from "@/db/padroes";
import { auditoria, empresaUsuarios, empresas, eventosSite, fontesReceita, metas, notasEquipe, usuarios, vendas } from "@/db/schema";
import { atividadeRecente, empresasDaCentral, listarEquipe, metasDoMes, notasRecentes, pessoasOnlineNasEmpresas, resumoDoSite } from "@/lib/servidor/central";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");

const agora = new Date("2026-10-27T15:00:00-03:00");
let gabriel: { id: string };
let vinicius: { id: string };
let donoDaLoja: { id: string };
let loja: { id: string; fonteId: string };

async function pessoa(nome: string, email: string, superadmin: boolean, vistoEm: Date | null = null) {
  const [u] = await db.insert(usuarios).values({ nome, email, senhaHash: "x", superadmin, vistoEm }).returning({ id: usuarios.id });
  return u;
}

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
  gabriel = await pessoa("Gabriel Ottaviano", "ottaviano@urutau.com", true, new Date(agora.getTime() - 60_000));
  vinicius = await pessoa("Vinícius", "vinicius@urutau.com", true);
  donoDaLoja = await pessoa("Rafael", "rafael@loja.com", false, new Date(agora.getTime() - 30_000));
  const [e] = await db.insert(empresas).values({ nome: "Urutau Veículos", atividade: "ambos", regime: "simples", anexoComercio: "I", anexoServicos: "III", perfil: "revenda_veiculos", responsavelId: gabriel.id }).returning();
  await db.transaction((tx) => criarPadroesDaEmpresa(tx, e.id, e.atividade, "revenda_veiculos"));
  await db.insert(empresaUsuarios).values({ empresaId: e.id, usuarioId: donoDaLoja.id, papel: "dono" });
  const [f] = await db.select().from(fontesReceita).where(eq(fontesReceita.empresaId, e.id)).limit(1);
  loja = { id: e.id, fonteId: f.id };
  await db.insert(empresas).values({ nome: "Clínica Sem Dono", atividade: "servicos", regime: "simples", anexoServicos: "III" });
});

afterAll(async () => {
  await cliente.end();
});

describe("equipe", () => {
  it("só quem é superadmin, na ordem de cadastro", async () => {
    const equipe = await listarEquipe(db);
    expect(equipe.map((p) => p.email)).toEqual(["ottaviano@urutau.com", "vinicius@urutau.com"]);
  });

  it("conta quem dos clientes está online agora", async () => {
    expect(await pessoasOnlineNasEmpresas(db, agora)).toBe(1);
  });
});

describe("metas", () => {
  it("o banco recusa alvo zero e mês fora do dia 1", async () => {
    await expect(db.insert(metas).values({ usuarioId: gabriel.id, mes: "2026-10-01", titulo: "x", tipo: "quantidade", alvo: 0 })).rejects.toThrow();
    await expect(db.insert(metas).values({ usuarioId: gabriel.id, mes: "2026-10-15", titulo: "x", tipo: "quantidade", alvo: 3 })).rejects.toThrow();
  });

  it("lista as metas do mês, de todos ou de uma pessoa", async () => {
    await db.insert(metas).values([
      { usuarioId: gabriel.id, mes: "2026-10-01", titulo: "Fechar 3 clientes", tipo: "quantidade", alvo: 3, atual: 1 },
      { usuarioId: vinicius.id, mes: "2026-10-01", titulo: "Vender R$ 10 mil", tipo: "valor", alvo: 1_000_000 },
      { usuarioId: gabriel.id, mes: "2026-09-01", titulo: "Mês passado", tipo: "quantidade", alvo: 1 },
    ]);
    expect((await metasDoMes(db, "2026-10")).map((m) => m.titulo)).toEqual(["Fechar 3 clientes", "Vender R$ 10 mil"]);
    expect((await metasDoMes(db, "2026-10", vinicius.id)).map((m) => m.titulo)).toEqual(["Vender R$ 10 mil"]);
  });
});

describe("clientes na Central", () => {
  it("soma as vendas do mês, conta as que esperam conferência e o último acesso do cliente", async () => {
    await db.insert(vendas).values([
      { empresaId: loja.id, data: "2026-10-05", valorCentavos: 300_000, fonteReceitaId: loja.fonteId, formaPagamento: "pix", status: "recebido", dataRecebimento: "2026-10-05" },
      { empresaId: loja.id, data: "2026-10-20", valorCentavos: 50_000, fonteReceitaId: loja.fonteId, formaPagamento: "pix", status: "recebido", dataRecebimento: "2026-10-20", origem: "whatsapp", conferidoEm: null },
      { empresaId: loja.id, data: "2026-09-30", valorCentavos: 999_999, fonteReceitaId: loja.fonteId, formaPagamento: "pix", status: "recebido", dataRecebimento: "2026-09-30" },
    ]);
    const todas = await empresasDaCentral(db, "2026-10");
    const l = todas.find((e) => e.id === loja.id)!;
    expect(l.vendasMes).toBe(350_000);
    expect(l.aConferir).toBe(1);
    expect(l.ultimoAcesso?.getTime()).toBe(agora.getTime() - 30_000);
    expect(todas.find((e) => e.nome === "Clínica Sem Dono")?.vendasMes).toBe(0);
    expect((await empresasDaCentral(db, "2026-10", gabriel.id)).map((e) => e.nome)).toEqual(["Urutau Veículos"]);
    expect(await empresasDaCentral(db, "2026-10", vinicius.id)).toEqual([]);
  });
});

describe("notas e atividade", () => {
  it("fixadas primeiro, excluídas somem, e filtra pela área da pessoa", async () => {
    await db.insert(notasEquipe).values([
      { autorId: gabriel.id, texto: "Ligar para a loja na sexta", sobreUsuarioId: gabriel.id, empresaId: loja.id },
      { autorId: vinicius.id, texto: "Reunião de pauta toda segunda", fixada: true },
      { autorId: vinicius.id, texto: "apagada", excluidoEm: new Date() },
    ]);
    const todas = await notasRecentes(db);
    expect(todas.map((n) => n.texto)).toEqual(["Reunião de pauta toda segunda", "Ligar para a loja na sexta"]);
    expect(todas[1]).toMatchObject({ autor: "Gabriel Ottaviano", empresa: "Urutau Veículos" });
    expect((await notasRecentes(db, { sobreUsuarioId: gabriel.id })).map((n) => n.texto)).toEqual(["Ligar para a loja na sexta"]);
  });

  it("a atividade traz quem fez e em qual empresa", async () => {
    await db.insert(auditoria).values({ empresaId: loja.id, usuarioId: gabriel.id, ator: "admin", acao: "admin.modulos" });
    const [a] = await atividadeRecente(db, { usuarioId: gabriel.id });
    expect(a).toMatchObject({ acao: "admin.modulos", quem: "Gabriel Ottaviano", daEquipe: true, empresa: "Urutau Veículos" });
  });
});

describe("site urutau.io", () => {
  it("conta os eventos da semana e lista os últimos contatos", async () => {
    expect((await resumoDoSite(db, 7, agora)).algumDia).toBe(false);
    await db.insert(eventosSite).values([
      { tipo: "visita", pagina: "/", criadoEm: new Date(agora.getTime() - 3_600_000) },
      { tipo: "visita", pagina: "/servicos", criadoEm: new Date(agora.getTime() - 7_200_000) },
      { tipo: "contato", nome: "Ana", contato: "ana@clinica.com", criadoEm: new Date(agora.getTime() - 60_000) },
      { tipo: "visita", pagina: "/", criadoEm: new Date(agora.getTime() - 10 * 86_400_000) },
    ]);
    const r = await resumoDoSite(db, 7, agora);
    expect(r).toMatchObject({ visitas: 2, contatos: 1, whatsapp: 0, algumDia: true });
    expect(r.ultimos.map((u) => u.nome)).toEqual(["Ana"]);
  });
});
