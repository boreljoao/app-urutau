import "server-only";
import { timingSafeEqual } from "node:crypto";

/** A Vercel Cron chama com `Authorization: Bearer $CRON_SECRET`. */
export function cronAutorizado(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return false;
  const recebido = Buffer.from(req.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${segredo}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}
