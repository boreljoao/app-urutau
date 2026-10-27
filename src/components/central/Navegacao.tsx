"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS: { href: string; rotulo: string; exato?: boolean; tambem?: string[]; soSocio?: boolean }[] = [
  { href: "/admin", rotulo: "Visão geral", exato: true },
  { href: "/admin/equipe", rotulo: "Equipe" },
  { href: "/admin/clientes", rotulo: "Clientes", tambem: ["/admin/empresas"] },
  { href: "/admin/comercial", rotulo: "Comercial" },
  { href: "/admin/receita", rotulo: "Receita", soSocio: true },
  { href: "/admin/ganhos", rotulo: "Meus ganhos" },
];

/** A tela aberta só muda de cinza para claro: nada de pílula colorida. */
export function Navegacao({ socio }: { socio: boolean }) {
  const caminho = usePathname();
  return (
    <nav aria-label="Central" className="flex items-center gap-4 overflow-x-auto sm:gap-5">
      {LINKS.filter((l) => socio || !l.soSocio).map((l) => {
        const ativo = l.exato ? caminho === l.href : [l.href, ...(l.tambem ?? [])].some((h) => caminho.startsWith(h));
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
