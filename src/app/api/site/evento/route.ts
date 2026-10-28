import { z } from "zod";
import { obterDb } from "@/db";
import { eventosSite } from "@/db/schema";
import { codigoDeVisitanteValido, origemDaVisita } from "@/lib/comercial";
import { leadDoSite } from "@/lib/servidor/comercial";
import { cors, origemPermitida } from "@/lib/servidor/site-origem";
import { registrarVisitante } from "@/lib/servidor/visitantes";
import { normalizarTelefone } from "@/lib/validacao";

export const dynamic = "force-dynamic";

/**
 * Recebe o que acontece no site urutau.io: visitas, seções vistas, contatos, cliques no WhatsApp
 * e o diagnóstico. Contato e diagnóstico viram lead no Comercial da Central.
 * Aceita só as origens de SITE_ORIGENS e corta o tamanho de cada campo.
 * Cidade e região vêm dos cabeçalhos de geolocalização da Vercel (aproximados, pelo IP);
 * o IP em si não é guardado.
 */

const curto = (n: number) => z.string().trim().max(n).nullish().transform((v) => v || null);

const esquema = z.object({
  tipo: z.enum(["visita", "contato", "whatsapp", "diagnostico", "secao"]),
  pagina: curto(200),
  nome: curto(120),
  negocio: curto(120),
  /** Telefone ou e-mail, como o visitante digitou. */
  contato: curto(160),
  mensagem: curto(2000),
  dores: z.array(z.string().trim().max(200)).max(20).optional().default([]),
  tamanho: curto(40),
  visitante: curto(64),
  referrer: curto(500),
  utmSource: curto(80),
  utmMedium: curto(80),
  utmCampaign: curto(120),
  aparelho: z.enum(["celular", "computador"]).optional(),
});

function cabecalho(req: Request, nome: string) {
  const v = req.headers.get(nome);
  if (!v) return null;
  try {
    return decodeURIComponent(v).slice(0, 80);
  } catch {
    return v.slice(0, 80);
  }
}

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
  const visitanteId = codigoDeVisitanteValido(d.visitante) ? d.visitante : null;
  if (visitanteId) {
    await registrarVisitante(
      db,
      {
        id: visitanteId,
        cidade: cabecalho(req, "x-vercel-ip-city"),
        regiao: cabecalho(req, "x-vercel-ip-country-region"),
        pais: cabecalho(req, "x-vercel-ip-country"),
        aparelho: d.aparelho ?? null,
        origem: origemDaVisita(d.utmSource, d.referrer, new URL(origem).hostname.replace(/^www\./, "")),
        meio: d.utmMedium,
        campanha: d.utmCampaign,
      },
      d.tipo === "visita",
    );
  }
  await db.insert(eventosSite).values({ tipo: d.tipo, pagina: d.pagina, nome: d.nome ?? d.negocio, contato: d.contato, mensagem: d.mensagem, visitanteId });
  if (d.tipo === "contato" || d.tipo === "diagnostico") {
    const email = d.contato?.includes("@") ? d.contato.toLowerCase() : null;
    const telefone = !email && d.contato ? normalizarTelefone(d.contato) : null;
    await leadDoSite(db, { tipo: d.tipo, nome: d.nome, negocio: d.negocio, telefone, email, mensagem: d.mensagem, dores: d.dores, tamanho: d.tamanho, pagina: d.pagina, visitanteId });
  }
  return new Response(null, { status: 204, headers: cors(origem) });
}
