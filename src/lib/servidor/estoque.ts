import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { categoriasDespesa, clientes, despesas, fontesReceita, movimentosEstoque, produtos, vendaItens, vendas, type FormaPagamento, type TipoMovimento, type Unidade } from "@/db/schema";
import { hoje, somarDias } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { MIL, UNIDADES, curvaABC, custoDaQuantidade, novoCustoMedio, quantidadeCabe, ratearDesconto, situacao, sugestaoDeCompra, totalDoItem, valorEmEstoque, type ProdutoImportado } from "@/lib/estoque";
import { registrarAuditoria } from "./auditoria";

/**
 * Estoque e caixa. Todo saldo muda por `movimentar`, dentro de uma transação e com a linha do
 * produto travada (FOR UPDATE): dois caixas vendendo o mesmo item ao mesmo tempo não se atropelam.
 */

type Tx = Parameters<Parameters<BancoDeDados["transaction"]>[0]>[0];

export class ErroEstoque extends Error {}

interface Movimento {
  empresaId: string;
  produtoId: string;
  tipo: TipoMovimento;
  quantidadeMil: number;
  custoUnitarioCentavos?: number | null;
  vendaId?: string | null;
  compraId?: string | null;
  documento?: string | null;
  observacao?: string;
  usuarioId: string | null;
}

async function movimentar(tx: Tx, m: Movimento) {
  const [p] = await tx
    .select()
    .from(produtos)
    .where(and(eq(produtos.id, m.produtoId), eq(produtos.empresaId, m.empresaId), isNull(produtos.excluidoEm)))
    .for("update");
  if (!p) throw new ErroEstoque("Produto não encontrado.");
  // A unidade vem do cadastro, não de quem chamou: "un" não anda em meia unidade.
  if (m.tipo !== "ajuste" && !quantidadeCabe(Math.abs(m.quantidadeMil), p.unidade))
    throw new ErroEstoque(`${p.nome} é vendido em ${UNIDADES[p.unidade].nome.toLowerCase()}: use quantidade inteira.`);
  const saldo = p.saldoMil + m.quantidadeMil;
  const custo =
    m.tipo === "entrada" && m.custoUnitarioCentavos != null ? novoCustoMedio(p.saldoMil, p.custoMedioCentavos, m.quantidadeMil, m.custoUnitarioCentavos) : p.custoMedioCentavos;
  await tx
    .update(produtos)
    .set({ saldoMil: saldo, custoMedioCentavos: custo, ...(m.tipo === "venda" ? { ultimaVendaEm: new Date() } : {}), atualizadoEm: new Date() })
    .where(eq(produtos.id, p.id));
  await tx.insert(movimentosEstoque).values({
    empresaId: m.empresaId,
    produtoId: p.id,
    tipo: m.tipo,
    quantidadeMil: m.quantidadeMil,
    custoUnitarioCentavos: m.custoUnitarioCentavos ?? null,
    saldoAposMil: saldo,
    custoMedioAposCentavos: custo,
    vendaId: m.vendaId ?? null,
    compraId: m.compraId ?? null,
    documento: m.documento ?? null,
    observacao: m.observacao ?? "",
    usuarioId: m.usuarioId,
  });
  return { antes: p, saldo, custo };
}

// ─── Produtos ────────────────────────────────────────────────────────────────

export interface DadosProduto {
  nome: string;
  sku: string | null;
  codigoBarras: string | null;
  categoria: string;
  unidade: Unidade;
  precoCentavos: number;
  minimoMil: number;
  controlaEstoque: boolean;
  ativo: boolean;
}

function codigoRepetido(e: unknown) {
  const causa = (e instanceof Error && e.cause ? e.cause : e) as { constraint_name?: string };
  if (causa?.constraint_name === "produtos_codigo_uq") return "Já existe um produto com este código de barras.";
  if (causa?.constraint_name === "produtos_sku_uq") return "Já existe um produto com este código interno (SKU).";
  return null;
}

/** Cadastra ou altera. No cadastro, saldo e custo iniciais entram como a primeira entrada. */
export async function salvarProduto(
  db: BancoDeDados,
  empresaId: string,
  id: string | null,
  dados: DadosProduto,
  usuarioId: string,
  inicial?: { saldoMil: number; custoCentavos: number },
) {
  try {
    return await db.transaction(async (tx) => {
      if (id) {
        const [atual] = await tx
          .select({ unidade: produtos.unidade })
          .from(produtos)
          .where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm)))
          .for("update");
        if (!atual) throw new ErroEstoque("Produto não encontrado.");
        if (atual.unidade !== dados.unidade) {
          const [mov] = await tx.select({ id: movimentosEstoque.id }).from(movimentosEstoque).where(and(eq(movimentosEstoque.empresaId, empresaId), eq(movimentosEstoque.produtoId, id))).limit(1);
          if (mov) throw new ErroEstoque("A unidade não muda depois que o produto já teve entrada ou venda. Cadastre outro produto para a nova unidade.");
        }
        const [p] = await tx
          .update(produtos)
          .set({ ...dados, atualizadoEm: new Date() })
          .where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm)))
          .returning({ id: produtos.id });
        if (!p) throw new ErroEstoque("Produto não encontrado.");
        return p.id;
      }
      const [p] = await tx
        .insert(produtos)
        .values({ ...dados, empresaId, custoMedioCentavos: inicial?.custoCentavos ?? 0, criadoPor: usuarioId })
        .returning({ id: produtos.id });
      if (inicial && inicial.saldoMil > 0)
        await movimentar(tx, { empresaId, produtoId: p.id, tipo: "entrada", quantidadeMil: inicial.saldoMil, custoUnitarioCentavos: inicial.custoCentavos, observacao: "Saldo inicial", usuarioId });
      return p.id;
    });
  } catch (e) {
    const msg = codigoRepetido(e);
    if (msg) throw new ErroEstoque(msg);
    throw e;
  }
}

