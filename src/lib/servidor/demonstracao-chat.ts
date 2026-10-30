/**
 * O chat dos sites de demonstração (vitrine da Urutau). Cada visitante vira uma conversa de
 * WhatsApp de verdade na empresa de demonstração do ramo: o atendente responde na hora e quem
 * apresenta mostra a mensagem chegando no painel. Se a equipe assume a conversa pelo painel,
 * a resposta aparece no site (o GET busca o que chegou depois).
 *
 * Só fala com empresas cujo número é de demonstração: nenhum cliente de verdade é alcançável daqui.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, gte, inArray, ne } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { agentesWhatsapp, conversas, mensagensWhatsapp } from "@/db/schema";
import { PREFIXO_NUMERO_DEMONSTRACAO } from "@/lib/atendimento";
import { receberMensagem, responderConversa } from "./atendimento";
import type { Ramo } from "./demonstracao";

export const LIMITES_DEMONSTRACAO = {
  /** Mensagens de um visitante na conversa inteira. */
  porConversa: 30,
  /** Mensagens de um visitante em 10 minutos. */
  porDezMinutos: 12,
  /** Mensagens de todos os visitantes de uma demonstração em uma hora: teto de custo. */
  porHora: 300,
};

/** O "telefone" do visitante: sai da chave do navegador, então a mesma pessoa cai na mesma conversa. */
function telefoneDoVisitante(chave: string) {
  const n = BigInt(`0x${createHash("sha256").update(chave).digest("hex").slice(0, 12)}`) % 100_000_000n;
  return `55219${n.toString().padStart(8, "0")}`;
}

async function acharDemonstracao(db: BancoDeDados, ramo: Ramo) {
  const phoneNumberId = `${PREFIXO_NUMERO_DEMONSTRACAO}${ramo}`;
  const [agente] = await db.select({ empresaId: agentesWhatsapp.empresaId }).from(agentesWhatsapp).where(eq(agentesWhatsapp.phoneNumberId, phoneNumberId));
  return agente ? { empresaId: agente.empresaId, phoneNumberId } : null;
}

type Resposta = { mensagens: { autor: "agente" | "sistema"; texto: string; em: string }[]; erro?: string };

/** O que a loja mandou depois de `desde`: respostas do atendente e da equipe, nunca rascunhos. */
async function respostasDepois(db: BancoDeDados, conversaId: string, desde: Date): Promise<Resposta["mensagens"]> {
  const linhas = await db
    .select({ autor: mensagensWhatsapp.autor, texto: mensagensWhatsapp.texto, em: mensagensWhatsapp.criadoEm })
    .from(mensagensWhatsapp)
    .where(
      and(
        eq(mensagensWhatsapp.conversaId, conversaId),
        gt(mensagensWhatsapp.criadoEm, desde),
        inArray(mensagensWhatsapp.autor, ["agente", "humano"]),
        ne(mensagensWhatsapp.status, "rascunho"),
        ne(mensagensWhatsapp.status, "descartada"),
      ),
    )
    .orderBy(asc(mensagensWhatsapp.criadoEm));
  return linhas.map((m) => ({ autor: "agente" as const, texto: m.texto, em: m.em.toISOString() }));
}

export async function conversarNaDemonstracao(db: BancoDeDados, ramo: Ramo, chave: string, texto: string): Promise<Resposta> {
  const demo = await acharDemonstracao(db, ramo);
  if (!demo) return { mensagens: [], erro: "Esta demonstração ainda não foi criada no app." };
  const waId = telefoneDoVisitante(chave);
  const agora = new Date();

  const [conversa] = await db
    .select({ id: conversas.id })
    .from(conversas)
    .where(and(eq(conversas.empresaId, demo.empresaId), eq(conversas.canal, "whatsapp"), eq(conversas.telefone, waId)));
  const doCliente = (desde: Date, conversaId?: string) =>
    db
      .select({ n: count() })
      .from(mensagensWhatsapp)
      .where(
        and(
          eq(mensagensWhatsapp.empresaId, demo.empresaId),
          eq(mensagensWhatsapp.autor, "cliente"),
          gte(mensagensWhatsapp.criadoEm, desde),
          conversaId ? eq(mensagensWhatsapp.conversaId, conversaId) : undefined,
        ),
      )
      .then((r) => r[0].n);
  if (conversa) {
    if ((await doCliente(new Date(0), conversa.id)) >= LIMITES_DEMONSTRACAO.porConversa)
      return { mensagens: [], erro: "Esta conversa de demonstração chegou ao limite. Recarregue a página para começar outra." };
    if ((await doCliente(new Date(agora.getTime() - 10 * 60_000), conversa.id)) >= LIMITES_DEMONSTRACAO.porDezMinutos)
      return { mensagens: [], erro: "Muitas mensagens seguidas. Espere um pouco e tente de novo." };
  }
  if ((await doCliente(new Date(agora.getTime() - 60 * 60_000))) >= LIMITES_DEMONSTRACAO.porHora)
    return { mensagens: [], erro: "A demonstração está muito movimentada agora. Tente de novo mais tarde." };

  const r = await receberMensagem(db, {
    phoneNumberId: demo.phoneNumberId,
    waId,
    nome: "Visitante do site",
    waMessageId: `wamid.site.${randomUUID()}`,
    em: agora,
    texto,
    tipo: "text",
  });
  if (!r) return { mensagens: [], erro: "Não deu para registrar a mensagem." };
  // Responde já, sem esperar a fila: a tarefa que receberMensagem enfileirou vai achar a conversa respondida e pular.
  if (r.responder) await responderConversa(db, r.conversa.id);

  const mensagens = await respostasDepois(db, r.conversa.id, agora);
  if (!mensagens.length && r.responder) return { mensagens, erro: "O atendente não conseguiu responder agora. Tente de novo em instantes." };
  if (!mensagens.length)
    mensagens.push({ autor: "sistema", texto: "Uma pessoa da equipe já está com a sua conversa e responde por aqui.", em: new Date().toISOString() });
  return { mensagens };
}

/** O que chegou depois de `desde` (a equipe respondendo pelo painel). */
export async function novidadesDaDemonstracao(db: BancoDeDados, ramo: Ramo, chave: string, desde: Date): Promise<Resposta> {
  const demo = await acharDemonstracao(db, ramo);
  if (!demo) return { mensagens: [] };
  const [conversa] = await db
    .select({ id: conversas.id })
    .from(conversas)
    .where(and(eq(conversas.empresaId, demo.empresaId), eq(conversas.canal, "whatsapp"), eq(conversas.telefone, telefoneDoVisitante(chave))));
  return { mensagens: conversa ? await respostasDepois(db, conversa.id, desde) : [] };
}
