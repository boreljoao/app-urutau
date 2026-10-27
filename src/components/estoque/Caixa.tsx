"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormaPagamento, Unidade } from "@/db/schema";
import { formatarReais, lerReais } from "@/lib/dinheiro";
import { MIL, UNIDADES, formatarQuantidade, lerQuantidade, limparCodigo, totalDoItem, troco as calcularTroco } from "@/lib/estoque";
import { LeitorCamera, bipe, useCameraDisponivel } from "./Leitor";

export interface ProdutoDoCaixa {
  id: string;
  nome: string;
  codigoBarras: string | null;
  sku: string | null;
  categoria: string;
  unidade: Unidade;
  precoCentavos: number;
  saldoMil: number;
  controlaEstoque: boolean;
}

interface Linha {
  chave: string;
  produtoId: string | null;
  nome: string;
  unidade: Unidade;
  precoCentavos: number;
  quantidadeMil: number;
}

type Resultado = { erro: string } | { vendaId: string; totalCentavos: number; estoqueNegativo: string[] };
type Vender = (v: {
  itens: { produtoId: string | null; descricao?: string; quantidadeMil: number; precoUnitarioCentavos?: number }[];
  descontoCentavos: number;
  formaPagamento: FormaPagamento;
  clienteId: string | null;
  aReceber: boolean;
}) => Promise<Resultado>;

