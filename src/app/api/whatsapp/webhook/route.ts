import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { obterDb } from "@/db";
import { lerWebhook } from "@/lib/atendimento";
import { atualizarStatus, receberMensagem } from "@/lib/servidor/atendimento";
import { MANIPULADORES, processarTarefas } from "@/lib/servidor/tarefas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook da WhatsApp Cloud API (um só para todas as lojas: o phone_number_id diz de quem é).
 * GET: a Meta confirma a URL com WHATSAPP_VERIFY_TOKEN.
 * POST: confere a assinatura com WHATSAPP_APP_SECRET, grava e responde 200 logo;
 * o agente responde depois, fora do tempo da requisição.
 */

export function GET(req: Request) {
  const url = new URL(req.url);
  const esperado = process.env.WHATSAPP_VERIFY_TOKEN;
  if (esperado && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === esperado)
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Proibido", { status: 403 });
}

function assinaturaValida(corpo: string, cabecalho: string | null) {
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo || !cabecalho?.startsWith("sha256=")) return false;
  const recebida = Buffer.from(cabecalho.slice(7), "hex");
  const calculada = createHmac("sha256", segredo).update(corpo, "utf8").digest();
  return recebida.length === calculada.length && timingSafeEqual(recebida, calculada);
}

export async function POST(req: Request) {
  const corpo = await req.text();
  if (!assinaturaValida(corpo, req.headers.get("x-hub-signature-256"))) return new Response("Assinatura inválida", { status: 401 });
  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }
  const db = obterDb();
  const { mensagens, status } = lerWebhook(json);
  let responder = false;
  for (const m of mensagens) responder = !!(await receberMensagem(db, m))?.responder || responder;
  for (const s of status) await atualizarStatus(db, s);
  if (responder) after(() => processarTarefas(db, MANIPULADORES, 10).then(() => undefined));
  return new Response("ok", { status: 200 });
}
