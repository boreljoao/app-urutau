import Link from "next/link";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { segundos } from "@/components/atendimento/Bolhas";
import { Numero } from "@/components/central/Numero";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { usdParaReais } from "@/lib/atendimento";
import { quando } from "@/lib/central";
import { NOME_SERVICO } from "@/lib/comercial";
import { listarConversasDoSite, resumoDoChat, type FiltroChat } from "@/lib/servidor/chat-site";
import { formatarTelefone } from "@/lib/validacao";

export const metadata = { title: "Chat do site" };
export const dynamic = "force-dynamic";

const FILTROS: { id: FiltroChat; rotulo: string }[] = [
  { id: "abertas", rotulo: "Abertas" },
  { id: "equipe", rotulo: "Esperando a equipe" },
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
  const [r, lista] = await Promise.all([resumoDoChat(db, agora), listarConversasDoSite(db, filtro)]);
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
                      </p>
                      <p className="mt-0.5 truncate text-[14px] text-suave">
                        {c.status === "humano" && c.motivoHumano ? `Chamou a equipe: ${c.motivoHumano}` : (c.resumo ?? c.ultimaMensagem ?? "")}
                      </p>
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
