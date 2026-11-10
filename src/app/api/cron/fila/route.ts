import { obterDb } from "@/db";
import { cronAutorizado } from "@/lib/servidor/cron";
import { enviarLembretesAgenda } from "@/lib/servidor/lembretes-agenda";
import { MANIPULADORES, processarTarefas } from "@/lib/servidor/tarefas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A cada 5 minutos: a fila (respostas do WhatsApp que falharam e voltam a tentar) e os lembretes da agenda. */
export async function GET(req: Request) {
  if (!cronAutorizado(req)) return new Response("Não autorizado", { status: 401 });
  const db = obterDb();
  const fila = await processarTarefas(db, MANIPULADORES, 30);
  const lembretes = await enviarLembretesAgenda(db).catch((e) => {
    console.error("lembretes da agenda", e);
    return { erro: true };
  });
  return Response.json({ fila, lembretes });
}
