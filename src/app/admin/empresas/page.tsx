import Link from "next/link";
import { AbasClientes } from "@/components/central/AbasClientes";
import { FormResponsavel } from "@/components/central/Formularios";
import { Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { quando, variacao } from "@/lib/central";
import { hoje, mesAtual, nomeDoMes } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { NOME_MODULO, PERFIS } from "@/lib/perfis";
import { definirResponsavel } from "@/lib/servidor/acoes-central";
import { listarEmpresasAdmin } from "@/lib/servidor/admin";
import { empresasDaCentral, listarEquipe } from "@/lib/servidor/central";

export const metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

export default async function Clientes() {
  const db = obterDb();
  const agora = new Date();
  const mes = mesAtual(agora);
  const [empresas, detalhes, equipe] = await Promise.all([empresasDaCentral(db, mes, undefined, hoje(agora)), listarEmpresasAdmin(db), listarEquipe(db)]);
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));
  const semDono = empresas.filter((e) => !e.responsavelId).length;
  return (
    <div className="space-y-5">
      <AbasClientes />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Empresas no sistema</h1>
          <p className="mt-1 text-[15px] text-suave">
            {empresas.length} {empresas.length === 1 ? "empresa" : "empresas"} no app
            {semDono ? ` · ${semDono} sem responsável na equipe` : " · todas com responsável"}
          </p>
        </div>
        <Link href="/admin/empresas/nova" className="btn-central">Nova empresa</Link>
      </header>
      {empresas.length === 0 ? (
        <Vazio>Nenhuma empresa ainda.</Vazio>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-superficie px-5 py-3">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead className="text-left text-meta">
              <tr>
                <th className="py-2 font-medium">Empresa</th>
                <th className="py-2 font-medium">Módulos</th>
                <th className="py-2 font-medium">Responsável</th>
                <th className="py-2 text-right font-medium">Vendido em {nomeDoMes(mes).split(" ")[0]}</th>
                <th className="py-2 text-right font-medium">vs. mês passado</th>
                <th className="py-2 text-right font-medium">A conferir</th>
                <th className="py-2 text-right font-medium">Cliente entrou</th>
              </tr>
            </thead>
            <tbody>
              {empresas.map((e) => {
                const d = detalhes.find((x) => x.id === e.id);
                return (
                  <tr key={e.id} className="border-t border-superficie-2 align-middle">
                    <td className="py-3 pr-3">
                      <Link href={`/admin/empresas/${e.id}`} className="font-semibold hover:underline">{e.nome}</Link>
                      <span className="block text-meta">{PERFIS[e.perfil].nome}{e.cidade ? ` · ${e.cidade}` : ""}</span>
                    </td>
                    <td className="py-3 pr-3 text-suave">{d ? [...d.modulos].map((m) => NOME_MODULO[m]).join(", ") : "–"}</td>
                    <td className="py-3 pr-3">
                      <FormResponsavel acao={definirResponsavel.bind(null, e.id)} equipe={pessoas} atual={e.responsavelId} empresa={e.nome} />
                    </td>
                    <td className="numero py-3 text-right">{formatarReais(e.vendasMes)}</td>
                    <td className="numero py-3 text-right">
                      <Variacao valor={variacao(e.vendasMes, e.vendasMesAnterior)} />
                    </td>
                    <td className="numero py-3 text-right">{e.aConferir || <span className="text-meta">0</span>}</td>
                    <td className="py-3 text-right text-suave">{e.ultimoAcesso ? quando(e.ultimoAcesso, agora) : <span className="text-meta">nunca</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Mesmo período do mês anterior; um traço quando não há base para comparar. */
function Variacao({ valor }: { valor: number | null }) {
  if (valor == null) return <span className="text-meta">–</span>;
  return <span className={valor >= 0 ? "text-positivo" : "text-negativo"}>{valor >= 0 ? "+" : "−"}{Math.abs(valor)}%</span>;
}
