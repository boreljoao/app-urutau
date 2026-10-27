import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Gaveta } from "@/components/central/Formularios";
import { Numero } from "@/components/central/Numero";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { BotaoComErro, FormContratoOuServico, FormDadosClienteUrutau, FormEncerrarContrato, FormMes, FormPagamento } from "@/components/central/Receita";
import { obterDb } from "@/db";
import { vendas } from "@/db/schema";
import { formatarData, hoje, intervaloDoMes, mesAtual, mesDe, nomeDoMes, somarMeses } from "@/lib/datas";
import { centavosParaInput, formatarPcm, formatarReais, razaoPcm } from "@/lib/dinheiro";
import { NOME_SERVICO_URUTAU, linhasDaCobranca, mensalidadeNoMes, mesesEntre, multaDeRescisao, ultimoMesDoContrato, valorPorDia } from "@/lib/receita";
import { formatarTelefone } from "@/lib/validacao";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { adicionarServico, cancelarCobranca, desfazerPagamentoAcao, encerrarContrato, encerrarServico, novoContrato, pagarCobranca, salvarClienteUrutau } from "@/lib/servidor/acoes-receita";
import { listarEquipe } from "@/lib/servidor/central";
import { dadosDosFormularios } from "@/lib/servidor/formularios-receita";
import { gerarCobrancas, obterClienteUrutau, paraCalculoDoContrato } from "@/lib/servidor/receita";

export const dynamic = "force-dynamic";

const STATUS_COBRANCA = { a_receber: "a receber", pago: "pago", cancelada: "cancelada" } as const;
const STATUS_CONTRATO = { ativo: "ativo", encerrado: "terminou o prazo", cancelado: "cancelado" } as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = /^[0-9a-f-]{36}$/i.test(id) ? await obterClienteUrutau(obterDb(), id) : null;
  return { title: d?.cliente.nome ?? "Cliente" };
}