export async function excluirProduto(db: BancoDeDados, empresaId: string, id: string) {
  await db.update(produtos).set({ excluidoEm: new Date(), ativo: false }).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
}

export type FiltroProdutos = "todos" | "repor" | "sem_estoque" | "parados" | "inativos";

const vendidoNoPeriodo = (dias: number) => sql<number>`(
  select coalesce(sum(vi.quantidade_mil), 0)::bigint from ${vendaItens} vi join ${vendas} v on v.id = vi.venda_id
  where vi.produto_id = "produtos"."id" and vi.empresa_id = "produtos"."empresa_id" and v.excluido_em is null and v.data >= ${somarDias(hoje(), -dias)})`;

function filtroDeProdutos(empresaId: string, o: { busca?: string; filtro?: FiltroProdutos; categoria?: string }) {
  const termo = o.busca?.trim() ?? "";
  const filtro = o.filtro ?? "todos";
  return and(
    eq(produtos.empresaId, empresaId),
    isNull(produtos.excluidoEm),
    filtro === "inativos" ? eq(produtos.ativo, false) : eq(produtos.ativo, true),
    // "Para repor" = abaixo do mínimo ou sem estoque: o mesmo número que o cartão mostra.
    filtro === "repor" ? sql`${produtos.controlaEstoque} and (${produtos.saldoMil} <= 0 or (${produtos.minimoMil} > 0 and ${produtos.saldoMil} <= ${produtos.minimoMil}))` : undefined,
    filtro === "sem_estoque" ? sql`${produtos.controlaEstoque} and ${produtos.saldoMil} <= 0` : undefined,
    filtro === "parados" ? sql`${produtos.saldoMil} > 0 and (${produtos.ultimaVendaEm} is null or ${produtos.ultimaVendaEm} < now() - interval '60 days')` : undefined,
    o.categoria ? eq(produtos.categoria, o.categoria) : undefined,
    termo ? or(ilike(produtos.nome, `%${termo}%`), eq(produtos.codigoBarras, termo), ilike(produtos.sku, `${termo}%`)) : undefined,
  );
}

export const PRODUTOS_POR_PAGINA = 200;

/** Quantos produtos o filtro acha (para "mostrando 200 de 1.340"). */
export async function contarProdutos(db: BancoDeDados, empresaId: string, o: { busca?: string; filtro?: FiltroProdutos; categoria?: string } = {}) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(produtos).where(filtroDeProdutos(empresaId, o));
  return r.n;
}

export async function listarProdutos(
  db: BancoDeDados,
  empresaId: string,
  o: { busca?: string; filtro?: FiltroProdutos; categoria?: string; pagina?: number; porPagina?: number } = {},
) {
  const porPagina = Math.min(Math.max(o.porPagina ?? PRODUTOS_POR_PAGINA, 1), 500);
  const pagina = Math.max(1, Math.floor(o.pagina ?? 1));
  const linhas = await db
    .select({
      id: produtos.id,
      nome: produtos.nome,
      sku: produtos.sku,
      codigoBarras: produtos.codigoBarras,
      categoria: produtos.categoria,
      unidade: produtos.unidade,
      precoCentavos: produtos.precoCentavos,
      custoMedioCentavos: produtos.custoMedioCentavos,
      saldoMil: produtos.saldoMil,
      minimoMil: produtos.minimoMil,
      controlaEstoque: produtos.controlaEstoque,
      ativo: produtos.ativo,
      ultimaVendaEm: produtos.ultimaVendaEm,
      vendido30dMil: vendidoNoPeriodo(30),
    })
    .from(produtos)
    .where(filtroDeProdutos(empresaId, o))
    .orderBy(asc(produtos.nome), asc(produtos.id))
    .limit(porPagina)
    .offset((pagina - 1) * porPagina);
  return linhas.map((l) => ({ ...l, vendido30dMil: Number(l.vendido30dMil), situacao: situacao(l) }));
}

export async function categoriasDeProdutos(db: BancoDeDados, empresaId: string) {
  const linhas = await db
    .selectDistinct({ categoria: produtos.categoria })
    .from(produtos)
    .where(and(eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm), sql`${produtos.categoria} <> ''`))
    .orderBy(asc(produtos.categoria));
  return linhas.map((l) => l.categoria);
}

