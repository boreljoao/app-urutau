import Link from "next/link";
import { Numero } from "@/components/central/Numero";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { FormPagamento } from "@/components/central/Receita";
import { GraficoMeses } from "@/components/GraficoMeses";
import { obterDb } from "@/db";
import { formatarData, hoje, mesAtual, mesDe, mesValido, nomeDoMes, somarMeses, ultimosMeses } from "@/lib/datas";
import { centavosParaInput, formatarPcm, formatarReais, razaoPcm } from "@/lib/dinheiro";
import { NOME_SERVICO_URUTAU, SERVICOS_URUTAU } from "@/lib/receita";
import { variacao } from "@/lib/central";
import { exigirSocio } from "@/lib/servidor/acesso";
import { pagarCobranca } from "@/lib/servidor/acoes-receita";
import { listarEquipe } from "@/lib/servidor/central";
import {
  cobrancasAtrasadas,
  cobrancasDoMes,
  comissoesAPagar,
  gerarCobrancas,
  lerParametros,
  listarClientesUrutau,
  margemPorCliente,
  numerosDoMes,
  receitaPorServico,
  recorrencia,
} from "@/lib/servidor/receita";

export const metadata = { title: "Receita" };
export const dynamic = "force-dynamic";

export default async function Receita({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await exigirSocio();
  const sp = await searchParams;
  const db = obterDb();
  const agora = new Date();
  const hojeData = hoje(agora);
  const atual = mesAtual(agora);
  const mes = mesValido(sp.mes) && sp.mes <= atual ? sp.mes : atual;
  await gerarCobrancas(db, atual);
  const p = await lerParametros(db);
  const meses = ultimosMeses(mes, 12);
  const [serie, rec, porServico, margens, atrasadas, doMes, aPagar, equipe, clientes] = await Promise.all([
    Promise.all(meses.map((m) => numerosDoMes(db, m, p))),
    recorrencia(db, mes),
    receitaPorServico(db, mes),
    margemPorCliente(db, mes, 3),
    cobrancasAtrasadas(db, hojeData),
    cobrancasDoMes(db, mes),
    comissoesAPagar(db),
    listarEquipe(db),
    listarClientesUrutau(db, mes, hojeData),
  ]);
  const n = serie[serie.length - 1];
  const anterior = serie[serie.length - 2];
  const nomeMes = nomeDoMes(mes).split(" ")[0];
  const socios = equipe.filter((e) => e.papel === "socio");
  const maior = socios.find((s) => s.id === p.socioMaiorId);
  const menor = maior ? socios.find((s) => s.id !== maior.id) : undefined;
  const margem = n.receita ? razaoPcm(n.sobra, n.receita) : null;
  const totalMargens = margens.reduce((s, m) => s + m.faturado, 0);
  const aReceberMes = doMes.filter((c) => c.status === "a_receber").reduce((s, c) => s + c.valor, 0);
  const totalAPagar = aPagar.reduce((s, a) => s + a.total, 0);
  const ativos = clientes.filter((c) => c.ativo);
  const oportunidades = SERVICOS_URUTAU.filter((s) => ["trafego", "site", "reels", "gestao", "atendente"].includes(s.id))
    .map((s) => ({ ...s, semEle: ativos.filter((c) => !c.servicos.includes(s.id)) }))
    .filter((s) => s.semEle.length > 0);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div>
          <h1 className="font-titulo text-2xl font-bold tracking-tight first-letter:uppercase">Receita de {nomeDoMes(mes)}</h1>
          <p className="mt-1 text-[15px] text-suave">
            Entrou {formatarReais(n.receita)}
            {anterior.receita ? ` (${(variacao(n.receita, anterior.receita) ?? 0) >= 0 ? "+" : "−"}${Math.abs(variacao(n.receita, anterior.receita) ?? 0)}% sobre ${nomeDoMes(somarMeses(mes, -1)).split(" ")[0]})` : ""}
            {" · "}sobraram {formatarReais(n.sobra)}
            {atrasadas.length ? ` · ${atrasadas.length} ${atrasadas.length === 1 ? "cobrança atrasada" : "cobranças atrasadas"}` : ""}.
          </p>
        </div>
        <nav aria-label="Mês" className="flex items-center gap-1">
          <Link href={`/admin/receita?mes=${somarMeses(mes, -1)}`} className="btn-leve !min-h-8 !px-3">‹</Link>
          <span className="px-2 text-[13px] text-suave first-letter:uppercase">{nomeDoMes(mes, true)}</span>
          {mes < atual && <Link href={`/admin/receita?mes=${somarMeses(mes, 1)}`} className="btn-leve !min-h-8 !px-3">›</Link>}
        </nav>
      </header>

      <section className="cartao" aria-label="O mês">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 xl:grid-cols-7">
          <Numero rotulo="Entrou (pago)" valor={formatarReais(n.receita)} linha={`faturado ${formatarReais(n.faturado)} · falta ${formatarReais(aReceberMes)}`} destaque />
          <Numero rotulo="Comissões" valor={formatarReais(n.comissoes)} linha={n.receita ? `${formatarPcm(razaoPcm(n.comissoes, n.receita) ?? 0, 0)} da receita` : "—"} />
          <Numero rotulo="Custos" valor={formatarReais(n.custos)} linha={`${formatarReais(n.custoEmpresa)} empresa · ${formatarReais(n.custoServicos)} serviços`} />
          <Numero rotulo="Sobrou (lucro)" valor={formatarReais(n.sobra)} linha={margem != null ? `margem de ${formatarPcm(margem, 0)}` : "—"} tom={n.sobra < 0 ? "negativo" : undefined} />
          <Numero rotulo="Caixa (sugerido)" valor={formatarReais(n.caixa)} linha={`${formatarPcm(p.caixaPcm, 0)} da receita`} />
          <Numero rotulo={maior ? maior.nome.split(" ")[0] : "Sócio 1"} valor={formatarReais(maior ? n.socioMaior : Math.round(n.paraSocios / 2))} linha="na teoria" />
          <Numero rotulo={menor ? menor.nome.split(" ")[0] : "Sócio 2"} valor={formatarReais(maior ? n.socioMenor : n.paraSocios - Math.round(n.paraSocios / 2))} linha={maior ? "na teoria" : "defina o sócio maior em Regras"} />
        </dl>
      </section>

      <section className="cartao" aria-label="Recorrência">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-5">
          <Numero
            rotulo="Receita recorrente (por mês)"
            valor={formatarReais(rec.mrr)}
            linha={rec.mrrAnterior ? `${rec.mrr >= rec.mrrAnterior ? "+" : "−"}${formatarReais(Math.abs(rec.mrr - rec.mrrAnterior))} sobre o mês passado` : "primeiro mês"}
            tom={rec.mrr < rec.mrrAnterior ? "negativo" : rec.mrr > rec.mrrAnterior ? "positivo" : undefined}
          />
          <Numero rotulo="Clientes ativos" valor={String(rec.clientesAtivos)} linha={`ticket médio ${formatarReais(rec.ticketMedio)}`} />
          <Numero rotulo="Cancelamentos no mês" valor={String(rec.cancelamentos)} linha={rec.churnPcm != null ? `${formatarPcm(rec.churnPcm, 1)} dos clientes` : "—"} tom={rec.cancelamentos ? "negativo" : undefined} />
          <Numero rotulo="Contratos acabando" valor={String(rec.vencendo.length)} linha="nos próximos 3 meses" />
          <Numero rotulo="Comissões a repassar" valor={formatarReais(totalAPagar)} linha={`${aPagar.length} ${aPagar.length === 1 ? "pessoa" : "pessoas"}`} />
        </dl>
      </section>

      <GraficoMeses dados={serie.map((s) => ({ mes: s.mes, faturamento: s.receita, despesas: s.comissoes + s.custos, lucro: s.sobra }))} />

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <section className="cartao lg:col-span-2" aria-labelledby="t-cob">
          <TituloBloco acao={<span className="text-[13px] text-meta">{doMes.length} no mês</span>}>
            <span id="t-cob" className="first-letter:uppercase">Cobranças de {nomeMes}</span>
          </TituloBloco>
          {doMes.length === 0 ? (
            <Vazio>Nenhuma cobrança neste mês.</Vazio>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {doMes.map((c) => (
                  <tr key={c.id} className="border-t border-superficie-2 align-middle first:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/admin/clientes/${c.clienteId}`} className="font-semibold hover:underline">{c.cliente}</Link>
                      <span className={`block text-[12px] ${c.status === "a_receber" && c.vencimento < hojeData ? "text-negativo" : "text-meta"}`}>
                        {c.status === "pago" && c.pagoEm ? `pago em ${formatarData(c.pagoEm)}` : c.status === "cancelada" ? "cancelada" : `vence ${formatarData(c.vencimento)}`}
                      </span>
                    </td>
                    <td className="numero py-2 pr-3 text-right">{formatarReais(c.status === "pago" ? (c.valorPago ?? c.valor) : c.valor)}</td>
                    <td className="py-2 text-right">
                      {c.status === "a_receber" ? <FormPagamento acao={pagarCobranca.bind(null, c.id)} valor={centavosParaInput(c.valor)} hoje={hojeData} /> : <span className="text-[12px] text-suave">{c.status === "pago" ? "pago" : "—"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="space-y-3">
          <section className="cartao" aria-labelledby="t-atraso">
            <TituloBloco acao={<span className="numero text-[13px] text-meta">{formatarReais(atrasadas.reduce((s, a) => s + a.valor, 0))}</span>}>
              <span id="t-atraso">Atrasadas</span>
            </TituloBloco>
            {atrasadas.length === 0 ? (
              <Vazio>Ninguém atrasado.</Vazio>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {atrasadas.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <Link href={`/admin/clientes/${a.clienteId}`} className="min-w-0 truncate hover:underline">
                      {a.cliente} <span className="text-meta">· {nomeDoMes(mesDe(a.competencia), true)}</span>
                    </Link>
                    <span className="numero shrink-0 text-negativo">{formatarReais(a.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-acabando">
            <TituloBloco>
              <span id="t-acabando">Contratos acabando</span>
            </TituloBloco>
            {rec.vencendo.length === 0 ? (
              <Vazio>Nenhum contrato acaba nos próximos 3 meses.</Vazio>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {rec.vencendo.map((v) => (
                  <li key={v.contratoId} className="flex justify-between gap-3">
                    <Link href={`/admin/clientes/${v.clienteId}`} className="hover:underline">{clientes.find((c) => c.id === v.clienteId)?.nome ?? "Cliente"}</Link>
                    <span className="text-suave">{nomeDoMes(v.fim, true)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[12px] text-meta">Hora de conversar sobre renovação.</p>
          </section>
        </div>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <section className="cartao" aria-labelledby="t-servico">
          <TituloBloco acao={<span className="text-[13px] text-meta">faturado em {nomeMes}</span>}>
            <span id="t-servico">Por serviço</span>
          </TituloBloco>
          {porServico.length === 0 ? (
            <Vazio>Nada faturado neste mês.</Vazio>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="text-left text-meta">
                <tr>
                  <th className="pb-2 font-medium">Serviço</th>
                  <th className="pb-2 text-right font-medium">Faturado</th>
                  <th className="pb-2 text-right font-medium">Custo + comissões</th>
                  <th className="pb-2 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {porServico.map((s) => {
                  const m = razaoPcm(s.valor - s.custo - s.comissoes, s.valor);
                  return (
                    <tr key={s.servico} className="border-t border-superficie-2">
                      <td className="py-2">{NOME_SERVICO_URUTAU[s.servico]}</td>
                      <td className="numero py-2 text-right">{formatarReais(s.valor)}</td>
                      <td className="numero py-2 text-right text-suave">{formatarReais(s.custo + s.comissoes)}</td>
                      <td className={`numero py-2 text-right ${m != null && m < 30_000 ? "text-negativo" : ""}`}>{m != null ? formatarPcm(m, 0) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[12px] text-meta">Comissões entram quando o cliente paga; até lá a margem aparece maior.</p>
        </section>

        <section className="cartao" aria-labelledby="t-cliente">
          <TituloBloco acao={<span className="text-[13px] text-meta">últimos 3 meses</span>}>
            <span id="t-cliente">Por cliente</span>
          </TituloBloco>
          {margens.length === 0 ? (
            <Vazio>Nenhum cliente faturado nos últimos 3 meses.</Vazio>
          ) : (
            <table className="w-full text-[13px]">
              <thead className="text-left text-meta">
                <tr>
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 text-right font-medium">Faturado</th>
                  <th className="pb-2 text-right font-medium">Peso</th>
                  <th className="pb-2 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody>
                {margens.slice(0, 10).map((m) => {
                  const mg = razaoPcm(m.faturado - m.custo - m.comissoes, m.faturado);
                  const peso = razaoPcm(m.faturado, totalMargens);
                  return (
                    <tr key={m.clienteId} className="border-t border-superficie-2">
                      <td className="py-2">
                        <Link href={`/admin/clientes/${m.clienteId}`} className="hover:underline">{m.nome}</Link>
                      </td>
                      <td className="numero py-2 text-right">{formatarReais(m.faturado)}</td>
                      <td className={`numero py-2 text-right ${peso != null && peso > 30_000 ? "font-semibold text-negativo" : "text-suave"}`}>{peso != null ? formatarPcm(peso, 0) : "—"}</td>
                      <td className="numero py-2 text-right">{mg != null ? formatarPcm(mg, 0) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[12px] text-meta">Peso acima de 30% em vermelho: depender demais de um cliente é risco.</p>
        </section>
      </div>

      {oportunidades.length > 0 && (
        <section className="cartao" aria-labelledby="t-oport">
          <TituloBloco acao={<span className="text-[13px] text-meta">clientes ativos que ainda não têm</span>}>
            <span id="t-oport">Dá para oferecer</span>
          </TituloBloco>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {oportunidades.map((o) => (
              <div key={o.id} className="text-[13px]">
                <p className="font-semibold">
                  {o.nome} <span className="numero text-meta">· {o.semEle.length}</span>
                </p>
                <p className="mt-1 text-suave">
                  {o.semEle.slice(0, 4).map((c, i) => (
                    <span key={c.id}>
                      {i > 0 && ", "}
                      <Link href={`/admin/clientes/${c.id}`} className="hover:underline">{c.nome}</Link>
                    </span>
                  ))}
                  {o.semEle.length > 4 ? "…" : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
