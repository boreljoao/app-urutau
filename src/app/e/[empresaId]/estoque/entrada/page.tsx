import Link from "next/link";
import { notFound } from "next/navigation";
import { FormEntrada } from "@/components/estoque/Formularios";
import { obterDb } from "@/db";
import { hoje } from "@/lib/datas";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { registrarEntradaAcao } from "@/lib/servidor/acoes-estoque";
import { listarProdutos } from "@/lib/servidor/estoque";

export const metadata = { title: "Chegou mercadoria" };
export const dynamic = "force-dynamic";

export default async function Entrada({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "lancar");
  if (!ctx.modulos.has("estoque")) notFound();
  const produtos = (await listarProdutos(obterDb(), empresaId)).filter((p) => p.controlaEstoque);
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Link href={`/e/${empresaId}/estoque`} aria-label="Voltar ao estoque" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <div>
          <h1 className="font-titulo text-2xl font-bold">Chegou mercadoria</h1>
          <p className="text-sm text-suave">Soma ao estoque, atualiza o custo médio e pode lançar a compra nas despesas.</p>
        </div>
      </header>
      <FormEntrada produtos={produtos} registrar={registrarEntradaAcao.bind(null, empresaId)} hoje={hoje()} />
    </div>
  );
}