export async function obterProduto(db: BancoDeDados, empresaId: string, id: string) {
  const [p] = await db.select().from(produtos).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm)));
  if (!p) return null;
  const [movs, [vendido]] = await Promise.all([
    db
      .select()
      .from(movimentosEstoque)
      .where(and(eq(movimentosEstoque.empresaId, empresaId), eq(movimentosEstoque.produtoId, id)))
      .orderBy(desc(movimentosEstoque.criadoEm))
      .limit(100),
    db
      .select({
        quantidade: sql<number>`coalesce(sum(${vendaItens.quantidadeMil}), 0)::bigint`,
        receita: sql<number>`coalesce(sum(${vendaItens.totalCentavos}), 0)::bigint`,
        custo: sql<number>`coalesce(sum(${vendaItens.custoTotalCentavos}), 0)::bigint`,
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
      .where(and(eq(vendaItens.empresaId, empresaId), eq(vendaItens.produtoId, id), isNull(vendas.excluidoEm), gte(vendas.data, somarDias(hoje(), -30)))),
  ]);
  return {
    produto: p,
    situacao: situacao(p),
    movimentos: movs,
    vendido30d: { quantidadeMil: Number(vendido.quantidade), receitaCentavos: Number(vendido.receita), custoCentavos: Number(vendido.custo) },
  };
}

/** O leitor de código de barras manda o código: acha pelo EAN ou pelo código interno. */
export async function acharPorCodigo(db: BancoDeDados, empresaId: string, codigo: string) {
  const c = codigo.trim();
  if (!c) return null;
  const [p] = await db
    .select()
    .from(produtos)
    .where(and(eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm), eq(produtos.ativo, true), or(eq(produtos.codigoBarras, c), eq(produtos.sku, c))))
    .limit(1);
  return p ?? null;
}

/** Para o caixa: os produtos que mais saem primeiro (os botões de toque rápido). */
export async function produtosDoCaixa(db: BancoDeDados, empresaId: string) {
  const linhas = await db
    .select({
      id: produtos.id,
      nome: produtos.nome,
      codigoBarras: produtos.codigoBarras,
      sku: produtos.sku,
      categoria: produtos.categoria,
      unidade: produtos.unidade,
      precoCentavos: produtos.precoCentavos,
      saldoMil: produtos.saldoMil,
      controlaEstoque: produtos.controlaEstoque,
      vendido30dMil: vendidoNoPeriodo(30),
    })
    .from(produtos)
    .where(and(eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm), eq(produtos.ativo, true)))
    .orderBy(desc(vendidoNoPeriodo(30)), asc(produtos.nome), asc(produtos.id))
    .limit(LIMITE_CAIXA);
  return linhas.map((l) => ({ ...l, vendido30dMil: Number(l.vendido30dMil) }));
}

/** O caixa carrega os que mais saem; o resto do catálogo é buscado no servidor (buscarNoCaixa). */
export const LIMITE_CAIXA = 400;

/** Busca do caixa no catálogo inteiro: código exato (EAN/SKU) primeiro, depois pelo nome. */
export async function buscarNoCaixa(db: BancoDeDados, empresaId: string, termo: string) {
  const t = termo.trim().slice(0, 80);
  if (!t) return [];
  return db
    .select({
      id: produtos.id,
      nome: produtos.nome,
      codigoBarras: produtos.codigoBarras,
      sku: produtos.sku,
      categoria: produtos.categoria,
      unidade: produtos.unidade,
      precoCentavos: produtos.precoCentavos,
      saldoMil: produtos.saldoMil,
      controlaEstoque: produtos.controlaEstoque,
      vendido30dMil: sql<number>`0`.mapWith(Number),
    })
    .from(produtos)
    .where(and(eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm), eq(produtos.ativo, true), or(eq(produtos.codigoBarras, t), eq(produtos.sku, t), ilike(produtos.nome, `%${t}%`))))
    .orderBy(sql`(${produtos.codigoBarras} = ${t} or ${produtos.sku} = ${t}) desc`, asc(produtos.nome))
    .limit(30);
}

// ─── Movimentos da equipe ────────────────────────────────────────────────────

export interface LinhaDeEntrada {
  produtoId: string;
  quantidadeMil: number;
  custoUnitarioCentavos: number;
}

/**
 * Chegou mercadoria: soma ao saldo, recalcula o custo médio e, se pedido, lança a compra nas
 * despesas ("Produtos e mercadorias"), paga ou a pagar, ligada pela mesma compra.
 */
export async function registrarEntrada(
  db: BancoDeDados,
  empresaId: string,
  usuarioId: string,
  e: { linhas: LinhaDeEntrada[]; documento: string | null; fornecedor: string | null; despesa: null | { vencimento: string; pago: boolean } },
) {
  if (!e.linhas.length) throw new ErroEstoque("Adicione pelo menos um produto.");
  if (e.linhas.some((l) => l.quantidadeMil <= 0 || l.custoUnitarioCentavos < 0)) throw new ErroEstoque("Quantidades e custos precisam ser positivos.");
  const compraId = crypto.randomUUID();
  const total = e.linhas.reduce((s, l) => s + totalDoItem(l.quantidadeMil, l.custoUnitarioCentavos), 0);
  await db.transaction(async (tx) => {
    for (const l of e.linhas)
      await movimentar(tx, {
        empresaId,
        produtoId: l.produtoId,
        tipo: "entrada",
        quantidadeMil: l.quantidadeMil,
        custoUnitarioCentavos: l.custoUnitarioCentavos,
        compraId,
        documento: e.documento,
        observacao: e.fornecedor ? `Fornecedor: ${e.fornecedor}` : "",
        usuarioId,
      });
    if (e.despesa && total > 0) {
      const [cat] = await tx
        .select({ id: categoriasDespesa.id })
        .from(categoriasDespesa)
        .where(and(eq(categoriasDespesa.empresaId, empresaId), eq(categoriasDespesa.chaveSistema, "mercadorias")))
        .limit(1);
      if (!cat) throw new ErroEstoque("A empresa não tem a categoria de despesa “Produtos e mercadorias”.");
      const dia = hoje();
      await tx.insert(despesas).values({
        empresaId,
        data: dia,
        valorCentavos: total,
        descricao: ["Compra de mercadorias", e.fornecedor, e.documento ? `NF ${e.documento}` : null].filter(Boolean).join(" · "),
        categoriaId: cat.id,
        status: e.despesa.pago ? "pago" : "a_pagar",
        vencimento: e.despesa.pago ? dia : e.despesa.vencimento,
        pagoEm: e.despesa.pago ? dia : null,
        compraId,
        criadoPor: usuarioId,
      });
    }
  });
  return { compraId, totalCentavos: total };
}

