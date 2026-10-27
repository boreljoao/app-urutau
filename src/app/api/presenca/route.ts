import { eq } from "drizzle-orm";
import { obterDb } from "@/db";
import { usuarios } from "@/db/schema";
import { obterUsuarioAtual } from "@/lib/servidor/auth";

export const dynamic = "force-dynamic";

/**
 * Sinal de vida de uma aba aberta (componente Presenca, a cada minuto com a aba visível).
 * Alimenta o "online agora" e o "onde está" da Central Urutau.
 */
export async function POST(req: Request) {
  const eu = await obterUsuarioAtual();
  if (!eu) return new Response(null, { status: 401 });
  let caminho: string | null = null;
  try {
    const corpo = (await req.json()) as { caminho?: unknown };
    if (typeof corpo.caminho === "string" && corpo.caminho.startsWith("/")) caminho = corpo.caminho.slice(0, 200);
  } catch {
    // corpo vazio ou inválido: registra só o horário
  }
  await obterDb().update(usuarios).set({ vistoEm: new Date(), ondeEsta: caminho }).where(eq(usuarios.id, eu.id));
  return new Response(null, { status: 204 });
}