const FORMAS: { id: FormaPagamento | "fiado"; nome: string; tecla: string }[] = [
  { id: "pix", nome: "Pix", tecla: "1" },
  { id: "debito", nome: "Débito", tecla: "2" },
  { id: "credito", nome: "Crédito", tecla: "3" },
  { id: "dinheiro", nome: "Dinheiro", tecla: "4" },
  { id: "fiado", nome: "Fiado", tecla: "5" },
];

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function Caixa({
  produtos,
  clientes,
  vender,
  base,
  podeCadastrar,
}: {
  produtos: ProdutoDoCaixa[];
  clientes: { id: string; nome: string; telefone: string | null }[];
  vender: Vender;
  base: string;
  podeCadastrar: boolean;
}) {
  const router = useRouter();
  const busca = useRef<HTMLInputElement>(null);
  const [termo, setTermo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState("");
  const [forma, setForma] = useState<FormaPagamento | "fiado">("pix");
  const [recebido, setRecebido] = useState("");
  const [cliente, setCliente] = useState("");
  const [camera, setCamera] = useState(false);
  const temCamera = useCameraDisponivel();
  const [aviso, setAviso] = useState<{ texto: string; codigo?: string } | null>(null);
  const [feito, setFeito] = useState<{ total: number; troco: number | null; alertas: string[]; cliente: (typeof clientes)[number] | null; itens: Linha[] } | null>(null);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const [avulso, setAvulso] = useState(false);

  const porCodigo = useMemo(() => {
    const m = new Map<string, ProdutoDoCaixa>();
    for (const p of produtos) {
      if (p.codigoBarras) m.set(p.codigoBarras, p);
      if (p.sku) m.set(p.sku.toLowerCase(), p);
    }
    return m;
  }, [produtos]);
  const categorias = useMemo(() => [...new Set(produtos.map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [produtos]);
  const visiveis = useMemo(() => {
    const t = semAcento(termo.trim());
    return produtos.filter((p) => (!categoria || p.categoria === categoria) && (!t || semAcento(p.nome).includes(t) || p.codigoBarras?.startsWith(t))).slice(0, 60);
  }, [produtos, termo, categoria]);

  const subtotal = linhas.reduce((s, l) => s + totalDoItem(l.quantidadeMil, l.precoCentavos), 0);
  const descontoCentavos = Math.min(subtotal, lerReais(desconto) ?? 0);
  const total = subtotal - descontoCentavos;
  const recebidoCentavos = lerReais(recebido);
  const troco = forma === "dinheiro" && recebidoCentavos != null ? calcularTroco(recebidoCentavos, total) : null;
  const clienteEscolhido = clientes.find((c) => c.nome === cliente) ?? null;
  const itens = linhas.reduce((s, l) => s + (UNIDADES[l.unidade].fracionada ? 1 : l.quantidadeMil / MIL), 0);

  const focarBusca = () => requestAnimationFrame(() => busca.current?.focus());

  const adicionar = useCallback((p: ProdutoDoCaixa, quantidadeMil = MIL) => {
    bipe();
    setAviso(null);
    setLinhas((atual) => {
      const i = atual.findIndex((l) => l.produtoId === p.id);
      if (i >= 0 && !UNIDADES[p.unidade].fracionada) {
        const copia = [...atual];
        copia[i] = { ...copia[i], quantidadeMil: copia[i].quantidadeMil + quantidadeMil };
        return copia;
      }
      return [...atual, { chave: `${p.id}-${Date.now()}`, produtoId: p.id, nome: p.nome, unidade: p.unidade, precoCentavos: p.precoCentavos, quantidadeMil }];
    });
  }, []);

  /** O que veio do leitor (ou digitado): "3*7891000315507" vende 3 de uma vez. */
  const lerEntrada = useCallback(
    (texto: string) => {
      const m = /^(\d+(?:[.,]\d{1,3})?)\s*[*xX]\s*(.+)$/.exec(texto.trim());
      const codigo = limparCodigo(m ? m[2] : texto);
      if (!codigo) return;
      const p = porCodigo.get(codigo) ?? porCodigo.get(codigo.toLowerCase());
      if (p) {
        const qtd = m ? lerQuantidade(m[1], p.unidade) : MIL;
        adicionar(p, qtd && qtd > 0 ? qtd : MIL);
        setTermo("");
        return;
      }
      if (visiveis.length === 1 && !/^\d{6,}$/.test(codigo)) {
        adicionar(visiveis[0]);
        setTermo("");
        return;
      }
      if (/^\d{6,}$/.test(codigo)) {
        bipe(true);
        setAviso({ texto: `Código ${codigo} não está cadastrado.`, codigo });
        setTermo("");
      }
    },
    [porCodigo, visiveis, adicionar],
  );

  const lidoNaCamera = useCallback((c: string) => lerEntrada(c), [lerEntrada]);

  const mudarQuantidade = (chave: string, mil: number) => setLinhas((a) => a.flatMap((l) => (l.chave !== chave ? [l] : mil > 0 ? [{ ...l, quantidadeMil: mil }] : [])));

  const limpar = () => {
    setLinhas([]);
    setDesconto("");
    setRecebido("");
    setCliente("");
    setForma("pix");
    setErro(undefined);
    setAviso(null);
    focarBusca();
  };

  const finalizar = useCallback(() => {
    if (!linhas.length || pendente) return;
    if (forma === "fiado" && !clienteEscolhido) return setErro("Venda fiado precisa de cliente: escolha quem está levando.");
    if (forma === "dinheiro" && recebido && troco === null) return setErro("O valor recebido é menor que o total.");
    setErro(undefined);
    iniciar(async () => {
      const r = await vender({
        itens: linhas.map((l) => (l.produtoId ? { produtoId: l.produtoId, quantidadeMil: l.quantidadeMil } : { produtoId: null, descricao: l.nome, quantidadeMil: l.quantidadeMil, precoUnitarioCentavos: l.precoCentavos })),
        descontoCentavos,
        formaPagamento: forma === "fiado" ? "outro" : forma,
        clienteId: clienteEscolhido?.id ?? null,
        aReceber: forma === "fiado",
      });
      if ("erro" in r) {
        bipe(true);
        setErro(r.erro);
        return;
      }
      setFeito({ total: r.totalCentavos, troco, alertas: r.estoqueNegativo, cliente: clienteEscolhido, itens: linhas });
      router.refresh();
    });
  }, [linhas, pendente, forma, clienteEscolhido, recebido, troco, descontoCentavos, vender, router]);

  // Atalhos de caixa: F2 finaliza, Esc limpa a busca (ou fecha o recibo), 1–5 escolhem o pagamento fora dos campos.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const emCampo = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "F2" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (feito) return;
        finalizar();
      } else if (e.key === "Escape") {
        if (feito) {
          setFeito(null);
          limpar();
        } else {
          setTermo("");
          focarBusca();
        }
      } else if (!emCampo && !feito) {
        const f = FORMAS.find((x) => x.tecla === e.key);
        if (f) setForma(f.id);
        else if (e.key === "/") {
          e.preventDefault();
          focarBusca();
        }
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  const comprovante = feito
    ? [
        "Comprovante de compra",
        ...feito.itens.map((l) => `${formatarQuantidade(l.quantidadeMil, l.unidade)} ${l.nome} — ${formatarReais(totalDoItem(l.quantidadeMil, l.precoCentavos))}`),
        `Total: ${formatarReais(feito.total)}`,
        "Obrigado pela preferência!",
      ].join("\n")
    : "";

  return (
    <MotionConfig reducedMotion="user">
      <div className="tela-larga grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label="Produtos" className="min-w-0 space-y-3">
          <div className="flex gap-2">
            <label htmlFor="busca-caixa" className="sr-only">Código de barras ou nome do produto</label>
            <input
              ref={busca}
              id="busca-caixa"
              autoFocus
              autoComplete="off"
              inputMode="search"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  lerEntrada(termo);
                }
              }}
              placeholder="Código de barras ou nome"
              title="Passe o leitor ou digite o nome. 3*código vende 3 de uma vez."
              className="campo flex-1 !text-lg"
            />
            {temCamera && (
              <button type="button" onClick={() => setCamera(true)} className="btn-secundario !px-4" aria-label="Ler código pela câmera">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M14 8v8M17 8v8" />
                </svg>
              </button>
            )}
          </div>

          {aviso && (
            <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-negativo bg-negativo-fundo px-3 py-2 text-sm">
              {aviso.texto}
              {aviso.codigo && podeCadastrar && (
                <Link href={`${base}/estoque/produtos/novo?codigo=${encodeURIComponent(aviso.codigo)}`} className="font-semibold underline">Cadastrar agora</Link>
              )}
            </p>
          )}

          {categorias.length > 1 && (
            <nav aria-label="Categorias" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {["", ...categorias].map((c) => (
                <button
                  key={c || "todas"}
                  type="button"
                  onClick={() => setCategoria(c)}
                  aria-pressed={categoria === c}
                  className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${categoria === c ? "border-texto bg-texto font-semibold text-fundo" : "border-borda text-suave"}`}
                >
                  {c || "Todas"}
                </button>
              ))}
            </nav>
          )}

          {produtos.length === 0 ? (
            <div className="cartao space-y-2 text-center">
              <p className="font-medium">Nenhum produto cadastrado ainda.</p>
              <p className="text-sm text-suave">Cadastre um por um ou importe a planilha do sistema antigo. Dá para vender item avulso enquanto isso.</p>
              {podeCadastrar && (
                <div className="flex justify-center gap-2 pt-1">
                  <Link href={`${base}/estoque/produtos/novo`} className="btn-secundario">Cadastrar</Link>
                  <Link href={`${base}/estoque/importar`} className="btn-secundario">Importar planilha</Link>
                </div>
              )}
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {visiveis.map((p) => {
                const zerado = p.controlaEstoque && p.saldoMil <= 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        adicionar(p);
                        focarBusca();
                      }}
                      className="flex h-full min-h-24 w-full flex-col justify-between rounded-xl border border-borda bg-superficie p-3 text-left transition-[transform,border-color] hover:border-texto/40 active:scale-[.97]"
                    >
                      <span className="line-clamp-2 text-[15px] font-medium leading-snug">{p.nome}</span>
                      <span className="mt-2 flex items-end justify-between gap-2">
                        <span className="numero text-base font-bold">
                          {formatarReais(p.precoCentavos)}
                          {UNIDADES[p.unidade].fracionada && <span className="text-xs font-normal text-suave">/{UNIDADES[p.unidade].curto}</span>}
                        </span>
                        {p.controlaEstoque && (
                          <span className={`text-[11px] ${zerado ? "font-semibold text-negativo" : "text-suave"}`}>{zerado ? "sem estoque" : formatarQuantidade(p.saldoMil, p.unidade)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {visiveis.length === 0 && produtos.length > 0 && <p className="py-6 text-center text-suave">Nada com “{termo}”. Enter procura pelo código.</p>}
        </section>

        <aside id="venda-atual" aria-label="Venda atual" className="scroll-mt-20 self-start lg:sticky lg:top-20">
          <div className="cartao space-y-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-titulo text-lg font-bold">Venda atual</h2>
              {linhas.length > 0 && (
                <button type="button" onClick={limpar} className="text-sm text-suave underline">Limpar</button>
              )}
            </div>

            {linhas.length === 0 ? (
              <p className="rounded-xl border border-dashed border-borda px-4 py-8 text-center text-sm text-suave">Passe um produto no leitor ou toque num item ao lado.</p>
            ) : (
              <ul className="-mx-1 max-h-[42vh] space-y-1 overflow-y-auto px-1">
                <AnimatePresence initial={false}>
                  {linhas.map((l) => (
                    <motion.li
                      key={l.chave}
                      layout
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                      className="rounded-lg bg-superficie-2 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium leading-snug">{l.nome}</span>
                        <span className="numero shrink-0 text-sm font-bold">{formatarReais(totalDoItem(l.quantidadeMil, l.precoCentavos))}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-suave">
                        <Quantidade linha={l} mudar={(mil) => mudarQuantidade(l.chave, mil)} />
                        <span>× {formatarReais(l.precoCentavos)}</span>
                        <button type="button" onClick={() => mudarQuantidade(l.chave, 0)} aria-label={`Tirar ${l.nome}`} className="grid h-8 w-8 place-items-center rounded-full text-base hover:bg-superficie">
                          ×
                        </button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}

            {avulso ? (
              <ItemAvulso
                adicionar={(nome, preco) => {
                  setLinhas((a) => [...a, { chave: `avulso-${Date.now()}`, produtoId: null, nome, unidade: "un", precoCentavos: preco, quantidadeMil: MIL }]);
                  setAvulso(false);
                  bipe();
                  focarBusca();
                }}
                cancelar={() => setAvulso(false)}
              />
            ) : (
              <button type="button" onClick={() => setAvulso(true)} className="text-sm font-medium underline">+ Item avulso (sem cadastro)</button>
            )}

            <div className="space-y-1 border-t border-borda pt-3 text-sm">
              <p className="flex justify-between text-suave">
                <span>{itens.toLocaleString("pt-BR")} {itens === 1 ? "item" : "itens"}</span>
                <span className="numero">{formatarReais(subtotal)}</span>
              </p>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="desconto" className="text-suave">Desconto</label>
                <input id="desconto" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" className="w-28 rounded-lg bg-superficie-2 px-2.5 py-1.5 text-right outline-none focus:ring-2 focus:ring-destaque/40" />
              </div>
              <p className="flex items-baseline justify-between pt-1">
                <span className="font-titulo text-base font-bold">Total</span>
                <span className="numero font-titulo text-3xl font-bold">{formatarReais(total)}</span>
              </p>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-sm text-suave">Pagamento</legend>
              <div className="grid grid-cols-5 gap-1.5">
                {FORMAS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setForma(f.id)}
                    aria-pressed={forma === f.id}
                    className={`rounded-lg border px-1 py-2.5 text-[13px] font-semibold ${forma === f.id ? "border-destaque bg-destaque text-sobre-destaque" : "border-borda bg-superficie-2"}`}
                  >
                    {f.nome}
                  </button>
                ))}
              </div>
            </fieldset>

            {forma === "dinheiro" && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <label htmlFor="recebido" className="text-suave">Recebido</label>
                <input id="recebido" inputMode="decimal" value={recebido} onChange={(e) => setRecebido(e.target.value)} placeholder={formatarReais(total)} className="w-32 rounded-lg bg-superficie-2 px-2.5 py-1.5 text-right outline-none focus:ring-2 focus:ring-destaque/40" />
                {troco != null && <span className="numero font-bold text-positivo">Troco {formatarReais(troco)}</span>}
              </div>
            )}

            <div>
              <label htmlFor="cliente-caixa" className="mb-1 block text-sm text-suave">{forma === "fiado" ? "Cliente (obrigatório no fiado)" : "Cliente (opcional)"}</label>
              <input id="cliente-caixa" list="clientes-caixa" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nome do cliente" className="campo !min-h-10 !py-2 text-sm" autoComplete="off" />
              <datalist id="clientes-caixa">
                {clientes.map((c) => (
                  <option key={c.id} value={c.nome} />
                ))}
              </datalist>
            </div>

            {erro && <p role="alert" className="text-sm text-negativo">{erro}</p>}
            <button type="button" onClick={finalizar} disabled={!linhas.length || pendente} className="btn-principal w-full !min-h-14 text-lg">
              {pendente ? "Registrando…" : `Finalizar ${formatarReais(total)}`}
            </button>
            <p className="hidden text-center text-xs text-suave lg:block">F2 finaliza · Esc limpa a busca · 1 a 5 escolhem o pagamento</p>
          </div>
        </aside>
      </div>

      {linhas.length > 0 && !feito && (
        <a
          href="#venda-atual"
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between rounded-2xl bg-texto px-4 py-3 font-semibold text-fundo shadow-xl lg:hidden"
        >
          <span>
            {itens.toLocaleString("pt-BR")} {itens === 1 ? "item" : "itens"} · <span className="numero">{formatarReais(total)}</span>
          </span>
          <span>Ver venda ›</span>
        </a>
      )}

      {camera && <LeitorCamera onLer={lidoNaCamera} onFechar={() => { setCamera(false); focarBusca(); }} />}

      <AnimatePresence>
        {feito && (
          <motion.div
            role="dialog"
            aria-label="Venda registrada"
            className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-sm space-y-4 rounded-2xl border border-borda bg-superficie p-6 text-center shadow-2xl"
              initial={{ scale: 0.94, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            >
              <span aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-positivo/15 text-3xl text-positivo">✓</span>
              <div>
                <p className="text-sm text-suave">Venda registrada</p>
                <p className="numero font-titulo text-4xl font-bold">{formatarReais(feito.total)}</p>
                {feito.troco != null && feito.troco > 0 && <p className="numero mt-1 text-xl font-bold text-positivo">Troco: {formatarReais(feito.troco)}</p>}
              </div>
              {feito.alertas.length > 0 && (
                <p className="rounded-xl bg-aviso-fundo px-3 py-2 text-left text-sm">
                  O sistema mostrava menos do que foi vendido de <strong>{feito.alertas.join(", ")}</strong>. Confira o estoque ou registre a entrada que faltou.
                </p>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    setFeito(null);
                    limpar();
                  }}
                  className="btn-principal w-full"
                >
                  Nova venda (Esc)
                </button>
                {feito.cliente?.telefone && (
                  <a href={`https://wa.me/${feito.cliente.telefone}?text=${encodeURIComponent(comprovante)}`} target="_blank" rel="noreferrer" className="btn-secundario w-full">
                    Enviar comprovante no WhatsApp
                  </a>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function Quantidade({ linha, mudar }: { linha: Linha; mudar: (mil: number) => void }) {
  const fracionada = UNIDADES[linha.unidade].fracionada;
  const [texto, setTexto] = useState(formatarQuantidade(linha.quantidadeMil, linha.unidade, false));
  useEffect(() => setTexto(formatarQuantidade(linha.quantidadeMil, linha.unidade, false)), [linha.quantidadeMil, linha.unidade]);
  const confirmar = () => {
    const q = lerQuantidade(texto, linha.unidade);
    if (q && q > 0) mudar(q);
    else setTexto(formatarQuantidade(linha.quantidadeMil, linha.unidade, false));
  };
  return (
    <span className="flex items-center gap-1">
      {!fracionada && (
        <button type="button" onClick={() => mudar(linha.quantidadeMil - MIL)} aria-label="Menos um" className="grid h-8 w-8 place-items-center rounded-full border border-borda text-base">
          −
        </button>
      )}
      <input
        aria-label={`Quantidade de ${linha.nome}`}
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
        autoFocus={fracionada && linha.quantidadeMil === MIL}
        className="numero h-8 w-16 rounded-md bg-superficie px-1 text-center text-sm text-texto outline-none focus:ring-2 focus:ring-destaque/40"
      />
      {fracionada ? (
        <span>{UNIDADES[linha.unidade].curto}</span>
      ) : (
        <button type="button" onClick={() => mudar(linha.quantidadeMil + MIL)} aria-label="Mais um" className="grid h-8 w-8 place-items-center rounded-full border border-borda text-base">
          +
        </button>
      )}
    </span>
  );
}

function ItemAvulso({ adicionar, cancelar }: { adicionar: (nome: string, precoCentavos: number) => void; cancelar: () => void }) {
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState("");
  const valor = lerReais(preco);
  return (
    <div className="space-y-2 rounded-xl border border-borda p-3">
      <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Descrição (ex.: encomenda)" className="campo !min-h-10 !py-2 text-sm" aria-label="Descrição do item avulso" />
      <div className="flex gap-2">
        <input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="Preço" className="campo !min-h-10 flex-1 !py-2 text-sm" aria-label="Preço do item avulso" />
        <button type="button" disabled={!nome.trim() || !valor} onClick={() => adicionar(nome.trim(), valor!)} className="btn-principal !min-h-10 !px-4 text-sm">
          Pôr
        </button>
        <button type="button" onClick={cancelar} className="btn-secundario !min-h-10 !px-3 text-sm">Cancelar</button>
      </div>
    </div>
  );
}
