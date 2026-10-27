import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoAcao } from "@/components/BotaoAcao";
import { ConversaDeTeste } from "@/components/atendimento/Chat";
import { obterDb } from "@/db";
import { NOME_INTENCAO, precoDo } from "@/lib/atendimento";
import { exigirAcesso } from "@/lib/servidor/acesso";
import { limparSimuladorAcao, simularAcao } from "@/lib/servidor/acoes-atendimento";
import { conversaDeTeste, obterAgente } from "@/lib/servidor/atendimento";

export const metadata = { title: "Testar atendente" };
export const dynamic = "force-dynamic";

const SUGESTOES: Record<string, string[]> = {
  revenda_veiculos: ["Oi, o Onix ainda está disponível?", "Vocês financiam sem entrada?", "Posso ir ver o carro sábado?"],
  consultorio: ["Oi, queria marcar uma consulta", "Quanto custa a consulta?", "Vocês atendem por convênio?"],
  padrao: ["Oi, vocês entregam hoje?", "Quanto custa?", "Quero comprar 2, pago no pix"],
};

export default async function Testar({ params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params;
  const ctx = await exigirAcesso(empresaId, "lancar");
  if (!ctx.modulos.has("whatsapp")) notFound();
  const db = obterDb();
  const [agente, teste] = await Promise.all([obterAgente(db, empresaId), conversaDeTeste(db, empresaId, ctx.usuario.id)]);
  const base = `/e/${empresaId}/whatsapp`;
  const custo = teste.mensagens.reduce((s, m) => s + (m.custoMicrosUsd ?? 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Link href={base} aria-label="Voltar às conversas" className="btn-secundario !min-h-10 !px-3">‹</Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-titulo text-2xl font-bold">Testar atendente</h1>
          <p className="text-sm text-suave">
            {agente ? `${agente.nome} · ${precoDo(agente.modelo).nome}` : "Usando o atendente padrão"} · nada vai para o WhatsApp e nenhuma venda é gravada
          </p>
        </div>
        {teste.conversa && (
          <BotaoAcao acao={limparSimuladorAcao.bind(null, empresaId)} className="btn-secundario !min-h-10 !px-3 text-sm">
            Recomeçar
          </BotaoAcao>
        )}
      </header>

      {!agente && (
        <p className="aviso">
          O atendente ainda não sabe nada da loja.{" "}
          <Link href={`${base}/agente`} className="font-medium underline">Ensine primeiro</Link> para ver respostas com preços e horários de verdade.
        </p>
      )}

      {teste.conversa?.intencao && (
        <p className="cartao !py-3 text-sm">
          <span className="font-semibold">Anotado: {NOME_INTENCAO[teste.conversa.intencao] ?? teste.conversa.intencao}</span>
          {teste.conversa.resumo ? <span className="text-suave"> · {teste.conversa.resumo}</span> : null}
          {teste.conversa.status === "humano" && <span className="block text-suave">Aqui ele chamaria a equipe da loja: {teste.conversa.motivoHumano}</span>}
        </p>
      )}

      <ConversaDeTeste
        acao={simularAcao.bind(null, empresaId)}
        mensagens={teste.mensagens}
        sugestoes={SUGESTOES[ctx.empresa.perfil] ?? SUGESTOES.padrao}
      />
      {custo > 0 && <p className="text-center text-xs text-suave">Custo de IA deste teste: US$ {(custo / 1e6).toFixed(4)}</p>}
    </div>
  );
}
