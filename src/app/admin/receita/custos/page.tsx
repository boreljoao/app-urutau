import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { BotaoComErro, FormCusto, FormMes } from "@/components/central/Receita";
import { obterDb } from "@/db";
import { mesAtual, mesDe, nomeDoMes } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { exigirSocio } from "@/lib/servidor/acesso";
import { criarCusto, encerrarCusto, excluirCusto } from "@/lib/servidor/acoes-receita";
import { listarClientesUrutau, listarCustos } from "@/lib/servidor/receita";

export const metadata = { title: "Custos" };
export const dynamic = "force-dynamic";

const CATEGORIA = { ferramenta: "Ferramenta", freelancer: "Freelancer", imposto: "Imposto", marketing: "Marketing", estrutura: "Estrutura", outro: "Outro" } as const;

export default async function Custos() {
  await exigirSocio();
  const db = obterDb();
  const mes = mesAtual();
  const [lista, clientes] = await Promise.all([listarCustos(db), listarClientesUrutau(db, mes, `${mes}-01`)]);
  const vale = (c: (typeof lista)[number]["custo"]) =>
    c.recorrencia === "mensal" ? mesDe(c.inicio) <= mes && (!c.fim || mesDe(c.fim) >= mes) : mesDe(c.inicio) === mes;
  const doMes = lista.filter((l) => vale(l.custo)).reduce((s, l) => s + l.custo.valorCentavos, 0);

  return (
    <div className="grid items-start gap-3 lg:grid-cols-[1fr_360px]">
      <section className="cartao" aria-labelledby="t-custos">
        <TituloBloco acao={<span className="numero text-[13px] text-meta">{formatarReais(doMes)} em {nomeDoMes(mes).split(" ")[0]}</span>}>
          <span id="t-custos">Custos da Urutau</span>
        </TituloBloco>
        <p className="mb-3 text-[13px] text-suave">
          O custo de cada serviço fica no contrato do cliente. Aqui entra o que é da empresa: DAS do MEI, ferramentas, freelancers, anúncios da própria Urutau.
        </p>
        {lista.length === 0 ? (
          <Vazio>Nenhum custo lançado. Comece pelo DAS do MEI e pelas assinaturas.</Vazio>
        ) : (
          <table className="w-full text-[13px]">
            <tbody>
              {lista.map(({ custo: c, cliente }) => (
                <tr key={c.id} className={`border-t border-superficie-2 align-middle first:border-0 ${vale(c) ? "" : "opacity-50"}`}>
                  <td className="py-2.5 pr-3">
                    <span className="font-semibold">{c.descricao}</span>
                    <span className="block text-[12px] text-meta">
                      {CATEGORIA[c.categoria]}
                      {cliente ? ` · ${cliente}` : ""}
                      {" · "}
                      {c.recorrencia === "mensal" ? `todo mês desde ${nomeDoMes(mesDe(c.inicio), true)}${c.fim ? ` até ${nomeDoMes(mesDe(c.fim), true)}` : ""}` : `uma vez em ${nomeDoMes(mesDe(c.inicio), true)}`}
                    </span>
                  </td>
                  <td className="numero py-2.5 pr-3 text-right">{formatarReais(c.valorCentavos)}</td>
                  <td className="py-2.5 text-right">
                    <span className="inline-flex items-center gap-3">
                      {c.recorrencia === "mensal" && !c.fim && <FormMes acao={encerrarCusto.bind(null, c.id)} nome="fim" rotulo="Parou" padrao={mes} />}
                      <BotaoComErro acao={excluirCusto.bind(null, c.id)} rotulo="Excluir" confirmar={`Excluir "${c.descricao}"? Some de todos os meses.`} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="cartao" aria-labelledby="t-novo">
        <TituloBloco>
          <span id="t-novo">Lançar custo</span>
        </TituloBloco>
        <FormCusto acao={criarCusto} clientes={clientes.map((c) => ({ id: c.id, nome: c.nome }))} hojeMes={mes} />
      </section>
    </div>
  );
}
