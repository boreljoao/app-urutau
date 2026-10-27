"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useMemo, useState, useTransition } from "react";
import { Campo, Erro } from "@/components/Campos";
import type { Unidade } from "@/db/schema";
import { formatarReais, lerReais } from "@/lib/dinheiro";
import type { EstadoForm } from "@/lib/estado-form";
import { MIL, UNIDADES, eanValido, formatarQuantidade, lerQuantidade, limparCodigo, margem, produtosDoCsv, totalDoItem, type ProdutoImportado } from "@/lib/estoque";
import { LeitorCamera, bipe, useCameraDisponivel } from "./Leitor";

type AcaoForm = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;

const reaisParaTexto = (c: number) => (c ? (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "");

// ─── Produto ─────────────────────────────────────────────────────────────────

export interface ProdutoInicial {
  nome: string;
  sku: string;
  codigoBarras: string;
  categoria: string;
  unidade: Unidade;
  preco: string;
  minimo: string;
  controlaEstoque: boolean;
  ativo: boolean;
  custoMedioCentavos: number;
}

export function FormProduto({ acao, inicial, categorias, novo }: { acao: AcaoForm; inicial: ProdutoInicial; categorias: string[]; novo: boolean }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const v = { ...inicial, ...estado.valores } as Record<string, string> & ProdutoInicial;
  const [unidade, setUnidade] = useState<Unidade>(inicial.unidade);
  const [preco, setPreco] = useState(v.preco);
  const [custo, setCusto] = useState(v.custoInicial ?? "");
  const [codigo, setCodigo] = useState(v.codigoBarras);
  const [camera, setCamera] = useState(false);
  const temCamera = useCameraDisponivel();
  const custoCentavos = novo ? (lerReais(custo) ?? 0) : inicial.custoMedioCentavos;
  const m = margem(lerReais(preco) ?? 0, custoCentavos);
  const lido = useCallback((c: string) => {
    bipe();
    setCodigo(c);
    setCamera(false);
  }, []);
  const codigoLimpo = limparCodigo(codigo);
  return (
    <form action={enviar} className="space-y-5">
      <fieldset disabled={pendente} className="space-y-5">
        <Campo rotulo="Nome do produto" nome="nome" erro={e.nome}>
          <input id="nome" name="nome" required maxLength={200} autoFocus={novo} defaultValue={v.nome} className="campo" placeholder="Ex.: Café torrado 500g" />
        </Campo>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo="Código de barras" nome="codigoBarras" erro={e.codigoBarras} dica={codigoLimpo && /^\d+$/.test(codigoLimpo) && !eanValido(codigoLimpo) ? "Esse número não parece um EAN válido — confira, ou use como código próprio." : "Passe o leitor aqui ou digite."}>
            <div className="flex gap-2">
              <input id="codigoBarras" name="codigoBarras" value={codigo} onChange={(x) => setCodigo(x.target.value)} onKeyDown={(x) => x.key === "Enter" && x.preventDefault()} inputMode="numeric" className="campo flex-1" />
              {temCamera && (
                <button type="button" onClick={() => setCamera(true)} className="btn-secundario !px-3" aria-label="Ler pela câmera">▥</button>
              )}
            </div>
          </Campo>
          <Campo rotulo="Código interno / SKU (opcional)" nome="sku" erro={e.sku}>
            <input id="sku" name="sku" maxLength={60} defaultValue={v.sku} className="campo" />
          </Campo>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo="Categoria" nome="categoria" erro={e.categoria}>
            <input id="categoria" name="categoria" list="categorias-produto" maxLength={60} defaultValue={v.categoria} className="campo" placeholder="Ex.: Mercearia" />
          </Campo>
          <datalist id="categorias-produto">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Campo rotulo="Vende por" nome="unidade">
            <select id="unidade" name="unidade" value={unidade} onChange={(x) => setUnidade(x.target.value as Unidade)} className="campo">
              {(Object.keys(UNIDADES) as Unidade[]).map((u) => (
                <option key={u} value={u}>
                  {UNIDADES[u].nome} ({UNIDADES[u].curto})
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo={`Preço de venda (por ${UNIDADES[unidade].curto})`} nome="preco" erro={e.preco}>
            <input id="preco" name="preco" inputMode="decimal" required value={preco} onChange={(x) => setPreco(x.target.value)} className="campo" placeholder="0,00" />
          </Campo>
          <Campo rotulo="Estoque mínimo" nome="minimo" erro={e.minimo} dica="Abaixo disso, o produto entra em “repor”.">
            <input id="minimo" name="minimo" inputMode="decimal" defaultValue={v.minimo} className="campo" placeholder="0" />
          </Campo>
        </div>
        {novo && (
          <div className="grid gap-5 rounded-xl border border-borda p-4 sm:grid-cols-2">
            <Campo rotulo="Quanto tem agora" nome="saldoInicial" erro={e.saldoInicial}>
              <input id="saldoInicial" name="saldoInicial" inputMode="decimal" defaultValue={v.saldoInicial} className="campo" placeholder="0" />
            </Campo>
            <Campo rotulo={`Custo de cada ${UNIDADES[unidade].curto}`} nome="custoInicial" erro={e.custoInicial}>
              <input id="custoInicial" name="custoInicial" inputMode="decimal" value={custo} onChange={(x) => setCusto(x.target.value)} className="campo" placeholder="0,00" />
            </Campo>
          </div>
        )}
        {m != null && custoCentavos > 0 && (
          <p className={`text-sm ${m < 15 ? "text-negativo" : "text-suave"}`}>
            Margem de <strong className="numero">{m.toLocaleString("pt-BR")}%</strong> sobre o preço ({formatarReais((lerReais(preco) ?? 0) - custoCentavos)} por {UNIDADES[unidade].curto})
            {m < 15 ? " — baixa para cobrir impostos e despesas." : "."}
          </p>
        )}
        <label className="flex items-start gap-3">
          <input type="checkbox" name="controlaEstoque" defaultChecked={v.controlaEstoque} className="mt-1 h-5 w-5 accent-[var(--destaque)]" />
          <span>
            <span className="block font-medium">Controlar estoque deste produto</span>
            <span className="text-sm text-suave">Desligue para serviços ou itens feitos na hora (um café coado, uma montagem).</span>
          </span>
        </label>
        {!novo && (
          <label className="flex items-center gap-3">
            <input type="checkbox" name="ativo" defaultChecked={v.ativo} className="h-5 w-5 accent-[var(--destaque)]" />
            <span className="font-medium">Ativo (aparece no caixa)</span>
          </label>
        )}
        <Erro msg={e._} />
        {estado.ok && <p role="status" className="text-sm font-medium text-positivo">{estado.ok}</p>}
        <button className="btn-principal w-full">{pendente ? "Salvando…" : novo ? "Cadastrar produto" : "Salvar alterações"}</button>
      </fieldset>
      {camera && <LeitorCamera onLer={lido} onFechar={() => setCamera(false)} />}
    </form>
  );
}

export function FormPerda({ acao, unidade }: { acao: AcaoForm; unidade: Unidade }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form action={enviar} className="space-y-3">
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <label className="sr-only" htmlFor="qtd-perda">Quantidade perdida</label>
        <input id="qtd-perda" name="quantidade" inputMode="decimal" placeholder={`Qtd (${UNIDADES[unidade].curto})`} className="campo" />
        <label className="sr-only" htmlFor="motivo-perda">Motivo</label>
        <input id="motivo-perda" name="motivo" maxLength={200} placeholder="Motivo: venceu, quebrou…" className="campo" />
      </div>
      <Erro msg={estado.erros?.quantidade ?? estado.erros?._} />
      {estado.ok && <p role="status" className="text-sm text-positivo">{estado.ok}</p>}
      <button className="btn-secundario w-full" disabled={pendente}>{pendente ? "…" : "Registrar perda"}</button>
    </form>
  );
}

// ─── Entrada de mercadoria ───────────────────────────────────────────────────

export interface ProdutoParaLista {
  id: string;
  nome: string;
  codigoBarras: string | null;
  sku: string | null;
  categoria: string;
  unidade: Unidade;
  custoMedioCentavos: number;
  saldoMil: number;
}

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Busca com leitor: Enter com código exato adiciona; senão mostra as opções pelo nome. */
function BuscaDeProduto({ produtos, escolher }: { produtos: ProdutoParaLista[]; escolher: (p: ProdutoParaLista) => void }) {
  const [termo, setTermo] = useState("");
  const [camera, setCamera] = useState(false);
  const temCamera = useCameraDisponivel();
  const opcoes = useMemo(() => {
    const t = semAcento(termo.trim());
    if (!t) return [];
    return produtos.filter((p) => semAcento(p.nome).includes(t) || p.codigoBarras === t || p.sku?.toLowerCase() === t).slice(0, 8);
  }, [produtos, termo]);
  const porCodigo = (c: string) => produtos.find((p) => p.codigoBarras === c || p.sku?.toLowerCase() === c.toLowerCase());
  const lido = useCallback(
    (c: string) => {
      const p = produtos.find((x) => x.codigoBarras === c || x.sku === c);
      bipe(!p);
      if (p) escolher(p);
    },
    [produtos, escolher],
  );
  return (
    <div className="relative">
      <div className="flex gap-2">
        <label htmlFor="busca-produto" className="sr-only">Buscar produto</label>
        <input
          id="busca-produto"
          autoFocus
          autoComplete="off"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const p = porCodigo(limparCodigo(termo)) ?? (opcoes.length === 1 ? opcoes[0] : undefined);
            bipe(!p);
            if (p) {
              escolher(p);
              setTermo("");
            }
          }}
          placeholder="Passe o leitor ou digite o nome"
          className="campo flex-1"
        />
        {temCamera && (
          <button type="button" onClick={() => setCamera(true)} className="btn-secundario !px-3" aria-label="Ler pela câmera">▥</button>
        )}
      </div>
      {opcoes.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-borda bg-superficie shadow-xl">
          {opcoes.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  escolher(p);
                  setTermo("");
                  bipe();
                }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-superficie-2"
              >
                <span className="truncate">{p.nome}</span>
                <span className="shrink-0 text-xs text-suave">{formatarQuantidade(p.saldoMil, p.unidade)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {camera && <LeitorCamera onLer={lido} onFechar={() => setCamera(false)} />}
    </div>
  );
}

interface LinhaEntrada {
  p: ProdutoParaLista;
  quantidade: string;
  custo: string;
}

export function FormEntrada({
  produtos,
  registrar,
  hoje,
}: {
  produtos: ProdutoParaLista[];
  registrar: (d: { linhas: { produtoId: string; quantidadeMil: number; custoUnitarioCentavos: number }[]; documento: string | null; fornecedor: string | null; despesa: { vencimento: string; pago: boolean } | null }) => Promise<{ erro?: string; ok?: string }>;
  hoje: string;
}) {
  const router = useRouter();
  const [linhas, setLinhas] = useState<LinhaEntrada[]>([]);
  const [documento, setDocumento] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [lancar, setLancar] = useState(true);
  const [pago, setPago] = useState(false);
  const [vencimento, setVencimento] = useState(hoje);
  const [resultado, setResultado] = useState<{ erro?: string; ok?: string }>({});
  const [pendente, iniciar] = useTransition();
  const escolher = useCallback((p: ProdutoParaLista) => {
    setLinhas((a) => {
      const i = a.findIndex((l) => l.p.id === p.id);
      if (i >= 0 && !UNIDADES[p.unidade].fracionada) {
        const c = [...a];
        const q = lerQuantidade(c[i].quantidade, p.unidade) ?? 0;
        c[i] = { ...c[i], quantidade: formatarQuantidade(q + MIL, p.unidade, false) };
        return c;
      }
      return [...a, { p, quantidade: "1", custo: reaisParaTexto(p.custoMedioCentavos) }];
    });
  }, []);
  const lidas = linhas.map((l) => ({ ...l, q: lerQuantidade(l.quantidade, l.p.unidade), c: lerReais(l.custo) }));
  const validas = lidas.every((l) => l.q && l.q > 0 && l.c != null);
  const total = lidas.reduce((s, l) => s + (l.q && l.c != null ? totalDoItem(l.q, l.c) : 0), 0);
  const mudar = (i: number, campo: "quantidade" | "custo", valor: string) => setLinhas((a) => a.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  return (
    <div className="space-y-4">
      <BuscaDeProduto produtos={produtos} escolher={escolher} />
      {linhas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-borda px-4 py-8 text-center text-sm text-suave">Passe cada produto que chegou. Repetir o mesmo soma 1.</p>
      ) : (
        <ul className="cartao divide-y divide-borda !p-0">
          {lidas.map((l, i) => (
            <li key={l.p.id + i} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[1fr_7rem_8rem_6rem_auto] sm:items-center">
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.p.nome}</span>
                <span className="text-xs text-suave">tem {formatarQuantidade(l.p.saldoMil, l.p.unidade)} · custo médio {formatarReais(l.p.custoMedioCentavos)}</span>
              </span>
              <button type="button" onClick={() => setLinhas((a) => a.filter((_, j) => j !== i))} aria-label={`Tirar ${l.p.nome}`} className="row-start-1 self-start justify-self-end text-xl text-suave sm:col-start-5">
                ×
              </button>
              <label className="text-xs text-suave">
                Chegou ({UNIDADES[l.p.unidade].curto})
                <input inputMode="decimal" value={l.quantidade} onChange={(e) => mudar(i, "quantidade", e.target.value)} aria-invalid={!l.q} className="campo !min-h-10 !py-1.5 aria-[invalid=true]:border-negativo" />
              </label>
              <label className="text-xs text-suave">
                Custo de cada
                <input inputMode="decimal" value={l.custo} onChange={(e) => mudar(i, "custo", e.target.value)} aria-invalid={l.c == null} className="campo !min-h-10 !py-1.5 aria-[invalid=true]:border-negativo" />
              </label>
              <span className="numero self-end pb-2 text-right text-sm font-semibold">{l.q && l.c != null ? formatarReais(totalDoItem(l.q, l.c)) : "–"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Fornecedor (opcional)" nome="fornecedor">
          <input id="fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} maxLength={120} className="campo" />
        </Campo>
        <Campo rotulo="Nota fiscal / pedido (opcional)" nome="documento">
          <input id="documento" value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={60} className="campo" />
        </Campo>
      </div>
      <div className="space-y-3 rounded-xl border border-borda p-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={lancar} onChange={(e) => setLancar(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--destaque)]" />
          <span>
            <span className="block font-medium">Lançar a compra nas despesas</span>
            <span className="text-sm text-suave">Entra em “Produtos e mercadorias” e aparece em contas a pagar.</span>
          </span>
        </label>
        {lancar && (
          <div className="flex flex-wrap items-center gap-4 pl-8 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={pago} onChange={() => setPago(true)} className="accent-[var(--destaque)]" /> Já paguei
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!pago} onChange={() => setPago(false)} className="accent-[var(--destaque)]" /> Vou pagar em
            </label>
            {!pago && <input type="date" aria-label="Vencimento" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="campo !min-h-10 !w-auto !py-1.5" />}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-suave">Total da compra</span>
        <span className="numero font-titulo text-2xl font-bold">{formatarReais(total)}</span>
      </div>
      {resultado.erro && <p role="alert" className="text-sm text-negativo">{resultado.erro}</p>}
      {resultado.ok && <p role="status" className="text-sm font-medium text-positivo">{resultado.ok}</p>}
      <button
        type="button"
        disabled={!linhas.length || !validas || pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await registrar({
              linhas: lidas.map((l) => ({ produtoId: l.p.id, quantidadeMil: l.q!, custoUnitarioCentavos: l.c! })),
              documento: documento.trim() || null,
              fornecedor: fornecedor.trim() || null,
              despesa: lancar ? { vencimento: pago ? hoje : vencimento, pago } : null,
            });
            setResultado(r);
            if (r.ok) {
              setLinhas([]);
              setDocumento("");
              router.refresh();
            }
          })
        }
        className="btn-principal w-full"
      >
        {pendente ? "Registrando…" : `Dar entrada em ${linhas.length} ${linhas.length === 1 ? "produto" : "produtos"}`}
      </button>
    </div>
  );
}

// ─── Inventário ──────────────────────────────────────────────────────────────

export function Inventario({ produtos, ajustar }: { produtos: ProdutoParaLista[]; ajustar: (c: { produtoId: string; contadoMil: number }[], obs: string) => Promise<{ erro?: string; ok?: string }> }) {
  const router = useRouter();
  const [contado, setContado] = useState<Record<string, string>>({});
  const [categoria, setCategoria] = useState("");
  const [termo, setTermo] = useState("");
  const [resultado, setResultado] = useState<{ erro?: string; ok?: string }>({});
  const [pendente, iniciar] = useTransition();
  const categorias = useMemo(() => [...new Set(produtos.map((p) => p.categoria).filter(Boolean))].sort(), [produtos]);
  const lista = produtos.filter((p) => (!categoria || p.categoria === categoria) && (!termo || semAcento(p.nome).includes(semAcento(termo)) || p.codigoBarras === termo));
  const contagens = produtos.flatMap((p) => {
    const t = contado[p.id];
    if (t === undefined || t.trim() === "") return [];
    const q = lerQuantidade(t, p.unidade);
    return q != null && q >= 0 ? [{ p, q }] : [];
  });
  const diferentes = contagens.filter((c) => c.q !== c.p.saldoMil);
  const impacto = diferentes.reduce((s, c) => s + Math.round(((c.q - c.p.saldoMil) * c.p.custoMedioCentavos) / MIL), 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const p = produtos.find((x) => x.codigoBarras === limparCodigo(termo));
            bipe(!p);
            if (p) {
              setContado((c) => ({ ...c, [p.id]: formatarQuantidade((lerQuantidade(c[p.id] ?? "0", p.unidade) ?? 0) + MIL, p.unidade, false) }));
              setTermo("");
            }
          }}
          placeholder="Filtrar ou passar o leitor (cada leitura conta +1)"
          aria-label="Filtrar produtos ou ler código"
          className="campo min-w-0 flex-1"
        />
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria" className="campo !w-auto">
          <option value="">Todas as categorias</option>
          {categorias.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="cartao overflow-x-auto !p-0">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs text-suave">
            <tr className="border-b border-borda">
              <th className="px-4 py-2.5 font-medium">Produto</th>
              <th className="px-2 py-2.5 text-right font-medium">No sistema</th>
              <th className="px-2 py-2.5 text-right font-medium">Contado</th>
              <th className="px-4 py-2.5 text-right font-medium">Diferença</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {lista.map((p) => {
              const t = contado[p.id] ?? "";
              const q = t.trim() ? lerQuantidade(t, p.unidade) : null;
              const dif = q != null ? q - p.saldoMil : null;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <span className="block font-medium">{p.nome}</span>
                    <span className="text-xs text-suave">{p.categoria || "sem categoria"}</span>
                  </td>
                  <td className="numero px-2 py-2 text-right text-suave">{formatarQuantidade(p.saldoMil, p.unidade)}</td>
                  <td className="px-2 py-2 text-right">
                    <input
                      inputMode="decimal"
                      aria-label={`Contado de ${p.nome}`}
                      value={t}
                      onChange={(e) => setContado((c) => ({ ...c, [p.id]: e.target.value }))}
                      aria-invalid={t.trim() !== "" && q == null}
                      className="numero h-10 w-24 rounded-lg bg-superficie-2 px-2 text-right outline-none focus:ring-2 focus:ring-destaque/40 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-negativo"
                    />
                  </td>
                  <td className={`numero px-4 py-2 text-right font-semibold ${dif == null || dif === 0 ? "text-suave" : dif < 0 ? "text-negativo" : "text-positivo"}`}>
                    {dif == null ? "" : dif === 0 ? "bate" : `${dif > 0 ? "+" : "−"}${formatarQuantidade(Math.abs(dif), p.unidade)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] rounded-2xl border border-borda bg-superficie p-3 shadow-lg">
        <p className="mb-2 text-sm text-suave">
          {contagens.length} {contagens.length === 1 ? "contado" : "contados"} · {diferentes.length} com diferença
          {diferentes.length > 0 && (
            <>
              {" "}· impacto no valor do estoque: <strong className={`numero ${impacto < 0 ? "text-negativo" : "text-positivo"}`}>{formatarReais(impacto)}</strong>
            </>
          )}
        </p>
        {resultado.erro && <p role="alert" className="mb-2 text-sm text-negativo">{resultado.erro}</p>}
        {resultado.ok && <p role="status" className="mb-2 text-sm font-medium text-positivo">{resultado.ok}</p>}
        <button
          type="button"
          disabled={!contagens.length || pendente}
          onClick={() =>
            iniciar(async () => {
              const r = await ajustar(contagens.map((c) => ({ produtoId: c.p.id, contadoMil: c.q })), "Contagem de inventário");
              setResultado(r);
              if (r.ok) {
                setContado({});
                router.refresh();
              }
            })
          }
          className="btn-principal w-full"
        >
          {pendente ? "Ajustando…" : "Ajustar o estoque pelo contado"}
        </button>
      </div>
    </div>
  );
}

// ─── Importação ──────────────────────────────────────────────────────────────

export function Importar({ importar }: { importar: (l: ProdutoImportado[]) => Promise<{ erro?: string; ok?: string }> }) {
  const router = useRouter();
  const [lido, setLido] = useState<ReturnType<typeof produtosDoCsv> | null>(null);
  const [arquivo, setArquivo] = useState("");
  const [resultado, setResultado] = useState<{ erro?: string; ok?: string }>({});
  const [pendente, iniciar] = useTransition();
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-borda px-4 py-10 text-center hover:border-texto/40">
        <span className="font-medium">{arquivo || "Escolher a planilha (.csv)"}</span>
        <span className="text-sm text-suave">No Excel ou Google Planilhas: Arquivo › Salvar como / Baixar › CSV.</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setArquivo(f.name);
            setResultado({});
            setLido(produtosDoCsv(await f.text()));
          }}
        />
      </label>
      {lido && (
        <>
          {lido.erros.length > 0 && (
            <div className="aviso space-y-1">
              <p className="font-medium">{lido.erros.length} {lido.erros.length === 1 ? "linha ficou de fora" : "linhas ficaram de fora"}</p>
              <ul className="text-suave">
                {lido.erros.slice(0, 6).map((x) => (
                  <li key={x.linha}>Linha {x.linha}: {x.motivo}</li>
                ))}
              </ul>
            </div>
          )}
          {lido.produtos.length > 0 && (
            <div className="cartao overflow-x-auto !p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-suave">
                  <tr className="border-b border-borda">
                    <th className="px-4 py-2.5 font-medium">Produto</th>
                    <th className="px-2 py-2.5 font-medium">Código</th>
                    <th className="px-2 py-2.5 text-right font-medium">Preço</th>
                    <th className="px-2 py-2.5 text-right font-medium">Custo</th>
                    <th className="px-4 py-2.5 text-right font-medium">Estoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {lido.produtos.slice(0, 50).map((p, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">
                        {p.nome}
                        {p.categoria && <span className="block text-xs text-suave">{p.categoria}</span>}
                      </td>
                      <td className="px-2 py-2 text-suave">{p.codigoBarras ?? p.sku ?? "–"}</td>
                      <td className="numero px-2 py-2 text-right">{formatarReais(p.precoCentavos)}</td>
                      <td className="numero px-2 py-2 text-right text-suave">{formatarReais(p.custoCentavos)}</td>
                      <td className="numero px-4 py-2 text-right">{formatarQuantidade(p.saldoMil, p.unidade)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lido.produtos.length > 50 && <p className="px-4 py-2 text-xs text-suave">…e mais {lido.produtos.length - 50}.</p>}
            </div>
          )}
          {resultado.erro && <p role="alert" className="text-sm text-negativo">{resultado.erro}</p>}
          {resultado.ok && <p role="status" className="text-sm font-medium text-positivo">{resultado.ok}</p>}
          <button
            type="button"
            disabled={!lido.produtos.length || pendente}
            onClick={() =>
              iniciar(async () => {
                const r = await importar(lido.produtos);
                setResultado(r);
                if (r.ok) router.refresh();
              })
            }
            className="btn-principal w-full"
          >
            {pendente ? "Importando…" : `Importar ${lido.produtos.length} ${lido.produtos.length === 1 ? "produto" : "produtos"}`}
          </button>
          <p className="text-center text-xs text-suave">Quem já existe (mesmo código de barras ou SKU) tem preço e estoque atualizados; o resto entra como novo.</p>
        </>
      )}
    </div>
  );
}
