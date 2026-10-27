"use server";

import { revalidatePath } from "next/cache";
import { obterDb } from "@/db";
import type { StatusConversa } from "@/db/schema";
import type { EstadoForm } from "@/lib/estado-form";
import { exigirSuperadmin } from "./acesso";
import { ErroAtendimento } from "./atendimento";
import { mudarStatusDoSite, responderNoSiteComoEquipe } from "./chat-site";

/** A equipe Urutau responde e organiza as conversas do chat do site pela Central. */

const CAMINHO = "/admin/comercial/chat";

export async function responderNoSiteAcao(conversaId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSuperadmin();
  const texto = String(fd.get("texto") ?? "").trim();
  if (!texto) return { erros: { texto: "Escreva a mensagem." } };
  if (texto.length > 4000) return { erros: { texto: "Mensagem longa demais (máximo de 4.000 caracteres)." }, valores: { texto } };
  try {
    await responderNoSiteComoEquipe(obterDb(), conversaId, texto, eu.id);
  } catch (e) {
    return { erros: { _: e instanceof ErroAtendimento ? e.message : "Não foi possível enviar. Tente de novo." }, valores: { texto } };
  }
  revalidatePath(CAMINHO, "layout");
  return { ok: "Enviada." };
}

export async function mudarStatusDoSiteAcao(conversaId: string, status: StatusConversa) {
  await exigirSuperadmin();
  try {
    await mudarStatusDoSite(obterDb(), conversaId, status);
  } catch (e) {
    return { erro: e instanceof ErroAtendimento ? e.message : "Não foi possível mudar a conversa." };
  }
  revalidatePath(CAMINHO, "layout");
}
