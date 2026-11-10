"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { obterDb } from "@/db";
import { formaPagamentoEnum, unidadeProdutoEnum } from "@/db/schema";
import { lerReais } from "@/lib/dinheiro";
import type { EstadoForm } from "@/lib/estado-form";
import { UNIDADES, lerQuantidade, limparCodigo, type ProdutoImportado } from "@/lib/estoque";
import type { Acao } from "@/lib/permissoes";
import { exigirPermissao } from "./acesso";
import {
  ErroEstoque,
  ajustarInventario,
  cancelarVendaCaixa,
  excluirProduto,
  importarProdutos,
  registrarEntrada,
  registrarPerda,
  registrarVendaCaixa,
  salvarProduto,
  type VendaDoCaixa,
} from "./estoque";

async function exigirEstoque(empresaId: string, acao: Acao) {
  const ctx = await exigirPermissao(empresaId, acao);
  if (!ctx.modulos.has("estoque")) throw new Error("O estoque não está ligado para esta empresa.");
  return ctx;
}

const erroDe = (e: unknown) => (e instanceof ErroEstoque ? e.message : "Não foi possível concluir. Tente de novo.");

function atualizar(empresaId: string) {
  revalidatePath(`/e/${empresaId}/estoque`, "layout");
  revalidatePath(`/e/${empresaId}/caixa`, "layout");
}

// ─── Produto ─────────────────────────────────────────────────────────────────

export async function salvarProdutoAcao(empresaId: string, id: string | null, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await exigirEstoque(empresaId, "gerenciar");
  const valores = Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  const erros: Record<string, string> = {};
  const unidade = unidadeProdutoEnum.enumValues.includes(valores.unidade as never) ? (valores.unidade as (typeof unidadeProdutoEnum.enumValues)[number]) : "un";
  const nome = (valores.nome ?? "").trim();
  if (!nome) erros.nome = "Dê um nome ao produto.";
  const preco = lerReais(valores.preco ?? "");
  if (preco === null || preco < 0) erros.preco = "Preço inválido. Exemplo: 12,90";
  const minimo = valores.minimo?.trim() ? lerQuantidade(valores.minimo, unidade) : 0;
  if (minimo === null || minimo < 0) erros.minimo = UNIDADES[unidade].fracionada ? "Quantidade inválida. Exemplo: 2,5" : "Use um número inteiro.";
  let inicial: { saldoMil: number; custoCentavos: number } | undefined;
  if (!id) {
    const saldo = valores.saldoInicial?.trim() ? lerQuantidade(valores.saldoInicial, unidade) : 0;
    const custo = valores.custoInicial?.trim() ? lerReais(valores.custoInicial) : 0;
    if (saldo === null || saldo < 0) erros.saldoInicial = "Quantidade inválida.";
    if (custo === null || custo < 0) erros.custoInicial = "Custo inválido.";
    if (saldo && saldo > 0 && !custo) erros.custoInicial = "Informe quanto custou cada unidade (para a margem e o valor do estoque).";
    inicial = { saldoMil: saldo ?? 0, custoCentavos: custo ?? 0 };
  }
  if (Object.keys(erros).length) return { erros, valores };
  try {
    const produtoId = await salvarProduto(
      obterDb(),
      empresaId,
      id,
      {
        nome: nome.slice(0, 200),
        sku: valores.sku?.trim().slice(0, 60) || null,
        codigoBarras: limparCodigo(valores.codigoBarras ?? "") || null,
        categoria: (valores.categoria ?? "").trim().slice(0, 60),
        unidade,
        precoCentavos: preco!,
        minimoMil: minimo!,
        controlaEstoque: valores.controlaEstoque === "on",
        ativo: id ? valores.ativo === "on" : true,
      },
      ctx.usuario.id,
      inicial,
    );
    atualizar(empresaId);
    if (!id) redirect(`/e/${empresaId}/estoque/produtos/${produtoId}?salvo=1`);
  } catch (e) {
    if (e instanceof ErroEstoque) return { erros: { [e.message.includes("barras") ? "codigoBarras" : e.message.includes("SKU") ? "sku" : "_"]: e.message }, valores };
    throw e;
  }
  return { ok: "Produto salvo." };
}

export async function excluirProdutoAcao(empresaId: string, id: string) {
  await exigirEstoque(empresaId, "gerenciar");
  await excluirProduto(obterDb(), empresaId, id);
  atualizar(empresaId);
  redirect(`/e/${empresaId}/estoque/produtos`);
}

export async function perdaAcao(empresaId: string, produtoId: string, unidade: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await exigirEstoque(empresaId, "lancar");
  const qtd = lerQuantidade(String(fd.get("quantidade") ?? ""), unidadeProdutoEnum.enumValues.includes(unidade as never) ? (unidade as "un") : "un");
  if (!qtd || qtd <= 0) return { erros: { quantidade: "Informe a quantidade." } };
  try {
    await registrarPerda(obterDb(), empresaId, ctx.usuario.id, produtoId, qtd, String(fd.get("motivo") ?? "").trim().slice(0, 200));
  } catch (e) {
    return { erros: { _: erroDe(e) } };
  }
  atualizar(empresaId);
  return { ok: "Perda registrada." };
}

// ─── Entrada, inventário e importação (dados montados na tela) ───────────────

