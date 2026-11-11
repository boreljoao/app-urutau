/**
 * Estoque e caixa contra um Postgres real: cadastro, entrada com custo médio e despesa, venda no
 * caixa (inclusive duas ao mesmo tempo), cancelamento, inventário, perdas, importação e painel.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { criarPadroesDaEmpresa } from "@/db/padroes";
import { clientes, despesas, empresas, movimentosEstoque, produtos, usuarios, vendaItens, vendas } from "@/db/schema";
import { produtosDoCsv } from "@/lib/estoque";
import {
  ErroEstoque,
  acharPorCodigo,
  ajustarInventario,
  caixaDoDia,
  cancelarVendaCaixa,
  contarProdutos,
  importarProdutos,
  listarProdutos,
  obterProduto,
  painelEstoque,
  registrarEntrada,
  registrarPerda,
  registrarVendaCaixa,
  salvarProduto,
  type DadosProduto,
} from "@/lib/servidor/estoque";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");

let loja: typeof empresas.$inferSelect;
let eu: { id: string };
const ids: Record<string, string> = {};

const base = (nome: string, extra: Partial<DadosProduto> = {}): DadosProduto => ({
  nome,
  sku: null,
  codigoBarras: null,
  categoria: "Mercearia",
  unidade: "un",
  precoCentavos: 1_000,
  minimoMil: 0,
  controlaEstoque: true,
  ativo: true,
  ...extra,
});

const saldo = async (id: string) => (await db.select({ s: produtos.saldoMil, c: produtos.custoMedioCentavos }).from(produtos).where(eq(produtos.id, id)))[0];

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
  [loja] = await db.insert(empresas).values({ nome: "Mercadinho Tauá", atividade: "comercio", regime: "simples", anexoComercio: "I", perfil: "varejo" }).returning();
  await db.transaction((tx) => criarPadroesDaEmpresa(tx, loja.id, loja.atividade, "varejo"));
  [eu] = await db.insert(usuarios).values({ nome: "Caixa", email: "caixa@tauá.dev", senhaHash: "x" }).returning({ id: usuarios.id });
});

afterAll(async () => {
  await cliente.end();
});

describe("cadastro", () => {
  it("saldo inicial entra como a primeira entrada, com custo", async () => {
    ids.cafe = await salvarProduto(db, loja.id, null, base("Café 500g", { codigoBarras: "7891000315507", precoCentavos: 1_890, minimoMil: 5_000 }), eu.id, { saldoMil: 10_000, custoCentavos: 1_200 });
    expect(await saldo(ids.cafe)).toEqual({ s: 10_000, c: 1_200 });
    const [m] = await db.select().from(movimentosEstoque).where(eq(movimentosEstoque.produtoId, ids.cafe));
    expect(m).toMatchObject({ tipo: "entrada", quantidadeMil: 10_000, saldoAposMil: 10_000, observacao: "Saldo inicial" });
    expect((await acharPorCodigo(db, loja.id, " 7891000315507 "))?.id).toBe(ids.cafe);
  });

  it("código de barras repetido na mesma loja é recusado com mensagem clara", async () => {
    await expect(salvarProduto(db, loja.id, null, base("Outro café", { codigoBarras: "7891000315507" }), eu.id)).rejects.toThrow("código de barras");
  });

  it("granel e item sem controle de estoque", async () => {
    ids.queijo = await salvarProduto(db, loja.id, null, base("Queijo minas", { unidade: "kg", precoCentavos: 4_590, categoria: "Frios" }), eu.id, { saldoMil: 3_000, custoCentavos: 2_800 });
    ids.cafezinho = await salvarProduto(db, loja.id, null, base("Cafezinho", { precoCentavos: 400, controlaEstoque: false, categoria: "Cafeteria" }), eu.id);
    expect(await saldo(ids.queijo)).toEqual({ s: 3_000, c: 2_800 });
  });
});

describe("entrada de mercadoria", () => {
  it("recalcula o custo médio e lança a compra nas despesas, a pagar", async () => {
    const r = await registrarEntrada(db, loja.id, eu.id, {
      linhas: [{ produtoId: ids.cafe, quantidadeMil: 10_000, custoUnitarioCentavos: 1_400 }],
      documento: "1234",
      fornecedor: "Distribuidora Sol",
      despesa: { vencimento: "2026-11-20", pago: false },
    });
    expect(r.totalCentavos).toBe(14_000);
    expect(await saldo(ids.cafe)).toEqual({ s: 20_000, c: 1_300 });
    const [d] = await db.select().from(despesas).where(eq(despesas.compraId, r.compraId));
    expect(d).toMatchObject({ valorCentavos: 14_000, status: "a_pagar", vencimento: "2026-11-20", descricao: "Compra de mercadorias · Distribuidora Sol · NF 1234" });
    const movs = await db.select().from(movimentosEstoque).where(eq(movimentosEstoque.compraId, r.compraId));
    expect(movs).toHaveLength(1);
  });
});

describe("caixa", () => {
  it("preço vem do cadastro, baixa estoque, guarda custo e lança a venda já conferida", async () => {
    const r = await registrarVendaCaixa(db, loja.id, eu.id, {
      itens: [
        { produtoId: ids.cafe, quantidadeMil: 2_000, precoUnitarioCentavos: 1 }, // o navegador mandou preço errado: ignorado
        { produtoId: ids.queijo, quantidadeMil: 500, descontoCentavos: 95 },
        { produtoId: ids.cafezinho, quantidadeMil: 1_000 },
        { produtoId: null, descricao: "Sacola", quantidadeMil: 1_000, precoUnitarioCentavos: 50 },
      ],
      descontoCentavos: 100,
      formaPagamento: "pix",
      clienteId: null,
      aReceber: false,
    });
    // 2 × 18,90 + 0,5 × 45,90 − 0,95 + 4,00 + 0,50 − 1,00 = 37,80 + 22,00 + 4,00 + 0,50 − 1,00 = 63,30
    expect(r.totalCentavos).toBe(6_330);
    expect(r.estoqueNegativo).toEqual([]);
    const [v] = await db.select().from(vendas).where(eq(vendas.id, r.vendaId));
    expect(v).toMatchObject({ origem: "balcao", status: "recebido", formaPagamento: "pix", valorCentavos: 6_330 });
    expect(v.conferidoEm).not.toBeNull();
    expect(v.descricao).toBe("Caixa: Café 500g e mais 3 itens");
    const itens = await db.select().from(vendaItens).where(eq(vendaItens.vendaId, r.vendaId));
    // O R$ 1,00 de desconto da venda é repartido pelos itens: a soma dos itens fecha o total.
    expect(itens.find((i) => i.descricao === "Café 500g")).toMatchObject({ precoUnitarioCentavos: 1_890, descontoVendaCentavos: 59, totalCentavos: 3_721, custoUnitarioCentavos: 1_300, custoTotalCentavos: 2_600 });
    expect(itens.find((i) => i.descricao === "Sacola")).toMatchObject({ produtoId: null, descontoVendaCentavos: 1, totalCentavos: 49 });
    expect(itens.reduce((t, i) => t + i.totalCentavos, 0)).toBe(6_330);
    expect(itens.reduce((t, i) => t + i.descontoVendaCentavos, 0)).toBe(100);
    expect((await saldo(ids.cafe)).s).toBe(18_000);
    expect((await saldo(ids.queijo)).s).toBe(2_500);
    expect(await db.select().from(movimentosEstoque).where(eq(movimentosEstoque.produtoId, ids.cafezinho))).toHaveLength(0);
  });

  it("dois caixas vendendo o mesmo produto ao mesmo tempo não perdem baixa", async () => {
    const vender = () => registrarVendaCaixa(db, loja.id, eu.id, { itens: [{ produtoId: ids.cafe, quantidadeMil: 1_000 }], descontoCentavos: 0, formaPagamento: "dinheiro", clienteId: null, aReceber: false });
    await Promise.all([vender(), vender(), vender()]);
    expect((await saldo(ids.cafe)).s).toBe(15_000);
  });

  it("vende além do saldo, mas avisa", async () => {
    const r = await registrarVendaCaixa(db, loja.id, eu.id, { itens: [{ produtoId: ids.queijo, quantidadeMil: 3_000 }], descontoCentavos: 0, formaPagamento: "credito", clienteId: null, aReceber: false });
    expect(r.estoqueNegativo).toEqual(["Queijo minas"]);
    expect((await saldo(ids.queijo)).s).toBe(-500);
    ids.vendaQueijo = r.vendaId;
  });

  it("fiado precisa de cliente e fica a receber", async () => {
    await expect(registrarVendaCaixa(db, loja.id, eu.id, { itens: [{ produtoId: ids.cafe, quantidadeMil: 1_000 }], descontoCentavos: 0, formaPagamento: "outro", clienteId: null, aReceber: true })).rejects.toThrow(ErroEstoque);
    const [c] = await db.insert(clientes).values({ empresaId: loja.id, nome: "Seu Zé" }).returning();
    const r = await registrarVendaCaixa(db, loja.id, eu.id, { itens: [{ produtoId: ids.cafe, quantidadeMil: 1_000 }], descontoCentavos: 0, formaPagamento: "outro", clienteId: c.id, aReceber: true });
    const [v] = await db.select().from(vendas).where(eq(vendas.id, r.vendaId));
    expect(v).toMatchObject({ status: "a_receber", clienteId: c.id });
  });

  it("cancelar devolve ao estoque e tira a venda do financeiro", async () => {
    await cancelarVendaCaixa(db, loja.id, ids.vendaQueijo, eu.id, "cliente desistiu");
    expect((await saldo(ids.queijo)).s).toBe(2_500);
    const [v] = await db.select().from(vendas).where(eq(vendas.id, ids.vendaQueijo));
    expect(v.excluidoEm).not.toBeNull();
    await expect(cancelarVendaCaixa(db, loja.id, ids.vendaQueijo, eu.id, "")).rejects.toThrow("já cancelada");
  });

  it("fechamento do dia por forma de pagamento", async () => {
    const c = await caixaDoDia(db, loja.id);
    expect(c.lista).toHaveLength(5);
    // Fiado é venda do dia, mas não entrou no caixa.
    expect(Object.fromEntries(c.porForma)).toEqual({ pix: 6_330, dinheiro: 5_670 });
    expect(c.total).toBe(13_890);
    expect(c.recebido).toBe(12_000);
    expect(c.aReceber).toBe(1_890);
    expect(c.lista.find((v) => v.valor === 6_330)?.itens).toBe(4);
  });
});

describe("inventário e perdas", () => {
  it("o saldo vira o contado e a diferença fica registrada", async () => {
    expect(await ajustarInventario(db, loja.id, eu.id, [{ produtoId: ids.cafe, contadoMil: 12_000 }, { produtoId: ids.queijo, contadoMil: 2_500 }])).toBe(1);
    expect((await saldo(ids.cafe)).s).toBe(12_000);
    const d = await obterProduto(db, loja.id, ids.cafe);
    expect(d?.movimentos[0]).toMatchObject({ tipo: "ajuste", quantidadeMil: -2_000, saldoAposMil: 12_000 });
  });

  it("perda tira do saldo", async () => {
    await registrarPerda(db, loja.id, eu.id, ids.queijo, 250, "venceu");
    expect((await saldo(ids.queijo)).s).toBe(2_250);
    await expect(registrarPerda(db, loja.id, eu.id, ids.queijo, 0, "")).rejects.toThrow(ErroEstoque);
  });
});

describe("importação", () => {
  it("atualiza quem tem o mesmo código e cria os novos", async () => {
    const { produtos: lista } = produtosDoCsv(["produto;ean;preco;custo;estoque;minimo", "Café 500g;7891000315507;19,90;13,00;20;5", "Açúcar 1kg;7896000000001;5,49;3,80;40;10"].join("\n"));
    expect(await importarProdutos(db, loja.id, eu.id, lista)).toEqual({ novos: 1, atualizados: 1 });
    const [cafe] = await db.select().from(produtos).where(eq(produtos.id, ids.cafe));
    expect(cafe).toMatchObject({ precoCentavos: 1_990, saldoMil: 20_000 });
    const [acucar] = await db.select().from(produtos).where(and(eq(produtos.empresaId, loja.id), eq(produtos.nome, "Açúcar 1kg")));
    expect(acucar).toMatchObject({ saldoMil: 40_000, custoMedioCentavos: 380, minimoMil: 10_000 });
  });
});

describe("painel", () => {
  it("valor em estoque, giro, margem e o que repor", async () => {
    await registrarVendaCaixa(db, loja.id, eu.id, { itens: [{ produtoId: ids.cafe, quantidadeMil: 16_000 }], descontoCentavos: 0, formaPagamento: "pix", clienteId: null, aReceber: false });
    const p = await painelEstoque(db, loja.id);
    expect(p.produtosAtivos).toBe(4);
    expect(p.repor).toBe(1); // café: 4 un, mínimo 5
    expect(p.comprar.map((x) => x.nome)).toContain("Café 500g");
    expect(p.maisVendidos[0]).toMatchObject({ nome: "Café 500g", classe: "A" });
    expect(p.vendas30d.receita).toBeGreaterThan(p.vendas30d.custo);
    expect(p.recentes[0].tipo).toBe("venda");
    expect((await listarProdutos(db, loja.id, { filtro: "repor" })).map((x) => x.nome)).toEqual(["Café 500g"]);
    expect((await listarProdutos(db, loja.id, { busca: "7896000000001" })).map((x) => x.nome)).toEqual(["Açúcar 1kg"]);
  });
});

// ─── Achados da auditoria (11/11/2026) ───────────────────────────────────────

describe("auditoria: caixa confiável", () => {
  const venda = (extra: Partial<Parameters<typeof registrarVendaCaixa>[3]> = {}) => ({
    itens: [{ produtoId: ids.cem, quantidadeMil: 1_000 }],
    descontoCentavos: 0,
    formaPagamento: "dinheiro" as const,
    clienteId: null,
    aReceber: false,
    ...extra,
  });

  beforeAll(async () => {
    ids.cem = await salvarProduto(db, loja.id, null, base("Produto de cem", { precoCentavos: 10_000 }), eu.id, { saldoMil: 10_000, custoCentavos: 6_000 });
  });

  it("F01: dinheiro entregue menor que o total é recusado sem gravar nada", async () => {
    const antes = await db.select({ id: vendas.id }).from(vendas).where(eq(vendas.empresaId, loja.id));
    await expect(registrarVendaCaixa(db, loja.id, eu.id, venda({ descontoCentavos: 2_000, valorEntregueCentavos: 1_000 }))).rejects.toThrow("Faltam R$");
    expect(await db.select({ id: vendas.id }).from(vendas).where(eq(vendas.empresaId, loja.id))).toHaveLength(antes.length);
    expect((await saldo(ids.cem)).s).toBe(10_000);
  });

  it("F01/F03: R$ 100 entregues numa venda de R$ 80 geram R$ 20 de troco, e a receita é R$ 80", async () => {
    const r = await registrarVendaCaixa(db, loja.id, eu.id, venda({ descontoCentavos: 2_000, valorEntregueCentavos: 10_000 }));
    expect(r).toMatchObject({ totalCentavos: 8_000, trocoCentavos: 2_000 });
    const [v] = await db.select().from(vendas).where(eq(vendas.id, r.vendaId));
    expect(v).toMatchObject({ valorCentavos: 8_000, valorEntregueCentavos: 10_000, trocoCentavos: 2_000 });
    const [item] = await db.select().from(vendaItens).where(eq(vendaItens.vendaId, r.vendaId));
    // O item carrega a receita líquida (R$ 80), não o preço cheio: margem de 25%, não 40%.
    expect(item).toMatchObject({ totalCentavos: 8_000, descontoVendaCentavos: 2_000, custoTotalCentavos: 6_000 });
    expect((await saldo(ids.cem)).s).toBe(9_000);
  });

  it("F03: desconto de 1 centavo em vários itens fecha a soma", async () => {
    const r = await registrarVendaCaixa(
      db,
      loja.id,
      eu.id,
      venda({ itens: [ids.cem, ids.cem, ids.cem].map((produtoId) => ({ produtoId, quantidadeMil: 1_000 })), descontoCentavos: 1, formaPagamento: "pix" }),
    );
    const itens = await db.select().from(vendaItens).where(eq(vendaItens.vendaId, r.vendaId));
    expect(itens.reduce((t, i) => t + i.totalCentavos, 0)).toBe(r.totalCentavos);
    expect(r.totalCentavos).toBe(29_999);
  });

  it("F04: 20 envios da mesma chave ao mesmo tempo viram uma venda e uma baixa", async () => {
    const antes = (await saldo(ids.cem)).s;
    const chave = crypto.randomUUID();
    const rs = await Promise.all(Array.from({ length: 20 }, () => registrarVendaCaixa(db, loja.id, eu.id, venda({ chave, formaPagamento: "pix" }))));
    expect(new Set(rs.map((r) => r.vendaId)).size).toBe(1);
    expect(await db.select().from(vendas).where(and(eq(vendas.empresaId, loja.id), eq(vendas.chaveIdempotencia, chave)))).toHaveLength(1);
    expect((await saldo(ids.cem)).s).toBe(antes - 1_000);
    // A resposta se perdeu e o caixa manda de novo: devolve a mesma venda, sem baixar outra vez.
    const deNovo = await registrarVendaCaixa(db, loja.id, eu.id, venda({ chave, formaPagamento: "pix" }));
    expect(deNovo).toMatchObject({ vendaId: rs[0].vendaId, repetida: true });
    expect((await saldo(ids.cem)).s).toBe(antes - 1_000);
    // Mesma chave com outro carrinho é conflito.
    await expect(registrarVendaCaixa(db, loja.id, eu.id, venda({ chave, formaPagamento: "pix", itens: [{ produtoId: ids.cem, quantidadeMil: 2_000 }] }))).rejects.toThrow("outro carrinho");
  });

  it("F11: produto desativado, meia unidade e troca de unidade são barrados no servidor", async () => {
    const id = await salvarProduto(db, loja.id, null, base("Some amanhã"), eu.id, { saldoMil: 5_000, custoCentavos: 100 });
    await expect(registrarVendaCaixa(db, loja.id, eu.id, venda({ itens: [{ produtoId: id, quantidadeMil: 500 }], formaPagamento: "pix" }))).rejects.toThrow("quantidade inteira");
    await expect(salvarProduto(db, loja.id, id, base("Some amanhã", { unidade: "kg" }), eu.id)).rejects.toThrow("unidade não muda");
    await salvarProduto(db, loja.id, id, base("Some amanhã", { ativo: false }), eu.id);
    await expect(registrarVendaCaixa(db, loja.id, eu.id, venda({ itens: [{ produtoId: id, quantidadeMil: 1_000 }], formaPagamento: "pix" }))).rejects.toThrow("desativado");
    await expect(registrarPerda(db, loja.id, eu.id, id, 500, "")).rejects.toThrow("quantidade inteira");
  });

  it("F13: o cartão “Para repor” e o filtro mostram a mesma população", async () => {
    await salvarProduto(db, loja.id, null, base("Zerado", { minimoMil: 2_000 }), eu.id);
    const p = await painelEstoque(db, loja.id);
    const filtro = await listarProdutos(db, loja.id, { filtro: "repor" });
    expect(p.repor).toBe(filtro.length);
    expect(p.repor).toBe(p.abaixoMinimo + p.semEstoque);
    expect(await contarProdutos(db, loja.id, { filtro: "repor" })).toBe(filtro.length);
  });

  it("F12: planilha só com preço não mexe no saldo", async () => {
    await salvarProduto(db, loja.id, ids.cem, base("Produto de cem", { precoCentavos: 10_000, sku: "CEM" }), eu.id);
    const antes = (await saldo(ids.cem)).s;
    const { produtos: lista, erros } = produtosDoCsv("nome;sku;preco\nProduto de cem;CEM;110,00");
    expect(erros).toEqual([]);
    expect(await importarProdutos(db, loja.id, eu.id, lista)).toEqual({ novos: 0, atualizados: 1 });
    const [p] = await db.select().from(produtos).where(eq(produtos.id, ids.cem));
    expect(p).toMatchObject({ precoCentavos: 11_000, saldoMil: antes });
  });
});
