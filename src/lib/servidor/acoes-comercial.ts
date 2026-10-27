"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { obterDb } from "@/db";
import { type EtapaLead, type StatusProposta, empresas, etapaLeadEnum, interacoes, leads, origemLeadEnum, propostas, tipoInteracaoEnum, usuarios } from "@/db/schema";
import { NOME_ETAPA, prospectosDoCsv, SERVICOS } from "@/lib/comercial";
import { lerReais } from "@/lib/dinheiro";
import type { EstadoForm } from "@/lib/estado-form";
import { errosPorCampo, formParaObjeto, normalizarTelefone } from "@/lib/validacao";
import { exigirSuperadmin } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { importarProspectos } from "./comercial";

/** Ações do Comercial da Urutau. Todas exigem superadmin. */

const recarregar = () => revalidatePath("/admin", "layout");
const vazioVira = <T extends z.ZodTypeAny>(t: T) => t.optional().or(z.literal("").transform(() => undefined));
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const ids = (fd: FormData, nome: string, validos: readonly string[]) => fd.getAll(nome).map(String).filter((s) => validos.includes(s));
const SERVICO_IDS = SERVICOS.map((s) => s.id) as readonly string[];

async function membroDaEquipe(id: string | undefined) {
  if (!id) return null;
  const [u] = await obterDb().select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.id, id), eq(usuarios.superadmin, true))).limit(1);
  return u?.id ?? null;
}

const esquemaLead = z.object({
  nome: z.string().trim().min(2, "Informe o nome do lead").max(120),
  contato: vazioVira(z.string().trim().max(120)),
  telefone: vazioVira(z.string().trim().max(30)),
  email: vazioVira(z.string().trim().toLowerCase().email("E-mail inválido")),
  site: vazioVira(z.string().trim().max(200)),
  instagram: vazioVira(z.string().trim().max(80)),
  categoria: vazioVira(z.string().trim().max(80)),
  cidade: vazioVira(z.string().trim().max(80)),
  origem: z.enum(origemLeadEnum.enumValues),
  responsavelId: vazioVira(z.string().uuid()),
  valorEstimado: vazioVira(z.string().trim()),
  proximoContato: vazioVira(data),
  observacao: vazioVira(z.string().trim().max(2000)),
});

function dadosDoLead(r: z.infer<typeof esquemaLead>, fd: FormData) {
  const telefone = r.telefone ? (normalizarTelefone(r.telefone) ?? r.telefone) : null;
  const valor = r.valorEstimado ? lerReais(r.valorEstimado) : null;
  return {
    nome: r.nome,
    contato: r.contato ?? null,
    telefone,
    email: r.email ?? null,
    site: r.site ?? null,
    instagram: r.instagram?.replace(/^@/, "") ?? null,
    categoria: r.categoria ?? null,
    cidade: r.cidade ?? null,
    origem: r.origem,
    valorEstimadoCentavos: valor,
    proximoContato: r.proximoContato ?? null,
    observacao: r.observacao ?? null,
    interesses: ids(fd, "interesses", SERVICO_IDS),
  };
}

export async function criarLead(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSuperadmin();
  const valores = formParaObjeto(fd);
  const r = esquemaLead.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  if (r.data.valorEstimado && lerReais(r.data.valorEstimado) == null) return { erros: { valorEstimado: "Valor inválido" }, valores };
  const db = obterDb();
  const [l] = await db
    .insert(leads)
    .values({ ...dadosDoLead(r.data, fd), responsavelId: (await membroDaEquipe(r.data.responsavelId)) ?? eu.id, criadoPor: eu.id })
    .returning({ id: leads.id });
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: "lead.criar", entidade: "lead", entidadeId: l.id, dados: { nome: r.data.nome } });
  recarregar();
  redirect(`/admin/comercial/leads/${l.id}`);
}

export async function salvarLead(id: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  await exigirSuperadmin();
  const valores = formParaObjeto(fd);
  const r = esquemaLead.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  if (r.data.valorEstimado && lerReais(r.data.valorEstimado) == null) return { erros: { valorEstimado: "Valor inválido" }, valores };
  await obterDb()
    .update(leads)
    .set({ ...dadosDoLead(r.data, fd), responsavelId: await membroDaEquipe(r.data.responsavelId) })
    .where(eq(leads.id, id));
  recarregar();
  return { ok: "Lead salvo." };
}

