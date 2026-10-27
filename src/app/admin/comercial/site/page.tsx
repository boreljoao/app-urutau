import Link from "next/link";
import { Numero } from "@/components/central/Numero";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { quando } from "@/lib/central";
import { SECOES_DO_SITE } from "@/lib/comercial";
import { type VisitanteRecente, resumoDeVisitantes, visitantesRecentes } from "@/lib/servidor/visitantes";

export const metadata = { title: "Site" };
export const dynamic = "force-dynamic";

const PERIODOS = [7, 30, 90];

/** "Visitante A1B2": as 4 primeiras letras do código, só para a equipe se referir a ele. */
const apelido = (id: string) => `Visitante ${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
const pct = (parte: number, total: number) => (total ? `${Math.round((parte / total) * 100)}%` : "–");

export default async function Site({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  const sp = await searchParams;
  const dias = PERIODOS.includes(Number(sp.dias)) ? Number(sp.dias) : 7;
  const db = obterDb();
  const agora = new Date();
  const [r, agiram, todos] = await Promise.all([
    resumoDeVisitantes(db, dias, agora),
    visitantesRecentes(db, { dias, agora, soQuemAgiu: true, limite: 30 }),
    visitantesRecentes(db, { dias, agora, limite: 60 }),
  ]);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Quem visitou o site</h1>
          <p className="mt-1 text-[15px] text-suave">
            Visitantes anônimos do urutau.io. Quando alguém manda o diagnóstico, o caminho dele vai junto para o lead.
          </p>
        </div>
        <nav aria-label="Período" className="flex gap-1">
          {PERIODOS.map((p) => (
            <Link
              key={p}
              href={`/admin/comercial/site?dias=${p}`}
              aria-current={p === dias ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-[13px] ${p === dias ? "bg-superficie-2 font-semibold text-texto" : "text-suave hover:text-texto"}`}
            >
              {p} dias
            </Link>
          ))}
        </nav>
      </header>

      <section className="cartao" aria-label="Números do site">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
          <Numero rotulo="Visitantes" valor={String(r.n)} linha={`${r.novos} novos · ${r.voltaram} voltaram`} />
          <Numero rotulo="Clicaram no WhatsApp" valor={String(r.clicaramWhatsapp)} linha={`${pct(r.clicaramWhatsapp, r.n)} dos visitantes`} />
          <Numero rotulo="Mandaram o diagnóstico" valor={String(r.mandaramDiagnostico)} linha={`${pct(r.mandaramDiagnostico, r.n)} dos visitantes`} />
          <Numero rotulo="Viraram lead" valor={String(r.viraramLead)} linha={`${pct(r.viraramLead, r.n)} dos visitantes`} destaque={r.viraramLead > 0} />
          <Numero rotulo="Mais vieram de" valor={r.porOrigem[0]?.nome ?? "–"} linha={r.porOrigem[0] ? `${r.porOrigem[0].n} visitantes` : "sem visitas"} />
        </dl>
      </section>

      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Ranking titulo="De onde vieram" itens={r.porOrigem} total={r.n} vazio="Sem visitas no período." />
        <Ranking titulo="Cidades" itens={r.porCidade.map((c) => ({ nome: c.nome ?? "—", n: c.n }))} total={r.n} vazio="A cidade aparece nas visitas pelo site publicado." />
        <Ranking titulo="O que mais viram" itens={r.porSecao.map((s) => ({ nome: SECOES_DO_SITE[s.nome ?? ""] ?? s.nome ?? "—", n: s.n }))} total={r.n} vazio="Nenhuma seção vista ainda." />
        <Ranking titulo="Aparelho" itens={r.porAparelho} total={r.n} vazio="Sem visitas no período." />
      </div>

      <section className="cartao" aria-labelledby="t-agiram">
        <TituloBloco acao={<span className="text-[13px] text-meta">clicaram no WhatsApp ou mandaram o diagnóstico</span>}>
          <span id="t-agiram">Quem agiu</span>
        </TituloBloco>
        {agiram.length === 0 ? <Vazio>Ninguém clicou no WhatsApp nem mandou o diagnóstico neste período.</Vazio> : <Tabela lista={agiram} agora={agora} />}
      </section>

      <section className="cartao" aria-labelledby="t-todos">
        <TituloBloco acao={<span className="text-[13px] text-meta">os 60 mais recentes</span>}>
          <span id="t-todos">Todos os visitantes</span>
        </TituloBloco>
        {todos.length === 0 ? <Vazio>Nenhuma visita registrada neste período.</Vazio> : <Tabela lista={todos} agora={agora} />}
      </section>

      <p className="px-1 text-[12px] text-meta">
        Sem nome nem telefone de quem só visitou: o código é aleatório e fica no navegador da pessoa. A cidade é aproximada (pela rede) e o IP não é
        guardado. Quem recusa no aviso de privacidade do site não entra aqui.
      </p>
    </div>
  );
}

