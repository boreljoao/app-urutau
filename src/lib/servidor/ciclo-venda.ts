import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { agendamentos, auditoria, vendaItens, vendas, veiculos } from "@/db/schema";
import { ErroEstoque, cancelarVendaCaixa } from "./estoque";
import { registrarAuditoria } from "./auditoria";

/**
 * Ciclo de vida de uma venda conforme a origem. Uma venda do caixa tem itens e baixou estoque;
 * uma da agenda está presa a um atendimento; uma do pátio, a um carro. Editar, excluir ou
 * restaurar pelo financeiro tem de levar esses vínculos junto, numa transação só.
 */

export type OrigemVenda =
  | { tipo: "caixa" }
  | { tipo: "agenda"; agendamentoId: string | null }
  | { tipo: "veiculo"; veiculoId: string }
  | { tipo: "manual" };

type Tx = Parameters<Parameters<BancoDeDados["transaction"]>[0]>[0];

export async function origemDaVenda(db: BancoDeDados | Tx, empresaId: string, vendaId: string): Promise<OrigemVenda> {
  const [[v], [item], [ag], [carro]] = await Promise.all([
    db.select({ origem: vendas.origem }).from(vendas).where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId))),
    db.select({ id: vendaItens.id }).from(vendaItens).where(and(eq(vendaItens.empresaId, empresaId), eq(vendaItens.vendaId, vendaId))).limit(1),
    db.select({ id: agendamentos.id }).from(agendamentos).where(and(eq(agendamentos.empresaId, empresaId), eq(agendamentos.vendaId, vendaId))).limit(1),
    db.select({ id: veiculos.id }).from(veiculos).where(and(eq(veiculos.empresaId, empresaId), eq(veiculos.vendaId, vendaId))).limit(1),
  ]);
  if (v?.origem === "balcao" || item) return { tipo: "caixa" };
  if (carro) return { tipo: "veiculo", veiculoId: carro.id };
  if (ag || v?.origem === "agenda") return { tipo: "agenda", agendamentoId: ag?.id ?? null };
  return { tipo: "manual" };
}

/** O que a tela de edição explica sobre a venda (e se o valor pode mudar ali). */
export function explicarOrigem(o: OrigemVenda): { aviso: string | null; valorLivre: boolean; textoExcluir: string } {
  switch (o.tipo) {
    case "caixa":
      return {
        aviso: "Venda do caixa: o valor vem dos itens. Para corrigir, exclua (o estoque volta) e passe de novo no caixa.",
        valorLivre: false,
        textoExcluir: "Excluir esta venda do caixa? Os produtos voltam ao estoque e não dá para desfazer.",
      };
    case "agenda":
      return {
        aviso: "Recebimento de um atendimento da agenda. Excluir libera o atendimento para receber de novo.",
        valorLivre: true,
        textoExcluir: "Excluir este recebimento? O atendimento volta a ficar sem recebimento.",
      };
    case "veiculo":
      return {
        aviso: "Venda de um carro do pátio: o valor muda pelo pátio. Excluir devolve o carro para disponível.",
        valorLivre: false,
        textoExcluir: "Excluir esta venda? O carro volta para disponível no pátio.",
      };
    default:
      return { aviso: null, valorLivre: true, textoExcluir: "Excluir este lançamento? Dá para desfazer logo em seguida." };
  }
}

/**
 * Exclui a venda e desfaz os efeitos dela: caixa devolve estoque; agenda solta o atendimento;
 * pátio devolve o carro. O vínculo desfeito fica na auditoria, para a restauração refazer.
 */