/** Contagem do inventário: o saldo passa a ser o contado, e a diferença fica registrada. */
export async function ajustarInventario(db: BancoDeDados, empresaId: string, usuarioId: string, contagens: { produtoId: string; contadoMil: number }[], observacao = "") {
  let ajustados = 0;
  await db.transaction(async (tx) => {
    for (const c of contagens) {
      if (c.contadoMil < 0) throw new ErroEstoque("A contagem não pode ser negativa.");
      const [p] = await tx.select({ saldo: produtos.saldoMil }).from(produtos).where(and(eq(produtos.id, c.produtoId), eq(produtos.empresaId, empresaId))).for("update");
      if (!p) throw new ErroEstoque("Produto não encontrado.");
      const diferenca = c.contadoMil - p.saldo;
      if (diferenca === 0) continue;
      await movimentar(tx, { empresaId, produtoId: c.produtoId, tipo: "ajuste", quantidadeMil: diferenca, observacao: observacao || "Contagem de inventário", usuarioId });
      ajustados++;
    }
  });
  return ajustados;
}

export async function registrarPerda(db: BancoDeDados, empresaId: string, usuarioId: string, produtoId: string, quantidadeMil: number, motivo: string) {
  if (quantidadeMil <= 0) throw new ErroEstoque("Informe quanto foi perdido.");
  return db.transaction((tx) => movimentar(tx, { empresaId, produtoId, tipo: "perda", quantidadeMil: -quantidadeMil, observacao: motivo || "Perda", usuarioId }));
}

// ─── Caixa ───────────────────────────────────────────────────────────────────

export interface ItemDoCaixa {
  /** Sem produto = item avulso digitado na hora (precisa de descrição e preço). */
  produtoId: string | null;
  descricao?: string;
  quantidadeMil: number;
  precoUnitarioCentavos?: number;
  descontoCentavos?: number;
}

export interface VendaDoCaixa {
  itens: ItemDoCaixa[];
  descontoCentavos: number;
  formaPagamento: FormaPagamento;
  clienteId: string | null;
  /** Fiado: fica a receber no financeiro. */
  aReceber: boolean;
  /** Dinheiro: quanto o cliente entregou. Vazio = o valor exato. Menos que o total é recusado. */
  valorEntregueCentavos?: number | null;
  /** Uma por carrinho, gerada no navegador: repetir o envio devolve a mesma venda. */
  chave?: string | null;
}

export interface VendaFeita {
  vendaId: string;
  totalCentavos: number;
  trocoCentavos: number | null;
  estoqueNegativo: string[];
  /** true quando a chave já tinha sido usada: nada novo foi gravado. */
  repetida?: boolean;
}

function hashDoPedido(v: VendaDoCaixa) {
  const resumo = {
    i: v.itens.map((i) => [i.produtoId, i.produtoId ? null : (i.descricao?.trim() ?? null), i.quantidadeMil, i.produtoId ? null : (i.precoUnitarioCentavos ?? 0), i.descontoCentavos ?? 0]),
    d: v.descontoCentavos,
    f: v.formaPagamento,
    c: v.clienteId,
    r: v.aReceber,
    e: v.valorEntregueCentavos ?? null,
  };
  return createHash("sha256").update(JSON.stringify(resumo)).digest("hex");
}

async function vendaDaChave(db: BancoDeDados | Tx, empresaId: string, chave: string, hash: string): Promise<VendaFeita | null> {
  const [v] = await db
    .select({ id: vendas.id, valor: vendas.valorCentavos, hash: vendas.pedidoHash, troco: vendas.trocoCentavos })
    .from(vendas)
    .where(and(eq(vendas.empresaId, empresaId), eq(vendas.chaveIdempotencia, chave)));
  if (!v) return null;
  if (v.hash !== hash) throw new ErroEstoque("Esta venda já foi registrada com outro carrinho. Recarregue o caixa antes de continuar.");
  return { vendaId: v.id, totalCentavos: v.valor, trocoCentavos: v.troco, estoqueNegativo: [], repetida: true };
}

const restricaoDe = (e: unknown) => {
  for (let c: unknown = e; c; c = (c as { cause?: unknown }).cause) {
    const nome = (c as { constraint_name?: string }).constraint_name;
    if (nome) return nome;
  }
  return null;
};

/**
 * Fecha uma venda do caixa: preço vem do cadastro (não do navegador), baixa o estoque de quem
 * controla, grava os itens com o custo do momento e lança a venda no financeiro já conferida.
 */
