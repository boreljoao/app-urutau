import Link from "next/link";
import { notFound } from "next/navigation";
import { obterDb } from "@/db";
import { formatarReais } from "@/lib/dinheiro";
import { NOME_SITUACAO, UNIDADES, formatarQuantidade, margem } from "@/lib/estoque";
import { pode } from "@/lib/permissoes";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { categoriasDeProdutos, listarProdutos, type FiltroProdutos } from "@/lib/servidor/estoque";

export const metadata = { title: "Produtos" };
export const dynamic = "force-dynamic";

const FILTROS: { id: FiltroProdutos; rotulo: string }[] = [
  { id: "todos", rotulo: "Todos" },
  { id: "repor", rotulo: "Repor" },
  { id: "sem_estoque", rotulo: "Zerados" },
  { id: "parados", rotulo: "Parados" },
  { id: "inativos", rotulo: "Inativos" },
];

const COR: Record<string, string> = {
  negativo: "border-negativo text-negativo",
  sem_estoque: "border-negativo text-negativo",
  abaixo_minimo: "border-destaque/70",
  ok: "border-borda text-suave",
  sem_controle: "border-borda text-suave",
};

export default async function Produtos({
  params,
  searchParams,
}: {
  params: Promise<{ empresaId: string }>;
  searchParams: Promise<{ f?: string; q?: string; c?: string }>;
}) {
  const { empresaId } = await params;
  const { f, q = "", c = "" } = await searchParams;
  const ctx = await exigirAcesso(empresaId, "ver_lancamentos");
  if (!ctx.modulos.has("estoque")) notFound();
  const filtro = FILTROS.some((x) => x.id === f) ? (f as FiltroProdutos) : "todos";
  const db = obterDb();
  const [lista, categorias] = await Promise.all([listarProdutos(db, empresaId, { busca: q, filtro, categoria: c || undefined }), categoriasDeProdutos(db, empresaId)]);
  const base = `/e/${empresaId}/estoque`;
  const link = (mudar: Record<string, string>) => {
    const s = new URLSearchParams({ ...(filtro !== "todos" ? { f: filtro } : {}), ...(q ? { q } : {}), ...(c ? { c } : {}), ...mudar });
    for (const [k, v] of [...s]) if (!v) s.delete(k);
    return `${base}/produtos${s.size ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link href={base} aria-label="Voltar ao estoque" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <h1 className="flex-1 font-titulo text-2xl font-bold">Produtos</h1>
        {pode(ctx.papel, "gerenciar") && <Link href={`${base}/produtos/novo`} className="btn-principal !min-h-11">+ Novo</Link>}
      </header>

      <form role="search" className="flex gap-2">
        {filtro !== "todos" && <input type="hidden" name="f" value={filtro} />}
        {c && <input type="hidden" name="c" value={c} />}
        <label htmlFor="q" className="sr-only">Buscar por nome ou código</label>
        <input id="q" name="q" defaultValue={q} placeholder="Nome, código de barras ou SKU" className="campo flex-1" />
        <button className="btn-secundario">Buscar</button>
      </form>

      <nav aria-label="Filtrar" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTROS.map((x) => (
          <Link
            key={x.id}
            href={link({ f: x.id === "todos" ? "" : x.id })}
            aria-current={filtro === x.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${filtro === x.id ? "border-texto bg-texto font-semibold text-fundo" : "border-borda text-suave"}`}
          >
            {x.rotulo}
          </Link>
        ))}
        {categorias.map((cat) => (
          <Link
            key={cat}
            href={link({ c: c === cat ? "" : cat })}
            aria-current={c === cat ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${c === cat ? "border-destaque font-semibold" : "border-dashed border-borda text-suave"}`}
          >
            {cat}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <p className="py-10 text-center text-suave">{q ? `Nada para "${q}".` : "Nenhum produto neste filtro."}</p>
      ) : (
        <ul className="cartao divide-y divide-borda !p-0">
          {lista.map((p) => {
            const m = margem(p.precoCentavos, p.custoMedioCentavos);
            return (
              <li key={p.id}>
                <Link href={`${base}/produtos/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.nome}</span>
                    <span className="block truncate text-xs text-suave">
                      {formatarReais(p.precoCentavos)}/{UNIDADES[p.unidade].curto}
                      {m != null && p.custoMedioCentavos > 0 ? ` · margem ${m.toLocaleString("pt-BR")}%` : ""}
                      {p.categoria ? ` · ${p.categoria}` : ""}
                      {p.codigoBarras ? ` · ${p.codigoBarras}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {p.controlaEstoque && <span className="numero block font-bold">{formatarQuantidade(p.saldoMil, p.unidade)}</span>}
                    {p.situacao !== "ok" && <span className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-[11px] ${COR[p.situacao]}`}>{NOME_SITUACAO[p.situacao]}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
