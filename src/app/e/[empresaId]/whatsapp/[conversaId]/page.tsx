import Link from "next/link";
import { notFound } from "next/navigation";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { BotaoAcao } from "@/components/BotaoAcao";
import { Bolhas } from "@/components/atendimento/Bolhas";
import { Rascunho, Responder, RolarParaFim } from "@/components/atendimento/Chat";
import { obterDb } from "@/db";
import { NOME_INTENCAO, janelaAberta, tempoDaJanela } from "@/lib/atendimento";
import { pode } from "@/lib/permissoes";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { aprovarAcao, descartarAcao, mudarStatusAcao, responderAcao } from "@/lib/servidor/acoes-atendimento";
import { marcarConversaLida, obterConversa } from "@/lib/servidor/atendimento";
import { formatarTelefone } from "@/lib/validacao";

export const metadata = { title: "Conversa" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Conversa({ params }: { params: Promise<{ empresaId: string; conversaId: string }> }) {
  const { empresaId, conversaId } = await params;
  const ctx = await exigirAcesso(empresaId, "ver_clientes");
  if (!ctx.modulos.has("whatsapp") || !UUID.test(conversaId)) notFound();
  const db = obterDb();
  const dados = await obterConversa(db, empresaId, conversaId);
  if (!dados) notFound();
  const { conversa: c, mensagens } = dados;
  if (c.naoLidas > 0) await marcarConversaLida(db, empresaId, conversaId);
  const base = `/e/${empresaId}`;
  const podeResponder = pode(ctx.papel, "lancar");
  const rascunho = mensagens.findLast((m) => m.status === "rascunho");
  const aberta = janelaAberta(c.ultimaEntradaEm);

  return (
    <div className="space-y-3">
      <AtualizarSozinho segundos={6} />
      <header className="flex items-center gap-3">
        <Link href={`${base}/whatsapp`} aria-label="Voltar às conversas" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-titulo text-xl font-bold">{c.nome ?? formatarTelefone(c.telefone)}</h1>
          <p className="truncate text-xs text-suave">
            {formatarTelefone(c.telefone)} · {c.status === "agente" ? "o agente está atendendo" : c.status === "humano" ? "a equipe está atendendo" : "encerrada"}
          </p>
        </div>
        {c.clienteId && (
          <Link href={`${base}/clientes/${c.clienteId}`} className="btn-secundario !min-h-10 !px-3 text-sm">Cliente</Link>
        )}
      </header>

      {(c.intencao || c.motivoHumano) && (
        <section className="cartao space-y-1 !py-3 text-sm" aria-label="Resumo do atendimento">
          {c.intencao && (
            <p>
              <span className="font-semibold">{NOME_INTENCAO[c.intencao] ?? c.intencao}</span>
              {c.resumo ? <span className="text-suave"> · {c.resumo}</span> : null}
            </p>
          )}
          {c.status === "humano" && c.motivoHumano && <p className="text-suave">Chamou a equipe porque: {c.motivoHumano}</p>}
        </section>
      )}

      {podeResponder && (
        <div className="flex flex-wrap gap-2">
          {c.status === "agente" && (
            <BotaoAcao acao={mudarStatusAcao.bind(null, empresaId, conversaId, "humano")} className="btn-secundario !min-h-10 flex-1 text-sm">
              Assumir a conversa
            </BotaoAcao>
          )}
          {c.status !== "agente" && (
            <BotaoAcao acao={mudarStatusAcao.bind(null, empresaId, conversaId, "agente")} className="btn-secundario !min-h-10 flex-1 text-sm">
              Devolver ao agente
            </BotaoAcao>
          )}
          {c.status !== "encerrada" && (
            <BotaoAcao acao={mudarStatusAcao.bind(null, empresaId, conversaId, "encerrada")} className="btn-secundario !min-h-10 text-sm">
              Encerrar
            </BotaoAcao>
          )}
        </div>
      )}

      <section className="rounded-2xl bg-fundo py-2" aria-label="Conversa">
        <Bolhas mensagens={mensagens} />
      </section>

      {podeResponder && (
        <div className="space-y-2">
          {rascunho && (
            <Rascunho
              key={rascunho.id}
              texto={rascunho.texto}
              acoes={rascunho.acoes ?? []}
              aprovar={aprovarAcao.bind(null, empresaId, rascunho.id)}
              descartar={descartarAcao.bind(null, empresaId, rascunho.id)}
            />
          )}
          {aberta ? (
            rascunho ? (
              <details className="rounded-2xl border border-borda bg-superficie p-3 text-sm">
                <summary className="cursor-pointer font-medium">Escrever outra resposta</summary>
                <div className="mt-2">
                  <Responder acao={responderAcao.bind(null, empresaId, conversaId)} aviso={`${tempoDaJanela(c.ultimaEntradaEm)}.`} />
                </div>
              </details>
            ) : (
              <Responder
                acao={responderAcao.bind(null, empresaId, conversaId)}
                aviso={c.status === "agente" ? `Se você responder, a conversa passa para você. ${tempoDaJanela(c.ultimaEntradaEm)}.` : `${tempoDaJanela(c.ultimaEntradaEm)}.`}
              />
            )
          ) : (
            <p className="rounded-2xl border border-borda bg-superficie p-3 text-sm text-suave">
              Passaram 24h da última mensagem do cliente. Pelas regras do WhatsApp, a loja só pode escrever de novo quando ele mandar mensagem.
            </p>
          )}
        </div>
      )}
      <RolarParaFim marca={mensagens.length} />
    </div>
  );
}
