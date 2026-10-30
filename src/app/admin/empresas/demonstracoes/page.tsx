import Link from "next/link";
import { AbasClientes } from "@/components/central/AbasClientes";
import { BotaoForm } from "@/components/central/Formularios";
import { obterDb } from "@/db";
import { quando } from "@/lib/central";
import { criarDemonstracoesAcao, novaSenhaDemonstracaoAcao } from "@/lib/servidor/acoes-admin";
import { DEMONSTRACOES, EMAIL_DEMONSTRACAO, RAMOS, existentes } from "@/lib/servidor/demonstracao";

export const metadata = { title: "Demonstrações" };
export const dynamic = "force-dynamic";
// Gerar uma empresa com 13 meses de lançamentos leva alguns segundos.
export const maxDuration = 120;

/** As empresas de mentira que a equipe leva para a prospecção: uma por ramo, sempre com datas de hoje. */
export default async function Demonstracoes() {
  const db = obterDb();
  const agora = new Date();
  const criadas = await existentes(db);
  return (
    <div className="space-y-5">
      <AbasClientes />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Demonstrações</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-suave">
            Uma empresa inventada por ramo, com 13 meses de vendas e despesas, clientes, conversas no WhatsApp e o atendente ligado. Recrie antes de
            cada visita para as datas ficarem atuais.
          </p>
        </div>
        <BotaoForm acao={criarDemonstracoesAcao} rotulo="Criar ou recriar todas" campos={{ ramo: "todos" }} className="btn-central" pendenteTexto="Criando as três…" />
      </header>

      <ul className="grid gap-4 md:grid-cols-3">
        {RAMOS.map((r) => {
          const d = DEMONSTRACOES[r];
          const e = criadas[r];
          return (
            <li key={r} className="flex flex-col gap-3 rounded-xl bg-superficie p-5">
              <div>
                <p className="text-meta">{d.rotulo}</p>
                <h2 className="font-titulo text-lg font-bold">{d.empresa.nome}</h2>
                <p className="mt-1 text-[13px] text-suave">{d.descricao}</p>
                <p className="mt-2 text-[13px]">{e ? `Gerada ${e.criadoEm ? quando(e.criadoEm, agora) : ""}` : <span className="text-meta">Ainda não criada</span>}</p>
              </div>
              {e && (
                <div className="flex flex-wrap gap-2 text-[13px]">
                  <Link href={`/e/${e.id}/painel`} className="btn-secundario !min-h-9 !px-3">Painel</Link>
                  <Link href={`/e/${e.id}/whatsapp`} className="btn-secundario !min-h-9 !px-3">Conversas</Link>
                  <Link href={`/e/${e.id}/whatsapp/apresentar`} className="btn-secundario !min-h-9 !px-3">Apresentar</Link>
                </div>
              )}
              <div className="mt-auto">
                <BotaoForm acao={criarDemonstracoesAcao} rotulo={e ? "Recriar" : "Criar"} campos={{ ramo: r }} className="btn-secundario !min-h-9 !px-3 text-[13px]" />
              </div>
            </li>
          );
        })}
      </ul>

      <section className="space-y-2 rounded-xl bg-superficie p-5">
        <h2 className="font-semibold">Conta para mostrar no celular</h2>
        <p className="max-w-2xl text-[13px] text-suave">
          Entre com <strong className="text-texto">{EMAIL_DEMONSTRACAO}</strong> para mostrar só as demonstrações, sem a Central e sem nenhum cliente de
          verdade. A senha aparece uma vez quando a conta é criada; gerar outra desconecta quem estiver usando a antiga.
        </p>
        <BotaoForm acao={novaSenhaDemonstracaoAcao} rotulo="Gerar nova senha" className="btn-secundario !min-h-9 !px-3 text-[13px]" pendenteTexto="Gerando…" />
      </section>
    </div>
  );
}
