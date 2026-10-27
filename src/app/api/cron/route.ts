import { obterDb } from "@/db";
import { mesAtual } from "@/lib/datas";
import { cronAutorizado } from "@/lib/servidor/cron";
import { gerarCobrancas } from "@/lib/servidor/receita";
import { MANIPULADORES, agendarRotinasDiarias, processarTarefas } from "@/lib/servidor/tarefas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chamado pela Vercel Cron (vercel.json) com `Authorization: Bearer $CRON_SECRET`.
 * Enfileira as rotinas do dia (idempotente) e processa a fila.
 */
export async function GET(req: Request) {
  if (!cronAutorizado(req)) return new Response("Não autorizado", { status: 401 });
  const db = obterDb();
  const empresas = await agendarRotinasDiarias(db);
  const resultado = await processarTarefas(db, MANIPULADORES, 50);
  // Cobranças da Urutau do mês que começou (idempotente).
  const cobrancasCriadas = await gerarCobrancas(db, mesAtual());
  return Response.json({ empresas, cobrancasCriadas, ...resultado });
}
