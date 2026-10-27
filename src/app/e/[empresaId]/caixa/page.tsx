import Link from "next/link";
import { notFound } from "next/navigation";
import { Caixa } from "@/components/estoque/Caixa";
import { obterDb } from "@/db";
import { formatarReais } from "@/lib/dinheiro";
import { pode } from "@/lib/permissoes";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { venderAcao } from "@/lib/servidor/acoes-estoque";
import { opcoesDeClientes } from "@/lib/servidor/clientes";
import { caixaDoDia, produtosDoCaixa } from "@/lib/servidor/estoque";

export const metadata = { title: "Caixa" };
export const dynamic = "force-dynamic";

export default async function PaginaCaixa({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "lancar");
  if (!ctx.modulos.has("estoque")) notFound();
  const db = obterDb();
  const [produtos, clientes, dia] = await Promise.all([produtosDoCaixa(db, empresaId), opcoesDeClientes(db, empresaId), caixaDoDia(db, empresaId)]);
  const base = `/e/${empresaId}`;
  return (
    <div className="tela-larga space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-2xl font-bold">Caixa</h1>
        <Link href={`${base}/caixa/hoje`} className="rounded-full border border-borda px-3.5 py-1.5 text-sm">
          Hoje: <strong className="numero">{formatarReais(dia.total)}</strong> em {dia.lista.length} {dia.lista.length === 1 ? "venda" : "vendas"} ›
        </Link>
      </header>
      <Caixa produtos={produtos} clientes={clientes} vender={venderAcao.bind(null, empresaId)} base={base} podeCadastrar={pode(ctx.papel, "gerenciar")} />
    </div>
  );
}
