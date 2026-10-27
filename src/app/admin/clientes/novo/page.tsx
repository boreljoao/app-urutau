import Link from "next/link";
import { FormClienteUrutau, type LinhaServico } from "@/components/central/Receita";
import { obterDb } from "@/db";
import type { ServicoUrutau } from "@/db/schema";
import { mesAtual } from "@/lib/datas";
import { centavosParaInput } from "@/lib/dinheiro";
import { exigirSocio } from "@/lib/servidor/acesso";
import { criarClienteUrutau } from "@/lib/servidor/acoes-receita";
import { obterLead } from "@/lib/servidor/comercial";
import { dadosDosFormularios } from "@/lib/servidor/formularios-receita";

export const metadata = { title: "Novo cliente" };
export const dynamic = "force-dynamic";

/** Frentes do site (interesse do lead) → serviço cobrado. */
const DA_FRENTE: Record<string, ServicoUrutau> = { atende: "atendente", flow: "automacao", financas: "sistema", gestao: "gestao", sites: "site", ads: "trafego" };
/** Origens em que alguém da equipe trouxe o lead; nas outras ele veio sozinho e os 10% vão para o bolo. */
const ALGUEM_TROUXE = new Set(["prospeccao", "indicacao", "outro"]);

export default async function NovoCliente({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  await exigirSocio();
  const { lead: leadId } = await searchParams;
  const db = obterDb();
  const [dados, doLead] = await Promise.all([dadosDosFormularios(db), leadId && /^[0-9a-f-]{36}$/i.test(leadId) ? obterLead(db, leadId) : null]);
  const mes = mesAtual();
  let inicial: Record<string, string> = { inicio: mes, diaVencimento: "10" };
  let servicos: LinhaServico[] | undefined;
  if (doLead) {
    const l = doLead.lead;
    inicial = {
      ...inicial,
      nome: l.nome,
      contato: l.contato ?? "",
      telefone: l.telefone ?? "",
      email: l.email ?? "",
      cidade: l.cidade ?? "",
      ramo: l.categoria ?? "",
      quemTrouxeId: l.responsavelId && ALGUEM_TROUXE.has(l.origem) ? l.responsavelId : "",
      empresaId: l.empresaId ?? "",
    };
    // A proposta aceita (ou a mais recente) sugere os serviços; com um serviço só, o valor também.
    const p = doLead.propostas.find((x) => x.status === "aceita") ?? doLead.propostas[0];
    const tipos: ServicoUrutau[] = p?.servicos.length ? p.servicos.map((s) => DA_FRENTE[s] ?? "outro") : l.interesses.map((s) => DA_FRENTE[s] ?? "outro");
    if (tipos.length) {
      const linha = (servico: ServicoUrutau, recorrencia: "mensal" | "unico", valor = ""): LinhaServico => ({ servico, descricao: "", recorrencia, valor, custo: "", executorId: "", abriuMao: false, inicio: "" });
      // Site é projeto: se a proposta tem entrada, o site leva esse valor como projeto único.
      const siteUnico = !!p?.valorUnicoCentavos && tipos.includes("site");
      const mensais = tipos.filter((t) => !(siteUnico && t === "site"));
      servicos = mensais.map((t) => linha(t, "mensal", p && mensais.length === 1 && p.valorMensalCentavos ? centavosParaInput(p.valorMensalCentavos) : ""));
      if (p?.valorUnicoCentavos) servicos.push(linha(siteUnico ? "site" : "outro", "unico", centavosParaInput(p.valorUnicoCentavos)));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <p className="mb-1 text-[13px]">
          <Link href={doLead ? `/admin/comercial/leads/${doLead.lead.id}` : "/admin/clientes"} className="text-meta hover:text-texto">‹ {doLead ? doLead.lead.nome : "Clientes"}</Link>
        </p>
        <h1 className="font-titulo text-2xl font-bold tracking-tight">{doLead ? `${doLead.lead.nome} virou cliente` : "Novo cliente"}</h1>
        <p className="mt-1 text-[15px] text-suave">
          As comissões usam a regra de hoje e ficam gravadas em cada serviço. As cobranças até este mês são criadas na hora.
        </p>
      </header>
      <FormClienteUrutau acao={criarClienteUrutau} dados={dados} inicial={inicial} leadId={doLead?.lead.id} servicosIniciais={servicos} />
    </div>
  );
}
