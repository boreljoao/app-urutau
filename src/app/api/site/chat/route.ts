import { z } from "zod";
import { obterDb } from "@/db";
import { LIMITES_CHAT, chaveDeChatValida } from "@/lib/chat-site";
import { codigoDeVisitanteValido } from "@/lib/comercial";
import { conversarNoSite, lerConversaDoSite } from "@/lib/servidor/chat-site";
import { cors, origemPermitida } from "@/lib/servidor/site-origem";

export const dynamic = "force-dynamic";
// O agente pode usar ferramentas antes de responder: dá tempo para algumas voltas com o Claude.
export const maxDuration = 60;

/**
 * O chat do site urutau.io. POST manda a mensagem do visitante e devolve a resposta do agente;
 * GET busca o que chegou depois (resposta da equipe) ou a conversa inteira ao recarregar.
 * A `chave` é um segredo aleatório gerado no navegador: sem ela não se lê nenhuma conversa.
 */
const METODOS = "GET, POST, OPTIONS";

const esquema = z.object({
  chave: z.string().refine(chaveDeChatValida),
  texto: z.string().trim().min(1).max(LIMITES_CHAT.texto * 2),
  visitante: z.string().max(64).nullish(),
  pagina: z.string().nullish().transform((p) => p?.slice(0, 200)),
});

export function OPTIONS(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors(origem, METODOS) });
}

export async function GET(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response("Origem não permitida", { status: 403 });
  const url = new URL(req.url);
  const chave = url.searchParams.get("chave");
  if (!chaveDeChatValida(chave)) return new Response("Chave inválida", { status: 400, headers: cors(origem, METODOS) });
  const depois = url.searchParams.get("depois");
  const desde = depois && !Number.isNaN(Date.parse(depois)) ? new Date(depois) : null;
  const conversa = await lerConversaDoSite(obterDb(), chave, desde);
  return Response.json(conversa ?? { status: "agente", mensagens: [] }, { headers: { ...cors(origem, METODOS), "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response("Origem não permitida", { status: 403 });
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400, headers: cors(origem, METODOS) });
  }
  const r = esquema.safeParse(corpo);
  if (!r.success) return new Response("Dados inválidos", { status: 400, headers: cors(origem, METODOS) });
  const d = r.data;
  const resposta = await conversarNoSite(obterDb(), {
    chave: d.chave,
    texto: d.texto,
    visitanteId: codigoDeVisitanteValido(d.visitante) ? d.visitante : null,
    pagina: d.pagina ?? null,
  });
  return Response.json(resposta, { headers: { ...cors(origem, METODOS), "Cache-Control": "no-store" } });
}
