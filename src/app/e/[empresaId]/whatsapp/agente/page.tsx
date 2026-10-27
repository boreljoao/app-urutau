import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoAcao } from "@/components/BotaoAcao";
import { FormAgente, FormConexao } from "@/components/atendimento/Configuracao";
import { obterDb } from "@/db";
import type { Perfil } from "@/db/schema";
import { MODELOS, MODELO_PADRAO, estimarCustoMensal, usdParaReais } from "@/lib/atendimento";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { conectarNumeroAcao, desconectarNumeroAcao, salvarAgenteAcao } from "@/lib/servidor/acoes-atendimento";
import { obterAgente } from "@/lib/servidor/atendimento";

export const metadata = { title: "Ajustar atendente" };
export const dynamic = "force-dynamic";

const reais = (usd: number) => usdParaReais(usd).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Um ponto de partida para o texto de conhecimento, no vocabulário do negócio. */
function modeloDeTexto(perfil: Perfil, empresa: string) {
  const comum = `HORÁRIO
Segunda a sexta, 9h às 18h. Sábado, 9h às 13h.

ENDEREÇO
(rua, número, bairro, cidade) — tem estacionamento?

PAGAMENTO
Pix, cartão de débito e crédito (até 3x sem juros), dinheiro.`;
  if (perfil === "revenda_veiculos")
    return `SOBRE A ${empresa.toUpperCase()}
Revenda de seminovos com garantia de 3 meses no motor e câmbio.

CARROS DISPONÍVEIS (atualize sempre)
- Onix LT 1.0 2021, 48 mil km, prata — R$ 72.900
- HB20 Comfort 2020, 61 mil km, branco — R$ 64.500

FINANCIAMENTO
Trabalhamos com os principais bancos. Entrada a partir de 20%. Para simular, pedir nome completo e CPF e chamar alguém da loja.

TROCA
Aceitamos carro na troca, com avaliação presencial.

VISITA E TEST DRIVE
Marcar dia e horário; o test drive precisa de CNH válida.

${comum}`;
  if (perfil === "consultorio")
    return `SOBRE O CONSULTÓRIO
Atendimentos com hora marcada.

SERVIÇOS E VALORES
- Consulta: R$ 250 (50 min)
- Retorno em até 30 dias: sem custo

CONVÊNIOS
Atendimento particular, com recibo para reembolso.

AGENDAMENTO
Perguntar o melhor dia e período e chamar alguém da equipe para confirmar o horário.

${comum}`;
  return `SOBRE A ${empresa.toUpperCase()}
(o que a loja vende, em uma frase)

PRODUTOS E PREÇOS (atualize sempre)
- Produto A — R$ 49,90
- Produto B — R$ 89,90

ENTREGA
Entregamos no bairro e arredores, taxa de R$ 8, em até 2 horas. Retirada na loja sem custo.

TROCAS
Até 7 dias com a etiqueta.

${comum}`;
}

export default async function AjustarAgente({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "gerenciar");
  if (!ctx.modulos.has("whatsapp")) notFound();
  const agente = await obterAgente(obterDb(), empresaId);
  const h = await headers();
  const urlWebhook = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/api/whatsapp/webhook`;
  const base = `/e/${empresaId}/whatsapp`;
  const modelos = MODELOS.map((m) => {
    const e = estimarCustoMensal(300, 8, m.id);
    return { id: m.id, nome: m.nome, descricao: m.descricao, custo: `≈ ${reais(e.totalUsd)}/mês` };
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Link href={base} aria-label="Voltar às conversas" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <h1 className="flex-1 font-titulo text-2xl font-bold">Ajustar atendente</h1>
        <Link href={`${base}/testar`} className="btn-secundario !min-h-10 !px-3 text-sm">Testar</Link>
      </header>

      <section className="cartao space-y-4" aria-labelledby="t-quem">
        <h2 id="t-quem" className="font-titulo text-lg font-bold">Quem ele é e o que sabe</h2>
        <FormAgente
          acao={salvarAgenteAcao.bind(null, empresaId)}
          modelos={modelos}
          modeloDeTexto={modeloDeTexto(ctx.empresa.perfil, ctx.empresa.nome)}
          inicial={{
            nome: agente?.nome ?? "Atendente",
            tom: agente?.tom ?? "",
            conhecimento: agente?.conhecimento ?? "",
            quandoChamarHumano: agente?.quandoChamarHumano ?? "",
            modo: agente?.modo ?? "aprovacao",
            modelo: agente?.modelo ?? MODELO_PADRAO,
          }}
        />
      </section>

      <section className="cartao space-y-4" aria-labelledby="t-numero">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="t-numero" className="font-titulo text-lg font-bold">Número do WhatsApp</h2>
            <p className="text-sm text-suave">
              {agente?.phoneNumberId && agente.tokenCifrado
                ? `Conectado${agente.numeroExibicao ? ` ao ${agente.numeroExibicao}` : ""}. Mensagens novas chegam aqui na hora.`
                : "Pela API oficial do WhatsApp (Meta). O número pode continuar no app WhatsApp Business do celular."}
            </p>
          </div>
          {agente?.phoneNumberId && (
            <BotaoAcao acao={desconectarNumeroAcao.bind(null, empresaId)} className="btn-secundario !min-h-10 shrink-0 text-sm" confirmar="Desconectar o número? O agente para de receber mensagens.">
              Desconectar
            </BotaoAcao>
          )}
        </div>
        {agente ? (
          <FormConexao acao={conectarNumeroAcao.bind(null, empresaId)} phoneNumberId={agente.phoneNumberId ?? ""} temToken={!!agente.tokenCifrado} />
        ) : (
          <p className="text-sm text-suave">Salve o atendente acima primeiro.</p>
        )}
        <details className="rounded-xl border border-borda p-3 text-sm">
          <summary className="cursor-pointer font-medium">Passo a passo na Meta</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-suave">
            <li>Em developers.facebook.com, crie um app do tipo “Empresa” e adicione o produto WhatsApp.</li>
            <li>Ligue o número da loja (pelo cadastro incorporado dá para manter o mesmo número no app WhatsApp Business).</li>
            <li>Cadastre uma forma de pagamento na conta do WhatsApp Business: a Meta cobra por mensagem enviada.</li>
            <li>
              Em Webhooks, use a URL <code className="break-all rounded bg-superficie-2 px-1">{urlWebhook}</code>, o token de verificação que a equipe Urutau passar, e assine o
              campo <code className="rounded bg-superficie-2 px-1">messages</code>.
            </li>
            <li>Crie um usuário do sistema com permissão no WhatsApp, gere um token permanente e cole acima com o Phone number ID.</li>
          </ol>
        </details>
      </section>
    </div>
  );
}
