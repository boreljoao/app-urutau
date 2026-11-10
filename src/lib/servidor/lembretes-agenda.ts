import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { agendamentos, agentesWhatsapp, clientes, empresas } from "@/db/schema";
import { PREFIXO_NUMERO_DEMONSTRACAO } from "@/lib/atendimento";
import { hoje, somarDias } from "@/lib/datas";
import { registrarAuditoria } from "./auditoria";
import { decifrar } from "./segredos";

/**
 * Lembretes da agenda pelo WhatsApp oficial (Cloud API), rodando na fila a cada 5 minutos.
 *
 * Fora da janela de 24h a Meta só aceita modelos aprovados, então cada lembrete é um modelo com um
 * botão de link para a página do paciente (painel-urutau/confirmar/<código>), onde ele confirma,
 * remarca ou cancela. Os modelos são criados uma vez no WhatsApp Manager de cada número:
 *
 *   agenda_marcada        "Oi, {{1}}! Seu horário de {{2}} ficou marcado para {{3}} ({{4}}). Toque no botão para confirmar, remarcar ou cancelar."
 *   agenda_lembrete_48h   "Oi, {{1}}! {{4}} aqui. Seu horário de {{2}} está marcado para {{3}}. Confirma pra gente?"
 *   agenda_lembrete_2h    "Oi, {{1}}! Lembrete de {{4}}: seu horário de {{2}} é {{3}}. Te esperamos!"
 *   Botão de link em todos: https://painel-urutau.vercel.app/confirmar/{{1}}   Idioma: pt_BR
 *
 * Sem os modelos (ou sem número oficial) nada sai daqui e o painel mostra os lembretes na lista
 * "Mandar hoje", para enviar com um toque. Números de demonstração não chamam a Meta.
 */

type Tipo = "marcado" | "h48" | "h2";
const MODELO: Record<Tipo, string> = { marcado: "agenda_marcada", h48: "agenda_lembrete_48h", h2: "agenda_lembrete_2h" };
const HORA = 3_600_000;
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0"}`;
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

type Lembretes = Partial<Record<Tipo | "erro", string>>;

/** O mesmo critério do painel (src/pacotes/lembretes.ts): um lembrete por vez, o mais próximo. */
export function lembreteDevido(a: { data: string; hora: string; status: string; lembretes: Lembretes }, agora = new Date()): Tipo | null {
  if (a.status !== "marcado" && a.status !== "confirmado") return null;
  const falta = new Date(`${a.data}T${a.hora}:00-03:00`).getTime() - agora.getTime();
  if (falta <= 0) return null;
  const e = a.lembretes;
  if (falta <= 2 * HORA) return e.h2 ? null : "h2";
  if (a.status === "confirmado") return null;
  if (falta <= 48 * HORA) {
    if (e.h48) return null;
    if (e.marcado && falta < 24 * HORA) return null;
    return "h48";
  }
  return e.marcado ? null : "marcado";
}

function quando(data: string, hora: string, hj: string) {
  const [, m, d] = data.split("-");
  const dia = data === hj ? "hoje" : data === somarDias(hj, 1) ? "amanhã" : `${DIAS[new Date(`${data}T12:00:00Z`).getUTCDay()]}, ${d}/${m},`;
  return `${dia} às ${hora.replace(":00", "h")}`;
}

async function enviarModelo(phoneNumberId: string, token: string, para: string, tipo: Tipo, params: string[], codigo: string) {
  const r = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "template",
      template: {
        name: MODELO[tipo],
        language: { code: "pt_BR" },
        components: [
          { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: codigo }] },
        ],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!r.ok) throw new Error(json.error?.message ?? `HTTP ${r.status}`);
}

