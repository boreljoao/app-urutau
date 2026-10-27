import Link from "next/link";
import { notFound } from "next/navigation";
import { Importar } from "@/components/estoque/Formularios";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { importarAcao } from "@/lib/servidor/acoes-estoque";

export const metadata = { title: "Importar produtos" };

export default async function PaginaImportar({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "gerenciar");
  if (!ctx.modulos.has("estoque")) notFound();
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Link href={`/e/${empresaId}/estoque`} aria-label="Voltar ao estoque" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <div>
          <h1 className="font-titulo text-2xl font-bold">Importar produtos</h1>
          <p className="text-sm text-suave">
            Traga a lista do sistema antigo ou da maquininha. Reconhecemos colunas como nome ou descrição, código de barras ou EAN, preço, custo, estoque, mínimo,
            unidade e categoria.
          </p>
        </div>
      </header>
      <Importar importar={importarAcao.bind(null, empresaId)} />
    </div>
  );
}
