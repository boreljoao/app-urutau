import Link from "next/link";
import { FormLead, SeletorEtapa } from "@/components/central/Comercial";
import { Gaveta } from "@/components/central/Formularios";
import { Avatar, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { type EtapaLead, type OrigemLead, etapaLeadEnum, origemLeadEnum } from "@/db/schema";
import { quando } from "@/lib/central";
import { ETAPAS, NOME_ETAPA, NOME_ORIGEM, NOME_SERVICO, SERVICOS, linkWhatsapp } from "@/lib/comercial";
import { hoje } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { formatarTelefone } from "@/lib/validacao";
import { criarLead, mudarEtapa } from "@/lib/servidor/acoes-comercial";
import { listarEquipe } from "@/lib/servidor/central";
import { type LeadDaLista, listarLeads } from "@/lib/servidor/comercial";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

type Busca = { etapa?: string; origem?: string; resp?: string; q?: string; ver?: string; lote?: string };

export default async function Leads({ searchParams }: { searchParams: Promise<Busca> }) {
  const sp = await searchParams;
  const etapa = sp.etapa === "abertos" || (etapaLeadEnum.enumValues as readonly string[]).includes(sp.etapa ?? "") ? (sp.etapa as EtapaLead | "abertos") : undefined;
  const origem = (origemLeadEnum.enumValues as readonly string[]).includes(sp.origem ?? "") ? (sp.origem as OrigemLead) : undefined;
  const funil = sp.ver === "funil";
  const db = obterDb();
  const agora = new Date();
  const hojeData = hoje(agora);
  const [equipe, lista] = await Promise.all([
    listarEquipe(db),
    listarLeads(db, { etapa: funil ? undefined : etapa, origem, responsavelId: sp.resp || undefined, busca: sp.q, lote: sp.lote }),
  ]);
  const posicao = new Map(equipe.map((p, i) => [p.id, i]));
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));
  const origens = Object.entries(NOME_ORIGEM).map(([id, nome]) => ({ id, nome }));
  const link = (mudar: Partial<Busca>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...mudar }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return `/admin/comercial/leads${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Leads</h1>
          <p className="mt-1 text-[15px] text-suave">
            {lista.length} {lista.length === 1 ? "lead" : "leads"}
            {sp.lote ? ` do lote "${sp.lote}"` : ""}
            {sp.q ? ` com "${sp.q}"` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={link({ ver: funil ? undefined : "funil" })} className="btn-leve">{funil ? "Ver em lista" : "Ver em funil"}</Link>
          <Gaveta rotulo="Novo lead" titulo="Novo lead" principal>
            <FormLead acao={criarLead} equipe={pessoas} origens={origens} servicos={SERVICOS} />
          </Gaveta>
        </div>
      </header>

      <form className="flex flex-wrap items-center gap-2" action="/admin/comercial/leads">
        {funil && <input type="hidden" name="ver" value="funil" />}
        {sp.lote && <input type="hidden" name="lote" value={sp.lote} />}
        <input name="q" defaultValue={sp.q} placeholder="Buscar nome, ramo, cidade, telefone…" aria-label="Buscar" className="campo !w-72 max-w-full" />
        {!funil && (
          <select name="etapa" defaultValue={etapa ?? ""} aria-label="Etapa" className="campo !w-auto">
            <option value="">Todas as etapas</option>
            <option value="abertos">Em aberto</option>
            {ETAPAS.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
        )}
        <select name="origem" defaultValue={origem ?? ""} aria-label="Origem" className="campo !w-auto">
          <option value="">Toda origem</option>
          {origens.map((o) => (
            <option key={o.id} value={o.id}>{o.nome}</option>
          ))}
        </select>
        <select name="resp" defaultValue={sp.resp ?? ""} aria-label="Responsável" className="campo !w-auto">
          <option value="">Toda a equipe</option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>{p.nome.split(" ")[0]}</option>
          ))}
        </select>
        <button className="btn-leve">Filtrar</button>
        {(sp.q || etapa || origem || sp.resp || sp.lote) && (
          <Link href={funil ? "/admin/comercial/leads?ver=funil" : "/admin/comercial/leads"} className="text-[13px] text-meta hover:text-texto">Limpar</Link>
        )}
      </form>

      {lista.length === 0 ? (
        <Vazio>Nenhum lead com esses filtros.</Vazio>
      ) : funil ? (
        <div className="grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(7,minmax(220px,1fr))]">
          {ETAPAS.map((e) => {
            const daEtapa = lista.filter((l) => l.etapa === e.id);
            const valor = daEtapa.reduce((s, l) => s + (l.valorEstimado ?? 0), 0);
            return (
              <section key={e.id} aria-label={e.nome} className="rounded-xl bg-superficie p-3">
                <header className="mb-3 flex items-baseline justify-between gap-2 px-1">
                  <h2 className="font-titulo text-[14px] font-bold">{e.nome}</h2>
                  <span className="numero text-[12px] text-meta">{daEtapa.length}{valor ? ` · ${formatarReais(valor)}` : ""}</span>
                </header>
                <ul className="space-y-2">
                  {daEtapa.slice(0, 40).map((l) => (
                    <li key={l.id}>
                      <CartaoLead l={l} posicao={posicao} hojeData={hojeData} />
                    </li>
                  ))}
                  {daEtapa.length > 40 && <li className="px-1 text-[12px] text-meta">e mais {daEtapa.length - 40}</li>}
                  {daEtapa.length === 0 && <li className="px-1 py-2 text-[12px] text-meta">Ninguém aqui.</li>}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-superficie px-5 py-3">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead className="text-left text-meta">
              <tr>
                <th className="py-2 font-medium">Lead</th>
                <th className="py-2 font-medium">Etapa</th>
                <th className="py-2 font-medium">Origem</th>
                <th className="py-2 font-medium">Responsável</th>
                <th className="py-2 font-medium">Último contato</th>
                <th className="py-2 font-medium">Retorno</th>
                <th className="py-2 text-right font-medium">Valor/mês</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((l) => {
                const zap = linkWhatsapp(l.telefone);
                const atrasado = l.proximoContato && l.proximoContato < hojeData && !["ganho", "perdido"].includes(l.etapa);
                return (
                  <tr key={l.id} className="border-t border-superficie-2 align-middle">
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/comercial/leads/${l.id}`} className="font-semibold hover:underline">{l.nome}</Link>
                      <span className="block text-meta">
                        {[l.categoria, l.cidade].filter(Boolean).join(" · ") || (l.telefone ? formatarTelefone(l.telefone) : "—")}
                        {l.interesses.length ? ` · ${l.interesses.map((i) => NOME_SERVICO[i]?.replace("urutau ", "")).join(", ")}` : ""}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <SeletorEtapa key={l.etapa} acao={mudarEtapa.bind(null, l.id)} atual={l.etapa} etapas={ETAPAS} nome={l.nome} />
                    </td>
                    <td className="py-2.5 pr-3 text-suave">{NOME_ORIGEM[l.origem]}</td>
                    <td className="py-2.5 pr-3">
                      {l.responsavel && l.responsavelId ? (
                        <span className="flex items-center gap-1.5">
                          <Avatar nome={l.responsavel} posicao={posicao.get(l.responsavelId) ?? 0} tamanho={20} />
                          {l.responsavel.split(" ")[0]}
                        </span>
                      ) : (
                        <span className="text-meta">ninguém</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-suave">{l.ultimoContato ? quando(l.ultimoContato, agora) : <span className="text-meta">nunca</span>}</td>
                    <td className={`py-2.5 pr-3 ${atrasado ? "font-semibold text-negativo" : "text-suave"}`}>
                      {l.proximoContato ? `${l.proximoContato.slice(8, 10)}/${l.proximoContato.slice(5, 7)}` : <span className="text-meta">—</span>}
                    </td>
                    <td className="numero py-2.5 pr-3 text-right">{l.valorEstimado ? formatarReais(l.valorEstimado) : <span className="text-meta">—</span>}</td>
                    <td className="py-2.5 text-right">
                      {zap && (
                        <a href={zap} target="_blank" rel="noreferrer" className="btn-leve !min-h-7 !px-2.5 !text-[12px]">WhatsApp</a>
                      )}
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

function CartaoLead({ l, posicao, hojeData }: { l: LeadDaLista; posicao: Map<string, number>; hojeData: string }) {
  const atrasado = l.proximoContato && l.proximoContato < hojeData && !["ganho", "perdido"].includes(l.etapa);
  return (
    <Link href={`/admin/comercial/leads/${l.id}`} className="block rounded-lg bg-superficie-2 p-3 transition-colors hover:brightness-125">
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[13px] font-semibold leading-5">{l.nome}</span>
        {l.responsavel && l.responsavelId && <Avatar nome={l.responsavel} posicao={posicao.get(l.responsavelId) ?? 0} tamanho={20} />}
      </span>
      <span className="mt-1 block truncate text-[12px] text-meta">{[l.categoria, l.cidade].filter(Boolean).join(" · ") || NOME_ORIGEM[l.origem]}</span>
      <span className="mt-2 flex items-center justify-between text-[12px]">
        <span className={atrasado ? "font-semibold text-negativo" : "text-suave"}>
          {l.proximoContato ? `retorno ${l.proximoContato.slice(8, 10)}/${l.proximoContato.slice(5, 7)}` : NOME_ETAPA[l.etapa]}
        </span>
        {l.valorEstimado ? <span className="numero">{formatarReais(l.valorEstimado)}</span> : null}
      </span>
    </Link>
  );
}