export async function enviarLembretesAgenda(db: BancoDeDados, agora = new Date()) {
  const hj = hoje(agora);
  const linhas = await db
    .select({
      id: agendamentos.id,
      empresaId: agendamentos.empresaId,
      data: agendamentos.data,
      hora: agendamentos.hora,
      status: agendamentos.status,
      nome: agendamentos.nome,
      servico: agendamentos.servico,
      token: agendamentos.tokenPaciente,
      serieId: agendamentos.serieId,
      lembretes: agendamentos.lembretes,
      telefone: clientes.telefone,
      empresa: empresas.nome,
      phoneNumberId: agentesWhatsapp.phoneNumberId,
      tokenCifrado: agentesWhatsapp.tokenCifrado,
    })
    .from(agendamentos)
    .innerJoin(clientes, and(eq(clientes.id, agendamentos.clienteId), eq(clientes.empresaId, agendamentos.empresaId)))
    .innerJoin(empresas, eq(empresas.id, agendamentos.empresaId))
    .innerJoin(agentesWhatsapp, eq(agentesWhatsapp.empresaId, agendamentos.empresaId))
    .where(
      and(
        isNull(agendamentos.excluidoEm),
        inArray(agendamentos.status, ["marcado", "confirmado"]),
        gte(agendamentos.data, hj),
        lte(agendamentos.data, somarDias(hj, 40)),
        isNotNull(clientes.telefone),
        isNotNull(agentesWhatsapp.phoneNumberId),
      ),
    )
    .limit(400);

  // Série semanal: só a primeira sessão futura manda o aviso "ao marcar".
  const primeiroDaSerie = new Map<string, string>();
  for (const a of [...linhas].sort((x, y) => `${x.data} ${x.hora}`.localeCompare(`${y.data} ${y.hora}`)))
    if (a.serieId && !primeiroDaSerie.has(a.serieId)) primeiroDaSerie.set(a.serieId, a.id);
  const resultado = { enviados: 0, simulados: 0, falhas: 0 };
  for (const a of linhas) {
    const lembretes = a.lembretes as Lembretes;
    let tipo = lembreteDevido({ ...a, lembretes }, agora);
    if (tipo === "marcado" && a.serieId && primeiroDaSerie.get(a.serieId) !== a.id) tipo = null;
    if (!tipo || !a.phoneNumberId) continue;
    // Depois de uma recusa da Meta (modelo não aprovado, número sem crédito), espera 6h para tentar de novo.
    if (lembretes.erro && agora.getTime() - new Date(lembretes.erro).getTime() < 6 * HORA) continue;
    const demonstracao = a.phoneNumberId.startsWith(PREFIXO_NUMERO_DEMONSTRACAO);
    try {
      if (!demonstracao) {
        if (!a.tokenCifrado) continue;
        const primeiro = a.nome.trim().split(/\s+/)[0];
        await enviarModelo(a.phoneNumberId, decifrar(a.tokenCifrado), a.telefone!, tipo, [primeiro, (a.servico || "atendimento").toLowerCase(), quando(a.data, a.hora, hj), a.empresa], a.token);
      }
      await db
        .update(agendamentos)
        .set({ lembretes: sql`(${agendamentos.lembretes} - 'erro') || ${JSON.stringify({ [tipo]: agora.toISOString() })}::jsonb` })
        .where(eq(agendamentos.id, a.id));
      await registrarAuditoria(db, { empresaId: a.empresaId, ator: "sistema", acao: "agenda.lembrete", entidade: "agendamento", entidadeId: a.id, dados: { tipo, demonstracao } });
      if (demonstracao) resultado.simulados++;
      else resultado.enviados++;
    } catch (e) {
      resultado.falhas++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("lembrete da agenda", a.id, tipo, msg);
      await db
        .update(agendamentos)
        .set({ lembretes: sql`${agendamentos.lembretes} || ${JSON.stringify({ erro: agora.toISOString() })}::jsonb` })
        .where(eq(agendamentos.id, a.id));
      await db.update(agentesWhatsapp).set({ ultimoErro: `Lembrete da agenda: ${msg}`, ultimoErroEm: agora }).where(eq(agentesWhatsapp.empresaId, a.empresaId));
    }
  }
  return resultado;
}
