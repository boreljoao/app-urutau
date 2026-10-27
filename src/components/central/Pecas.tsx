import type { EstadoPresenca } from "@/lib/central";
import { iniciais, matizDa } from "@/lib/central";

/** Peças visuais da Central que não precisam de JavaScript no navegador. */

export function Avatar({ nome, posicao, tamanho = 36 }: { nome: string; posicao: number; tamanho?: number }) {
  const h = matizDa(posicao);
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center rounded-full font-titulo font-bold"
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.38, background: `hsl(${h} 55% 78%)`, color: `hsl(${h} 45% 18%)` }}
    >
      {iniciais(nome)}
    </span>
  );
}

const COR_PONTO: Record<EstadoPresenca, string> = {
  online: "var(--positivo)",
  ausente: "var(--texto-suave)",
  offline: "var(--borda)",
  nunca: "transparent",
};

export function Ponto({ estado }: { estado: EstadoPresenca }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      {estado === "online" && <span className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: COR_PONTO.online }} />}
      <span
        className="relative inline-block h-2 w-2 rounded-full"
        style={{ background: COR_PONTO[estado], boxShadow: estado === "nunca" ? "inset 0 0 0 1px var(--texto-meta)" : undefined }}
      />
    </span>
  );
}

export function TituloBloco({ children, acao }: { children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-titulo text-[15px] font-bold">{children}</h2>
      {acao}
    </div>
  );
}

/** Um bloco vazio mantém o lugar e diz o que falta, em vez de sumir. */
export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-superficie-2/60 px-3 py-4 text-[13px] text-meta">{children}</p>;
}
