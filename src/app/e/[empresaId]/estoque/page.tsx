import Link from "next/link";
import { notFound } from "next/navigation";
import { obterDb } from "@/db";
import { quando } from "@/lib/central";
import { formatarReais } from "@/lib/dinheiro";
import { NOME_MOVIMENTO, formatarQuantidade, margem } from "@/lib/estoque";
import { pode } from "@/lib/permissoes";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { painelEstoque } from "@/lib/servidor/estoque";

export const metadata = { title: "Estoque" };
export const dynamic = "force-dynamic";

function Bloco({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="cartao space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-titulo text-lg font-bold">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

export default async function Estoque({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "ver_lancamentos");
  if (!ctx.modulos.has("estoque")) notFound();
  const p = await painelEstoque(obterDb(), empresaId);
  const base = `/e/${empresaId}`;
  const gerencia = pode(ctx.papel, "gerenciar");
  const lancar = pode(ctx.papel, "lancar");
  const m = margem(p.vendas30d.receita, p.vendas30d.custo);
  const agora = new Date();

  if (p.produtosAtivos === 0)
    return (
      <div className="space-y-4">
        <h1 className="font-titulo text-2xl font-bold">Estoque</h1>
        <div className="cartao space-y-3 text-center">
          <p className="font-titulo text-lg font-bold">Vamos colocar os produtos aqui</p>
          <p className="text-suave">Traga a planilha do sistema antigo (ou da maquininha) de uma vez, ou cadastre passando o leitor de código de barras.</p>
          {gerencia && (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link href={`${base}/estoque/importar`} className="btn-principal">Importar planilha</Link>
              <Link href={`${base}/estoque/produtos/novo`} className="btn-secundario">Cadastrar um produto</Link>
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-titulo text-2xl font-bold">Estoque</h1>
          <p className="text-sm text-suave">
            {p.produtosAtivos} produtos · {p.repor > 0 ? `${p.repor} pedem atenção` : "nada faltando"}
          </p>
        </div>
        {lancar && <Link href={`${base}/caixa`} className="btn-principal !min-h-11">Abrir o caixa</Link>}
      </header>

      <nav aria-label="Atalhos do estoque" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { href: `${base}/estoque/produtos`, t: "Produtos", d: "lista e cadastro" },
          ...(lancar ? [{ href: `${base}/estoque/entrada`, t: "Chegou mercadoria", d: "entrada e custo" }] : []),
          ...(gerencia ? [{ href: `${base}/estoque/inventario`, t: "Inventário", d: "contar e ajustar" }] : []),
          ...(gerencia ? [{ href: `${base}/estoque/importar`, t: "Importar", d: "planilha CSV" }] : []),
        ].map((a) => (
          <Link key={a.href} href={a.href} className="cartao !p-3 transition-colors hover:border-texto/40">
            <span className="block font-medium">{a.t}</span>
            <span className="text-xs text-suave">{a.d}</span>
          </Link>
        ))}
      </nav>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="cartao">
          <dt className="text-xs text-suave">Valor em estoque (custo)</dt>
          <dd className="numero mt-1 text-xl font-bold">{formatarReais(p.valorEmCusto)}</dd>
          <dd className="text-xs text-suave">vira {formatarReais(p.valorEmVenda)} vendido</dd>
        </div>
        <div className="cartao">
          <dt className="text-xs text-suave">Vendido em 30 dias</dt>
          <dd className="numero mt-1 text-xl font-bold text-destaque-texto">{formatarReais(p.vendas30d.receita)}</dd>
          <dd className="text-xs text-suave">{p.vendas30d.vendas} vendas no caixa</dd>
        </div>
        <div className="cartao">
          <dt className="text-xs text-suave">Margem bruta (30 dias)</dt>
          <dd className={`numero mt-1 text-xl font-bold ${m != null && m < 20 ? "text-negativo" : ""}`}>{m == null ? "–" : `${m.toLocaleString("pt-BR")}%`}</dd>
          <dd className="text-xs text-suave">lucro de {formatarReais(p.vendas30d.receita - p.vendas30d.custo)} sobre o custo</dd>
        </div>
        <div className={`cartao ${p.repor > 0 ? "!border-destaque/70" : ""}`}>
          <dt className="text-xs text-suave">Repor</dt>
          <dd className="numero mt-1 text-xl font-bold">{p.repor}</dd>
          <dd className="text-xs text-suave">
            {p.semEstoque} zerados{p.negativos ? ` (${p.negativos} negativos)` : ""} · {p.abaixoMinimo} abaixo do mínimo
          </dd>
        </div>
      </dl>

      <Bloco titulo="Comprar agora" acao={<Link href={`${base}/estoque/produtos?f=repor`} className="text-sm underline">ver todos</Link>}>
        {p.comprar.length === 0 ? (
          <p className="text-sm text-suave">Nada para repor: o estoque cobre o ritmo de venda das próximas semanas.</p>
        ) : (
          <ul className="divide-y divide-borda">
            {p.comprar.map((x) => (
              <li key={x.id}>
                <Link href={`${base}/estoque/produtos/${x.id}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{x.nome}</span>
                    <span className="text-xs text-suave">
                      tem {formatarQuantidade(x.saldoMil, x.unidade)}
                      {x.cobertura != null ? ` · dura ${x.cobertura === 0 ? "menos de 1 dia" : `${x.cobertura} ${x.cobertura === 1 ? "dia" : "dias"}`}` : ""}
                      {x.vendido30dMil ? ` · vendeu ${formatarQuantidade(x.vendido30dMil, x.unidade)} em 30 dias` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="numero block font-bold">+{formatarQuantidade(x.comprarMil, x.unidade)}</span>
                    <span className="text-xs text-suave">≈ {formatarReais(Math.round((x.comprarMil * x.custoMedioCentavos) / 1000))}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="O que mais vende (90 dias)">
          {p.maisVendidos.length === 0 ? (
            <p className="text-sm text-suave">As vendas do caixa aparecem aqui.</p>
          ) : (
            <>
              <p className="text-xs text-suave">
                Curva ABC: {p.contagemAbc.A} produtos fazem 80% da receita (A), {p.contagemAbc.B} fazem os 15% seguintes (B) e {p.contagemAbc.C} o resto (C).
              </p>
              <ol className="space-y-2">
                {p.maisVendidos.map((x) => {
                  const maior = p.maisVendidos[0].receita90;
                  return (
                    <li key={x.id}>
                      <Link href={`${base}/estoque/produtos/${x.id}`} className="block">
                        <span className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="truncate">
                            <span className={`mr-1.5 inline-grid h-5 w-5 place-items-center rounded text-[11px] font-bold ${x.classe === "A" ? "bg-destaque text-sobre-destaque" : "bg-superficie-2"}`}>{x.classe}</span>
                            {x.nome}
                          </span>
                          <span className="numero shrink-0 font-semibold">{formatarReais(x.receita90)}</span>
                        </span>
                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-superficie-2">
                          <span className="block h-full rounded-full bg-destaque" style={{ width: `${Math.max(3, (x.receita90 / maior) * 100)}%` }} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </Bloco>

        <Bloco titulo="Dinheiro parado" acao={<Link href={`${base}/estoque/produtos?f=parados`} className="text-sm underline">ver todos</Link>}>
          {p.parados.length === 0 ? (
            <p className="text-sm text-suave">Tudo girando: nenhum produto com estoque parado há mais de 60 dias.</p>
          ) : (
            <>
              <p className="text-sm text-suave">
                <strong className="numero text-texto">{formatarReais(p.valorParado)}</strong> em produtos que não vendem há mais de 60 dias. Promoção ou combo libera esse caixa.
              </p>
              <ul className="divide-y divide-borda">
                {p.parados.map((x) => (
                  <li key={x.id}>
                    <Link href={`${base}/estoque/produtos/${x.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{x.nome}</span>
                        <span className="text-xs text-suave">{x.ultimaVendaEm ? `última venda ${quando(x.ultimaVendaEm, agora)}` : "nunca vendeu no caixa"}</span>
                      </span>
                      <span className="numero shrink-0 font-semibold">{formatarReais(x.valorParado)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Bloco>
      </div>

      <Bloco titulo="Últimos movimentos">
        <ul className="divide-y divide-borda">
          {p.recentes.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <Link href={`${base}/estoque/produtos/${x.produtoId}`} className="block truncate font-medium">{x.produto}</Link>
                <span className="text-xs text-suave">
                  {NOME_MOVIMENTO[x.tipo]} · {quando(x.criadoEm, agora)}
                  {x.observacao ? ` · ${x.observacao}` : ""}
                </span>
              </span>
              <span className={`numero shrink-0 font-semibold ${x.quantidadeMil < 0 ? "text-negativo" : "text-positivo"}`}>
                {x.quantidadeMil > 0 ? "+" : "−"}
                {formatarQuantidade(Math.abs(x.quantidadeMil), x.unidade)}
              </span>
            </li>
          ))}
        </ul>
      </Bloco>
    </div>
  );
}