export async function excluirVenda(db: BancoDeDados, empresaId: string, vendaId: string, usuarioId: string, podeEstornarCaixa: boolean) {
  const origem = await origemDaVenda(db, empresaId, vendaId);
  if (origem.tipo === "caixa") {
    if (!podeEstornarCaixa) throw new ErroEstoque("Só dono ou gerente estorna venda do caixa.");
    await cancelarVendaCaixa(db, empresaId, vendaId, usuarioId, "Excluída no financeiro");
    return origem;
  }
  await db.transaction(async (tx) => {
    const [v] = await tx
      .update(vendas)
      .set({ excluidoEm: new Date() })
      .where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId), isNull(vendas.excluidoEm)))
      .returning({ valor: vendas.valorCentavos });
    if (!v) throw new ErroEstoque("Este lançamento não existe mais.");
    let vinculo: Record<string, string> | null = null;
    if (origem.tipo === "agenda" && origem.agendamentoId) {
      await tx.update(agendamentos).set({ vendaId: null, atualizadoEm: new Date() }).where(and(eq(agendamentos.id, origem.agendamentoId), eq(agendamentos.vendaId, vendaId)));
      vinculo = { agendamentoId: origem.agendamentoId };
    }
    if (origem.tipo === "veiculo") {
      await tx
        .update(veiculos)
        .set({ status: "disponivel", vendaId: null, valorVendaCentavos: null, vendidoEm: null, atualizadoEm: new Date() })
        .where(and(eq(veiculos.id, origem.veiculoId), eq(veiculos.vendaId, vendaId)));
      vinculo = { veiculoId: origem.veiculoId };
    }
    await registrarAuditoria(tx as unknown as BancoDeDados, { empresaId, usuarioId, ator: "usuario", acao: "venda.excluir", entidade: "venda", entidadeId: vendaId, dados: { valorCentavos: v.valor, origem: origem.tipo, ...(vinculo ?? {}) } });
  });
  return origem;
}

/** Restaura uma venda excluída, refazendo o vínculo se ele ainda estiver livre. Venda do caixa não volta. */
export async function restaurarVenda(db: BancoDeDados, empresaId: string, vendaId: string, usuarioId: string) {
  await db.transaction(async (tx) => {
    const [v] = await tx
      .select({ origem: vendas.origem, valor: vendas.valorCentavos, data: vendas.data, clienteId: vendas.clienteId })
      .from(vendas)
      .where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId), sql`${vendas.excluidoEm} is not null`))
      .for("update");
    if (!v) throw new ErroEstoque("Este lançamento já foi restaurado.");
    const [item] = await tx.select({ id: vendaItens.id }).from(vendaItens).where(and(eq(vendaItens.empresaId, empresaId), eq(vendaItens.vendaId, vendaId))).limit(1);
    if (v.origem === "balcao" || item) throw new ErroEstoque("Venda do caixa estornada não volta: os produtos já voltaram ao estoque. Passe de novo no caixa.");
    const [ultima] = await tx
      .select({ dados: auditoria.dados })
      .from(auditoria)
      .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.acao, "venda.excluir"), eq(auditoria.entidadeId, vendaId)))
      .orderBy(desc(auditoria.criadoEm))
      .limit(1);
    const d = (ultima?.dados ?? {}) as { agendamentoId?: string; veiculoId?: string };
    if (d.agendamentoId) {
      const [a] = await tx
        .update(agendamentos)
        .set({ vendaId, status: "atendido", atualizadoEm: new Date() })
        .where(and(eq(agendamentos.id, d.agendamentoId), eq(agendamentos.empresaId, empresaId), isNull(agendamentos.vendaId)))
        .returning({ id: agendamentos.id });
      if (!a) throw new ErroEstoque("O atendimento já recebeu outro lançamento: esta venda não pode voltar.");
    }
    if (d.veiculoId) {
      const [c] = await tx
        .update(veiculos)
        .set({ status: "vendido", vendaId, valorVendaCentavos: v.valor, vendidoEm: v.data, clienteId: v.clienteId, atualizadoEm: new Date() })
        .where(and(eq(veiculos.id, d.veiculoId), eq(veiculos.empresaId, empresaId), isNull(veiculos.vendaId), isNull(veiculos.excluidoEm)))
        .returning({ id: veiculos.id });
      if (!c) throw new ErroEstoque("O carro já foi vendido de novo: esta venda não pode voltar.");
    }
    await tx.update(vendas).set({ excluidoEm: null }).where(eq(vendas.id, vendaId));
    await registrarAuditoria(tx as unknown as BancoDeDados, { empresaId, usuarioId, ator: "usuario", acao: "venda.restaurar", entidade: "venda", entidadeId: vendaId });
  });
}
