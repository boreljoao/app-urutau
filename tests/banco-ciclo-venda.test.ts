/**
 * Ciclo de vida da venda pela origem (auditoria F02): excluir pelo financeiro desfaz os efeitos
 * de cada origem — caixa devolve estoque, agenda solta o atendimento, pátio devolve o carro — e
 * restaurar refaz o vínculo só se ele ainda estiver livre.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { criarPadroesDaEmpresa } from "@/db/padroes";
import { agendamentos, empresas, fontesReceita, produtos, usuarios, vendas, veiculos } from "@/db/schema";
import { excluirVenda, origemDaVenda, restaurarVenda } from "@/lib/servidor/ciclo-venda";
import { registrarVendaCaixa, salvarProduto } from "@/lib/servidor/estoque";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");

let empresa: typeof empresas.$inferSelect;
let eu: { id: string };
let fonteId: string;

const novaVenda = async (extra: Partial<typeof vendas.$inferInsert> = {}) =>
  (
    await db
      .insert(vendas)
      .values({ empresaId: empresa.id, data: "2026-11-10", valorCentavos: 15_000, fonteReceitaId: fonteId, formaPagamento: "pix", status: "recebido", dataRecebimento: "2026-11-10", ...extra })
      .returning()
  )[0];

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
  [empresa] = await db.insert(empresas).values({ nome: "Loja e consultório", atividade: "comercio", regime: "simples", anexoComercio: "I", perfil: "varejo" }).returning();
  await db.transaction((tx) => criarPadroesDaEmpresa(tx, empresa.id, empresa.atividade, "varejo"));
  [eu] = await db.insert(usuarios).values({ nome: "Dona", email: "dona@ciclo.dev", senhaHash: "x" }).returning({ id: usuarios.id });
  [{ id: fonteId }] = await db.select({ id: fontesReceita.id }).from(fontesReceita).where(eq(fontesReceita.empresaId, empresa.id)).limit(1);
});

afterAll(async () => {
  await cliente.end();
});

describe("caixa", () => {
  it("excluir pelo financeiro devolve o estoque; repetir não devolve de novo; não restaura", async () => {
    const produtoId = await salvarProduto(
      db,
      empresa.id,
      null,
      { nome: "Camiseta", sku: null, codigoBarras: null, categoria: "", unidade: "un", precoCentavos: 5_000, minimoMil: 0, controlaEstoque: true, ativo: true },
      eu.id,
      { saldoMil: 10_000, custoCentavos: 2_000 },
    );
    const v = await registrarVendaCaixa(db, empresa.id, eu.id, { itens: [{ produtoId, quantidadeMil: 1_000 }], descontoCentavos: 0, formaPagamento: "pix", clienteId: null, aReceber: false });
    const saldo = async () => (await db.select({ s: produtos.saldoMil }).from(produtos).where(eq(produtos.id, produtoId)))[0].s;
    expect(await saldo()).toBe(9_000);
    expect(await origemDaVenda(db, empresa.id, v.vendaId)).toEqual({ tipo: "caixa" });
    await expect(excluirVenda(db, empresa.id, v.vendaId, eu.id, false)).rejects.toThrow("dono ou gerente");
    await excluirVenda(db, empresa.id, v.vendaId, eu.id, true);
    expect(await saldo()).toBe(10_000);
    await expect(excluirVenda(db, empresa.id, v.vendaId, eu.id, true)).rejects.toThrow();
    expect(await saldo()).toBe(10_000);
    await expect(restaurarVenda(db, empresa.id, v.vendaId, eu.id)).rejects.toThrow("não volta");
  });
});

describe("agenda", () => {
  it("excluir o recebimento solta o atendimento; restaurar prende de novo", async () => {
    const venda = await novaVenda({ origem: "agenda" });
    const [a] = await db
      .insert(agendamentos)
      .values({ empresaId: empresa.id, data: "2026-11-10", hora: "10:00", nome: "Paciente", status: "atendido", vendaId: venda.id })
      .returning();
    expect(await origemDaVenda(db, empresa.id, venda.id)).toEqual({ tipo: "agenda", agendamentoId: a.id });
    await excluirVenda(db, empresa.id, venda.id, eu.id, false);
    expect((await db.select().from(agendamentos).where(eq(agendamentos.id, a.id)))[0].vendaId).toBeNull();
    await restaurarVenda(db, empresa.id, venda.id, eu.id);
    expect((await db.select().from(agendamentos).where(eq(agendamentos.id, a.id)))[0].vendaId).toBe(venda.id);
  });

  it("não restaura se o atendimento já recebeu outro lançamento", async () => {
    const venda = await novaVenda({ origem: "agenda" });
    const [a] = await db.insert(agendamentos).values({ empresaId: empresa.id, data: "2026-11-10", hora: "11:00", nome: "Outro", status: "atendido", vendaId: venda.id }).returning();
    await excluirVenda(db, empresa.id, venda.id, eu.id, false);
    const outra = await novaVenda({ origem: "agenda" });
    await db.update(agendamentos).set({ vendaId: outra.id }).where(eq(agendamentos.id, a.id));
    await expect(restaurarVenda(db, empresa.id, venda.id, eu.id)).rejects.toThrow("outro lançamento");
    expect((await db.select().from(vendas).where(eq(vendas.id, venda.id)))[0].excluidoEm).not.toBeNull();
  });
});

describe("pátio", () => {
  it("excluir a venda devolve o carro; restaurar vende de novo se ele ainda estiver livre", async () => {
    const venda = await novaVenda({ valorCentavos: 4_500_000 });
    const [carro] = await db
      .insert(veiculos)
      .values({ empresaId: empresa.id, modelo: "Gol 1.6", entradaEm: "2026-10-01", status: "vendido", vendaId: venda.id, valorVendaCentavos: 4_500_000, vendidoEm: "2026-11-10" })
      .returning();
    expect(await origemDaVenda(db, empresa.id, venda.id)).toEqual({ tipo: "veiculo", veiculoId: carro.id });
    await excluirVenda(db, empresa.id, venda.id, eu.id, false);
    expect((await db.select().from(veiculos).where(eq(veiculos.id, carro.id)))[0]).toMatchObject({ status: "disponivel", vendaId: null, valorVendaCentavos: null });
    await restaurarVenda(db, empresa.id, venda.id, eu.id);
    expect((await db.select().from(veiculos).where(eq(veiculos.id, carro.id)))[0]).toMatchObject({ status: "vendido", vendaId: venda.id, valorVendaCentavos: 4_500_000 });
  });

  it("venda manual exclui e restaura sem mexer em mais nada", async () => {
    const venda = await novaVenda();
    expect(await origemDaVenda(db, empresa.id, venda.id)).toEqual({ tipo: "manual" });
    await excluirVenda(db, empresa.id, venda.id, eu.id, false);
    await restaurarVenda(db, empresa.id, venda.id, eu.id);
    const [v] = await db.select().from(vendas).where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, empresa.id)));
    expect(v.excluidoEm).toBeNull();
  });
});
