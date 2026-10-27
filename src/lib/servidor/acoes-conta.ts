"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { obterDb } from "@/db";
import { sessoes, usuarios } from "@/db/schema";
import type { EstadoForm } from "@/lib/estado-form";
import { errosPorCampo, formParaObjeto } from "@/lib/validacao";
import { registrarAuditoria } from "./auditoria";
import { conferirSenha, exigirUsuario, hashSenha, hashToken, NOME_COOKIE } from "./auth";

/** Ações da própria conta: nome, e-mail e senha. Valem para qualquer pessoa logada. */

const esquemaDados = z.object({
  nome: z.string().trim().min(2, "Informe seu nome").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
});

export async function salvarDadosDaConta(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirUsuario();
  const valores = formParaObjeto(fd);
  const r = esquemaDados.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  const db = obterDb();
  const [outro] = await db.select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.email, r.data.email), ne(usuarios.id, eu.id))).limit(1);
  if (outro) return { erros: { email: "Já existe outra conta com este e-mail." }, valores };
  await db.update(usuarios).set(r.data).where(eq(usuarios.id, eu.id));
  revalidatePath("/", "layout");
  return { ok: "Dados salvos.", valores: r.data };
}

const esquemaSenha = z
  .object({
    atual: z.string().min(1, "Informe a senha atual"),
    nova: z.string().min(8, "A senha nova precisa ter pelo menos 8 caracteres").max(200),
    repetir: z.string(),
  })
  .refine((s) => s.nova === s.repetir, { path: ["repetir"], message: "As duas senhas não são iguais" });

/** Troca a senha e encerra as outras sessões (a deste aparelho continua). */
export async function trocarSenha(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirUsuario();
  const r = esquemaSenha.safeParse(formParaObjeto(fd));
  if (!r.success) return { erros: errosPorCampo(r.error) };
  const db = obterDb();
  const [u] = await db.select({ senhaHash: usuarios.senhaHash }).from(usuarios).where(eq(usuarios.id, eu.id)).limit(1);
  if (!u || !(await conferirSenha(u.senhaHash, r.data.atual))) return { erros: { atual: "Senha atual incorreta" } };
  const token = (await cookies()).get(NOME_COOKIE)?.value ?? "";
  await db.transaction(async (tx) => {
    await tx.update(usuarios).set({ senhaHash: await hashSenha(r.data.nova), senhaProvisoria: false }).where(eq(usuarios.id, eu.id));
    await tx.delete(sessoes).where(and(eq(sessoes.usuarioId, eu.id), ne(sessoes.tokenHash, hashToken(token))));
  });
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: "conta.trocar_senha" });
  revalidatePath("/", "layout");
  return { ok: "Senha trocada. As outras sessões abertas foram encerradas." };
}
