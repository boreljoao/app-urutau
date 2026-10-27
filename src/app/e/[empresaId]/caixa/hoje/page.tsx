import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoAcao } from "@/components/BotaoAcao";
import { obterDb } from "@/db";
import { dataValida, formatarData, hoje, somarDias } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { pode } from "@/lib/permissoes";
import { NOME_FORMA } from "@/lib/rotulos";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { cancelarVendaAcao } from "@/lib/servidor/acoes-estoque";
import { caixaDoDia } from "@/lib/servidor/estoque";

export const metadata = { title: "Fechamento do caixa" };
export const dynamic = "force-dynamic";

const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export default async function Fechamento({ params, searchParams }: { params: Promise<{ empresaId: string }>; searchParams: Promise<{ dia?: string }> }) {
  const { empresaId } = await params;
  const { dia: pedido } = await searchParams;
  const ctx = await exigirAcesso(empresaId, "lancar");
  if (!ctx.modulos.has("estoque")) notFound();
  const dia = dataValida(pedido) && pedido <= hoje() ? pedido : hoje();
  const c = await caixaDoDia(obterDb(), empresaId, dia);
  const base = `/e/${empresaId}/caixa`;
  const cancelar = pode(ctx.papel, "gerenciar");
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Link href={base} aria-label="Voltar ao caixa" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <h1 className="flex-1 font-titulo text-2xl font-bold">Fechamento</h1>
        <nav aria-label="Escolher dia" className="flex items-center gap-1 text-sm">
          <Link href={`${base}/hoje?dia=${somarDias(dia, -1)}`} className="btn-secundario !min-h-9 !px-3" aria-label="Dia anterior">‹</Link>
          <span className="px-1">{dia === hoje() ? "Hoje" : formatarData(dia)}</span>
          {dia < hoje() && (
            <Link href={`${base}/hoje?dia=${somarDias(dia, 1)}`} className="btn-secundario !min-h-9 !px-3" aria-label="Dia seguinte">›</Link>
          )}
        </nav>
      </header>

      <section className="cartao space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-suave">Total do dia</p>
            <p className="numero font-titulo text-3xl font-bold text-destaque-texto">{formatarReais(c.total)}</p>
          </div>
          <p className="text-right text-sm text-suave">
            {c.lista.length} {c.lista.length === 1 ? "venda" : "vendas"}
            <br />
            ticket médio {formatarReais(c.ticketMedio)}
          </p>
        </div>
        {c.porForma.length > 0 && (
          <ul className="space-y-2 border-t border-borda pt-3">
            {c.porForma.map(([forma, valor]) => (
              <li key={forma}>
                <span className="flex justify-between text-sm">
                  <span>{forma === "outro" ? "Fiado / outro" : NOME_FORMA[forma]}</span>
                  <span className="numero font-semibold">{formatarReais(valor)}</span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-superficie-2">
                  <span className="block h-full rounded-full bg-destaque" style={{ width: `${(valor / c.total) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-suave">Confira com o extrato da maquininha e o dinheiro da gaveta. As vendas já estão no financeiro.</p>
      </section>

      {c.lista.length === 0 ? (
        <p className="py-8 text-center text-suave">Nenhuma venda no caixa neste dia.</p>
      ) : (
        <ul className="cartao divide-y divide-borda !p-0">
          {c.lista.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{v.descricao.replace(/^Caixa: /, "")}</span>
                <span className="text-xs text-suave">
                  {hora.format(v.criadoEm)} · {v.status === "a_receber" ? "fiado" : NOME_FORMA[v.formaPagamento]} · {v.itens} {v.itens === 1 ? "item" : "itens"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="numero font-semibold">{formatarReais(v.valor)}</span>
                {cancelar && (
                  <BotaoAcao
                    acao={cancelarVendaAcao.bind(null, empresaId, v.id)}
                    className="text-xs text-suave underline"
                    confirmar="Cancelar esta venda? Os produtos voltam ao estoque e ela sai do financeiro."
                  >
                    Cancelar
                  </BotaoAcao>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
