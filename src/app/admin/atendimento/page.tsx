import Link from "next/link";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { BotaoAcao } from "@/components/BotaoAcao";
import { segundos } from "@/components/atendimento/Bolhas";
import { Numero } from "@/components/central/Numero";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { MODELOS, NOME_ESTADO, estadoDoAgente, estimarCustoMensal, precoDo, usdParaReais, type EstadoAgente } from "@/lib/atendimento";
import { quando } from "@/lib/central";
import { formatarReais } from "@/lib/dinheiro";
import { PERFIS } from "@/lib/perfis";
import { criarAgenteCentralAcao, mudarModoCentralAcao } from "@/lib/servidor/acoes-atendimento";
import { lojasSemAgente, movimentoRecente, painelAtendimento } from "@/lib/servidor/atendimento";
import { resumoDoChat } from "@/lib/servidor/chat-site";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { formatarTelefone } from "@/lib/validacao";

export const metadata = { title: "Atendimento" };
export const dynamic = "force-dynamic";

const reais = (usd: number) => usdParaReais(usd).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: usd < 10 ? 2 : 0 });

const COR: Record<EstadoAgente, string> = {
  erro: "var(--negativo)",
  no_ar: "var(--positivo)",
  aprovacao: "var(--positivo)",
  simulador: "var(--texto-meta)",
  pausado: "var(--borda)",
  sem_agente: "var(--borda)",
};

function Estado({ estado }: { estado: EstadoAgente }) {
  const vazado = estado === "aprovacao" || estado === "simulador";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold" style={{ color: estado === "erro" ? "var(--negativo)" : "var(--texto)" }}>
      <span className="relative inline-flex h-2 w-2">
        {estado === "no_ar" && <span className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: COR.no_ar }} />}
        <span className="relative h-2 w-2 rounded-full" style={vazado ? { boxShadow: `inset 0 0 0 1.5px ${COR[estado]}` } : { background: COR[estado] }} />
      </span>
      {NOME_ESTADO[estado]}
    </span>
  );
}

const AUTOR: Record<string, string> = { cliente: "Cliente", agente: "Agente", humano: "Equipe", sistema: "Sistema" };

