import { z } from "zod";
import { obterDb } from "@/db";
import { eventosSite } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Recebe o que acontece no site urutau.io: visitas, contatos do formulário e cliques no WhatsApp.
 * O navegador do visitante chama direto, então não há segredo possível: aceita só as origens
 * de SITE_ORIGENS (separadas por vírgula) e corta o tamanho de cada campo.
 */
const ORIGENS_PADRAO = "https://urutau.io,https://www.urutau.io";

function origemPermitida(req: Request): string | null {
  const origem = req.headers.get("origin");
  if (!origem) return null;
  const lista = (process.env.SITE_ORIGENS ?? ORIGENS_PADRAO).split(",").map((o) => o.trim()).filter(Boolean);
  return lista.includes(origem) ? origem : null;
}

const cors = (origem: string) => ({
  "Access-Control-Allow-Origin": origem,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
});

const curto = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);

const esquema = z.object({
  tipo: z.enum(["visita", "contato", "whatsapp"]),
  pagina: curto(200),
  nome: curto(120),
  contato: curto(160),
  mensagem: curto(2000),
});

export function OPTIONS(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors(origem) });
}

export async function POST(req: Request) {
  const origem = origemPermitida(req);
  if (!origem) return new Response("Origem não permitida", { status: 403 });
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return new Response("JSON inválido", { status: 400, headers: cors(origem) });
  }
  const r = esquema.safeParse(corpo);
  if (!r.success) return new Response("Dados inválidos", { status: 400, headers: cors(origem) });
  await obterDb().insert(eventosSite).values(r.data);
  return new Response(null, { status: 204, headers: cors(origem) });
}
