import Link from "next/link";
import { notFound } from "next/navigation";
import { Inventario } from "@/components/estoque/Formularios";
import { obterDb } from "@/db";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { inventarioAcao } from "@/lib/servidor/acoes-estoque";
import { listarProdutos } from "@/lib/servidor/estoque";

export const metadata = { title: "Inventário" };
export const dynamic = "force-dynamic";

export default async function PaginaInventario({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "gerenciar");
  if (!ctx.modulos.has("estoque")) notFound();
  const produtos = (await listarProdutos(obterDb(), empresaId)).filter((p) => p.controlaEstoque);
  return (
    <div className="tela-larga space-y-5">
      <header className="flex items-center gap-3">
        <Link href={`/e/${empresaId}/estoque`} aria-label="Voltar ao estoque" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <div>
          <h1 className="font-titulo text-2xl font-bold">Inventário</h1>
          <p className="text-sm text-suave">Conte o que tem na prateleira. Só os produtos contados são ajustados, e o histórico guarda cada diferença.</p>
        </div>
      </header>
      <Inventario produtos={produtos} ajustar={inventarioAcao.bind(null, empresaId)} />
    </div>
  );
}
