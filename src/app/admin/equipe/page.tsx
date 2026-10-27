import Link from "next/link";
import { BotaoRedefinirSenha } from "@/components/Admin";
import { FormPessoaEquipe, SeletorPapel } from "@/components/central/Formularios";
import { Avatar, Ponto, TituloBloco } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { presenca } from "@/lib/central";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { adicionarPessoaEquipe, definirPapelEquipe, redefinirSenhaEquipe } from "@/lib/servidor/acoes-central";
import { listarEquipe } from "@/lib/servidor/central";

export const metadata = { title: "Equipe" };
export const dynamic = "force-dynamic";

export default async function Equipe() {
  const eu = await exigirSuperadmin();
  const equipe = await listarEquipe(obterDb());
  const agora = new Date();
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section aria-labelledby="t-equipe">
        <h1 id="t-equipe" className="mb-1 font-titulo text-2xl font-bold tracking-tight">Equipe Urutau</h1>
        <p className="mb-5 text-[15px] text-suave">Quem está aqui vê todos os clientes e tem a própria área com metas e anotações.</p>
        <ul className="divide-y divide-superficie-2 rounded-xl bg-superficie px-5">
          {equipe.map((p, i) => {
            const st = presenca(p.vistoEm, agora);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-4 py-4">
                <Avatar nome={p.nome} posicao={i} tamanho={40} />
                <Link href={`/admin/equipe/${p.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block truncate font-titulo text-[16px] font-bold">{p.nome}</span>
                  <span className="block truncate text-[13px] text-suave">{p.email}</span>
                </Link>
                <span className="flex items-center gap-1.5 text-[13px] text-suave">
                  <Ponto estado={st.estado} /> {st.texto}
                </span>
                {p.senhaProvisoria && <span className="rounded-full bg-aviso-fundo px-2 py-0.5 text-[12px]">senha provisória</span>}
                {eu.socio && p.id !== eu.id ? (
                  <SeletorPapel key={p.papel} acao={definirPapelEquipe.bind(null, p.id)} atual={p.papel} nome={p.nome} />
                ) : (
                  <span className="text-[12px] text-meta">{p.papel === "socio" ? "sócio" : "equipe"}</span>
                )}
                {p.id !== eu.id && eu.socio && <BotaoRedefinirSenha acao={redefinirSenhaEquipe.bind(null, p.id)} nome={p.nome} />}
              </li>
            );
          })}
        </ul>
      </section>
      {eu.socio && (
      <section className="cartao h-fit bg-superficie" aria-labelledby="t-nova">
        <TituloBloco>
          <span id="t-nova">Pôr alguém na equipe</span>
        </TituloBloco>
        <p className="mb-4 text-[13px] text-suave">
          A conta nasce com uma senha provisória, que aparece aqui uma única vez. Passe para a pessoa por mensagem privada; no primeiro acesso ela troca em Minha conta.
        </p>
        <FormPessoaEquipe acao={adicionarPessoaEquipe} />
      </section>
      )}
    </div>
  );
}