export default async function ClienteUrutau({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eu = await exigirSuperadmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = obterDb();
  const agora = new Date();
  const hojeData = hoje(agora);
  const mes = mesAtual(agora);
  await gerarCobrancas(db, mes);
  const d = await obterClienteUrutau(db, id);
  if (!d) notFound();
  const { cliente: c } = d;
  const [form, equipe] = await Promise.all([eu.socio ? dadosDosFormularios(db) : null, listarEquipe(db)]);

  // Âncora: quanto custa por dia e quanto isso pesa no faturamento dele (sistema ou informado à mão).
  const ativos = d.contratos.filter((k) => k.status === "ativo");
  const mensal = ativos.reduce((s, k) => s + mensalidadeNoMes(paraCalculoDoContrato(k), d.itens.filter((i) => i.contratoId === k.id), mes), 0);
  const mesPassado = somarMeses(mes, -1);
  let faturamento: number | null = c.faturamentoInformadoCentavos;
  let fonteFaturamento = "informado";
  if (c.empresaId) {
    const { inicio, fim } = intervaloDoMes(mesPassado);
    const [r] = await db
      .select({ v: sql<number>`coalesce(sum(${vendas.valorCentavos}), 0)::bigint`.mapWith(Number) })
      .from(vendas)
      .where(and(eq(vendas.empresaId, c.empresaId), isNull(vendas.excluidoEm), gte(vendas.data, inicio), lt(vendas.data, fim)));
    faturamento = r.v;
    fonteFaturamento = `vendas no sistema em ${nomeDoMes(mesPassado).split(" ")[0]}`;
  }
  const pesoPcm = faturamento ? razaoPcm(mensal, faturamento) : null;

  // Números do dinheiro (sócios): recebido, em atraso, e margem dos últimos 3 meses.
  const recebido = d.cobrancas.filter((k) => k.status === "pago").reduce((s, k) => s + (k.valorPagoCentavos ?? 0), 0);
  const atrasadas = d.cobrancas.filter((k) => k.status === "a_receber" && k.vencimento < hojeData);
  const comissoesTotais = d.ganhos.reduce((s, g) => s + g.total, 0);
  const meusGanhos = d.ganhos.filter((g) => g.usuarioId === eu.id).reduce((s, g) => s + g.total, 0);
  const meuPrevisto = ativos.reduce((s, k) => {
    const calc = paraCalculoDoContrato(k);
    return (
      s +
      d.itens
        .filter((i) => i.contratoId === k.id)
        .reduce((t, i) => {
          const v = linhasDaCobranca(calc, [i], mes).total;
          const exec = i.executorId === eu.id && !i.executorAbriuMao ? Math.round((v * i.executorPcm) / 100_000) : 0;
          const trouxe = c.quemTrouxeId === eu.id ? Math.round((v * i.trouxePcm) / 100_000) : 0;
          return t + exec + trouxe;
        }, 0)
    );
  }, 0);
  const quemTrouxe = equipe.find((p) => p.id === c.quemTrouxeId)?.nome ?? null;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div className="min-w-0">
          <p className="mb-1 text-[13px]">
            <Link href="/admin/clientes" className="text-meta hover:text-texto">‹ Clientes</Link>
          </p>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">{c.nome}</h1>
          <p className="mt-1 flex flex-wrap gap-x-2 text-[15px] text-suave">
            {[c.ramo, c.cidade, c.contato, c.telefone ? formatarTelefone(c.telefone) : null, c.email].filter(Boolean).join(" · ") || "sem dados de contato"}
          </p>
          <p className="mt-1 text-[13px] text-meta">
            {c.quemTrouxeId ? `Trazido por ${quemTrouxe ?? "alguém da equipe"}` : "Veio sozinho (os 10% de quem trouxe ficam no bolo)"}
            {d.empresa && (
              <>
                {" · usa o sistema como "}
                <Link href={`/admin/empresas/${d.empresa.id}`} className="underline-offset-2 hover:underline">{d.empresa.nome}</Link>
              </>
            )}
            {c.leadId && (
              <>
                {" · "}
                <Link href={`/admin/comercial/leads/${c.leadId}`} className="underline-offset-2 hover:underline">histórico do lead</Link>
              </>
            )}
          </p>
        </div>
        {eu.socio && form && (
          <div className="flex flex-wrap gap-2">
            <Gaveta rotulo="Editar dados" titulo={`Dados de ${c.nome}`}>
              <FormDadosClienteUrutau
                acao={salvarClienteUrutau.bind(null, c.id)}
                dados={form}
                inicial={{
                  nome: c.nome,
                  contato: c.contato ?? "",
                  telefone: c.telefone ?? "",
                  email: c.email ?? "",
                  ramo: c.ramo ?? "",
                  cidade: c.cidade ?? "",
                  documento: c.documento ?? "",
                  quemTrouxeId: c.quemTrouxeId ?? "",
                  empresaId: c.empresaId ?? "",
                  faturamentoInformado: c.faturamentoInformadoCentavos ? centavosParaInput(c.faturamentoInformadoCentavos) : "",
                  observacao: c.observacao ?? "",
                }}
              />
            </Gaveta>
            <Gaveta rotulo="Novo contrato" titulo="Novo contrato (renovação)" principal>
              <FormContratoOuServico acao={novoContrato.bind(null, c.id)} dados={form} quemTrouxe={c.quemTrouxeId ?? undefined} comContrato />
            </Gaveta>
          </div>
        )}
      </header>

      <section className="cartao" aria-label="Números do cliente">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Numero rotulo="Paga por mês" valor={mensal ? formatarReais(mensal) : "–"} linha={mensal ? `${formatarReais(valorPorDia(mensal))} por dia` : "sem serviço mensal ativo"} />
          <Numero
            rotulo="Peso no faturamento dele"
            valor={pesoPcm != null ? formatarPcm(pesoPcm, 1) : "–"}
            linha={faturamento != null ? `de ${formatarReais(faturamento)} (${fonteFaturamento})` : "ligue ao sistema ou informe o faturamento"}
          />
          {eu.socio ? (
            <>
              <Numero rotulo="Já pagou" valor={formatarReais(recebido)} linha={`${d.cobrancas.filter((k) => k.status === "pago").length} pagamentos`} />
              <Numero rotulo="Em atraso" valor={formatarReais(atrasadas.reduce((s, k) => s + k.valorCentavos, 0))} linha={`${atrasadas.length} ${atrasadas.length === 1 ? "cobrança" : "cobranças"}`} tom={atrasadas.length ? "negativo" : undefined} />
              <Numero rotulo="Comissões pagas sobre ele" valor={formatarReais(comissoesTotais)} linha={recebido ? `${formatarPcm(razaoPcm(comissoesTotais, recebido) ?? 0, 0)} do que entrou` : "—"} />
              <Numero rotulo="Você ganha neste mês" valor={formatarReais(meuPrevisto)} linha={`previsto · ${formatarReais(meusGanhos)} até hoje`} destaque={meuPrevisto > 0} />
            </>
          ) : (
            <>
              <Numero rotulo="Você ganha neste mês" valor={formatarReais(meuPrevisto)} linha="previsto, se ele pagar" destaque={meuPrevisto > 0} />
              <Numero rotulo="Você já ganhou" valor={formatarReais(meusGanhos)} linha="com este cliente" />
            </>
          )}
        </dl>
      </section>

      {d.contratos.length === 0 && <Vazio>Nenhum contrato ainda.</Vazio>}
      {d.contratos.map((k) => {
        const calc = paraCalculoDoContrato(k);
        const itens = d.itens.filter((i) => i.contratoId === k.id);
        const fim = ultimoMesDoContrato(calc);
        const restantes = fim ? Math.max(0, mesesEntre(mes, fim)) : 0;
        const mensalK = mensalidadeNoMes(calc, itens, mes);
        const multa = multaDeRescisao(k.multaTipo, k.multaValor, mensalK, restantes);
        return (
          <section key={k.id} className="cartao" aria-label={`Contrato de ${formatarData(k.inicio)}`}>
            <TituloBloco
              acao={
                eu.socio && k.status === "ativo" && form ? (
                  <span className="flex gap-2">
                    <Gaveta rotulo="+ Serviço" titulo="Acrescentar serviço">
                      <FormContratoOuServico acao={adicionarServico.bind(null, k.id)} dados={form} quemTrouxe={c.quemTrouxeId ?? undefined} comContrato={false} />
                    </Gaveta>
                    <Gaveta rotulo="Encerrar" titulo="Encerrar contrato">
                      <p className="text-[13px] text-suave">
                        {k.multaTipo !== "nenhuma" ? `Multa de rescisão hoje: ${formatarReais(multa)} (${restantes} ${restantes === 1 ? "mês" : "meses"} restantes).` : "Este contrato não tem multa."}
                      </p>
                      <FormEncerrarContrato acao={encerrarContrato.bind(null, k.id)} padrao={mes} />
                    </Gaveta>
                  </span>
                ) : undefined
              }
            >
              Contrato · {nomeDoMes(mesDe(k.inicio), true)} → {fim ? nomeDoMes(fim, true) : "sem prazo"}{" "}
              <span className={`ml-1 text-[12px] font-normal ${k.status === "ativo" ? "text-positivo" : "text-meta"}`}>{STATUS_CONTRATO[k.status]}</span>
            </TituloBloco>
            <p className="mb-3 text-[13px] text-suave">
              {[
                `vence dia ${k.diaVencimento}`,
                k.meses ? `${k.meses} meses` : "sem prazo",
                k.descontoPcm ? `${formatarPcm(k.descontoPcm, 1)} de desconto${k.descontoMeses ? ` nos ${k.descontoMeses} primeiros meses` : ""}` : null,
                k.multaTipo === "valor" ? `multa de ${formatarReais(k.multaValor)}` : k.multaTipo === "percentual_restante" ? `multa de ${formatarPcm(k.multaValor, 1)} do que faltar` : "sem multa",
                k.status === "ativo" && k.multaTipo !== "nenhuma" && fim ? `multa hoje: ${formatarReais(multa)}` : null,
                k.motivoEncerramento ? `motivo: ${k.motivoEncerramento}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="text-left text-meta">
                  <tr>
                    <th className="py-2 font-medium">Serviço</th>
                    <th className="py-2 pr-3 text-right font-medium">Valor</th>
                    {eu.socio && <th className="py-2 pr-3 text-right font-medium">Nosso custo</th>}
                    <th className="py-2 font-medium">Quem executa</th>
                    <th className="py-2 font-medium">Período</th>
                    {eu.socio && <th className="py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.id} className={`border-t border-superficie-2 align-top ${i.ate && mesDe(i.ate) < mes ? "opacity-50" : ""}`}>
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold">{NOME_SERVICO_URUTAU[i.servico]}</span>
                        {i.descricao && <span className="block text-meta">{i.descricao}</span>}
                      </td>
                      <td className="numero py-2.5 pr-3 text-right">
                        {formatarReais(i.valorCentavos)}
                        <span className="block text-[12px] text-meta">{i.recorrencia === "mensal" ? `por mês · ${formatarReais(valorPorDia(i.valorCentavos))}/dia` : "projeto único"}</span>
                      </td>
                      {eu.socio && <td className="numero py-2.5 pr-3 text-right text-suave">{i.custoCentavos ? formatarReais(i.custoCentavos) : "—"}</td>}
                      <td className="py-2.5 pr-3">
                        {i.executor ?? <span className="text-meta">ninguém (bolo)</span>}
                        {i.executorId && (
                          <span className="block text-[12px] text-meta">
                            {i.executorAbriuMao ? "abriu mão da comissão" : `${formatarPcm(i.executorPcm, 1)} de execução`}
                            {c.quemTrouxeId ? ` · ${formatarPcm(i.trouxePcm, 1)} para quem trouxe` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-suave">
                        {i.recorrencia === "unico" ? nomeDoMes(mesDe(i.inicio ?? k.inicio), true) : `desde ${nomeDoMes(mesDe(i.inicio ?? k.inicio), true)}`}
                        {i.ate && <span className="block text-[12px] text-meta">até {nomeDoMes(mesDe(i.ate), true)}</span>}
                      </td>
                      {eu.socio && (
                        <td className="py-2.5 text-right">
                          {k.status === "ativo" && i.recorrencia === "mensal" && !i.ate && (
                            <FormMes acao={encerrarServico.bind(null, i.id)} nome="ate" rotulo="Tirar serviço" padrao={mes} confirmar="Tirar este serviço a partir do mês seguinte ao escolhido?" />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {eu.socio && (
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <section className="cartao lg:col-span-2" aria-labelledby="t-cobrancas">
            <TituloBloco acao={<span className="text-[13px] text-meta">as do mês aparecem no começo do mês</span>}>
              <span id="t-cobrancas">Cobranças</span>
            </TituloBloco>
            {d.cobrancas.length === 0 ? (
              <Vazio>Nenhuma cobrança ainda.</Vazio>
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {d.cobrancas.map((k) => {
                    const atrasada = k.status === "a_receber" && k.vencimento < hojeData;
                    return (
                      <tr key={k.id} className="border-t border-superficie-2 align-middle first:border-0">
                        <td className="py-2.5 pr-3">
                          <span className="font-semibold first-letter:uppercase">{nomeDoMes(mesDe(k.competencia))}</span>
                          <span className={`block text-[12px] ${atrasada ? "font-semibold text-negativo" : "text-meta"}`}>
                            {k.status === "pago" && k.pagoEm ? `pago em ${formatarData(k.pagoEm)}` : `vence ${formatarData(k.vencimento)}`}
                            {atrasada ? " · atrasada" : ""}
                          </span>
                        </td>
                        <td className="numero py-2.5 pr-3 text-right">
                          {formatarReais(k.valorCentavos)}
                          {k.status === "pago" && k.valorPagoCentavos != null && k.valorPagoCentavos !== k.valorCentavos && (
                            <span className="block text-[12px] text-meta">pagou {formatarReais(k.valorPagoCentavos)}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-suave">{STATUS_COBRANCA[k.status]}</td>
                        <td className="py-2.5 text-right">
                          {k.status === "a_receber" ? (
                            <span className="inline-flex flex-col items-end gap-1">
                              <FormPagamento acao={pagarCobranca.bind(null, k.id)} valor={centavosParaInput(k.valorCentavos)} hoje={hojeData} />
                              <BotaoComErro acao={cancelarCobranca.bind(null, k.id)} rotulo="Não vai cobrar este mês" confirmar="Tirar esta cobrança das contas (cortesia, renegociação)?" />
                            </span>
                          ) : k.status === "pago" ? (
                            <BotaoComErro acao={desfazerPagamentoAcao.bind(null, k.id)} rotulo="Desfazer pagamento" confirmar="Desfazer este pagamento? As comissões dele somem." />
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-ganhos">
            <TituloBloco>
              <span id="t-ganhos">Quem já ganhou com ele</span>
            </TituloBloco>
            {d.ganhos.length === 0 ? (
              <Vazio>As comissões aparecem quando o cliente paga.</Vazio>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {d.ganhos.map((g) => (
                  <li key={`${g.usuarioId}-${g.tipo}`} className="flex justify-between gap-3">
                    <span>
                      {g.nome} <span className="text-meta">· {g.tipo === "trouxe" ? "trouxe" : "executou"}</span>
                    </span>
                    <span className="numero">{formatarReais(g.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {c.observacao && <p className="px-1 text-[13px] text-suave">{c.observacao}</p>}
    </div>
  );
}