export async function registrarVendaCaixa(db: BancoDeDados, empresaId: string, usuarioId: string, v: VendaDoCaixa): Promise<VendaFeita> {
  if (!v.itens.length) throw new ErroEstoque("O carrinho está vazio.");
  if (v.itens.some((i) => !Number.isSafeInteger(i.quantidadeMil) || i.quantidadeMil <= 0)) throw new ErroEstoque("Quantidade inválida no carrinho.");
  if (v.aReceber && !v.clienteId) throw new ErroEstoque("Venda fiado precisa de cliente.");
  if (v.valorEntregueCentavos != null && (!Number.isSafeInteger(v.valorEntregueCentavos) || v.valorEntregueCentavos < 0)) throw new ErroEstoque("Valor entregue inválido.");
  const chave = v.chave?.trim() || null;
  const hash = chave ? hashDoPedido(v) : null;
  if (chave && hash) {
    const anterior = await vendaDaChave(db, empresaId, chave, hash);
    if (anterior) return anterior;
  }
  try {
    return await gravarVendaCaixa(db, empresaId, usuarioId, v, chave, hash);
  } catch (e) {
    // Dois envios da mesma chave ao mesmo tempo: o segundo esbarra no índice único e devolve o primeiro.
    if (chave && hash && restricaoDe(e) === "vendas_chave_uq") {
      const anterior = await vendaDaChave(db, empresaId, chave, hash);
      if (anterior) return anterior;
    }
    throw e;
  }
}

async function gravarVendaCaixa(db: BancoDeDados, empresaId: string, usuarioId: string, v: VendaDoCaixa, chave: string | null, hash: string | null): Promise<VendaFeita> {
  return db.transaction(async (tx) => {
    const ids = [...new Set(v.itens.flatMap((i) => (i.produtoId ? [i.produtoId] : [])))];
    const cadastro = ids.length
      ? await tx.select().from(produtos).where(and(eq(produtos.empresaId, empresaId), inArray(produtos.id, ids), isNull(produtos.excluidoEm)))
      : [];
    const porId = new Map(cadastro.map((p) => [p.id, p]));
    const linhas = v.itens.map((i) => {
      const p = i.produtoId ? porId.get(i.produtoId) : null;
      if (i.produtoId && !p) throw new ErroEstoque("Um produto do carrinho não existe mais.");
      if (p && !p.ativo) throw new ErroEstoque(`${p.nome} foi desativado e não pode ser vendido. Tire do carrinho.`);
      if (p && !quantidadeCabe(i.quantidadeMil, p.unidade)) throw new ErroEstoque(`${p.nome} é vendido em ${UNIDADES[p.unidade].nome.toLowerCase()}: use quantidade inteira.`);
      const descricao = p?.nome ?? i.descricao?.trim();
      const preco = p?.precoCentavos ?? i.precoUnitarioCentavos ?? 0;
      if (!descricao) throw new ErroEstoque("Item avulso precisa de descrição.");
      const desconto = Math.min(i.descontoCentavos ?? 0, totalDoItem(i.quantidadeMil, preco));
      return { p, descricao, quantidadeMil: i.quantidadeMil, preco, desconto, total: totalDoItem(i.quantidadeMil, preco, desconto) };
    });
    // O desconto da venda inteira é repartido entre os itens: a soma dos itens é o total da venda.
    const partes = ratearDesconto(
      linhas.map((l) => l.total),
      v.descontoCentavos,
    );
    const total = linhas.reduce((s, l, k) => s + l.total - partes[k], 0);
    if (total <= 0) throw new ErroEstoque("O total da venda precisa ser maior que zero.");

    // Dinheiro: o que o cliente entregou precisa cobrir a venda. Troco não é receita.
    let entregue: number | null = null;
    let trocoVenda: number | null = null;
    if (v.formaPagamento === "dinheiro" && !v.aReceber) {
      entregue = v.valorEntregueCentavos ?? total;
      if (entregue < total) throw new ErroEstoque(`O cliente entregou ${formatarReais(entregue)} e a venda é ${formatarReais(total)}. Faltam ${formatarReais(total - entregue)}.`);
      trocoVenda = entregue - total;
    }

    if (v.clienteId) {
      const [c] = await tx.select({ id: clientes.id }).from(clientes).where(and(eq(clientes.id, v.clienteId), eq(clientes.empresaId, empresaId), isNull(clientes.excluidoEm)));
      if (!c) throw new ErroEstoque("Cliente não encontrado.");
    }
    const [fonte] = await tx
      .select({ id: fontesReceita.id })
      .from(fontesReceita)
      .where(and(eq(fontesReceita.empresaId, empresaId), eq(fontesReceita.ativo, true)))
      .orderBy(sql`(${fontesReceita.nome} ~* '(balc|loja|caixa|pdv)') desc`, asc(fontesReceita.ordem))
      .limit(1);
    if (!fonte) throw new ErroEstoque("Cadastre uma fonte de receita antes de vender.");

    const dia = hoje();
    const resumo = linhas.length === 1 ? linhas[0].descricao : `${linhas[0].descricao} e mais ${linhas.length - 1} ${linhas.length === 2 ? "item" : "itens"}`;
    const [venda] = await tx
      .insert(vendas)
      .values({
        empresaId,
        data: dia,
        valorCentavos: total,
        descricao: `Caixa: ${resumo}`.slice(0, 300),
        fonteReceitaId: fonte.id,
        formaPagamento: v.formaPagamento,
        status: v.aReceber ? "a_receber" : "recebido",
        dataRecebimento: v.aReceber ? somarDias(dia, 30) : dia,
        clienteId: v.clienteId,
        origem: "balcao",
        chaveIdempotencia: chave,
        pedidoHash: hash,
        valorEntregueCentavos: entregue,
        trocoCentavos: trocoVenda,
        criadoPor: usuarioId,
      })
      .returning({ id: vendas.id });

    // Baixa na ordem dos ids: dois caixas com carrinhos parecidos travam os produtos na mesma
    // ordem e não ficam um esperando o outro.
    const alertas: string[] = [];
    const custos = new Map<number, number>();
    const ordem = linhas.map((l, k) => ({ l, k })).sort((a, b) => (a.l.p?.id ?? "").localeCompare(b.l.p?.id ?? ""));
    for (const { l, k } of ordem) {
      let custo = l.p?.custoMedioCentavos ?? 0;
      if (l.p?.controlaEstoque) {
        const r = await movimentar(tx, { empresaId, produtoId: l.p.id, tipo: "venda", quantidadeMil: -l.quantidadeMil, vendaId: venda.id, usuarioId });
        custo = r.custo;
        if (r.saldo < 0) alertas.push(l.p.nome);
      } else if (l.p) {
        await tx.update(produtos).set({ ultimaVendaEm: new Date() }).where(eq(produtos.id, l.p.id));
      }
      custos.set(k, custo);
    }
    await tx.insert(vendaItens).values(
      linhas.map((l, k) => ({
        empresaId,
        vendaId: venda.id,
        produtoId: l.p?.id ?? null,
        descricao: l.descricao,
        quantidadeMil: l.quantidadeMil,
        precoUnitarioCentavos: l.preco,
        descontoCentavos: l.desconto,
        descontoVendaCentavos: partes[k],
        totalCentavos: l.total - partes[k],
        custoUnitarioCentavos: custos.get(k) ?? 0,
        custoTotalCentavos: custoDaQuantidade(l.quantidadeMil, custos.get(k) ?? 0),
      })),
    );
    return { vendaId: venda.id, totalCentavos: total, trocoCentavos: trocoVenda, estoqueNegativo: alertas };
  });
}

