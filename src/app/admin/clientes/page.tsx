import Link from "next/link";
import { AbasClientes } from "@/components/central/AbasClientes";
import { Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { hoje, mesAtual, mesDe, nomeDoMes } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { NOME_SERVICO_URUTAU } from "@/lib/receita";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { gerarCobrancas, listarClientesUrutau } from "@/lib/servidor/receita";

export const metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

export default async function Clientes() {
  const eu = await exigirSuperadmin();
  const db = obterDb();
  const agora = new Date();
  const mes = mesAtual(agora);
  await gerarCobrancas(db, mes);
  const lista = await listarClientesUrutau(db, mes, hoje(agora));
  const ativos = lista.filter((c) => c.ativo);
  const mrr = ativos.reduce((s, c) => s + c.mensal, 0);
  const atrasados = lista.filter((c) => c.atrasadas > 0).length;

  return (
    <div className="space-y-4">
      <AbasClientes />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Clientes da Urutau</h1>
          <p className="mt-1 text-[15px] text-suave">
            {ativos.length} {ativos.length === 1 ? "cliente ativo" : "clientes ativos"}
            {eu.socio && mrr ? ` · ${formatarReais(mrr)} por mês` : ""}
            {eu.socio && atrasados ? ` · ${atrasados} com pagamento atrasado` : ""}
          </p>
        </div>
        {eu.socio && <Link href="/admin/clientes/novo" className="btn-central">Novo cliente</Link>}
      </header>

      {lista.length === 0 ? (
        <Vazio>Nenhum cliente cadastrado ainda. {eu.socio ? "Cadastre em Novo cliente ou pelo lead que fechou, no Comercial." : "Os sócios cadastram os clientes que fecham."}</Vazio>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-superficie px-5 py-3">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead className="text-left text-meta">
              <tr>
                <th className="py-2 font-medium">Cliente</th>
                <th className="py-2 font-medium">O que fazemos</th>
                <th className="py-2 font-medium">Quem trouxe</th>
                {eu.socio && <th className="py-2 text-right font-medium">Por mês</th>}
                <th className="py-2 font-medium">Contrato até</th>
                {eu.socio && <th className="py-2 font-medium">Pagamentos</th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className={`border-t border-superficie-2 align-top ${c.ativo ? "" : "opacity-60"}`}>
                  <td className="py-3 pr-3">
                    <Link href={`/admin/clientes/${c.id}`} className="font-semibold hover:underline">{c.nome}</Link>
                    <span className="block text-meta">{[c.ramo, c.cidade].filter(Boolean).join(" · ") || (c.ativo ? "—" : "sem contrato ativo")}</span>
                  </td>
                  <td className="py-3 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {c.servicos.length ? (
                        c.servicos.map((s) => (
                          <span key={s} className="rounded-full bg-superficie-2 px-2 py-0.5 text-[12px]">{NOME_SERVICO_URUTAU[s]}</span>
                        ))
                      ) : (
                        <span className="text-meta">—</span>
                      )}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-suave">{c.quemTrouxe ?? <span className="text-meta">veio sozinho</span>}</td>
                  {eu.socio && <td className="numero py-3 pr-3 text-right">{c.mensal ? formatarReais(c.mensal) : <span className="text-meta">—</span>}</td>}
                  <td className="py-3 pr-3 text-suave">
                    {!c.ativo ? <span className="text-meta">encerrado</span> : c.semPrazo ? "sem prazo" : c.fimContrato ? nomeDoMes(c.fimContrato, true) : "—"}
                    {c.ativo && c.fimContrato && !c.semPrazo && mesDe(`${c.fimContrato}-01`) <= mes && <span className="block text-[12px] text-negativo">acaba este mês</span>}
                  </td>
                  {eu.socio && (
                    <td className="py-3">
                      {c.atrasadas ? (
                        <span className="text-negativo">
                          {c.atrasadas} {c.atrasadas === 1 ? "atrasada" : "atrasadas"} · {formatarReais(c.valorAtrasado)}
                        </span>
                      ) : (
                        <span className="text-suave">{c.ativo ? "em dia" : "—"}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
