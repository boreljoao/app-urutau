"use server";

import { obterDb } from "@/db";
import { exigirSuperadmin } from "./acesso";
import { historicoDoAssistente, perguntarAoAssistente, type FalaDoAssistente } from "./assistente";
import { ErroAtendimento } from "./atendimento";

/** O assistente da equipe: a conversa vem da tela (não fica no banco) e só a equipe Urutau pode usar. */
export async function perguntarAoAssistenteAcao(
  historico: FalaDoAssistente[],
): Promise<{ texto: string; custoMicros: number; consultas: string[] } | { erro: string }> {
  const eu = await exigirSuperadmin();
  const p = historicoDoAssistente.safeParse(historico);
  if (!p.success) return { erro: "Conversa inválida ou longa demais. Comece uma nova." };
  try {
    return await perguntarAoAssistente(obterDb(), p.data.slice(-20), eu);
  } catch (e) {
    console.error("[assistente]", e);
    return { erro: e instanceof ErroAtendimento ? e.message : "O assistente não respondeu. Tente de novo." };
  }
}
