import Link from "next/link";
import { notFound } from "next/navigation";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { BotaoAcao } from "@/components/BotaoAcao";
import { Bolhas } from "@/components/atendimento/Bolhas";
import { Responder, RolarParaFim } from "@/components/atendimento/Chat";
import { obterDb } from "@/db";
import { usdParaReais } from "@/lib/atendimento";
import { Temperatura } from "@/components/central/Temperatura";
import { NOME_URGENCIA } from "@/lib/chat-site";
import { NOME_SERVICO } from "@/lib/comercial";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { mudarStatusDoSiteAcao, responderNoSiteAcao } from "@/lib/servidor/acoes-chat-site";
import { conversaDoSiteParaEquipe, marcarSiteLida } from "@/lib/servidor/chat-site";
import { formatarTelefone } from "@/lib/validacao";

export const metadata = { title: "Conversa do site" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mostrarContato = (c: string | null) => (c && /^\d+$/.test(c) ? formatarTelefone(c) : c);
const SITUACAO = { agente: "o agente está atendendo", humano: "com a equipe", encerrada: "encerrada" } as const;

export default async function ConversaDoSite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await exigirSuperadmin();
  if (!UUID.test(id)) notFound();
  const db = obterDb();
  const dados = await conversaDoSiteParaEquipe(db, id);
  if (!dados) notFound();
  const { conversa: c, mensagens } = dados;
  if (c.naoLidas > 0) await marcarSiteLida(db, id);
  const custo = mensagens.reduce((s, m) => s + (m.custoMicrosUsd ?? 0), 0);
  const telefone = c.contato && /^\d+$/.test(c.contato) ? c.contato : null;

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <AtualizarSozinho segundos={6} />
      <header className="flex items-center gap-3">
        <Link href="/admin/comercial/chat" aria-label="Voltar às conversas" className="btn-secundario !min-h-10 !px-3">
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-titulo text-xl font-bold">{c.nome ?? "Visitante sem nome"}</h1>
          <p className="truncate text-xs text-suave">
            {[mostrarContato(c.contato), SITUACAO[c.status], c.pagina ? `abriu em ${c.pagina}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {telefone && (
          <a href={`https://wa.me/${telefone}`} target="_blank" rel="noreferrer" className="btn-secundario !min-h-10 !px-3 text-sm">
            WhatsApp
          </a>
        )}
        {c.leadId && (
          <Link href={`/admin/comercial/leads/${c.leadId}`} className="btn-secundario !min-h-10 !px-3 text-sm">
            Lead
          </Link>
        )}
      </header>

      <section className="cartao space-y-1.5 !py-3 text-sm" aria-label="Resumo">
        {c.resumo && <p>{c.resumo}</p>}
        {Object.keys(c.ficha).length > 0 && (
          <dl className="grid gap-x-4 gap-y-1.5 pt-1 sm:grid-cols-[auto_1fr]">
            {(
              [
                ["Quer", c.ficha.objetivo],
                ["Negócio", c.ficha.negocio],
                ["Usa hoje", c.ficha.usaHoje],
                ["Urgência", c.ficha.urgencia && NOME_URGENCIA[c.ficha.urgencia]],
                ["Orçamento", c.ficha.orcamento],
                ["Próximo passo", c.ficha.proximoPasso],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[12px] text-meta sm:pt-0.5">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            {c.ficha.temperatura && (
              <div className="contents">
                <dt className="text-[12px] text-meta sm:pt-0.5">Temperatura</dt>
                <dd>
                  <Temperatura t={c.ficha.temperatura} />
                </dd>
              </div>
            )}
            {(c.ficha.duvidas?.length ?? 0) > 0 && (
              <div className="contents">
                <dt className="text-[12px] text-meta sm:pt-0.5">Dúvidas</dt>
                <dd>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {c.ficha.duvidas?.map((d) => <li key={d}>{d}</li>)}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        )}
        {c.interesses.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {c.interesses.map((i) => (
              <span key={i} className="rounded-full bg-superficie-2 px-2 py-0.5 text-[12px] text-suave">
                {NOME_SERVICO[i] ?? i}
              </span>
            ))}
          </p>
        )}
        {c.status === "humano" && c.motivoHumano && <p className="text-suave">Chamou a equipe porque: {c.motivoHumano}</p>}
        <p className="text-[12px] text-meta">
          Custo da IA nesta conversa: {usdParaReais(custo / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        {c.status !== "agente" && (
          <BotaoAcao acao={mudarStatusDoSiteAcao.bind(null, id, "agente")} className="btn-secundario !min-h-10 flex-1 text-sm">
            Devolver ao agente
          </BotaoAcao>
        )}
        {c.status === "agente" && (
          <BotaoAcao acao={mudarStatusDoSiteAcao.bind(null, id, "humano")} className="btn-secundario !min-h-10 flex-1 text-sm">
            Assumir a conversa
          </BotaoAcao>
        )}
        {c.status !== "encerrada" && (
          <BotaoAcao acao={mudarStatusDoSiteAcao.bind(null, id, "encerrada")} className="btn-secundario !min-h-10 text-sm">
            Encerrar
          </BotaoAcao>
        )}
      </div>

      <section className="rounded-2xl bg-fundo py-2" aria-label="Conversa">
        <Bolhas
          mensagens={mensagens.map((m) => ({ ...m, status: "enviada", texto: m.autor === "humano" && m.quem ? `${m.texto}\n— ${m.quem.split(" ")[0]}` : m.texto }))}
          equipe="Equipe Urutau"
        />
      </section>

      <Responder
        acao={responderNoSiteAcao.bind(null, id)}
        placeholder="Escreva para o visitante"
        aviso={
          c.status === "agente"
            ? "Se você responder, a conversa passa para a equipe e o agente para de responder. A resposta aparece no chat do site enquanto a pessoa estiver com ele aberto."
            : "A resposta aparece no chat do site enquanto a pessoa estiver com ele aberto. Se ela deixou WhatsApp, vale chamar por lá também."
        }
      />
      <RolarParaFim marca={mensagens.length} />
    </div>
  );
}
