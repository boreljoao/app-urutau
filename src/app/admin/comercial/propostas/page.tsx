import Link from "next/link";
import { AcoesProposta, FormProposta } from "@/components/central/Comercial";
import { Gaveta } from "@/components/central/Formularios";
import { Numero } from "@/components/central/Numero";
import { Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { type StatusProposta, statusPropostaEnum } from "@/db/schema";
import { quando } from "@/lib/central";
import { NOME_SERVICO, NOME_STATUS_PROPOSTA, SERVICOS } from "@/lib/comercial";
import { formatarData, hoje } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { criarProposta, mudarStatusProposta } from "@/lib/servidor/acoes-comercial";
import { listarLeads, listarPropostas } from "@/lib/servidor/comercial";

export const metadata = { title: "Propostas" };
export const dynamic = "force-dynamic";

export default async function Propostas({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = (statusPropostaEnum.enumValues as readonly string[]).includes(sp.status ?? "") ? (sp.status as StatusProposta) : undefined;
  const db = obterDb();
  const agora = new Date();
  const hojeData = hoje(agora);
  const [todas, abertos] = await Promise.all([listarPropostas(db), listarLeads(db, { etapa: "abertos" })]);
  const lista = status ? todas.filter((p) => p.status === status) : todas;
  const soma = (s: StatusProposta, campo: "mensal" | "unico") => todas.filter((p) => p.status === s).reduce((t, p) => t + p[campo], 0);
  const decididas = todas.filter((p) => p.status === "aceita" || p.status === "recusada").length;
  const aceitas = todas.filter((p) => p.status === "aceita").length;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Propostas</h1>
          <p className="mt-1 text-[15px] text-suave">
            {todas.filter((p) => p.status === "enviada").length} esperando resposta · {todas.filter((p) => p.status === "rascunho").length} em rascunho
          </p>
        </div>
        <Gaveta rotulo="Nova proposta" titulo="Nova proposta" principal>
          <FormProposta acao={criarProposta} servicos={SERVICOS} leads={abertos.map((l) => ({ id: l.id, nome: l.nome }))} />
        </Gaveta>
      </header>

      <section className="cartao" aria-label="Números das propostas">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          <Numero rotulo="Na mesa (por mês)" valor={formatarReais(soma("enviada", "mensal"))} linha={`+ ${formatarReais(soma("enviada", "unico"))} de entrada`} />
          <Numero rotulo="Aceitas (por mês)" valor={formatarReais(soma("aceita", "mensal"))} linha={`+ ${formatarReais(soma("aceita", "unico"))} de entrada`} destaque={soma("aceita", "mensal") > 0} />
          <Numero rotulo="Taxa de aceite" valor={decididas ? `${Math.round((aceitas / decididas) * 100)}%` : "–"} linha={`${aceitas} de ${decididas} respondidas`} />
          <Numero rotulo="Em rascunho" valor={String(todas.filter((p) => p.status === "rascunho").length)} linha="ainda não enviadas" />
        </dl>
      </section>

      <nav aria-label="Filtrar por status" className="flex flex-wrap gap-1">
        {[undefined, ...statusPropostaEnum.enumValues].map((s) => (
          <Link
            key={s ?? "todas"}
            href={s ? `/admin/comercial/propostas?status=${s}` : "/admin/comercial/propostas"}
            aria-current={status === s ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-[13px] ${status === s ? "bg-superficie-2 font-semibold text-texto" : "text-suave hover:text-texto"}`}
          >
            {s ? NOME_STATUS_PROPOSTA[s] : "Todas"} <span className="numero text-meta">{s ? todas.filter((p) => p.status === s).length : todas.length}</span>
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <Vazio>Nenhuma proposta {status ? `com status ${NOME_STATUS_PROPOSTA[status].toLowerCase()}` : "ainda"}.</Vazio>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-superficie px-5 py-3">
          <table className="w-full min-w-[880px] text-[13px]">
            <thead className="text-left text-meta">
              <tr>
                <th className="py-2 font-medium">Proposta</th>
                <th className="py-2 font-medium">Para</th>
                <th className="py-2 text-right font-medium">Por mês</th>
                <th className="py-2 text-right font-medium">Entrada</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Validade</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const vencida = p.status === "enviada" && p.validade && p.validade < hojeData;
                return (
                  <tr key={p.id} className="border-t border-superficie-2 align-middle">
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold">{p.titulo}</span>
                      <span className="block text-meta">{p.servicos.map((s) => NOME_SERVICO[s]?.replace("urutau ", "") ?? s).join(", ") || "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      {p.leadId ? <Link href={`/admin/comercial/leads/${p.leadId}`} className="hover:underline">{p.lead}</Link> : p.empresa ?? <span className="text-meta">—</span>}
                    </td>
                    <td className="numero py-2.5 pr-3 text-right">{p.mensal ? formatarReais(p.mensal) : <span className="text-meta">—</span>}</td>
                    <td className="numero py-2.5 pr-3 text-right">{p.unico ? formatarReais(p.unico) : <span className="text-meta">—</span>}</td>
                    <td className="py-2.5 pr-3">
                      <span className={p.status === "aceita" ? "text-positivo" : p.status === "recusada" ? "text-negativo" : ""}>{NOME_STATUS_PROPOSTA[p.status]}</span>
                      <span className="block text-[12px] text-meta">
                        {p.status === "enviada" && p.enviadaEm ? `enviada ${quando(p.enviadaEm, agora)}` : p.respondidaEm ? `respondida ${quando(p.respondidaEm, agora)}` : `criada ${quando(p.criadoEm, agora)}`}
                      </span>
                    </td>
                    <td className={`py-2.5 pr-3 ${vencida ? "font-semibold text-negativo" : "text-suave"}`}>{p.validade ? formatarData(p.validade) : <span className="text-meta">—</span>}</td>
                    <td className="py-2.5 text-right">
                      <AcoesProposta acao={mudarStatusProposta.bind(null, p.id)} status={p.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
