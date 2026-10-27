"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", rotulo: "Visão geral", exato: true },
  { href: "/admin/equipe", rotulo: "Equipe" },
  { href: "/admin/empresas", rotulo: "Clientes" },
];

/** A tela aberta só muda de cinza para claro: nada de pílula colorida. */
export function Navegacao() {
  const caminho = usePathname();
  return (
    <nav aria-label="Central" className="flex items-center gap-4 sm:gap-5">
      {LINKS.map((l) => {
        const ativo = l.exato ? caminho === l.href : caminho.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={ativo ? "page" : undefined}
            className={`whitespace-nowrap text-sm font-semibold transition-colors ${ativo ? "text-texto" : "text-suave hover:text-texto"}`}
          >
            {l.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