function Ranking({ titulo, itens, total, vazio }: { titulo: string; itens: { nome: string; n: number }[]; total: number; vazio: string }) {
  return (
    <section className="cartao" aria-label={titulo}>
      <TituloBloco>{titulo}</TituloBloco>
      {itens.length === 0 ? (
        <Vazio>{vazio}</Vazio>
      ) : (
        <ul className="space-y-2.5">
          {itens.map((i) => (
            <li key={i.nome} className="text-[13px]">
              <span className="flex justify-between gap-2">
                <span className="truncate">{i.nome}</span>
                <span className="numero shrink-0 text-suave">{i.n}</span>
              </span>
              <span className="mt-1 block h-1.5 rounded-full bg-superficie-2">
                <span className="block h-1.5 rounded-full bg-destaque" style={{ width: `${total ? Math.min(100, (i.n / total) * 100) : 0}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tabela({ lista, agora }: { lista: VisitanteRecente[]; agora: Date }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead className="text-left text-meta">
          <tr>
            <th className="py-2 font-medium">Visitante</th>
            <th className="py-2 font-medium">Veio de</th>
            <th className="py-2 font-medium">Viu</th>
            <th className="py-2 font-medium">Fez</th>
            <th className="py-2 text-right font-medium">Visitas</th>
            <th className="py-2 text-right font-medium">Última</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((v) => (
            <tr key={v.id} className="border-t border-superficie-2 align-top">
              <td className="py-2.5 pr-3">
                {v.leadId ? (
                  <Link href={`/admin/comercial/leads/${v.leadId}`} className="font-semibold hover:underline">{v.lead}</Link>
                ) : (
                  <span className="font-semibold">{apelido(v.id)}</span>
                )}
                <span className="block text-meta">{[v.cidade && `${v.cidade}${v.regiao ? `/${v.regiao}` : ""}`, v.aparelho].filter(Boolean).join(" · ") || "—"}</span>
              </td>
              <td className="py-2.5 pr-3">
                {v.origem ?? "Direto"}
                {v.campanha && <span className="block text-meta">campanha {v.campanha}</span>}
              </td>
              <td className="py-2.5 pr-3 text-suave">{v.secoes.length ? v.secoes.map((s) => SECOES_DO_SITE[s] ?? s).join(", ") : <span className="text-meta">só o começo</span>}</td>
              <td className="py-2.5 pr-3">
                {[v.diagnosticos ? "mandou o diagnóstico" : null, v.cliquesWhatsapp ? `clicou no WhatsApp${v.cliquesWhatsapp > 1 ? ` ${v.cliquesWhatsapp}x` : ""}` : null].filter(Boolean).join(" · ") || (
                  <span className="text-meta">só olhou</span>
                )}
              </td>
              <td className="numero py-2.5 pr-3 text-right">{v.visitas}</td>
              <td className="py-2.5 text-right text-meta">{quando(v.ultimaVisita, agora)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