/** Desfaz uma venda do caixa: devolve ao estoque o que saiu e tira a venda do financeiro. */
export async function cancelarVendaCaixa(db: BancoDeDados, empresaId: string, vendaId: string, usuarioId: string, motivo: string) {
  await db.transaction(async (tx) => {
    const [v] = await tx
      .update(vendas)
      .set({ excluidoEm: new Date() })
      .where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId), eq(vendas.origem, "balcao"), isNull(vendas.excluidoEm)))
      .returning({ id: vendas.id, valor: vendas.valorCentavos });
    if (!v) throw new ErroEstoque("Venda não encontrada ou já cancelada.");
    const saidas = await tx
      .select({ produtoId: movimentosEstoque.produtoId, quantidade: movimentosEstoque.quantidadeMil })
      .from(movimentosEstoque)
      .where(and(eq(movimentosEstoque.empresaId, empresaId), eq(movimentosEstoque.vendaId, vendaId), eq(movimentosEstoque.tipo, "venda")));
    for (const s of saidas)
      await movimentar(tx, { empresaId, produtoId: s.produtoId, tipo: "cancelamento", quantidadeMil: -s.quantidade, vendaId, observacao: motivo || "Venda cancelada", usuarioId });
    await registrarAuditoria(tx as unknown as BancoDeDados, { empresaId, usuarioId, ator: "usuario", acao: "caixa.cancelar_venda", entidade: "venda", entidadeId: vendaId, dados: { valorCentavos: v.valor, motivo } });
  });
}

/** O caixa do dia: vendas, total por forma de pagamento e ticket médio (o "fechamento"). */
export async function caixaDoDia(db: BancoDeDados, empresaId: string, dia = hoje()) {
  const lista = await db
    .select({
      id: vendas.id,
      valor: vendas.valorCentavos,
      descricao: vendas.descricao,
      formaPagamento: vendas.formaPagamento,
      status: vendas.status,
      trocoCentavos: vendas.trocoCentavos,
      criadoEm: vendas.criadoEm,
      // Sem join, o Drizzle escreve a coluna sem o nome da tabela: dentro da subconsulta ela seria a de `vi`.
      itens: sql<number>`(select count(*)::int from ${vendaItens} vi where vi.venda_id = "vendas"."id")`,
    })
    .from(vendas)
    .where(and(eq(vendas.empresaId, empresaId), eq(vendas.origem, "balcao"), eq(vendas.data, dia), isNull(vendas.excluidoEm)))
    .orderBy(desc(vendas.criadoEm));
  // Vendido ≠ recebido: fiado entra no faturamento do dia, mas não no que entrou no caixa.
  const porForma = new Map<FormaPagamento, number>();
  let recebido = 0;
  let aReceber = 0;
  for (const v of lista) {
    if (v.status === "a_receber") {
      aReceber += v.valor;
      continue;
    }
    recebido += v.valor;
    porForma.set(v.formaPagamento, (porForma.get(v.formaPagamento) ?? 0) + v.valor);
  }
  const total = lista.reduce((s, v) => s + v.valor, 0);
  return {
    lista,
    /** Tudo o que foi vendido no dia (inclui fiado). */
    total,
    /** O que foi pago na hora, por forma (pix/cartão registrados aqui não são confirmação do banco). */
    recebido,
    aReceber,
    porForma: [...porForma].sort((a, b) => b[1] - a[1]),
    ticketMedio: lista.length ? Math.round(total / lista.length) : 0,
  };
}

export async function itensDaVenda(db: BancoDeDados, empresaId: string, vendaId: string) {
  return db.select().from(vendaItens).where(and(eq(vendaItens.empresaId, empresaId), eq(vendaItens.vendaId, vendaId)));
}

// ─── Importação ──────────────────────────────────────────────────────────────

