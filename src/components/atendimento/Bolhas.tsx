/** Mensagens de uma conversa do WhatsApp, no jeito do próprio WhatsApp: cliente à esquerda, loja à direita. */

export interface MensagemNaTela {
  id: string;
  autor: "cliente" | "agente" | "humano" | "sistema";
  texto: string;
  status: string;
  erro?: string | null;
  acoes?: { nome: string; resumo: string }[] | null;
  tempoRespostaMs?: number | null;
  criadoEm: Date;
}

const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" });

const ICONE_ACAO: Record<string, string> = { anotar_atendimento: "✎", salvar_cliente: "☺", registrar_venda: "$", chamar_humano: "☎", salvar_contato: "☺", chamar_equipe: "☎" };

function Tique({ status }: { status: string }) {
  if (status === "falhou") return <span className="font-bold text-negativo" title="Não foi entregue">!</span>;
  if (status === "lida") return <span className="text-[#53bdeb]" title="Lida">✓✓</span>;
  if (status === "entregue") return <span title="Entregue">✓✓</span>;
  if (status === "enviada") return <span title="Enviada">✓</span>;
  return null;
}

export function segundos(ms: number | null | undefined) {
  if (ms == null) return null;
  return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`;
}

/** `equipe` é como as respostas de pessoas aparecem: "Equipe da loja" no WhatsApp, "Equipe Urutau" no chat do site. */
export function Bolhas({ mensagens, ocultarRascunhos = true, equipe = "Equipe da loja" }: { mensagens: MensagemNaTela[]; ocultarRascunhos?: boolean; equipe?: string }) {
  let ultimoDia = "";
  return (
    <ol className="space-y-1.5" aria-label="Mensagens">
      {mensagens
        .filter((m) => !(ocultarRascunhos && m.status === "rascunho"))
        .map((m) => {
          const d = dia.format(m.criadoEm);
          const separador = d !== ultimoDia;
          ultimoDia = d;
          return (
            <li key={m.id}>
              {separador && <p className="my-3 text-center text-xs font-medium text-suave first-letter:uppercase">{d}</p>}
              {m.autor === "sistema" ? (
                <p className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-superficie px-3 py-1 text-center text-xs text-suave">{m.texto}</p>
              ) : (
                <Bolha m={m} equipe={equipe} />
              )}
            </li>
          );
        })}
    </ol>
  );
}

function Bolha({ m, equipe }: { m: MensagemNaTela; equipe: string }) {
  const daLoja = m.autor !== "cliente";
  return (
    <div className={`flex flex-col ${daLoja ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug shadow-sm ${
          daLoja ? `rounded-br-md ${m.autor === "humano" ? "border border-destaque/60 bg-superficie" : "bg-superficie-2"}` : "rounded-bl-md border border-borda bg-superficie"
        } ${m.status === "falhou" ? "!border-negativo" : ""}`}
      >
        {daLoja && <span className="mb-0.5 block text-[11px] font-semibold text-suave">{m.autor === "agente" ? "Agente" : equipe}</span>}
        <p className="whitespace-pre-wrap break-words">{m.texto}</p>
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-suave">
          {m.autor === "agente" && segundos(m.tempoRespostaMs) && <span title="Tempo até responder">{segundos(m.tempoRespostaMs)} ·</span>}
          {hora.format(m.criadoEm)}
          {daLoja && <Tique status={m.status} />}
        </span>
      </div>
      {m.erro && <span className="mt-0.5 max-w-[85%] text-xs text-negativo">{m.erro}</span>}
      {m.acoes && m.acoes.length > 0 && (
        <ul className="mt-1 flex max-w-[85%] flex-wrap justify-end gap-1">
          {m.acoes.map((a, i) => (
            <li key={i} className="rounded-full border border-borda px-2 py-0.5 text-[11px] text-suave">
              <span aria-hidden>{ICONE_ACAO[a.nome] ?? "•"}</span> {a.resumo}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