/** Muda a etapa e deixa a mudança no histórico do lead (é daí que sai a conversão do funil). */
async function trocarEtapa(leadId: string, para: EtapaLead, autorId: string, texto = "") {
  const db = obterDb();
  const [l] = await db.select({ etapa: leads.etapa, nome: leads.nome }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!l || l.etapa === para) return false;
  await db.update(leads).set({ etapa: para, ...(para === "ganho" ? { proximoContato: null } : {}) }).where(eq(leads.id, leadId));
  await db.insert(interacoes).values({ leadId, autorId, tipo: "nota", texto, etapaDe: l.etapa, etapaPara: para });
  await registrarAuditoria(db, { usuarioId: autorId, ator: "usuario", acao: "lead.etapa", entidade: "lead", entidadeId: leadId, dados: { nome: l.nome, para: NOME_ETAPA[para] } });
  return true;
}

export async function mudarEtapa(leadId: string, fd: FormData) {
  const eu = await exigirSuperadmin();
  const para = String(fd.get("etapa") ?? "");
  if (!(etapaLeadEnum.enumValues as readonly string[]).includes(para)) return;
  const motivo = String(fd.get("motivo") ?? "").trim().slice(0, 300);
  if (para === "perdido" && motivo) await obterDb().update(leads).set({ motivoPerda: motivo }).where(eq(leads.id, leadId));
  await trocarEtapa(leadId, para as EtapaLead, eu.id, motivo);
  recarregar();
}

const esquemaInteracao = z.object({
  tipo: z.enum(tipoInteracaoEnum.enumValues),
  texto: z.string().trim().max(4000).default(""),
  proximoContato: vazioVira(data),
  etapa: vazioVira(z.enum(etapaLeadEnum.enumValues)),
});

/** "Liguei para ele": registra o contato, o próximo retorno e, se for o caso, a nova etapa. */
export async function registrarInteracao(leadId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSuperadmin();
  const r = esquemaInteracao.safeParse(formParaObjeto(fd));
  if (!r.success) return { erros: errosPorCampo(r.error) };
  if (r.data.tipo === "nota" && !r.data.texto) return { erros: { texto: "Escreva a anotação" } };
  const db = obterDb();
  const [l] = await db.select({ etapa: leads.etapa }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!l) return { erros: { _: "Lead não encontrado." } };
  await db.insert(interacoes).values({ leadId, autorId: eu.id, tipo: r.data.tipo, texto: r.data.texto });
  // Primeiro contato tira o lead de "novo".
  const etapa = r.data.etapa ?? (l.etapa === "novo" && r.data.tipo !== "nota" ? "contatado" : undefined);
  if (etapa) await trocarEtapa(leadId, etapa, eu.id);
  if (r.data.proximoContato !== undefined || fd.has("proximoContato"))
    await db.update(leads).set({ proximoContato: r.data.proximoContato ?? null }).where(eq(leads.id, leadId));
  recarregar();
  return { ok: "Registrado." };
}

export async function excluirLead(leadId: string) {
  await exigirSuperadmin();
  await obterDb().update(leads).set({ excluidoEm: new Date() }).where(eq(leads.id, leadId));
  recarregar();
  redirect("/admin/comercial/leads");
}

/** Liga o lead à empresa dele no app (depois de fechar e cadastrar). */
export async function ligarEmpresa(leadId: string, fd: FormData) {
  await exigirSuperadmin();
  const empresaId = String(fd.get("empresaId") ?? "");
  const db = obterDb();
  if (empresaId) {
    const [e] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, empresaId)).limit(1);
    if (!e) return;
  }
  await db.update(leads).set({ empresaId: empresaId || null }).where(eq(leads.id, leadId));
  recarregar();
}

const esquemaProposta = z.object({
  leadId: vazioVira(z.string().uuid()),
  titulo: z.string().trim().min(2, "Dê um nome à proposta").max(120),
  mensal: vazioVira(z.string().trim()),
  unico: vazioVira(z.string().trim()),
  validade: vazioVira(data),
  observacao: vazioVira(z.string().trim().max(4000)),
});

