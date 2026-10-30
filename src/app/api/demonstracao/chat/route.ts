import { z } from "zod";
import { obterDb } from "@/db";
import { LIMITES_CHAT, chaveDeChatValida } from "@/lib/chat-site";
import { RAMOS, type Ramo } from "@/lib/servidor/demonstracao";
import { conversarNaDemonstracao, novidadesDaDemonstracao } from "@/lib/servidor/demonstracao-chat";

export const dynamic = "force-dynamic";
// O atendente pode usar ferramentas antes de responder: dá tempo para algumas voltas com o Claude.
export const maxDuration = 60;

/**
 * O chat dos sites de demonstração. POST manda a mensagem do visitante e devolve a resposta;
 * GET busca o que a equipe respondeu pelo painel depois de `depois`.
 * Aceita só as origens de DEMO_ORIGENS (separadas por vírgula).
 */
const METODOS = "GET, POST, OPTIONS";
const ORIGENS_PADRAO = "https://urutau-vitrine.vercel.app,http://localhost:5190";

function origemPermitida(req: Request) {
  const origem = req.headers.get("origin");
  if (!origem) return null;
  const lista = (process.env.DEMO_ORIGENS ?? ORIGENS_PADRAO).split(",").map((o) => o.trim()).filter(Boolean);
  return lista.includes(origem) ? origem : null;
}
const cors = (origem: string) => ({
  "Access-Control-Allow-Origin": origem,
  "Access-Control-Allow-Methods": METODOS,
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Vary: "Origin",
});

const ramo = z.enum(RAMOS as [Ramo, ...Ramo[]]);
const esquema = z.object({
  ramo,
  chave: z.string().refine(chaveDeChatValida),
  texto: z.string().trim().min(1).max(LIMITES_CHAT.texto),
});

export function OPTIONS(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors(origem) });
}

export async function GET(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response("Origem não permitida", { status: 403 });
  const url = new URL(req.url);
  const r = ramo.safeParse(url.searchParams.get("ramo"));
  const chave = url.searchParams.get("chave");
  const depois = Date.parse(url.searchParams.get("depois") ?? "");
  if (!r.success || !chaveDeChatValida(chave) || Number.isNaN(depois)) return Response.json({ erro: "Dados inválidos" }, { status: 400, headers: cors(origem) });
  return Response.json(await novidadesDaDemonstracao(obterDb(), r.data, chave, new Date(depois)), { headers: cors(origem) });
}

export async function POST(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response("Origem não permitida", { status: 403 });
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return Response.json({ erro: "JSON inválido" }, { status: 400, headers: cors(origem) });
  }
  const r = esquema.safeParse(corpo);
  if (!r.success) return Response.json({ erro: "Mensagem inválida" }, { status: 400, headers: cors(origem) });
  const resposta = await conversarNaDemonstracao(obterDb(), r.data.ramo, r.data.chave, r.data.texto);
  return Response.json(resposta, { status: resposta.erro ? 429 : 200, headers: cors(origem) });
}