/** Produto com o mesmo código de barras ou SKU é atualizado (preço, custo, saldo); os outros entram. */
export async function importarProdutos(db: BancoDeDados, empresaId: string, usuarioId: string, lista: ProdutoImportado[]) {
  let novos = 0;
  let atualizados = 0;
  await db.transaction(async (tx) => {
    for (const i of lista) {
      const chave = [i.codigoBarras ? eq(produtos.codigoBarras, i.codigoBarras) : undefined, i.sku ? eq(produtos.sku, i.sku) : undefined].filter(Boolean);
      const [existente] = chave.length
        ? await tx
            .select()
            .from(produtos)
            .where(and(eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm), or(...chave)))
            .limit(1)
        : [];
      if (existente) {
        if (i.unidade && i.unidade !== existente.unidade)
          throw new ErroEstoque(`“${existente.nome}” está cadastrado em ${existente.unidade} e a planilha diz ${i.unidade}. Corrija a planilha.`);
        // Campo que não veio fica como está; zero só quando a planilha diz zero.
        await tx
          .update(produtos)
          .set({
            nome: i.nome,
            categoria: i.categoria ?? existente.categoria,
            precoCentavos: i.precoCentavos ?? existente.precoCentavos,
            minimoMil: i.minimoMil ?? existente.minimoMil,
            atualizadoEm: new Date(),
          })
          .where(eq(produtos.id, existente.id));
        // Planilha sem a coluna de estoque (só preços, por exemplo) não mexe no saldo.
        const diferenca = i.saldoMil === undefined ? 0 : i.saldoMil - existente.saldoMil;
        if (diferenca !== 0)
          await movimentar(tx, {
            empresaId,
            produtoId: existente.id,
            tipo: diferenca > 0 && i.custoCentavos != null ? "entrada" : "ajuste",
            quantidadeMil: diferenca,
            custoUnitarioCentavos: diferenca > 0 && i.custoCentavos != null ? i.custoCentavos : null,
            observacao: "Importação de planilha",
            usuarioId,
          });
        atualizados++;
        continue;
      }
      const [p] = await tx
        .insert(produtos)
        .values({
          empresaId,
          nome: i.nome,
          sku: i.sku,
          codigoBarras: i.codigoBarras,
          categoria: i.categoria ?? "",
          unidade: i.unidade ?? "un",
          precoCentavos: i.precoCentavos ?? 0,
          custoMedioCentavos: i.custoCentavos ?? 0,
          minimoMil: i.minimoMil ?? 0,
          criadoPor: usuarioId,
        })
        .returning({ id: produtos.id });
      if (i.saldoMil && i.saldoMil > 0)
        await movimentar(tx, { empresaId, produtoId: p.id, tipo: "entrada", quantidadeMil: i.saldoMil, custoUnitarioCentavos: i.custoCentavos ?? 0, observacao: "Importação de planilha", usuarioId });
      novos++;
    }
  });
  return { novos, atualizados };
}

// ─── Painel ──────────────────────────────────────────────────────────────────

