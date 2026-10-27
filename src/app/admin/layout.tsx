import Link from "next/link";
import { Avatar } from "@/components/central/Pecas";
import { Navegacao } from "@/components/central/Navegacao";
import { Presenca } from "@/components/Presenca";
import { obterDb } from "@/db";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { listarEquipe } from "@/lib/servidor/central";
import { sair } from "../(publico)/acoes";

export const metadata = { title: { template: "%s · Central Urutau", default: "Central Urutau" } };

export default async function LayoutCentral({ children }: { children: React.ReactNode }) {
  const eu = await exigirSuperadmin();
  const equipe = await listarEquipe(obterDb());
  const posicao = Math.max(0, equipe.findIndex((p) => p.id === eu.id));
  return (
    <div className="central min-h-dvh">
      <header className="sticky top-0 z-20 bg-fundo/95 shadow-[0_1px_0_var(--superficie)]">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center gap-4 px-4 sm:gap-8 md:px-6">
          <Link href="/admin" className="flex items-center gap-2" aria-label="Central Urutau">
            <Marca />
            <span className="hidden whitespace-nowrap font-titulo text-[15px] font-bold tracking-tight sm:inline">
              urutau <span className="text-suave">central</span>
            </span>
          </Link>
          <Navegacao socio={eu.socio} />
          <div className="ml-auto flex items-center gap-3">
            <Link href="/admin/conta" className="flex items-center gap-2 text-sm text-suave hover:text-texto">
              <span className="hidden sm:inline">{eu.nome.split(" ")[0]}</span>
              <Avatar nome={eu.nome} posicao={posicao} tamanho={28} />
            </Link>
            <form action={sair}>
              <button className="text-sm text-meta hover:text-texto">Sair</button>
            </form>
          </div>
        </div>
      </header>
      {eu.senhaProvisoria && (
        <p className="bg-aviso-fundo px-4 py-2 text-center text-[13px]">
          Você está com uma senha provisória.{" "}
          <Link href="/admin/conta" className="font-semibold underline underline-offset-2">Troque agora</Link>
        </p>
      )}
      <main className="mx-auto max-w-[1200px] px-4 pb-16 pt-6 md:px-6">{children}</main>
      <Presenca />
    </div>
  );
}

/** O urutau de olho aberto: um olho amarelo na noite. */
function Marca() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <circle cx="11" cy="11" r="10" fill="var(--superficie-2)" />
      <circle cx="11" cy="11" r="5.5" fill="var(--destaque)" />
      <circle cx="11" cy="11" r="2.2" fill="var(--fundo)" />
    </svg>
  );
}
