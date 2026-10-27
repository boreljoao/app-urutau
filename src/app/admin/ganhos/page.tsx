import Link from "next/link";
import { Numero } from "@/components/central/Numero";
import { Avatar, TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { formatarData, mesAtual, mesDe, nomeDoMes, ultimosMeses } from "@/lib/datas";
import { formatarPcm, formatarReais } from "@/lib/dinheiro";
import { NOME_SERVICO_URUTAU, SERVICOS_URUTAU } from "@/lib/receita";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { listarEquipe } from "@/lib/servidor/central";
import { extratoDeGanhos, gerarCobrancas, lerParametros, lerRegras, resumoDeGanhos, serieDeGanhos } from "@/lib/servidor/receita";

export const metadata = { title: "Meus ganhos" };
export const dynamic = "force-dynamic";

/**
 * O que cada pessoa ganha com a Urutau. A equipe só vê a própria página (o parâmetro `pessoa`
 * é ignorado); os sócios podem abrir a de qualquer um.
 */
export default async function MeusGanhos({ searchParams }: { searchParams: Promise<{ pessoa?: string }> }) {
  const eu = await exigirSuperadmin();
  const sp = await searchParams;
  const db = obterDb();
  const mes = mesAtual();
  await gerarCobrancas(db, mes);
  const equipe = await listarEquipe(db);
  const alvo = eu.socio && sp.pessoa && equipe.some((p) => p.id === sp.pessoa) ? sp.pessoa : eu.id;
  const pessoa = equipe.find((p) => p.id === alvo);
  const posicao = Math.max(0, equipe.findIndex((p) => p.id === alvo));
  const meses = ultimosMeses(mes, 6);
  const [r, extrato, serie, regras, p] = await Promise.all([resumoDeGanhos(db, alvo, mes), extratoDeGanhos(db, alvo), serieDeGanhos(db, alvo, meses), lerRegras(db), lerParametros(db)]);
  const maiorMes = Math.max(1, ...serie.map((s) => s.valor));
  const nome = alvo === eu.id ? "Você" : (pessoa?.nome.split(" ")[0] ?? "Pessoa");
  const nomeMes = nomeDoMes(mes).split(" ")[0];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div className="flex items-center gap-3">
          {pessoa && <Avatar nome={pessoa.nome} posicao={posicao} tamanho={48} />}
          <div>
            <h1 className="font-titulo text-2xl font-bold tracking-tight">{alvo === eu.id ? "Meus ganhos" : `Ganhos de ${nome}`}</h1>
            <p className="mt-1 text-[15px] text-suave">
              {r.clientesQueTrouxe.length} {r.clientesQueTrouxe.length === 1 ? "cliente trazido" : "clientes trazidos"} · {r.servicosQueExecuta}{" "}
              {r.servicosQueExecuta === 1 ? "serviço executado" : "serviços executados"} · comissão só depois que o cliente paga
            </p>
          </div>
        </div>
        {eu.socio && (
          <nav aria-label="Pessoa" className="flex flex-wrap gap-1">
            {equipe.map((e) => (
              <Link
                key={e.id}
                href={`/admin/ganhos?pessoa=${e.id}`}
                aria-current={e.id === alvo ? "page" : undefined}
                className={`rounded-full px-3 py-1 text-[13px] ${e.id === alvo ? "bg-superficie-2 font-semibold text-texto" : "text-suave hover:text-texto"}`}
              >
                {e.nome.split(" ")[0]}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <section className="cartao" aria-label="Resumo">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          <Numero rotulo={`Ganhou em ${nomeMes}`} valor={formatarReais(r.noMes)} linha="de clientes que já pagaram" destaque={r.noMes > 0} />
          <Numero rotulo="Previsto neste mês" valor={formatarReais(r.previstoNoMes)} linha="se todos os clientes pagarem" />
          <Numero rotulo="A receber da Urutau" valor={formatarReais(r.aReceber)} linha="cliente pagou, falta o repasse" />
          <Numero rotulo="Já recebido" valor={formatarReais(r.recebido)} linha="desde o começo" />
        </dl>
      </section>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <section className="cartao lg:col-span-2" aria-labelledby="t-meses">
          <TituloBloco acao={<span className="text-[13px] text-meta">pelo mês em que o cliente pagou</span>}>
            <span id="t-meses">Últimos 6 meses</span>
          </TituloBloco>
          <ul className="flex h-40 items-end gap-3" aria-label="Ganho por mês">
            {serie.map((s) => (
              <li key={s.mes} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="numero text-[11px] text-suave">{s.valor ? formatarReais(s.valor).replace(",00", "") : ""}</span>
                <span className="w-full max-w-14 rounded-t-md bg-destaque" style={{ height: `${Math.max(2, (s.valor / maiorMes) * 100)}%`, opacity: s.valor ? 1 : 0.2 }} />
                <span className="text-[12px] text-meta first-letter:uppercase">{nomeDoMes(s.mes, true).slice(0, 3)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="cartao" aria-labelledby="t-regra">
          <TituloBloco>
            <span id="t-regra">Como você ganha</span>
          </TituloBloco>
          <ul className="space-y-1.5 text-[13px]">
            <li className="flex justify-between">
              <span>Trouxe o cliente</span>
              <span className="numero">{formatarPcm(p.trouxePcm, 1)}</span>
            </li>
            {SERVICOS_URUTAU.filter((s) => s.id !== "outro").map((s) => (
              <li key={s.id} className="flex justify-between text-suave">
                <span>Executa {s.nome.charAt(0).toLowerCase() + s.nome.slice(1)}</span>
                <span className="numero">{formatarPcm(regras[s.id] ?? 0, 1)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-meta">Trouxe e executa? Soma as duas. Cada contrato guarda a regra do dia em que foi fechado.</p>
        </section>
      </div>

      {r.clientesQueTrouxe.length > 0 && (
        <section className="cartao" aria-labelledby="t-trouxe">
          <TituloBloco>
            <span id="t-trouxe">Clientes que {alvo === eu.id ? "você" : nome} trouxe</span>
          </TituloBloco>
          <p className="flex flex-wrap gap-1.5">
            {r.clientesQueTrouxe.map((c) => (
              <Link key={c.id} href={`/admin/clientes/${c.id}`} className="rounded-full bg-superficie-2 px-3 py-1 text-[13px] hover:brightness-125">{c.nome}</Link>
            ))}
          </p>
        </section>
      )}

      <section className="cartao" aria-labelledby="t-extrato">
        <TituloBloco acao={<span className="text-[13px] text-meta">cada centavo, cliente por cliente</span>}>
          <span id="t-extrato">Extrato</span>
        </TituloBloco>
        {extrato.length === 0 ? (
          <Vazio>Ainda nada. A comissão aparece aqui quando um cliente que {alvo === eu.id ? "você" : nome} trouxe ou atende paga a Urutau.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="text-left text-meta">
                <tr>
                  <th className="py-2 font-medium">Cliente pagou</th>
                  <th className="py-2 font-medium">Cliente</th>
                  <th className="py-2 font-medium">Serviço</th>
                  <th className="py-2 font-medium">Por quê</th>
                  <th className="py-2 text-right font-medium">Conta</th>
                  <th className="py-2 text-right font-medium">Você ganha</th>
                  <th className="py-2 font-medium">Repasse</th>
                </tr>
              </thead>
              <tbody>
                {extrato.map((l) => (
                  <tr key={l.id} className="border-t border-superficie-2">
                    <td className="py-2.5 pr-3 text-suave">
                      {l.clientePagouEm ? formatarData(l.clientePagouEm) : "—"}
                      <span className="block text-[12px] text-meta first-letter:uppercase">ref. {nomeDoMes(mesDe(l.competencia), true)}</span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/clientes/${l.clienteId}`} className="hover:underline">{l.cliente}</Link>
                    </td>
                    <td className="py-2.5 pr-3">{NOME_SERVICO_URUTAU[l.servico]}</td>
                    <td className="py-2.5 pr-3 text-suave">{l.tipo === "trouxe" ? "trouxe o cliente" : "executou"}</td>
                    <td className="numero py-2.5 pr-3 text-right text-suave">
                      {formatarPcm(l.pcm, 1)} de {formatarReais(l.base)}
                    </td>
                    <td className="numero py-2.5 pr-3 text-right font-semibold">{formatarReais(l.valor)}</td>
                    <td className="py-2.5">{l.status === "pago" ? <span className="text-positivo">recebido{l.pagoEm ? ` ${formatarData(l.pagoEm).slice(0, 5)}` : ""}</span> : <span className="text-suave">a receber</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
