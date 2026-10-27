"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { obterDb } from "@/db";
import { empresas, metas, notasEquipe, sessoes, usuarios } from "@/db/schema";
import { intervaloDoMes, mesAtual } from "@/lib/datas";
import { lerReais } from "@/lib/dinheiro";
import type { EstadoForm } from "@/lib/estado-form";
import { errosPorCampo, formParaObjeto } from "@/lib/validacao";
import { exigirSuperadmin } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { gerarSenhaProvisoria, hashSenha } from "./auth";

/**
 * Ações da Central Urutau. Todas exigem superadmin; senhas provisórias aparecem uma vez na tela
 * e nunca vão para a auditoria.
 */

const recarregar = () => revalidatePath("/admin", "layout");

/** "R$ 1.500" vira centavos nas metas em dinheiro; nas de quantidade, só inteiros. */
function lerQuantia(tipo: "valor" | "quantidade", entrada: string): number | null {
  if (tipo === "valor") return lerReais(entrada);
  const n = Number(entrada.replace(/\./g, "").trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const esquemaMeta = z.object({
  usuarioId: z.string().uuid("Escolha a pessoa"),
  titulo: z.string().trim().min(2, "Dê um nome à meta").max(80),
  tipo: z.enum(["valor", "quantidade"]),
  alvo: z.string().trim().min(1, "Informe o alvo"),
});

export async function criarMeta(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const admin = await exigirSuperadmin();
  const valores = formParaObjeto(fd);
  const r = esquemaMeta.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  const alvo = lerQuantia(r.data.tipo, r.data.alvo);
  if (!alvo) return { erros: { alvo: "Informe um alvo maior que zero" }, valores };
  const db = obterDb();
  const [pessoa] = await db.select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.id, r.data.usuarioId), eq(usuarios.superadmin, true))).limit(1);
  if (!pessoa) return { erros: { usuarioId: "Essa pessoa não está na equipe" }, valores };
  const [m] = await db
    .insert(metas)
    .values({ usuarioId: pessoa.id, mes: intervaloDoMes(mesAtual()).inicio, titulo: r.data.titulo, tipo: r.data.tipo, alvo, criadoPor: admin.id })
    .returning({ id: metas.id });
  await registrarAuditoria(db, { usuarioId: admin.id, ator: "usuario", acao: "meta.criar", entidade: "meta", entidadeId: m.id, dados: { titulo: r.data.titulo } });
  recarregar();
  return { ok: "Meta criada.", valores: { usuarioId: r.data.usuarioId } };
}

/** Soma ao que já foi feito (um valor negativo corrige um lançamento errado). */
export async function avancarMeta(metaId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const admin = await exigirSuperadmin();
  const db = obterDb();
  const [m] = await db.select().from(metas).where(eq(metas.id, metaId)).limit(1);
  if (!m) return { erros: { _: "Meta não encontrada." } };
  const entrada = String(fd.get("quanto") ?? "").trim();
  const negativo = entrada.startsWith("-");
  const quanto = lerQuantia(m.tipo, entrada.replace(/^-/, ""));
  if (!quanto) return { erros: { quanto: "Informe quanto avançou" } };
  const atual = Math.max(0, m.atual + (negativo ? -quanto : quanto));
  await db.update(metas).set({ atual }).where(eq(metas.id, metaId));
  await registrarAuditoria(db, { usuarioId: admin.id, ator: "usuario", acao: "meta.progresso", entidade: "meta", entidadeId: metaId, dados: { titulo: m.titulo, de: m.atual, para: atual } });
  recarregar();
  return { ok: "Anotado." };
}

export async function excluirMeta(metaId: string) {
  const admin = await exigirSuperadmin();
  const db = obterDb();
  const [m] = await db.delete(metas).where(eq(metas.id, metaId)).returning({ titulo: metas.titulo });
  if (m) await registrarAuditoria(db, { usuarioId: admin.id, ator: "usuario", acao: "meta.excluir", entidade: "meta", entidadeId: metaId, dados: { titulo: m.titulo } });
  recarregar();
}

