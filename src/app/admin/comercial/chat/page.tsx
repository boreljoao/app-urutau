import Link from "next/link";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { segundos } from "@/components/atendimento/Bolhas";
import { Numero } from "@/components/central/Numero";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { usdParaReais } from "@/lib/atendimento";
import { quando } from "@/lib/central";
import { NOME_SERVICO } from "@/lib/comercial";
import { Temperatura } from "@/components/central/Temperatura";
import { NOME_URGENCIA, type Urgencia } from "@/lib/chat-site";
import { listarConversasDoSite, oQueOsVisitantesQuerem, resumoDoChat, type FiltroChat } from "@/lib/servidor/chat-site";
import { formatarTelefone } from "@/lib/validacao";

export const metadata = { title: "Chat do site" };
export const dynamic = "force-dynamic";

const FILTROS: { id: FiltroChat; rotulo: string }[] = [
  { id: "abertas", rotulo: "Abertas" },
  { id: "equipe", rotulo: "Esperando a equipe" },
  { id: "quentes", rotulo: "Quentes" },
  { id: "contato", rotulo: "Deixaram contato" },
  { id: "todas", rotulo: "Todas" },
];

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  agente: { rotulo: "com o agente", cor: "var(--positivo)" },
  humano: { rotulo: "com a equipe", cor: "var(--destaque)" },
  esperando: { rotulo: "espera a equipe", cor: "var(--negativo)" },
  encerrada: { rotulo: "encerrada", cor: "var(--borda)" },
};

