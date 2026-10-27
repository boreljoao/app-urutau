import Link from "next/link";
import { notFound } from "next/navigation";
import { AtualizarSozinho } from "@/components/AtualizarSozinho";
import { obterDb } from "@/db";
import { NOME_ESTADO, NOME_INTENCAO, estadoDoAgente } from "@/lib/atendimento";
import { quando } from "@/lib/central";
import { pode } from "@/lib/permissoes";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { listarConversas, obterAgente, resumoDaLoja, type FiltroConversas } from "@/lib/servidor/atendimento";
import { formatarTelefone } from "@/lib/validacao";

export const metadata = { title: "Atendente no WhatsApp" };
export const dynamic = "force-dynamic";

const FILTROS: { id: FiltroConversas; rotulo: string }[] = [
  { id: "abertas", rotulo: "Abertas" },
  { id: "aprovar", rotulo: "Para aprovar" },
  { id: "humano", rotulo: "Com a equipe" },
  { id: "agente", rotulo: "Com o agente" },
  { id: "encerrada", rotulo: "Encerradas" },
];

const COR_ESTADO: Record<string, string> = {
  erro: "var(--negativo)",
  no_ar: "var(--positivo)",
  aprovacao: "var(--destaque)",
  simulador: "var(--texto-suave)",
  pausado: "var(--texto-suave)",
  sem_agente: "var(--borda)",
};

export default async function Atendimento({
  params,
  searchParams,
}: {
  params: Promise<{ empresaId: string }>;
  searchParams: Promise<{ f?: string; q?: string }>;
}) {
  const { empresaId } = await params;
  const { f, q = "" } = await searchParams;
  const ctx = await exigirAcesso(empresaId, "ver_clientes");
  if (!ctx.modulos.has("whatsapp")) notFound();
  const filtro = FILTROS.some((x) => x.id === f) ? (f as FiltroConversas) : "abertas";
  const db = obterDb();
  const [agente, resumo, lista] = await Promise.all([obterAgente(db, empresaId), resumoDaLoja(db, empresaId), listarConversas(db, empresaId, filtro, q)]);
  const base = `/e/${empresaId}/whatsapp`;
  const estado = estadoDoAgente(agente ? { modo: agente.modo, conectado: !!(agente.phoneNumberId && agente.tokenCifrado), ultimoErroEm: agente.ultimoErroEm } : null);
  const agora = new Date();

  return (
    <div className="space-y-4">
      <AtualizarSozinho segundos={10} />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-titulo text-2xl font-bold">Atendente</h1>
          <p className="mt-0.5 flex items-start gap-2 text-sm text-suave">
            <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: COR_ESTADO[estado] }} />
            {agente ? `${agente.nome} · ${NOME_ESTADO[estado]}` : "Atendente ainda não configurado"}
            {agente?.numeroExibicao ? ` · ${agente.numeroExibicao}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`${base}/testar`} className="btn-secundario !min-h-10 !px-3 text-sm">Testar</Link>
          {pode(ctx.papel, "gerenciar") && <Link href={`${base}/agente`} className="btn-secundario !min-h-10 !px-3 text-sm">Ajustar</Link>}
        </div>
      </header>

      {estado === "erro" && agente?.ultimoErro && (
        <p role="alert" className="rounded-xl border border-negativo bg-negativo-fundo p-3 text-sm">
          <strong>O atendente teve um problema:</strong> {agente.ultimoErro}
        </p>
      )}
      {(estado === "simulador" || estado === "sem_agente") && (
        <div className="aviso space-y-1">
          <p className="font-medium">{estado === "sem_agente" ? "Comece ensinando o atendente sobre a loja." : "O atendente já funciona no simulador."}</p>
          <p className="text-suave">
            {estado === "sem_agente"
              ? "Diga o que vende, preços, horários e quando chamar alguém. Depois teste no simulador antes de ligar no WhatsApp."
              : "Para atender clientes de verdade, falta conectar o número do WhatsApp da loja."}{" "}
            {pode(ctx.papel, "gerenciar") && <Link href={`${base}/agente`} className="font-medium underline">Configurar agora</Link>}
          </p>
        </div>
      )}

      <dl className="grid grid-cols-4 gap-2 text-center">
        {[
          { r: "Hoje", v: resumo.hoje },
          { r: "Abertas", v: resumo.abertas },
          { r: "Aprovar", v: resumo.aprovar, alerta: resumo.aprovar > 0 },
          { r: "Com a equipe", v: resumo.comEquipe, alerta: resumo.comEquipe > 0 },
        ].map((n) => (
          <div key={n.r} className={`cartao !px-2 !py-3 ${n.alerta ? "!border-destaque/70" : ""}`}>
            <dd className="numero text-2xl font-bold">{n.v}</dd>
            <dt className="text-xs text-suave">{n.r}</dt>
          </div>
        ))}
      </dl>

      <nav aria-label="Filtrar conversas" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTROS.map((x) => (
          <Link
            key={x.id}
            href={`${base}?f=${x.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-current={filtro === x.id ? "page" : undefined}
            className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${filtro === x.id ? "border-texto bg-texto font-semibold text-fundo" : "border-borda text-suave"}`}
          >
            {x.rotulo}
            {x.id === "aprovar" && resumo.aprovar > 0 ? ` · ${resumo.aprovar}` : ""}
          </Link>
        ))}
      </nav>

      <form role="search" className="flex gap-2">
        <input type="hidden" name="f" value={filtro} />
        <label htmlFor="q" className="sr-only">Buscar conversa</label>
        <input id="q" name="q" defaultValue={q} placeholder="Nome, telefone ou assunto" className="campo flex-1" />
        <button className="btn-secundario">Buscar</button>
      </form>

      {lista.length === 0 ? (
        <p className="py-10 text-center text-suave">
          {q ? `Nada encontrado para "${q}".` : filtro === "aprovar" ? "Nenhuma resposta esperando aprovação. ✓" : "Nenhuma conversa aqui. Quando um cliente mandar mensagem, ela aparece na hora."}
        </p>
      ) : (
        <ul className="cartao divide-y divide-borda !p-0">
          {lista.map((c) => (
            <li key={c.id}>
              <Link href={`${base}/${c.id}`} className="flex gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-superficie-2 font-titulo font-bold text-suave"
                >
                  {(c.nome ?? "?").trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate ${c.naoLidas > 0 ? "font-bold" : "font-medium"}`}>{c.nome ?? formatarTelefone(c.telefone)}</span>
                    <span className={`shrink-0 text-xs ${c.naoLidas > 0 ? "font-semibold text-destaque-texto" : "text-suave"}`}>{quando(c.ultimaMensagemEm, agora)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm text-suave">
                      {c.ultimoAutor === "agente" ? "Agente: " : c.ultimoAutor === "humano" ? "Você: " : ""}
                      {c.ultimoTexto ?? ""}
                    </span>
                    {c.naoLidas > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-destaque px-1.5 text-[11px] font-bold text-sobre-destaque">{c.naoLidas}</span>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                    {c.status === "humano" && <span className="rounded-full border border-destaque/70 px-2 py-0.5">Com a equipe</span>}
                    {c.status === "encerrada" && <span className="rounded-full border border-borda px-2 py-0.5 text-suave">Encerrada</span>}
                    {c.rascunhos > 0 && <span className="rounded-full bg-aviso-fundo px-2 py-0.5 font-medium">Resposta para aprovar</span>}
                    {c.intencao && <span className="rounded-full border border-borda px-2 py-0.5 text-suave">{NOME_INTENCAO[c.intencao] ?? c.intencao}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