const esquemaEntrada = z.object({
  linhas: z.array(z.object({ produtoId: z.uuid(), quantidadeMil: z.number().int().positive(), custoUnitarioCentavos: z.number().int().min(0) })).min(1).max(300),
  documento: z.string().trim().max(60).nullable(),
  fornecedor: z.string().trim().max(120).nullable(),
  despesa: z.object({ vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), pago: z.boolean() }).nullable(),
});

export async function registrarEntradaAcao(empresaId: string, dados: z.input<typeof esquemaEntrada>): Promise<{ erro?: string; ok?: string }> {
  const ctx = await exigirEstoque(empresaId, "lancar");
  const r = esquemaEntrada.safeParse(dados);
  if (!r.success) return { erro: "Confira as quantidades e os custos." };
  try {
    const { totalCentavos } = await registrarEntrada(obterDb(), empresaId, ctx.usuario.id, { ...r.data, documento: r.data.documento || null, fornecedor: r.data.fornecedor || null });
    atualizar(empresaId);
    revalidatePath(`/e/${empresaId}/despesas`, "layout");
    return { ok: `Entrada registrada: ${r.data.linhas.length} ${r.data.linhas.length === 1 ? "produto" : "produtos"}, ${(totalCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.` };
  } catch (e) {
    return { erro: erroDe(e) };
  }
}

export async function inventarioAcao(empresaId: string, contagens: { produtoId: string; contadoMil: number }[], observacao: string): Promise<{ erro?: string; ok?: string }> {
  const ctx = await exigirEstoque(empresaId, "gerenciar");
  const r = z.array(z.object({ produtoId: z.uuid(), contadoMil: z.number().int().min(0) })).min(1).max(5000).safeParse(contagens);
  if (!r.success) return { erro: "Nenhuma contagem válida." };
  try {
    const n = await ajustarInventario(obterDb(), empresaId, ctx.usuario.id, r.data, observacao.slice(0, 200));
    atualizar(empresaId);
    return { ok: n ? `${n} ${n === 1 ? "produto ajustado" : "produtos ajustados"}. O resto já batia.` : "Tudo batia com o sistema. Nada para ajustar." };
  } catch (e) {
    return { erro: erroDe(e) };
  }
}

export async function importarAcao(empresaId: string, lista: ProdutoImportado[]): Promise<{ erro?: string; ok?: string }> {
  const ctx = await exigirEstoque(empresaId, "gerenciar");
  const item = z.object({
    nome: z.string().min(1).max(200),
    sku: z.string().max(60).nullable(),
    codigoBarras: z.string().max(40).nullable(),
    categoria: z.string().max(60),
    unidade: z.enum(unidadeProdutoEnum.enumValues),
    precoCentavos: z.number().int().min(0),
    custoCentavos: z.number().int().min(0),
    saldoMil: z.number().int(),
    minimoMil: z.number().int().min(0),
  });
  const r = z.array(item).min(1).max(5000).safeParse(lista);
  if (!r.success) return { erro: "A planilha tem linhas inválidas." };
  try {
    const { novos, atualizados } = await importarProdutos(obterDb(), empresaId, ctx.usuario.id, r.data);
    atualizar(empresaId);
    return { ok: `${novos} ${novos === 1 ? "produto novo" : "produtos novos"} e ${atualizados} ${atualizados === 1 ? "atualizado" : "atualizados"}.` };
  } catch (e) {
    return { erro: erroDe(e) };
  }
}

// ─── Caixa ───────────────────────────────────────────────────────────────────

const esquemaVenda = z.object({
  itens: z
    .array(
      z.object({
        produtoId: z.uuid().nullable(),
        descricao: z.string().trim().max(200).optional(),
        quantidadeMil: z.number().int().positive().max(1_000_000_000),
        precoUnitarioCentavos: z.number().int().min(0).optional(),
        descontoCentavos: z.number().int().min(0).optional(),
      }),
    )
    .min(1)
    .max(500),
  descontoCentavos: z.number().int().min(0),
  formaPagamento: z.enum(formaPagamentoEnum.enumValues),
  clienteId: z.uuid().nullable(),
  aReceber: z.boolean(),
});

export async function venderAcao(empresaId: string, venda: VendaDoCaixa): Promise<{ erro: string } | { vendaId: string; totalCentavos: number; estoqueNegativo: string[] }> {
  const ctx = await exigirEstoque(empresaId, "lancar");
  const r = esquemaVenda.safeParse(venda);
  if (!r.success) return { erro: "O carrinho tem algo inválido. Confira as quantidades." };
  try {
    const feito = await registrarVendaCaixa(obterDb(), empresaId, ctx.usuario.id, r.data);
    atualizar(empresaId);
    revalidatePath(`/e/${empresaId}/vendas`, "layout");
    revalidatePath(`/e/${empresaId}/painel`);
    return feito;
  } catch (e) {
    return { erro: erroDe(e) };
  }
}

export async function cancelarVendaAcao(empresaId: string, vendaId: string) {
  const ctx = await exigirEstoque(empresaId, "gerenciar");
  try {
    await cancelarVendaCaixa(obterDb(), empresaId, vendaId, ctx.usuario.id, "Cancelada no caixa");
  } catch (e) {
    return { erro: erroDe(e) };
  }
  atualizar(empresaId);
  revalidatePath(`/e/${empresaId}/vendas`, "layout");
}