export default async function CentralAtendimento() {
  await exigirSuperadmin();
  const db = obterDb();
  const agora = new Date();
  const [lojas, feed, semAgente, chat] = await Promise.all([painelAtendimento(db, agora), movimentoRecente(db, 30), lojasSemAgente(db), resumoDoChat(db, agora)]);
  const comEstado = lojas.map((l) => ({ ...l, estado: estadoDoAgente(l, agora) }));
  const ordem: EstadoAgente[] = ["erro", "no_ar", "aprovacao", "simulador", "pausado", "sem_agente"];
  comEstado.sort((a, b) => ordem.indexOf(a.estado) - ordem.indexOf(b.estado) || b.conversas7d - a.conversas7d);

  const soma = (k: "conversasHoje" | "comEquipe" | "aprovar" | "respostasAgente7d" | "respostasEquipe7d" | "custo30dMicros" | "vendas30d" | "vendas30dCentavos" | "falhas7d") =>
    lojas.reduce((s, l) => s + Number(l[k]), 0);
  const noAr = comEstado.filter((l) => l.estado === "no_ar" || l.estado === "aprovacao").length;
  const comErro = comEstado.filter((l) => l.estado === "erro").length;
  const agente7d = soma("respostasAgente7d");
  const equipe7d = soma("respostasEquipe7d");
  const parteAgente = agente7d + equipe7d ? Math.round((agente7d / (agente7d + equipe7d)) * 100) : null;
  const custo30 = soma("custo30dMicros") / 1e6;
  const precisam = soma("aprovar") + soma("comEquipe");

  const achado = [
    lojas.length ? `${noAr} de ${lojas.length} ${lojas.length === 1 ? "atendente" : "atendentes"} no ar` : "nenhum atendente criado ainda",
    comErro ? `${comErro} com erro` : null,
    precisam ? `${precisam} ${precisam === 1 ? "conversa espera" : "conversas esperam"} alguém das lojas` : "nenhuma conversa esperando gente",
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <AtualizarSozinho segundos={15} />
      <header className="pb-2">
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Atendimento</h1>
        <p className="mt-1 text-[15px] text-suave">{achado.join(" · ")}.</p>
      </header>

      <section className="cartao entrada" aria-labelledby="t-numeros">
        <h2 id="t-numeros" className="sr-only">Números do atendimento</h2>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Numero rotulo="Atendentes no ar" valor={`${noAr}/${lojas.length}`} linha={comErro ? `${comErro} com erro agora` : "nenhum erro nas últimas 24h"} tom={comErro ? "negativo" : undefined} />
          <Numero rotulo="Conversas hoje" valor={String(soma("conversasHoje"))} linha={`${lojas.reduce((s, l) => s + l.conversas7d, 0)} nos últimos 7 dias`} />
          <Numero
            rotulo="Respondidas pelo agente"
            valor={parteAgente == null ? "–" : `${parteAgente}%`}
            linha={`${agente7d} do agente · ${equipe7d} da equipe (7 dias)`}
            destaque={parteAgente != null && parteAgente >= 70}
          />
          <Numero rotulo="Esperando gente" valor={String(precisam)} linha={`${soma("aprovar")} para aprovar · ${soma("comEquipe")} com a equipe`} tom={precisam ? "negativo" : undefined} />
          <Numero rotulo="Vendas pelo WhatsApp" valor={formatarReais(soma("vendas30dCentavos"))} linha={`${soma("vendas30d")} vendas em 30 dias`} destaque={soma("vendas30d") > 0} />
          <Numero rotulo="Custo em 30 dias" valor={reais(custo30)} linha={`IA + mensagens da Meta · US$ ${custo30.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
        </dl>
      </section>

      <section className="cartao entrada flex flex-wrap items-center gap-x-6 gap-y-3" aria-labelledby="t-chat-site">
        <div className="min-w-0 flex-1">
          <h2 id="t-chat-site" className="font-titulo text-[16px] font-bold">
            Chat do site urutau.io
          </h2>
          <p className="text-[13px] text-suave">
            O agente da própria Urutau, 24h.{" "}
            {chat.falhas7d > 0 ? <span className="text-negativo">Falhou {chat.falhas7d}× nesta semana.</span> : "Sem falhas nesta semana."}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[11px] text-meta">Hoje</dt>
            <dd className="numero text-[18px] font-bold">{chat.hoje}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-meta">Esperam a equipe</dt>
            <dd className={`numero text-[18px] font-bold ${chat.esperandoEquipe ? "text-negativo" : ""}`}>{chat.esperandoEquipe}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-meta">Contatos (30 dias)</dt>
            <dd className="numero text-[18px] font-bold">{chat.contatos30d}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-meta">Custo (30 dias)</dt>
            <dd className="numero text-[18px] font-bold">{reais(chat.custo30dMicros / 1e6)}</dd>
          </div>
        </dl>
        <Link href="/admin/comercial/chat" className="btn-secundario !min-h-10 text-sm">
          Ver conversas
        </Link>
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="t-lojas" className="min-w-0 space-y-3">
          <h2 id="t-lojas" className="sr-only">Cada loja e seu atendente</h2>
          {comEstado.length === 0 && (
            <div className="cartao">
              <Vazio>Nenhuma loja tem atendente ainda. Crie um abaixo, ensine sobre a loja e teste no simulador antes de conectar o número.</Vazio>
            </div>
          )}
          <ul className="grid gap-3 lg:grid-cols-2">
            {comEstado.map((l, i) => {
              const total = l.respostasAgente7d + l.respostasEquipe7d;
              const pct = total ? Math.round((l.respostasAgente7d / total) * 100) : 0;
              return (
                <li key={l.empresaId} className="cartao entrada flex flex-col gap-4" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-titulo text-[16px] font-bold">{l.empresa}</h3>
                      <p className="truncate text-[12px] text-meta">
                        {l.nome} · {precoDo(l.modelo).nome.replace("Claude ", "")} · {PERFIS[l.perfil].nome}
                      </p>
                    </div>
                    <Estado estado={l.estado} />
                  </div>

                  {l.estado === "erro" && l.ultimoErro && (
                    <p className="rounded-lg bg-negativo-fundo px-3 py-2 text-[13px]">
                      {l.ultimoErro} <span className="text-meta">· {l.ultimoErroEm ? quando(l.ultimoErroEm, agora) : ""}</span>
                    </p>
                  )}

                  <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
                    <div>
                      <dt className="text-[11px] text-meta">Hoje</dt>
                      <dd className="numero text-[18px] font-bold">{l.conversasHoje}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-meta">7 dias</dt>
                      <dd className="numero text-[18px] font-bold">{l.conversas7d}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-meta">Responde em</dt>
                      <dd className="numero text-[18px] font-bold">{segundos(l.tempoMedioMs) ?? "–"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-meta">Para aprovar</dt>
                      <dd className={`numero text-[18px] font-bold ${l.aprovar ? "text-destaque-texto" : ""}`}>{l.aprovar}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-meta">Com a equipe</dt>
                      <dd className="numero text-[18px] font-bold">{l.comEquipe}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-meta">Vendas 30d</dt>
                      <dd className="numero text-[18px] font-bold">{l.vendas30d}</dd>
                    </div>
                  </dl>

                  <div>
                    <div className="mb-1 flex justify-between text-[11px] text-meta">
                      <span>Agente {pct}% · equipe {total ? 100 - pct : 0}%</span>
                      <span>{reais(l.custo30dMicros / 1e6)} em 30d</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-superficie-2" role="img" aria-label={`O agente respondeu ${pct}% das mensagens nos últimos 7 dias`}>
                      <div className="h-full rounded-full bg-destaque" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Link href={`/e/${l.empresaId}/whatsapp`} className="btn-central">Conversas</Link>
                    <Link href={`/e/${l.empresaId}/whatsapp/agente`} className="btn-leve">Ajustar</Link>
                    {l.modo === "desligado" ? (
                      <BotaoAcao acao={mudarModoCentralAcao.bind(null, l.empresaId, "aprovacao")} className="btn-leve">Retomar</BotaoAcao>
                    ) : (
                      <BotaoAcao acao={mudarModoCentralAcao.bind(null, l.empresaId, "desligado")} className="btn-leve" confirmar={`Pausar o atendente da ${l.empresa}?`}>
                        Pausar
                      </BotaoAcao>
                    )}
                    <span className="ml-auto text-[12px] text-meta">
                      {l.numero ?? (l.conectado ? "número conectado" : "sem número")}
                      {l.ultimaAtividade ? ` · ${quando(l.ultimaAtividade, agora)}` : ""}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {semAgente.length > 0 && (
            <section className="cartao" aria-labelledby="t-sem">
              <TituloBloco>
                <span id="t-sem">Lojas sem atendente</span>
              </TituloBloco>
              <ul className="divide-y divide-superficie-2">
                {semAgente.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.nome}</span>
                      <span className="text-[12px] text-meta">{PERFIS[e.perfil].nome}</span>
                    </span>
                    <BotaoAcao acao={criarAgenteCentralAcao.bind(null, e.id)} className="btn-leve shrink-0">Criar atendente</BotaoAcao>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="cartao" aria-labelledby="t-custo">
            <TituloBloco>
              <span id="t-custo">Quanto custa por loja, por mês</span>
            </TituloBloco>
            <p className="mb-3 text-[13px] text-suave">
              Cada conversa com ~8 respostas. Inclui a IA (Anthropic) e as mensagens que a Meta cobra no Brasil (US$ 0,0068 cada desde 01/10/2026). Dólar a R$ 5,50.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px]">
                <thead className="text-[12px] text-meta">
                  <tr>
                    <th className="py-1.5 font-medium">Modelo</th>
                    {[100, 300, 1000].map((n) => (
                      <th key={n} className="py-1.5 text-right font-medium">{n.toLocaleString("pt-BR")} conversas</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-superficie-2">
                  {MODELOS.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2 font-medium">{m.nome.replace("Claude ", "")}</td>
                      {[100, 300, 1000].map((n) => {
                        const e = estimarCustoMensal(n, 8, m.id);
                        return (
                          <td key={n} className="numero py-2 text-right">
                            {reais(e.totalUsd)}
                            <span className="block text-[11px] text-meta">IA {reais(e.iaUsd)} · Meta {reais(e.metaUsd)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="cartao entrada min-w-0 self-start xl:sticky xl:top-16" aria-labelledby="t-vivo">
          <TituloBloco acao={<span className="text-[12px] text-meta">atualiza sozinho</span>}>
            <span id="t-vivo" className="flex items-center gap-2">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-positivo opacity-60 motion-reduce:animate-none" />
                <span className="relative h-2 w-2 rounded-full bg-positivo" />
              </span>
              Ao vivo
            </span>
          </TituloBloco>
          {feed.length === 0 ? (
            <Vazio>As mensagens de todas as lojas aparecem aqui assim que chegam.</Vazio>
          ) : (
            <ol className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
              {feed.map((m) => (
                <li key={m.id} className="text-[13px]">
                  <Link href={`/e/${m.empresaId}/whatsapp/${m.conversaId}`} className="block rounded-lg px-2 py-1.5 hover:bg-superficie-2">
                    <span className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="truncate font-semibold">{m.empresa}</span>
                      <span className="shrink-0 text-meta">{quando(m.criadoEm, agora)}</span>
                    </span>
                    <span className="block truncate text-meta">
                      {m.cliente ?? formatarTelefone(m.telefone)} · {AUTOR[m.autor]}
                      {m.status === "rascunho" ? " (para aprovar)" : m.status === "falhou" ? " (falhou)" : ""}
                    </span>
                    <span className={`line-clamp-2 ${m.autor === "sistema" ? "text-meta" : "text-suave"}`}>{m.texto}</span>
                    {m.acoes?.some((a) => a.nome === "registrar_venda") && <span className="mt-0.5 block text-[12px] font-semibold text-destaque-texto">registrou uma venda</span>}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
