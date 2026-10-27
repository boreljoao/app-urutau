import Link from "next/link";
import { notFound } from "next/navigation";
import { FormProduto } from "@/components/estoque/Formularios";
import { obterDb } from "@/db";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { salvarProdutoAcao } from "@/lib/servidor/acoes-estoque";
import { categoriasDeProdutos } from "@/lib/servidor/estoque";

export const metadata = { title: "Novo produto" };

export default async function NovoProduto({ params, searchParams }: { params: Promise<{ empresaId: string }>; searchParams: Promise<{ codigo?: string }> }) {
  const { empresaId } = await params;
  const { codigo = "" } = await searchParams;
  const ctx = await exigirAcesso(empresaId, "gerenciar");
  if (!ctx.modulos.has("estoque")) notFound();
  const categorias = await categoriasDeProdutos(obterDb(), empresaId);
  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Link href={`/e/${empresaId}/estoque/produtos`} aria-label="Voltar aos produtos" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <h1 className="font-titulo text-2xl font-bold">Novo produto</h1>
      </header>
      <FormProduto
        novo
        acao={salvarProdutoAcao.bind(null, empresaId, null)}
        categorias={categorias}
        inicial={{ nome: "", sku: "", codigoBarras: codigo.replace(/\D/g, "").slice(0, 14), categoria: "", unidade: "un", preco: "", minimo: "", controlaEstoque: true, ativo: true, custoMedioCentavos: 0 }}
      />
    </div>
  );
}
