import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoAcao } from "@/components/BotaoAcao";
import { FormPerda, FormProduto } from "@/components/estoque/Formularios";
import { obterDb } from "@/db";
import { formatarReais } from "@/lib/dinheiro";
import { NOME_MOVIMENTO, NOME_SITUACAO, UNIDADES, coberturaEmDias, formatarQuantidade, margem, valorEmEstoque } from "@/lib/estoque";
import { pode } from "@/lib/permissoes";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { excluirProdutoAcao, perdaAcao, salvarProdutoAcao } from "@/lib/servidor/acoes-estoque";
import { categoriasDeProdutos, obterProduto } from "@/lib/servidor/estoque";

export const metadata = { title: "Produto" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dataHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function Produto({ params, searchParams }: { params: Promise<{ empresaId: string; produtoId: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const { empresaId, produtoId } = await params;
  const { salvo } = await searchParams;
  const ctx = await exigirAcesso(empresaId, "ver_lancamentos");
  if (!ctx.modulos.has("estoque") || !UUID.test(produtoId)) notFound();
  const db = obterDb();
  const [dados, categorias] = await Promise.all([obterProduto(db, empresaId, produtoId), categoriasDeProdutos(db, empresaId)]);
  if (!dados) notFound();
  const { produto: p, movimentos, vendido30d } = dados;
  const base = `/e/${empresaId}/estoque`;
  const gerencia = pode(ctx.papel, "gerenciar");
  const m = margem(p.precoCentavos, p.custoMedioCentavos);
  const cobertura = coberturaEmDias(p.saldoMil, vendido30d.quantidadeMil, 30);
  const reais = (c: number) => (c ? (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "");

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <Link href={`${base}/produtos`} aria-label="Voltar aos produtos" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-titulo text-2xl font-bold leading-tight">{p.nome}</h1>
          <p className="text-sm text-suave">
            {p.categoria || "Sem categoria"}
            {p.codigoBarras ? ` · ${p.codigoBarras}` : ""}
            {p.sku ? ` · SKU ${p.sku}` : ""}
          </p>
        </div>
      </header>
      {salvo && <p role="status" className="aviso">Produto cadastrado. Ele já aparece no caixa.</p>}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="cartao !p-3">
          <dt className="text-xs text-suave">Em estoque</dt>
          <dd className={`numero text-xl font-bold ${p.saldoMil <= 0 && p.controlaEstoque ? "text-negativo" : ""}`}>{p.controlaEstoque ? formatarQuantidade(p.saldoMil, p.unidade) : "—"}</dd>
          <dd className="text-xs text-suave">{NOME_SITUACAO[dados.situacao]}</dd>
        </div>
        <div className="cartao !p-3">
          <dt className="text-xs text-suave">Preço · custo médio</dt>
          <dd className="numero text-xl font-bold">{formatarReais(p.precoCentavos)}</dd>
          <dd className="text-xs text-suave">
            custo {formatarReais(p.custoMedioCentavos)}
            {m != null && p.custoMedioCentavos > 0 ? ` · margem ${m.toLocaleString("pt-BR")}%` : ""}
          </dd>
        </div>
        <div className="cartao !p-3">
          <dt className="text-xs text-suave">Vendido em 30 dias</dt>
          <dd className="numero text-xl font-bold">{formatarQuantidade(vendido30d.quantidadeMil, p.unidade)}</dd>
          <dd className="text-xs text-suave">{formatarReais(vendido30d.receitaCentavos)} · lucro {formatarReais(vendido30d.receitaCentavos - vendido30d.custoCentavos)}</dd>
        </div>
        <div className="cartao !p-3">
          <dt className="text-xs text-suave">Dura</dt>
          <dd className="numero text-xl font-bold">{cobertura == null ? "–" : `${cobertura} ${cobertura === 1 ? "dia" : "dias"}`}</dd>
          <dd className="text-xs text-suave">{formatarReais(valorEmEstoque(p.saldoMil, p.custoMedioCentavos))} parados aqui</dd>
        </div>
      </dl>

      {p.controlaEstoque && pode(ctx.papel, "lancar") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <section className="cartao space-y-2">
            <h2 className="font-titulo font-bold">Chegou mais?</h2>
            <p className="text-sm text-suave">Registre a entrada com o custo da compra: o custo médio se ajusta sozinho.</p>
            <Link href={`${base}/entrada`} className="btn-secundario w-full">Dar entrada</Link>
          </section>
          <section className="cartao space-y-2">
            <h2 className="font-titulo font-bold">Perdeu, venceu, quebrou?</h2>
            <FormPerda acao={perdaAcao.bind(null, empresaId, p.id, p.unidade)} unidade={p.unidade} />
          </section>
        </div>
      )}

      <section className="cartao space-y-3" aria-labelledby="t-hist">
        <h2 id="t-hist" className="font-titulo text-lg font-bold">Histórico</h2>
        {movimentos.length === 0 ? (
          <p className="text-sm text-suave">{p.controlaEstoque ? "Nenhum movimento ainda." : "Este produto vende sem baixar estoque."}</p>
        ) : (
          <ol className="divide-y divide-borda">
            {movimentos.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{NOME_MOVIMENTO[x.tipo]}</span>
                  <span className="block truncate text-xs text-suave">
                    {dataHora.format(x.criadoEm)}
                    {x.custoUnitarioCentavos != null ? ` · custo ${formatarReais(x.custoUnitarioCentavos)}` : ""}
                    {x.documento ? ` · NF ${x.documento}` : ""}
                    {x.observacao ? ` · ${x.observacao}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`numero block font-semibold ${x.quantidadeMil < 0 ? "text-negativo" : "text-positivo"}`}>
                    {x.quantidadeMil > 0 ? "+" : x.quantidadeMil < 0 ? "−" : ""}
                    {formatarQuantidade(Math.abs(x.quantidadeMil), p.unidade)}
                  </span>
                  <span className="text-xs text-suave">fica {formatarQuantidade(x.saldoAposMil, p.unidade)}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {gerencia && (
        <section className="cartao space-y-4" aria-labelledby="t-editar">
          <h2 id="t-editar" className="font-titulo text-lg font-bold">Dados do produto</h2>
          <FormProduto
            novo={false}
            acao={salvarProdutoAcao.bind(null, empresaId, p.id)}
            categorias={categorias}
            inicial={{
              nome: p.nome,
              sku: p.sku ?? "",
              codigoBarras: p.codigoBarras ?? "",
              categoria: p.categoria,
              unidade: p.unidade,
              preco: reais(p.precoCentavos),
              minimo: p.minimoMil ? formatarQuantidade(p.minimoMil, p.unidade, false) : "",
              controlaEstoque: p.controlaEstoque,
              ativo: p.ativo,
              custoMedioCentavos: p.custoMedioCentavos,
            }}
          />
          <p className="text-xs text-suave">A unidade ({UNIDADES[p.unidade].nome.toLowerCase()}) muda como as quantidades são lidas daqui para a frente; o saldo não é convertido.</p>
          <BotaoAcao acao={excluirProdutoAcao.bind(null, empresaId, p.id)} className="btn-perigo w-full" confirmar={`Excluir “${p.nome}”? O histórico de vendas continua.`}>
            Excluir produto
          </BotaoAcao>
        </section>
      )}
    </div>
  );
}
