"use server";

import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { obterDb } from "@/db";
import { agentesWhatsapp, type StatusConversa } from "@/db/schema";
import { MODELOS } from "@/lib/atendimento";
import type { EstadoForm } from "@/lib/estado-form";
import type { Acao } from "@/lib/permissoes";
import { exigirPermissao, exigirSuperadmin } from "./acesso";
import {
  ErroAtendimento,
  aprovarRascunho,
  descartarRascunho,
  limparSimulador,
  mudarStatusConversa,
  responderComoEquipe,
  simularMensagem,
  testarConexao,
} from "./atendimento";
import { registrarAuditoria } from "./auditoria";
import { cifrar } from "./segredos";
import { MANIPULADORES, processarTarefas } from "./tarefas";

async function exigirWhatsapp(empresaId: string, acao: Acao) {
  const ctx = await exigirPermissao(empresaId, acao);
  if (!ctx.modulos.has("whatsapp")) throw new Error("O atendente de WhatsApp não está ligado para esta empresa.");
  return ctx;
}

function mensagemDeErro(e: unknown) {
  if (e instanceof ErroAtendimento) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "A chave da IA não está configurada ou é inválida. Avise a equipe Urutau.";
  if (e instanceof Anthropic.APIError) return "A IA não respondeu agora. Tente de novo em instantes.";
  return "Não foi possível concluir. Tente de novo.";
}

const caminho = (empresaId: string) => `/e/${empresaId}/whatsapp`;

export async function responderAcao(empresaId: string, conversaId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await exigirWhatsapp(empresaId, "lancar");
  const texto = String(fd.get("texto") ?? "").trim();
  if (!texto) return { erros: { texto: "Escreva a mensagem." } };
  if (texto.length > 4000) return { erros: { texto: "Mensagem longa demais (máximo de 4.000 caracteres)." }, valores: { texto } };
  try {
    await responderComoEquipe(obterDb(), empresaId, conversaId, texto, ctx.usuario.id);
  } catch (e) {
    return { erros: { _: mensagemDeErro(e) }, valores: { texto } };
  }
  revalidatePath(caminho(empresaId), "layout");
  return { ok: "Enviada." };
}

export async function aprovarAcao(empresaId: string, mensagemId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await exigirWhatsapp(empresaId, "lancar");
  const texto = String(fd.get("texto") ?? "").trim();
  try {
    await aprovarRascunho(obterDb(), empresaId, mensagemId, texto, ctx.usuario.id);
  } catch (e) {
    return { erros: { _: mensagemDeErro(e) }, valores: { texto } };
  }
  revalidatePath(caminho(empresaId), "layout");
  return { ok: "Enviada." };
}

export async function descartarAcao(empresaId: string, mensagemId: string) {
  await exigirWhatsapp(empresaId, "lancar");
  await descartarRascunho(obterDb(), empresaId, mensagemId);
  revalidatePath(caminho(empresaId), "layout");
}

export async function mudarStatusAcao(empresaId: string, conversaId: string, status: StatusConversa) {
  await exigirWhatsapp(empresaId, "lancar");
  const db = obterDb();
  try {
    const responder = await mudarStatusConversa(db, empresaId, conversaId, status);
    if (responder) after(() => processarTarefas(db, MANIPULADORES, 5).then(() => undefined));
  } catch (e) {
    return { erro: mensagemDeErro(e) };
  }
  revalidatePath(caminho(empresaId), "layout");
}

// ─── Simulador ───────────────────────────────────────────────────────────────

export async function simularAcao(empresaId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await exigirWhatsapp(empresaId, "lancar");
  const texto = String(fd.get("texto") ?? "").trim();
  if (!texto) return { erros: { texto: "Escreva como se fosse o cliente." } };
  try {
    await simularMensagem(obterDb(), empresaId, ctx.usuario.id, texto.slice(0, 2000));
  } catch (e) {
    revalidatePath(`${caminho(empresaId)}/testar`);
    revalidatePath(`${caminho(empresaId)}/apresentar`);
    return { erros: { _: mensagemDeErro(e) } };
  }
  revalidatePath(`${caminho(empresaId)}/testar`);
  revalidatePath(`${caminho(empresaId)}/apresentar`);
  return { ok: "Respondida." };
}

export async function limparSimuladorAcao(empresaId: string) {
  const ctx = await exigirWhatsapp(empresaId, "lancar");
  await limparSimulador(obterDb(), empresaId, ctx.usuario.id);
  revalidatePath(`${caminho(empresaId)}/testar`);
  revalidatePath(`${caminho(empresaId)}/apresentar`);
}

// ─── Configuração do agente ──────────────────────────────────────────────────

const esquemaAgente = z.object({
  nome: z.string().trim().min(1, "Dê um nome ao atendente.").max(60),
  tom: z.string().trim().max(300),
  conhecimento: z.string().trim().max(20_000, "Texto longo demais (máximo de 20 mil caracteres)."),
  quandoChamarHumano: z.string().trim().max(2_000),
  modo: z.enum(["automatico", "aprovacao", "desligado"]),
  modelo: z.enum(MODELOS.map((m) => m.id) as [string, ...string[]]),
});