export async function criarProposta(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSuperadmin();
  const valores = formParaObjeto(fd);
  const r = esquemaProposta.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  const mensal = r.data.mensal ? lerReais(r.data.mensal) : 0;
  const unico = r.data.unico ? lerReais(r.data.unico) : 0;
  if (mensal == null) return { erros: { mensal: "Valor inválido" }, valores };
  if (unico == null) return { erros: { unico: "Valor inválido" }, valores };
  if (!mensal && !unico) return { erros: { mensal: "Informe o valor mensal ou o de entrada" }, valores };
  const db = obterDb();
  const [p] = await db
    .insert(propostas)
    .values({
      leadId: r.data.leadId ?? null,
      titulo: r.data.titulo,
      servicos: ids(fd, "servicos", SERVICO_IDS),
      valorMensalCentavos: mensal,
      valorUnicoCentavos: unico,
      validade: r.data.validade ?? null,
      observacao: r.data.observacao ?? null,
      criadoPor: eu.id,
    })
    .returning({ id: propostas.id });
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: "proposta.criar", entidade: "proposta", entidadeId: p.id, dados: { titulo: r.data.titulo } });
  recarregar();
  return { ok: "Proposta criada.", valores: {} };
}

/**
 * Enviada leva o lead para "proposta"; aceita fecha o lead ("ganho"); recusada só registra.
 * Voltar para rascunho limpa as datas.
 */
export async function mudarStatusProposta(id: string, status: StatusProposta) {
  const eu = await exigirSuperadmin();
  const db = obterDb();
  const agora = new Date();
  const [p] = await db
    .update(propostas)
    .set(
      status === "enviada"
        ? { status, enviadaEm: agora, respondidaEm: null }
        : status === "rascunho"
          ? { status, enviadaEm: null, respondidaEm: null }
          : { status, respondidaEm: agora },
    )
    .where(eq(propostas.id, id))
    .returning({ leadId: propostas.leadId, titulo: propostas.titulo });
  if (!p) return;
  if (p.leadId) {
    const [l] = await db.select({ etapa: leads.etapa }).from(leads).where(eq(leads.id, p.leadId)).limit(1);
    if (status === "aceita") await trocarEtapa(p.leadId, "ganho", eu.id, `Aceitou a proposta "${p.titulo}".`);
    else if (status === "enviada" && l && ["novo", "contatado", "diagnostico"].includes(l.etapa))
      await trocarEtapa(p.leadId, "proposta", eu.id, `Proposta "${p.titulo}" enviada.`);
  }
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: `proposta.${status}`, entidade: "proposta", entidadeId: id, dados: { titulo: p.titulo } });
  recarregar();
}

export async function excluirProposta(id: string) {
  await exigirSuperadmin();
  await obterDb().delete(propostas).where(eq(propostas.id, id));
  recarregar();
}

const LIMITE_ARQUIVO = 5 * 1024 * 1024;

/** Importa o CSV do google-maps-scraper-kit (ou uma planilha parecida) como leads de prospecção. */
export async function importarCsv(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSuperadmin();
  const arquivo = fd.get("arquivo");
  let conteudo = String(fd.get("colado") ?? "");
  if (arquivo instanceof File && arquivo.size > 0) {
    if (arquivo.size > LIMITE_ARQUIVO) return { erros: { arquivo: "Arquivo maior que 5 MB" } };
    conteudo = await arquivo.text();
  }
  if (!conteudo.trim()) return { erros: { arquivo: "Escolha o CSV da prospecção ou cole o conteúdo" } };
  const lote = String(fd.get("lote") ?? "").trim().slice(0, 80);
  if (!lote) return { erros: { lote: "Dê um nome ao lote, ex.: dentistas em Maricá" }, valores: { lote } };
  const { prospectos, ignoradas, colunas } = prospectosDoCsv(conteudo);
  if (!prospectos.length)
    return { erros: { arquivo: `Nenhuma empresa encontrada. Colunas lidas: ${colunas.slice(0, 8).join(", ") || "nenhuma"}. O arquivo precisa da coluna "title" (ou "nome").` }, valores: { lote } };
  const responsavelId = await membroDaEquipe(String(fd.get("responsavelId") ?? "") || undefined);
  const db = obterDb();
  const r = await importarProspectos(db, prospectos, { lote, responsavelId, criadoPor: eu.id });
  const semMapa = prospectos.filter((p) => p.latitude == null).length;
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: "prospeccao.importar", dados: { lote, novos: r.novos } });
  recarregar();
  return {
    ok: [
      `${r.novos} ${r.novos === 1 ? "empresa nova" : "empresas novas"} no lote "${lote}".`,
      r.repetidos ? `${r.repetidos} já estavam no painel.` : "",
      ignoradas ? `${ignoradas} linhas sem nome ou repetidas no arquivo.` : "",
      semMapa ? `${semMapa} sem coordenadas (rode o robô com --full para aparecerem no mapa).` : "",
    ]
      .filter(Boolean)
      .join(" "),
    valores: {},
  };
}
