/**
 * Receita da Urutau contra um Postgres real: cobranças geradas, pagamento que vira comissão,
 * desfazer, números do mês e o extrato de cada pessoa.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { clientesUrutau, cobrancaItens, cobrancas, contratoItens, contratos, custosUrutau, ganhos, parametrosCentral, regrasComissao, usuarios } from "@/db/schema";
import {
  cobrancasAtrasadas,
  comissoesAPagar,
  desfazerPagamento,
  extratoDeGanhos,
  gerarCobrancas,
  lerParametros,
  lerRegras,
  listarClientesUrutau,
  numerosDoMes,
  recorrencia,
  registrarPagamento,
  resumoDeGanhos,
} from "@/lib/servidor/receita";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");
let borel: { id: string };
let vinicius: { id: string };
let wanderley: { id: string };
let loja: { id: string };
let contrato: { id: string };
let site: { id: string };
let trafego: { id: string };

async function pessoa(nome: string, superadmin = true) {
  const [u] = await db.insert(usuarios).values({ nome, email: `${nome.toLowerCase()}@urutau.dev`, senhaHash: "x", superadmin }).returning({ id: usuarios.id });
  return u;
}

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  // Os usuários existem antes da migração da receita para conferir que o primeiro vira sócio.
  await migrate(db, { migrationsFolder: "./drizzle" });
  borel = await pessoa("Borel");
  vinicius = await pessoa("Vinicius");
  wanderley = await pessoa("Wanderley");
  [loja] = await db.insert(clientesUrutau).values({ nome: "Clínica Mar", quemTrouxeId: wanderley.id }).returning({ id: clientesUrutau.id });
  // Agosto a janeiro, 20% de desconto nos 2 primeiros meses, vence dia 10.
  [contrato] = await db
    .insert(contratos)
    .values({ clienteId: loja.id, inicio: "2026-08-01", meses: 6, descontoPcm: 20_000, descontoMeses: 2, criadoEm: new Date("2026-07-15T12:00:00-03:00") })
    .returning({ id: contratos.id });
  [site] = await db
    .insert(contratoItens)
    .values({ contratoId: contrato.id, servico: "site", recorrencia: "unico", valorCentavos: 300_000, custoCentavos: 20_000, executorId: vinicius.id, executorPcm: 30_000, trouxePcm: 10_000 })
    .returning({ id: contratoItens.id });
  [trafego] = await db
    .insert(contratoItens)
    .values({ contratoId: contrato.id, servico: "trafego", recorrencia: "mensal", valorCentavos: 100_000, executorId: vinicius.id, executorPcm: 35_000, trouxePcm: 10_000 })
    .returning({ id: contratoItens.id });
});

afterAll(async () => {
  await cliente.end();
});

describe("regras iniciais", () => {
  it("a migração traz a tabela combinada", async () => {
    const r = await lerRegras(db);
    expect(r).toMatchObject({ site: 30_000, trafego: 35_000, reels: 35_000, post: 35_000 });
    expect(await lerParametros(db)).toEqual({ trouxePcm: 10_000, caixaPcm: 10_000, diferencaPcm: 5_000, socioMaiorId: null });
  });
});

describe("cobranças", () => {
  it("gera do início até o mês pedido, com desconto e o site só no primeiro mês", async () => {
    expect(await gerarCobrancas(db, "2026-10")).toBe(3);
    expect(await gerarCobrancas(db, "2026-10")).toBe(0);
    const lista = await db.select().from(cobrancas).where(eq(cobrancas.contratoId, contrato.id)).orderBy(cobrancas.competencia);
    expect(lista.map((c) => [c.competencia, c.vencimento, c.valorCentavos])).toEqual([
      ["2026-08-01", "2026-08-10", 320_000],
      ["2026-09-01", "2026-09-10", 80_000],
      ["2026-10-01", "2026-10-10", 100_000],
    ]);
    const linhas = await db.select().from(cobrancaItens).where(eq(cobrancaItens.cobrancaId, lista[0].id));
    expect(linhas.find((l) => l.itemId === site.id)).toMatchObject({ valorCentavos: 240_000, custoCentavos: 20_000 });
  });

  it("no mês do cadastro, o vencimento não cai antes do dia em que o contrato foi cadastrado", async () => {
    const [outro] = await db.insert(clientesUrutau).values({ nome: "Cadastrado no dia 20" }).returning({ id: clientesUrutau.id });
    const [k] = await db
      .insert(contratos)
      .values({ clienteId: outro.id, inicio: "2026-10-01", diaVencimento: 10, criadoEm: new Date("2026-10-20T15:00:00-03:00") })
      .returning({ id: contratos.id });
    await db.insert(contratoItens).values({ contratoId: k.id, servico: "post", recorrencia: "mensal", valorCentavos: 50_000 });
    await gerarCobrancas(db, "2026-11", k.id);
    const lista = await db.select().from(cobrancas).where(eq(cobrancas.contratoId, k.id)).orderBy(cobrancas.competencia);
    expect(lista.map((c) => c.vencimento)).toEqual(["2026-10-20", "2026-11-10"]);
    await db.delete(clientesUrutau).where(eq(clientesUrutau.id, outro.id));
  });

  it("atrasadas: as vencidas e não pagas", async () => {
    expect((await cobrancasAtrasadas(db, "2026-10-27")).map((c) => c.competencia)).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
  });
});

describe("pagamento vira comissão", () => {
  it("agosto pago: 10% do Wanderley (trouxe) e 30%/35% do Vinícius (executou)", async () => {
    const [ago] = await db.select().from(cobrancas).where(eq(cobrancas.competencia, "2026-08-01"));
    const g = await registrarPagamento(db, ago.id, "2026-10-05");
    // Site 240.000 (com desconto) + tráfego 80.000.
    expect(g.filter((x) => x.usuarioId === wanderley.id).reduce((s, x) => s + x.valor, 0)).toBe(32_000);
    expect(g.filter((x) => x.usuarioId === vinicius.id).reduce((s, x) => s + x.valor, 0)).toBe(72_000 + 28_000);
    await expect(registrarPagamento(db, ago.id, "2026-10-05")).rejects.toThrow("já está paga");
  });

  it("desfazer apaga as comissões; com repasse feito, não deixa", async () => {
    const [set] = await db.select().from(cobrancas).where(eq(cobrancas.competencia, "2026-09-01"));
    await registrarPagamento(db, set.id, "2026-10-06");
    await desfazerPagamento(db, set.id);
    expect(await db.select().from(ganhos).where(eq(ganhos.cobrancaId, set.id))).toEqual([]);
    await registrarPagamento(db, set.id, "2026-10-06", 40_000);
    const parciais = await db.select().from(ganhos).where(eq(ganhos.cobrancaId, set.id));
    expect(parciais.map((x) => x.baseCentavos)).toEqual([40_000, 40_000]);
    await db.update(ganhos).set({ status: "pago", pagoEm: "2026-10-20" }).where(eq(ganhos.cobrancaId, set.id));
    await expect(desfazerPagamento(db, set.id)).rejects.toThrow("comissão paga");
  });
});

describe("números do mês", () => {
  it("receita pelo dinheiro que entrou, custos do mês e a divisão teórica", async () => {
    await db.insert(custosUrutau).values([
      { descricao: "DAS MEI", categoria: "imposto", valorCentavos: 8_000, recorrencia: "mensal", inicio: "2026-01-01" },
      { descricao: "Domínio", categoria: "ferramenta", valorCentavos: 5_000, recorrencia: "unico", inicio: "2026-09-01" },
    ]);
    await db.insert(parametrosCentral).values({ chave: "socio_maior_id", valor: borel.id });
    const p = await lerParametros(db);
    const out = await numerosDoMes(db, "2026-10", p);
    // Entraram 320.000 (agosto) + 40.000 (setembro parcial) em outubro.
    expect(out.receita).toBe(360_000);
    expect(out.comissoes).toBe(32_000 + 100_000 + 4_000 + 14_000);
    expect(out.custoEmpresa).toBe(8_000);
    expect(out.faturado).toBe(100_000);
    expect(out.caixa + out.socioMaior + out.socioMenor + out.comissoes + out.custos).toBe(out.receita);
    expect(out.socioMaior - out.socioMenor).toBe(18_000);
    expect((await numerosDoMes(db, "2026-09", p)).custoEmpresa).toBe(13_000);
  });

  it("receita recorrente e clientes ativos", async () => {
    const r = await recorrencia(db, "2026-10");
    expect(r).toMatchObject({ mrr: 100_000, clientesAtivos: 1, ticketMedio: 100_000, cancelamentos: 0 });
    expect(r.vencendo.map((v) => v.fim)).toEqual(["2027-01"]);
  });
});

describe("cada pessoa", () => {
  it("extrato, a receber e previsão do mês do Vinícius", async () => {
    const extrato = await extratoDeGanhos(db, vinicius.id);
    expect(extrato.every((l) => l.cliente === "Clínica Mar")).toBe(true);
    const r = await resumoDeGanhos(db, vinicius.id, "2026-10");
    expect(r).toMatchObject({ noMes: 100_000 + 14_000, aReceber: 100_000, recebido: 14_000, previstoNoMes: 35_000, servicosQueExecuta: 2 });
    const w = await resumoDeGanhos(db, wanderley.id, "2026-10");
    expect(w.clientesQueTrouxe.map((c) => c.nome)).toEqual(["Clínica Mar"]);
    expect(w.previstoNoMes).toBe(10_000);
  });

  it("lista de clientes e comissões a pagar", async () => {
    const [c] = await listarClientesUrutau(db, "2026-10", "2026-10-27");
    expect(c).toMatchObject({ nome: "Clínica Mar", ativo: true, mensal: 100_000, servicos: ["site", "trafego"], fimContrato: "2027-01", atrasadas: 1, quemTrouxe: "Wanderley" });
    const a = await comissoesAPagar(db);
    expect(a.map((x) => [x.nome, x.total])).toEqual([["Vinicius", 100_000], ["Wanderley", 32_000]]);
  });
});

describe("papéis", () => {
  it("primeiro da equipe vira sócio na migração (aqui não havia ninguém antes: todos equipe)", async () => {
    const r = await db.select({ papel: usuarios.papelEquipe }).from(usuarios);
    expect(r.every((x) => x.papel === "equipe")).toBe(true);
    expect(await db.select().from(regrasComissao)).toHaveLength(10);
  });
});