export async function salvarAgenteAcao(empresaId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await exigirWhatsapp(empresaId, "gerenciar");
  const valores = Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, String(v)]));
  const r = esquemaAgente.safeParse(valores);
  if (!r.success) return { erros: Object.fromEntries(r.error.issues.map((i) => [String(i.path[0] ?? "_"), i.message])), valores };
  const db = obterDb();
  await db
    .insert(agentesWhatsapp)
    .values({ empresaId, ...r.data })
    .onConflictDoUpdate({ target: agentesWhatsapp.empresaId, set: { ...r.data, atualizadoEm: new Date() } });
  await registrarAuditoria(db, {
    empresaId,
    usuarioId: ctx.usuario.id,
    ator: ctx.comoAdmin ? "admin" : "usuario",
    acao: "whatsapp.configurar",
    entidade: "agente_whatsapp",
    entidadeId: empresaId,
    dados: { modo: r.data.modo, modelo: r.data.modelo },
  });
  revalidatePath(caminho(empresaId), "layout");
  revalidatePath("/admin/atendimento");
  return { ok: "Atendente salvo." };
}

export async function conectarNumeroAcao(empresaId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const ctx = await exigirWhatsapp(empresaId, "gerenciar");
  const phoneNumberId = String(fd.get("phoneNumberId") ?? "").replace(/\D/g, "");
  const token = String(fd.get("token") ?? "").trim();
  const valores = { phoneNumberId };
  if (phoneNumberId.length < 6) return { erros: { phoneNumberId: "Copie o “Phone number ID” do painel da Meta (só números)." }, valores };
  const db = obterDb();
  const [atual] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.empresaId, empresaId));
  if (!atual) return { erros: { _: "Salve o atendente antes de conectar o número." }, valores };
  if (!token && !atual.tokenCifrado) return { erros: { token: "Cole o token de acesso da Meta." }, valores };
  let numero: string | null = atual.numeroExibicao;
  if (token) {
    try {
      numero = (await testarConexao(phoneNumberId, token)).numero ?? numero;
    } catch (e) {
      return { erros: { token: `A Meta recusou: ${e instanceof Error ? e.message.replace(/^WhatsApp: /, "") : "erro"}` }, valores };
    }
  }
  try {
    await db
      .update(agentesWhatsapp)
      .set({
        phoneNumberId,
        numeroExibicao: numero,
        ...(token ? { tokenCifrado: cifrar(token) } : {}),
        ultimoErro: null,
        ultimoErroEm: null,
        atualizadoEm: new Date(),
      })
      .where(eq(agentesWhatsapp.empresaId, empresaId));
  } catch (e) {
    const causa = (e instanceof Error && e.cause ? e.cause : e) as { code?: string };
    if (causa?.code === "23505") return { erros: { phoneNumberId: "Este número já está ligado a outra loja." }, valores };
    throw e;
  }
  await registrarAuditoria(db, { empresaId, usuarioId: ctx.usuario.id, ator: ctx.comoAdmin ? "admin" : "usuario", acao: "whatsapp.conectar", entidade: "agente_whatsapp", entidadeId: empresaId });
  revalidatePath(caminho(empresaId), "layout");
  revalidatePath("/admin/atendimento");
  return { ok: numero ? `Conectado ao ${numero}.` : "Número conectado." };
}

export async function desconectarNumeroAcao(empresaId: string) {
  const ctx = await exigirWhatsapp(empresaId, "gerenciar");
  const db = obterDb();
  await db.update(agentesWhatsapp).set({ phoneNumberId: null, tokenCifrado: null, numeroExibicao: null }).where(eq(agentesWhatsapp.empresaId, empresaId));
  await registrarAuditoria(db, { empresaId, usuarioId: ctx.usuario.id, ator: ctx.comoAdmin ? "admin" : "usuario", acao: "whatsapp.desconectar", entidade: "agente_whatsapp", entidadeId: empresaId });
  revalidatePath(caminho(empresaId), "layout");
  revalidatePath("/admin/atendimento");
}

// ─── Central ─────────────────────────────────────────────────────────────────

/** A equipe Urutau cria o atendente de uma loja com tudo no padrão (modo aprovação, Opus 5.5). */
export async function criarAgenteCentralAcao(empresaId: string) {
  const eu = await exigirSuperadmin();
  const db = obterDb();
  await db.insert(agentesWhatsapp).values({ empresaId }).onConflictDoNothing();
  await registrarAuditoria(db, { empresaId, usuarioId: eu.id, ator: "admin", acao: "whatsapp.criar_agente", entidade: "agente_whatsapp", entidadeId: empresaId });
  revalidatePath("/admin/atendimento");
}

export async function mudarModoCentralAcao(empresaId: string, modo: "automatico" | "aprovacao" | "desligado") {
  const eu = await exigirSuperadmin();
  const db = obterDb();
  await db.update(agentesWhatsapp).set({ modo, atualizadoEm: new Date() }).where(eq(agentesWhatsapp.empresaId, empresaId));
  await registrarAuditoria(db, { empresaId, usuarioId: eu.id, ator: "admin", acao: "whatsapp.modo", entidade: "agente_whatsapp", entidadeId: empresaId, dados: { modo } });
  revalidatePath("/admin/atendimento");
  revalidatePath(caminho(empresaId), "layout");
}
