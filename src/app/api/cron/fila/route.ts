import { obterDb } from "@/db";
import { cronAutorizado } from "@/lib/servidor/cron";
import { MANIPULADORES, processarTarefas } from "@/lib/servidor/tarefas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A cada 5 minutos: só a fila (respostas do WhatsApp que falharam e voltam a tentar). */
export async function GET(req: Request) {
  if (!cronAutorizado(req)) return new Response("Não autorizado", { status: 401 });
  return Response.json(await processarTarefas(obterDb(), MANIPULADORES, 30));
}
