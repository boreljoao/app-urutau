import { Avatar } from "@/components/central/Pecas";
import { descreverAcao, primeiroNome } from "@/lib/central";

export interface ItemAtividade {
  id: string;
  quem: string | null;
  /** Posição na equipe (decide o tom do avatar); null para quem é cliente. */
  posicao: number | null;
  cliente: boolean;
  ator: string;
  acao: string;
  dados: Record<string, unknown> | null;
  empresa: string | null;
  quando: string;
}

const SEM_PESSOA: Record<string, string> = { sistema: "O sistema", agente: "O atendente" };

/** "Gabriel conferiu uma venda · Urutau Veículos ........ há 5 min" */
export function Linhas({ itens }: { itens: ItemAtividade[] }) {
  return (
    <ul className="divide-y divide-superficie-2">
      {itens.map((a) => (
        <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          {a.posicao != null && a.quem ? (
            <Avatar nome={a.quem} posicao={a.posicao} tamanho={24} />
          ) : (
            <span aria-hidden className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-superficie-2 text-[11px] text-suave">
              {a.quem ? a.quem[0].toUpperCase() : "·"}
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-[13px]">
            <span className="font-semibold">{a.quem ? primeiroNome(a.quem) : (SEM_PESSOA[a.ator] ?? "Alguém")}</span>
            {a.cliente && <span className="text-meta"> (cliente)</span>} {descreverAcao(a.acao, a.dados)}
            {a.empresa && <span className="text-suave"> · {a.empresa}</span>}
          </p>
          <span className="shrink-0 text-[12px] text-meta">{a.quando}</span>
        </li>
      ))}
    </ul>
  );
}
