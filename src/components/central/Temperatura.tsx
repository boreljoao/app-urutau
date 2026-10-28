import type { Temperatura as TipoTemperatura } from "@/lib/chat-site";

/** Como o visitante do site está: quente em amarelo (dado que importa), o resto em cinza. */
export function Temperatura({ t }: { t?: TipoTemperatura }) {
  if (!t) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${t === "quente" ? "bg-destaque text-fundo" : "bg-superficie-2 text-suave"}`}>{t}</span>
  );
}