/** Tudo o que o dono precisa ver do estoque numa tela: valor parado, o que repor, o que gira e a margem. */
export async function painelEstoque(db: BancoDeDados, empresaId: string) {
  const desde90 = somarDias(hoje(), -90);
  const desde30 = somarDias(hoje(), -30);
  const ativos = and(eq(produtos.empresaId, empresaId), isNull(produtos.excluidoEm), eq(produtos.ativo, true));
  const controlado = sql`${produtos.controlaEstoque} and ${produtos.saldoMil}`;
  const parado = sql`${produtos.controlaEstoque} and ${produtos.saldoMil} > 0 and (${produtos.ultimaVendaEm} is null or ${produtos.ultimaVendaEm} < now() - interval '60 days')`;
  const colunas = {
    id: produtos.id,
    nome: produtos.nome,
    sku: produtos.sku,
    codigoBarras: produtos.codigoBarras,
    categoria: produtos.categoria,
    unidade: produtos.unidade,
    precoCentavos: produtos.precoCentavos,
    custoMedioCentavos: produtos.custoMedioCentavos,
    saldoMil: produtos.saldoMil,
    minimoMil: produtos.minimoMil,
    controlaEstoque: produtos.controlaEstoque,
    ativo: produtos.ativo,
    ultimaVendaEm: produtos.ultimaVendaEm,
    vendido30dMil: vendidoNoPeriodo(30),
  };
  const comoLinha = <T extends { saldoMil: number; minimoMil: number; controlaEstoque: boolean; vendido30dMil: number }>(l: T) => ({
    ...l,
    vendido30dMil: Number(l.vendido30dMil),
    situacao: situacao(l),
  });

  // Totais em SQL, sobre o catálogo inteiro (não sobre uma página da lista).
  const [[t], vendidos90, [r30], recentes, paradosTop, candidatos] = await Promise.all([
    db
      .select({
        ativos: sql<number>`count(*)::int`,
        valorEmCusto: sql<number>`coalesce(sum(round(${produtos.saldoMil}::numeric * ${produtos.custoMedioCentavos} / 1000)) filter (where ${controlado} > 0), 0)::bigint`.mapWith(Number),
        valorEmVenda: sql<number>`coalesce(sum(round(${produtos.saldoMil}::numeric * ${produtos.precoCentavos} / 1000)) filter (where ${controlado} > 0), 0)::bigint`.mapWith(Number),
        abaixoMinimo: sql<number>`(count(*) filter (where ${controlado} > 0 and ${produtos.minimoMil} > 0 and ${produtos.saldoMil} <= ${produtos.minimoMil}))::int`,
        semEstoque: sql<number>`(count(*) filter (where ${controlado} <= 0))::int`,
        negativos: sql<number>`(count(*) filter (where ${controlado} < 0))::int`,
        valorParado: sql<number>`coalesce(sum(round(${produtos.saldoMil}::numeric * ${produtos.custoMedioCentavos} / 1000)) filter (where ${parado}), 0)::bigint`.mapWith(Number),
      })
      .from(produtos)
      .where(ativos),
    db
      .select({ produtoId: vendaItens.produtoId, receita: sql<number>`sum(${vendaItens.totalCentavos})::bigint`.mapWith(Number) })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
      .innerJoin(produtos, and(eq(produtos.id, vendaItens.produtoId), eq(produtos.empresaId, vendaItens.empresaId)))
      .where(and(eq(vendaItens.empresaId, empresaId), isNull(vendas.excluidoEm), gte(vendas.data, desde90), isNull(produtos.excluidoEm), eq(produtos.ativo, true)))
      .groupBy(vendaItens.produtoId),
    db
      .select({
        receita: sql<number>`coalesce(sum(${vendaItens.totalCentavos}), 0)::bigint`,
        custo: sql<number>`coalesce(sum(${vendaItens.custoTotalCentavos}), 0)::bigint`,
        vendas: sql<number>`count(distinct ${vendaItens.vendaId})::int`,
      })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
      .where(and(eq(vendaItens.empresaId, empresaId), isNull(vendas.excluidoEm), gte(vendas.data, desde30))),
    db
      .select({
        id: movimentosEstoque.id,
        tipo: movimentosEstoque.tipo,
        quantidadeMil: movimentosEstoque.quantidadeMil,
        criadoEm: movimentosEstoque.criadoEm,
        produto: produtos.nome,
        produtoId: produtos.id,
        unidade: produtos.unidade,
        observacao: movimentosEstoque.observacao,
      })
      .from(movimentosEstoque)
      .innerJoin(produtos, and(eq(produtos.id, movimentosEstoque.produtoId), eq(produtos.empresaId, movimentosEstoque.empresaId)))
      .where(and(eq(movimentosEstoque.empresaId, empresaId), lt(movimentosEstoque.criadoEm, sql`now() + interval '1 minute'`)))
      .orderBy(desc(movimentosEstoque.criadoEm))
      .limit(12),
    db
      .select(colunas)
      .from(produtos)
      .where(and(ativos, parado))
      .orderBy(sql`${produtos.saldoMil}::numeric * ${produtos.custoMedioCentavos} desc`, asc(produtos.id))
      .limit(8),
    // Para a sugestão de compra: quem está no mínimo ou abaixo, e quem vende (pode acabar logo).
    db
      .select(colunas)
      .from(produtos)
      .where(and(ativos, sql`${produtos.controlaEstoque} and (${produtos.saldoMil} <= ${produtos.minimoMil} or ${produtos.saldoMil} <= 0 or ${vendidoNoPeriodo(30)} > 0)`))
      .orderBy(asc(produtos.saldoMil), asc(produtos.id))
      .limit(1000),
  ]);

  const receita90 = new Map(vendidos90.flatMap((v) => (v.produtoId ? [[v.produtoId, v.receita] as const] : [])));
  const abc = curvaABC([...receita90].map(([id, receita]) => ({ id, receita })));
  const contagemAbc = { A: 0, B: 0, C: 0 };
  for (const c of abc.values()) contagemAbc[c]++;
  // Quem não vendeu em 90 dias é C.
  contagemAbc.C += Math.max(0, t.ativos - abc.size);

  const topo = [...receita90].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const dosTopo = topo.length ? await db.select(colunas).from(produtos).where(and(ativos, inArray(produtos.id, topo.map(([id]) => id)))) : [];
  const porId = new Map(dosTopo.map((p) => [p.id, comoLinha(p)]));
  const maisVendidos = topo.flatMap(([id, receita]) => {
    const p = porId.get(id);
    return p ? [{ ...p, receita90: receita, classe: abc.get(id) ?? "C" }] : [];
  });

  const comprar = candidatos
    .map(comoLinha)
    .map((p) => ({ ...p, comprarMil: sugestaoDeCompra(p), cobertura: p.vendido30dMil > 0 ? Math.floor(Math.max(0, p.saldoMil) / (p.vendido30dMil / 30)) : null }))
    .filter((p) => p.comprarMil > 0 && (p.situacao !== "ok" || (p.cobertura != null && p.cobertura < 15)))
    .sort((a, b) => (a.cobertura ?? 999) - (b.cobertura ?? 999) || a.saldoMil - b.saldoMil);

  return {
    produtosAtivos: t.ativos,
    valorEmCusto: t.valorEmCusto,
    valorEmVenda: t.valorEmVenda,
    /** Para repor = abaixo do mínimo + sem estoque (o mesmo que o filtro "Para repor"). */
    repor: t.abaixoMinimo + t.semEstoque,
    abaixoMinimo: t.abaixoMinimo,
    /** Zerados e negativos. */
    semEstoque: t.semEstoque,
    negativos: t.negativos,
    vendas30d: { receita: Number(r30.receita), custo: Number(r30.custo), vendas: r30.vendas },
    parados: paradosTop.map(comoLinha).map((p) => ({ ...p, valorParado: valorEmEstoque(p.saldoMil, p.custoMedioCentavos) })),
    valorParado: t.valorParado,
    comprar: comprar.slice(0, 12),
    maisVendidos,
    contagemAbc,
    recentes,
  };
}