const esquemaNota = z.object({
  texto: z.string().trim().min(1, "Escreva a anotação").max(2000),
  sobreUsuarioId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  empresaId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

export async function criarNota(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const admin = await exigirSuperadmin();
  const valores = formParaObjeto(fd);
  const r = esquemaNota.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  await obterDb()
    .insert(notasEquipe)
    .values({ autorId: admin.id, texto: r.data.texto, sobreUsuarioId: r.data.sobreUsuarioId ?? null, empresaId: r.data.empresaId ?? null, fixada: fd.get("fixada") === "on" });
  recarregar();
  return { ok: "Anotado.", valores: { sobreUsuarioId: valores.sobreUsuarioId ?? "" } };
}

export async function fixarNota(notaId: string, fixada: boolean) {
  await exigirSuperadmin();
  await obterDb().update(notasEquipe).set({ fixada }).where(eq(notasEquipe.id, notaId));
  recarregar();
}

export async function excluirNota(notaId: string) {
  await exigirSuperadmin();
  await obterDb().update(notasEquipe).set({ excluidoEm: new Date() }).where(eq(notasEquipe.id, notaId));
  recarregar();
}

export async function definirResponsavel(empresaId: string, fd: FormData) {
  const admin = await exigirSuperadmin();
  const db = obterDb();
  const id = String(fd.get("responsavelId") ?? "");
  let para: { id: string; nome: string } | undefined;
  if (id) {
    [para] = await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.id, id), eq(usuarios.superadmin, true))).limit(1);
    if (!para) return;
  }
  await db.update(empresas).set({ responsavelId: para?.id ?? null }).where(eq(empresas.id, empresaId));
  await registrarAuditoria(db, { empresaId, usuarioId: admin.id, ator: "admin", acao: "admin.responsavel", dados: { para: para?.nome ?? "ninguém" } });
  recarregar();
}

const esquemaPessoaEquipe = z.object({
  nome: z.string().trim().min(2, "Informe o nome").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido"),
});

/**
 * Põe alguém na equipe Urutau. Conta nova nasce com senha provisória (mostrada uma vez);
 * conta existente só ganha o acesso de equipe.
 */
export async function adicionarPessoaEquipe(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const admin = await exigirSuperadmin();
  const valores = formParaObjeto(fd);
  const r = esquemaPessoaEquipe.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  const db = obterDb();
  const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, r.data.email)).limit(1);
  let senha: string | null = null;
  let id: string;
  if (existente) {
    await db.update(usuarios).set({ superadmin: true }).where(eq(usuarios.id, existente.id));
    id = existente.id;
  } else {
    senha = gerarSenhaProvisoria(12);
    [{ id }] = await db
      .insert(usuarios)
      .values({ nome: r.data.nome, email: r.data.email, senhaHash: await hashSenha(senha), superadmin: true, senhaProvisoria: true })
      .returning({ id: usuarios.id });
  }
  await registrarAuditoria(db, { usuarioId: admin.id, ator: "admin", acao: "equipe.adicionar", entidade: "usuario", entidadeId: id, dados: { nome: r.data.nome } });
  recarregar();
  return {
    ok: senha
      ? `${r.data.nome} entrou na equipe. Login: ${r.data.email} · senha provisória: ${senha} (anote agora: ela não aparece de novo).`
      : `${r.data.email} já tinha conta e agora é da equipe.`,
    valores: {},
  };
}

/** Senha nova para alguém da equipe; derruba as sessões abertas dessa pessoa. */
export async function redefinirSenhaEquipe(usuarioId: string): Promise<{ erro?: string; senha?: string }> {
  const admin = await exigirSuperadmin();
  if (usuarioId === admin.id) return { erro: "Para a sua própria senha, use Minha conta." };
  const db = obterDb();
  const [p] = await db.select({ nome: usuarios.nome }).from(usuarios).where(and(eq(usuarios.id, usuarioId), eq(usuarios.superadmin, true))).limit(1);
  if (!p) return { erro: "Essa pessoa não está na equipe." };
  const senha = gerarSenhaProvisoria(12);
  await db.transaction(async (tx) => {
    await tx.update(usuarios).set({ senhaHash: await hashSenha(senha), senhaProvisoria: true }).where(eq(usuarios.id, usuarioId));
    await tx.delete(sessoes).where(eq(sessoes.usuarioId, usuarioId));
  });
  await registrarAuditoria(db, { usuarioId: admin.id, ator: "admin", acao: "equipe.senha", entidade: "usuario", entidadeId: usuarioId, dados: { nome: p.nome } });
  return { senha };
}
