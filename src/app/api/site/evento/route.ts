import { z } from "zod";
import { obterDb } from "@/db";
import { eventosSite } from "@/db/schema";
import { leadDoSite } from "@/lib/servidor/comercial";
import { normalizarTelefone } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/**
 * Recebe o que acontece no site urutau.io: visitas, contatos, cliques no WhatsApp e o
 * diagnóstico. Contato e diagnóstico viram lead no Comercial da Central.
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
  tipo: z.enum(["visita", "contato", "whatsapp", "diagnostico"]),
  pagina: curto(200),
  nome: curto(120),
  negocio: curto(120),
  /** Telefone ou e-mail, como o visitante digitou. */
  contato: curto(160),
  mensagem: curto(2000),
  dores: z.array(z.string().trim().max(200)).max(20).optional().default([]),
  tamanho: curto(40),
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
  const d = r.data;
  const db = obterDb();
  await db.insert(eventosSite).values({ tipo: d.tipo, pagina: d.pagina, nome: d.nome ?? d.negocio, contato: d.contato, mensagem: d.mensagem });
  if (d.tipo === "contato" || d.tipo === "diagnostico") {
    const email = d.contato?.includes("@") ? d.contato.toLowerCase() : null;
    const telefone = !email && d.contato ? normalizarTelefone(d.contato) : null;
    await leadDoSite(db, { tipo: d.tipo, nome: d.nome, negocio: d.negocio, telefone, email, mensagem: d.mensagem, dores: d.dores, tamanho: d.tamanho, pagina: d.pagina });
  }
  return new Response(null, { status: 204, headers: cors(origem) });
}
