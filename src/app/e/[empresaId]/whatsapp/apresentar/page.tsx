import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoAcao } from "@/components/BotaoAcao";
import { CelularWhatsApp } from "@/components/atendimento/Apresentacao";
import { segundos } from "@/components/atendimento/Bolhas";
import { obterDb } from "@/db";
import { NOME_INTENCAO } from "@/lib/atendimento";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { limparSimuladorAcao, simularAcao } from "@/lib/servidor/acoes-atendimento";
import { conversaDeTeste, obterAgente } from "@/lib/servidor/atendimento";

export const metadata = { title: "Apresentar atendente" };
export const dynamic = "force-dynamic";

const SUGESTOES: Record<string, string[]> = {
  revenda_veiculos: ["Oi, o Onix ainda está disponível?", "Vocês financiam sem entrada?", "Posso ir ver o carro sábado?"],
  consultorio: ["Oi, queria marcar uma consulta", "Quanto custa a consulta?", "Vocês atendem por convênio?"],
  padrao: ["Oi! Como funciona o atendente no WhatsApp?", "Quanto custa um site?", "Quero conversar com alguém da equipe"],
};

const ICONE: Record<string, string> = { anotar_atendimento: "✎", salvar_cliente: "☺", registrar_venda: "$", chamar_humano: "☎" };

/** O simulador em tela cheia para mostrar a um cliente: o celular de um lado, o painel da loja do outro. */
export default async function Apresentar({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "lancar");
  if (!ctx.modulos.has("whatsapp")) notFound();
  const db = obterDb();
  const [agente, teste] = await Promise.all([obterAgente(db, empresaId), conversaDeTeste(db, empresaId, ctx.usuario.id)]);
  const c = teste.conversa;
  const respostas = teste.mensagens.filter((m) => m.autor === "agente" && m.tempoRespostaMs != null);
  const tempoMedio = respostas.length ? respostas.reduce((s, m) => s + (m.tempoRespostaMs ?? 0), 0) / respostas.length : null;
  const custo = teste.mensagens.reduce((s, m) => s + (m.custoMicrosUsd ?? 0), 0);
  const acoes = teste.mensagens.flatMap((m) => (m.acoes ?? []).map((a, i) => ({ ...a, chave: `${m.id}-${i}`, em: m.criadoEm })));
  const nomeLoja = agente?.nome && agente.nome !== "Atendente" ? agente.nome : ctx.empresa.nome;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link href={`/e/${empresaId}/whatsapp`} aria-label="Voltar às conversas" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-titulo text-2xl font-bold">Atendente no WhatsApp</h1>
          <p className="text-sm text-suave">Escreva como cliente. A resposta é da IA, de verdade, e o painel ao lado é o que a loja recebe.</p>
        </div>
        {c && (
          <BotaoAcao acao={limparSimuladorAcao.bind(null, empresaId)} className="btn-secundario !min-h-10 !px-3 text-sm">
            Recomeçar
          </BotaoAcao>
        )}
      </header>

      {/* No computador sai da coluna estreita do app: o celular e o painel lado a lado. */}
      <div className="grid items-start gap-6 lg:relative lg:left-1/2 lg:w-[min(1080px,calc(100vw-4rem))] lg:-translate-x-1/2 lg:grid-cols-[400px_minmax(0,1fr)]">
        <CelularWhatsApp nomeLoja={nomeLoja} mensagens={teste.mensagens} acao={simularAcao.bind(null, empresaId)} sugestoes={SUGESTOES[ctx.empresa.perfil] ?? SUGESTOES.padrao} />

        <section aria-labelledby="t-painel" className="space-y-4">
          <h2 id="t-painel" className="font-titulo text-lg font-bold">O que chega no painel da loja</h2>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="cartao !py-3">
              <dt className="text-xs text-suave">Cliente</dt>
              <dd className="text-lg font-semibold">{c?.nome ?? "Ainda sem nome"}</dd>
            </div>
            <div className={`cartao !py-3 ${c?.status === "humano" ? "!border-destaque" : ""}`}>
              <dt className="text-xs text-suave">Situação</dt>
              <dd className="text-lg font-semibold">
                {!c ? "Esperando mensagem" : c.status === "humano" ? "Chamou a equipe" : "Atendente cuidando"}
              </dd>
              {c?.status === "humano" && c.motivoHumano && <dd className="text-sm text-suave">{c.motivoHumano}</dd>}
            </div>
            <div className="cartao !py-3 sm:col-span-2">
              <dt className="text-xs text-suave">O que a pessoa quer</dt>
              <dd className="text-lg font-semibold">{c?.intencao ? NOME_INTENCAO[c.intencao] ?? c.intencao : "A IA anota assim que entender"}</dd>
              {c?.resumo && <dd className="text-sm">{c.resumo}</dd>}
            </div>
          </dl>

          <div className="cartao space-y-2">
            <h3 className="text-sm font-semibold">O que o atendente fez sozinho</h3>
            {acoes.length === 0 ? (
              <p className="text-sm text-suave">Cada anotação, cliente salvo, venda ou chamada da equipe aparece aqui.</p>
            ) : (
              <ol className="space-y-1.5">
                {acoes.map((a) => (
                  <li key={a.chave} className="flex gap-2 text-sm">
                    <span aria-hidden className="w-4 shrink-0 text-center text-destaque">{ICONE[a.nome] ?? "•"}</span>
                    <span>{a.resumo}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="cartao !px-2 !py-3">
              <dt className="text-xs text-suave">Mensagens</dt>
              <dd className="font-titulo text-2xl font-bold">{teste.mensagens.filter((m) => m.status !== "rascunho").length}</dd>
            </div>
            <div className="cartao !px-2 !py-3">
              <dt className="text-xs text-suave">Responde em</dt>
              <dd className="font-titulo text-2xl font-bold">{segundos(tempoMedio) ?? "—"}</dd>
            </div>
            <div className="cartao !px-2 !py-3">
              <dt className="text-xs text-suave">Custo da IA</dt>
              <dd className="font-titulo text-2xl font-bold">{custo > 0 ? `US$ ${(custo / 1e6).toFixed(3)}` : "—"}</dd>
            </div>
          </dl>

          <p className="text-sm text-suave">
            Funciona 24 horas, inclusive fim de semana. No número de verdade, a equipe vê todas as conversas aqui, assume quando quiser e escolhe entre
            responder sozinho, aprovar cada resposta ou pausar.
          </p>
        </section>
      </div>
    </div>
  );
}