const reais = (micros: number) => usdParaReais(micros / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mostrarContato = (c: string | null) => (c && /^\d+$/.test(c) ? formatarTelefone(c) : c);

export default async function ChatDoSite({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f } = await searchParams;
  const filtro = FILTROS.some((x) => x.id === f) ? (f as FiltroChat) : "abertas";
  const db = obterDb();
  const agora = new Date();
  const [r, lista, querem] = await Promise.all([resumoDoChat(db, agora), listarConversasDoSite(db, filtro), oQueOsVisitantesQuerem(db, agora)]);
  const maiorFrente = Math.max(1, ...querem.frentes.map((f) => f.n));
  const conversao = r.conversas30d ? `${Math.round((r.contatos30d / r.conversas30d) * 100)}% das conversas` : "sem conversas";

  return (
    <div className="space-y-3">
      <AtualizarSozinho segundos={10} />
      <header>
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Chat do site</h1>
        <p className="mt-1 text-[15px] text-suave">
          O agente da Urutau atende quem entra no urutau.io a qualquer hora. Quando a pessoa deixa contato, vira lead; quando ele chama a equipe, a
          conversa aparece aqui e na fila da visão geral.
        </p>
      </header>

      {r.falhas7d > 0 && (
        <p role="alert" className="rounded-xl border border-negativo bg-negativo-fundo p-3 text-sm">
          <strong>
            O agente falhou {r.falhas7d} {r.falhas7d === 1 ? "vez" : "vezes"} nesta semana.
          </strong>{" "}
          Quem escreveu viu o aviso para deixar contato. Abra a conversa para ver o motivo (sem a ANTHROPIC_API_KEY na Vercel, o agente não responde).
        </p>
      )}

      <section className="cartao" aria-label="Números do chat">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Numero rotulo="Conversas hoje" valor={String(r.hoje)} linha={`${r.semana} nos últimos 7 dias`} />
          <Numero
            rotulo="Esperando a equipe"
            valor={String(r.esperandoEquipe)}
            linha={r.naoLidas ? `${r.naoLidas} mensagens novas` : "nenhuma mensagem nova"}
            destaque={r.esperandoEquipe > 0}
          />
          <Numero rotulo="Deixaram contato" valor={String(r.contatos30d)} linha={`30 dias · ${conversao}`} />
          <Numero rotulo="Respostas em 7 dias" valor={String(r.agente7d + r.equipe7d)} linha={`${r.agente7d} do agente · ${r.equipe7d} da equipe`} />
          <Numero rotulo="Tempo de resposta" valor={segundos(r.tempoMedioMs) ?? "–"} linha="média do agente, 7 dias" />
          <Numero rotulo="Custo da IA" valor={reais(r.custo30dMicros)} linha={`30 dias · teto de ${r.limiteDiario} respostas/dia`} />
        </dl>
      </section>

      <section className="cartao" aria-labelledby="t-querem">
        <TituloBloco>
          <span id="t-querem">O que os visitantes querem</span>
          <span className="ml-2 text-[12px] font-normal text-meta">últimos {querem.dias} dias, anotado pelo agente</span>
        </TituloBloco>
        {querem.frentes.length === 0 && querem.objetivos.length === 0 ? (
          <Vazio>Assim que alguém conversar com o urutau, aparece aqui o que as pessoas procuram e o que perguntam.</Vazio>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-suave">Frentes procuradas</h3>
              <ul className="space-y-1.5">
                {querem.frentes.map((f) => (
                  <li key={f.frente} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{NOME_SERVICO[f.frente] ?? f.frente}</span>
                      <span className="numero text-suave">{f.n}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-superficie-2">
                      <div className="h-1.5 rounded-full bg-destaque" style={{ width: `${(f.n / maiorFrente) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="pt-1 text-[12px] text-meta">
                {(["quente", "morno", "frio"] as const).map((t) => `${querem.temperaturas[t] ?? 0} ${t}`).join(" · ")}
                {" · "}
                {(Object.keys(NOME_URGENCIA) as Urgencia[]).map((u) => `${querem.urgencias[u] ?? 0} ${NOME_URGENCIA[u]}`).join(" · ")}
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-suave">O que pediram</h3>
              <ul className="space-y-1.5 text-sm">
                {querem.objetivos.map((o, i) => (
                  <li key={`${o.conversaId}-${i}`}>
                    <Link href={`/admin/comercial/chat/${o.conversaId}`} className="hover:underline">
                      {o.texto}
                    </Link>{" "}
                    <span className="text-[12px] text-meta">{o.nome ?? "visitante"}</span> <Temperatura t={o.temperatura} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-suave">Dúvidas que fizeram</h3>
              <ul className="space-y-1.5 text-sm">
                {querem.duvidas.map((d, i) => (
                  <li key={`${d.conversaId}-${i}`}>
                    <Link href={`/admin/comercial/chat/${d.conversaId}`} className="hover:underline">
                      “{d.texto}”
                    </Link>{" "}
                    <span className="text-[12px] text-meta">{d.nome ?? "visitante"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section className="cartao" aria-labelledby="t-conversas">
        <TituloBloco
          acao={
            <nav aria-label="Filtro" className="flex flex-wrap gap-1">
              {FILTROS.map((x) => (
                <Link
                  key={x.id}
                  href={`/admin/comercial/chat?f=${x.id}`}
                  aria-current={x.id === filtro ? "page" : undefined}
                  className={`rounded-full px-3 py-1 text-[13px] ${x.id === filtro ? "bg-superficie-2 font-semibold text-texto" : "text-suave hover:text-texto"}`}
                >
                  {x.rotulo}
                </Link>
              ))}
            </nav>
          }
        >
          <span id="t-conversas">Conversas</span>
        </TituloBloco>
        {lista.length === 0 ? (
          <Vazio>
            {filtro === "equipe" ? "Ninguém esperando a equipe agora." : "Nenhuma conversa aqui ainda. Elas aparecem assim que alguém escrever no chat do site."}
          </Vazio>
        ) : (
          <ul className="divide-y divide-borda">
            {lista.map((c) => {
              const s = STATUS[c.status === "humano" && c.ultimoAutor === "cliente" ? "esperando" : c.status];
              return (
                <li key={c.id}>
                  <Link href={`/admin/comercial/chat/${c.id}`} className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-superficie-2/60">
                    <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.cor }} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{c.nome ?? "Visitante sem nome"}</span>
                        {c.contato && <span className="text-[13px] text-suave">{mostrarContato(c.contato)}</span>}
                        <span className="text-[12px] text-meta">{s.rotulo}</span>
                        <Temperatura t={c.ficha.temperatura} />
                      </p>
                      <p className="mt-0.5 truncate text-[14px] text-suave">
                        {c.status === "humano" && c.motivoHumano
                          ? `Chamou a equipe: ${c.motivoHumano}`
                          : (c.ficha.objetivo ?? c.resumo ?? c.ultimaMensagem ?? "")}
                      </p>
                      {(c.ficha.duvidas?.length ?? 0) > 0 && (
                        <p className="mt-0.5 truncate text-[13px] text-meta">Perguntou: {c.ficha.duvidas?.at(-1)}</p>
                      )}
                      {c.interesses.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {c.interesses.map((i) => (
                            <span key={i} className="rounded-full bg-superficie-2 px-2 py-0.5 text-[11px] text-suave">
                              {NOME_SERVICO[i] ?? i}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-[12px] text-meta">
                      <p>{quando(c.ultimaMensagemEm, agora)}</p>
                      <p className="numero">
                        {c.mensagens} msg · {reais(c.custoMicros)}
                      </p>
                      {c.status === "humano" && c.naoLidas > 0 && (
                        <span className="numero mt-1 inline-block rounded-full bg-destaque px-1.5 text-[11px] font-bold text-fundo">{c.naoLidas}</span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
