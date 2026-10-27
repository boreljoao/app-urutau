"use server";

import { and, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { obterDb } from "@/db";
import {
  categoriaCustoEnum,
  clientesUrutau,
  cobrancas,
  contratoItens,
  contratos,
  custosUrutau,
  empresas,
  ganhos,
  interacoes,
  leads,
  parametrosCentral,
  recorrenciaEnum,
  regrasComissao,
  servicoUrutauEnum,
  usuarios,
} from "@/db/schema";
import { hoje, mesAtual } from "@/lib/datas";
import { lerPercentual, lerReais } from "@/lib/dinheiro";
import type { EstadoForm } from "@/lib/estado-form";
import { errosPorCampo, formParaObjeto, normalizarTelefone } from "@/lib/validacao";
import { exigirSocio } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { desfazerPagamento, gerarCobrancas, lerParametros, lerRegras, registrarPagamento } from "./receita";

/**
 * Ações da Receita da Urutau. Todas são dos sócios: a equipe vê os clientes, mas não mexe em
 * contrato, cobrança, custo ou regra.
 */

const recarregar = () => revalidatePath("/admin", "layout");
const vazio = <T extends z.ZodTypeAny>(t: T) => t.optional().or(z.literal("").transform(() => undefined));
const mes = z.string().regex(/^\d{4}-\d{2}$/, "Mês inválido");
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");

/** Dinheiro digitado → centavos; vazio = 0; inválido = null. */
const dinheiro = (v: string | undefined) => (v && v.trim() ? lerReais(v) : 0);

async function daEquipe(id: string | undefined) {
  if (!id) return null;
  const [u] = await obterDb().select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.id, id), eq(usuarios.superadmin, true))).limit(1);
  return u?.id ?? null;
}

// ─── Cliente + contrato ──────────────────────────────────────────────────────

const esquemaCliente = z.object({
  nome: z.string().trim().min(2, "Informe o nome do cliente").max(120),
  contato: vazio(z.string().trim().max(120)),
  telefone: vazio(z.string().trim().max(30)),
  email: vazio(z.string().trim().toLowerCase().email("E-mail inválido")),
  documento: vazio(z.string().trim().max(20)),
  cidade: vazio(z.string().trim().max(80)),
  ramo: vazio(z.string().trim().max(80)),
  quemTrouxeId: vazio(z.string().uuid()),
  empresaId: vazio(z.string().uuid()),
  faturamentoInformado: vazio(z.string().trim()),
  observacao: vazio(z.string().trim().max(2000)),
});

const esquemaContrato = z.object({
  inicio: mes,
  meses: vazio(z.coerce.number().int().min(1, "Mínimo 1 mês").max(120)),
  diaVencimento: z.coerce.number().int().min(1).max(28).default(10),
  desconto: vazio(z.string().trim()),
  descontoMeses: vazio(z.coerce.number().int().min(1).max(120)),
  multaTipo: z.enum(["nenhuma", "valor", "percentual_restante"]).default("nenhuma"),
  multaValor: vazio(z.string().trim()),
  observacaoContrato: vazio(z.string().trim().max(2000)),
});

const esquemaItem = z.object({
  servico: z.enum(servicoUrutauEnum.enumValues),
  descricao: z.string().trim().max(200).default(""),
  recorrencia: z.enum(recorrenciaEnum.enumValues),
  valor: z.string().trim().min(1, "Informe o valor"),
  custo: z.string().trim().optional().default(""),
  executorId: z.string().optional().default(""),
  abriuMao: z.boolean().optional().default(false),
  inicio: z.string().optional().default(""),
});

type ItemLido = { servico: (typeof servicoUrutauEnum.enumValues)[number]; descricao: string; recorrencia: "mensal" | "unico"; valor: number; custo: number; executorId: string | null; abriuMao: boolean; inicio: string | null };

/** Lê os serviços (JSON do formulário) e valida cada linha. */
async function lerItens(fd: FormData, minimo: number): Promise<{ itens?: ItemLido[]; erro?: string }> {
  let bruto: unknown;
  try {
    bruto = JSON.parse(String(fd.get("itens") ?? "[]"));
  } catch {
    return { erro: "Serviços inválidos." };
  }
  const r = z.array(esquemaItem).safeParse(bruto);
  if (!r.success) return { erro: "Confira os serviços: cada um precisa de tipo, valor e se é mensal ou único." };
  if (r.data.length < minimo) return { erro: "Coloque pelo menos um serviço." };
  const itens: ItemLido[] = [];
  for (const [n, i] of r.data.entries()) {
    const valor = lerReais(i.valor);
    const custo = dinheiro(i.custo);
    if (valor == null || valor < 0) return { erro: `Serviço ${n + 1}: valor inválido.` };
    if (custo == null || custo < 0) return { erro: `Serviço ${n + 1}: custo inválido.` };
    if (i.inicio && !/^\d{4}-\d{2}$/.test(i.inicio)) return { erro: `Serviço ${n + 1}: mês de início inválido.` };
    itens.push({ servico: i.servico, descricao: i.descricao, recorrencia: i.recorrencia, valor, custo, executorId: (await daEquipe(i.executorId || undefined)) ?? null, abriuMao: i.abriuMao, inicio: i.inicio ? `${i.inicio}-01` : null });
  }
  return { itens };
}

/** Grava os serviços com a regra de hoje congelada em cada um. */
async function gravarItens(contratoId: string, itens: ItemLido[]) {
  const db = obterDb();
  const [regras, p] = await Promise.all([lerRegras(db), lerParametros(db)]);
  if (!itens.length) return;
  await db.insert(contratoItens).values(
    itens.map((i) => ({
      contratoId,
      servico: i.servico,
      descricao: i.descricao,
      recorrencia: i.recorrencia,
      valorCentavos: i.valor,
      custoCentavos: i.custo,
      executorId: i.executorId,
      executorPcm: i.executorId ? (regras[i.servico] ?? 0) : 0,
      executorAbriuMao: i.executorId ? i.abriuMao : false,
      trouxePcm: p.trouxePcm,
      inicio: i.inicio,
    })),
  );
}

function lerContrato(valores: Record<string, string>) {
  const r = esquemaContrato.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error) };
  const c = r.data;
  const descontoPcm = c.desconto ? lerPercentual(c.desconto) : 0;
  if (descontoPcm == null || descontoPcm > 100_000) return { erros: { desconto: "Desconto inválido (de 0 a 100%)" } };
  let multaValor = 0;
  if (c.multaTipo === "valor") {
    const v = c.multaValor ? lerReais(c.multaValor) : null;
    if (v == null || v < 0) return { erros: { multaValor: "Informe o valor da multa" } };
    multaValor = v;
  } else if (c.multaTipo === "percentual_restante") {
    const v = c.multaValor ? lerPercentual(c.multaValor) : null;
    if (v == null || v > 100_000) return { erros: { multaValor: "Informe o percentual da multa" } };
    multaValor = v;
  }
  return {
    contrato: {
      inicio: `${c.inicio}-01`,
      meses: c.meses ?? null,
      diaVencimento: c.diaVencimento,
      descontoPcm,
      descontoMeses: descontoPcm ? (c.descontoMeses ?? null) : null,
      multaTipo: c.multaTipo,
      multaValor,
      observacao: c.observacaoContrato ?? null,
    },
  };
}

async function lerCliente(valores: Record<string, string>) {
  const r = esquemaCliente.safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error) };
  const c = r.data;
  const fat = c.faturamentoInformado ? lerReais(c.faturamentoInformado) : null;
  if (c.faturamentoInformado && fat == null) return { erros: { faturamentoInformado: "Valor inválido" } };
  if (c.empresaId) {
    const [e] = await obterDb().select({ id: empresas.id }).from(empresas).where(eq(empresas.id, c.empresaId)).limit(1);
    if (!e) return { erros: { empresaId: "Empresa não encontrada" } };
  }
  return {
    cliente: {
      nome: c.nome,
      contato: c.contato ?? null,
      telefone: c.telefone ? (normalizarTelefone(c.telefone) ?? c.telefone) : null,
      email: c.email ?? null,
      documento: c.documento?.replace(/\D/g, "") || null,
      cidade: c.cidade ?? null,
      ramo: c.ramo ?? null,
      quemTrouxeId: await daEquipe(c.quemTrouxeId),
      empresaId: c.empresaId ?? null,
      faturamentoInformadoCentavos: fat,
      observacao: c.observacao ?? null,
    },
  };
}

/** Cadastro completo: o cliente, o primeiro contrato e os serviços. Já gera as cobranças até este mês. */
export async function criarClienteUrutau(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSocio();
  const valores = formParaObjeto(fd);
  const cli = await lerCliente(valores);
  if (cli.erros) return { erros: cli.erros, valores };
  const con = lerContrato(valores);
  if (con.erros) return { erros: con.erros, valores };
  const it = await lerItens(fd, 1);
  if (it.erro) return { erros: { _: it.erro }, valores };
  const db = obterDb();
  const leadId = valores.leadId && /^[0-9a-f-]{36}$/i.test(valores.leadId) ? valores.leadId : null;
  const [novo] = await db.insert(clientesUrutau).values({ ...cli.cliente!, leadId, criadoPor: eu.id }).returning({ id: clientesUrutau.id });
  const [contrato] = await db.insert(contratos).values({ ...con.contrato!, clienteId: novo.id, criadoPor: eu.id }).returning({ id: contratos.id });
  await gravarItens(contrato.id, it.itens!);
  await gerarCobrancas(db, mesAtual(), contrato.id);
  if (leadId) {
    const [l] = await db.select({ etapa: leads.etapa }).from(leads).where(eq(leads.id, leadId)).limit(1);
    if (l && l.etapa !== "ganho") {
      await db.update(leads).set({ etapa: "ganho", proximoContato: null }).where(eq(leads.id, leadId));
      await db.insert(interacoes).values({ leadId, autorId: eu.id, tipo: "nota", texto: "Virou cliente da Urutau.", etapaDe: l.etapa, etapaPara: "ganho" });
    }
  }
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: "cliente_urutau.criar", entidade: "cliente_urutau", entidadeId: novo.id, dados: { nome: cli.cliente!.nome } });
  recarregar();
  redirect(`/admin/clientes/${novo.id}`);
}

export async function salvarClienteUrutau(id: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  await exigirSocio();
  const valores = formParaObjeto(fd);
  const cli = await lerCliente(valores);
  if (cli.erros) return { erros: cli.erros, valores };
  await obterDb().update(clientesUrutau).set(cli.cliente!).where(eq(clientesUrutau.id, id));
  recarregar();
  return { ok: "Cliente salvo." };
}

/** Renovação ou novo contrato do mesmo cliente. */
export async function novoContrato(clienteId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSocio();
  const valores = formParaObjeto(fd);
  const con = lerContrato(valores);
  if (con.erros) return { erros: con.erros, valores };
  const it = await lerItens(fd, 1);
  if (it.erro) return { erros: { _: it.erro }, valores };
  const db = obterDb();
  const [contrato] = await db.insert(contratos).values({ ...con.contrato!, clienteId, criadoPor: eu.id }).returning({ id: contratos.id });
  await gravarItens(contrato.id, it.itens!);
  await gerarCobrancas(db, mesAtual(), contrato.id);
  recarregar();
  return { ok: "Contrato criado.", valores: {} };
}

/** Serviço a mais num contrato que já existe. */
export async function adicionarServico(contratoId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  await exigirSocio();
  const it = await lerItens(fd, 1);
  if (it.erro) return { erros: { _: it.erro } };
  await gravarItens(contratoId, it.itens!);
  await gerarCobrancas(obterDb(), mesAtual(), contratoId);
  recarregar();
  return { ok: "Serviço acrescentado. Ele entra a partir das próximas cobranças." };
}

/** Tira um serviço do contrato: `ate` é o último mês cobrado. */
export async function encerrarServico(itemId: string, fd: FormData) {
  await exigirSocio();
  const r = mes.safeParse(String(fd.get("ate") ?? ""));
  if (!r.success) return;
  await obterDb().update(contratoItens).set({ ate: `${r.data}-01` }).where(eq(contratoItens.id, itemId));
  recarregar();
}

/** Encerra (fim natural) ou cancela o contrato. Cobranças futuras ainda não pagas são apagadas. */
export async function encerrarContrato(contratoId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSocio();
  const r = z.object({ ultimoMes: mes, status: z.enum(["encerrado", "cancelado"]), motivo: vazio(z.string().trim().max(500)) }).safeParse(formParaObjeto(fd));
  if (!r.success) return { erros: errosPorCampo(r.error) };
  const db = obterDb();
  const ultimo = `${r.data.ultimoMes}-01`;
  await db.transaction(async (tx) => {
    await tx.update(contratos).set({ status: r.data.status, encerradoEm: ultimo, motivoEncerramento: r.data.motivo ?? null }).where(eq(contratos.id, contratoId));
    await tx.delete(cobrancas).where(and(eq(cobrancas.contratoId, contratoId), eq(cobrancas.status, "a_receber"), gt(cobrancas.competencia, ultimo)));
  });
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: `contrato.${r.data.status}`, entidade: "contrato", entidadeId: contratoId, dados: { motivo: r.data.motivo } });
  recarregar();
  return { ok: r.data.status === "cancelado" ? "Contrato cancelado." : "Contrato encerrado." };
}

// ─── Cobranças ───────────────────────────────────────────────────────────────

/** Cliente pagou (total ou parte). As comissões nascem aqui. */
export async function pagarCobranca(cobrancaId: string, _: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSocio();
  const pagoEm = data.safeParse(String(fd.get("pagoEm") ?? ""));
  if (!pagoEm.success) return { erros: { pagoEm: "Informe a data do pagamento" } };
  const valorTxt = String(fd.get("valor") ?? "").trim();
  const valor = valorTxt ? lerReais(valorTxt) : undefined;
  if (valor === null || (valor !== undefined && valor <= 0)) return { erros: { valor: "Valor inválido" } };
  try {
    const g = await registrarPagamento(obterDb(), cobrancaId, pagoEm.data, valor);
    await registrarAuditoria(obterDb(), { usuarioId: eu.id, ator: "usuario", acao: "cobranca.pago", entidade: "cobranca", entidadeId: cobrancaId, dados: { comissoes: g.length } });
  } catch (e) {
    return { erros: { _: e instanceof Error ? e.message : "Não deu para registrar." } };
  }
  recarregar();
  return { ok: "Pagamento registrado." };
}

export async function desfazerPagamentoAcao(cobrancaId: string): Promise<{ erro?: string }> {
  await exigirSocio();
  try {
    await desfazerPagamento(obterDb(), cobrancaId);
  } catch (e) {
    return { erro: e instanceof Error ? e.message : "Não deu para desfazer." };
  }
  recarregar();
  return {};
}

/** Cobrança que não vai acontecer (mês de cortesia, renegociação): sai das contas. */
export async function cancelarCobranca(cobrancaId: string) {
  await exigirSocio();
  await obterDb().update(cobrancas).set({ status: "cancelada" }).where(and(eq(cobrancas.id, cobrancaId), eq(cobrancas.status, "a_receber")));
  recarregar();
}

/** Repasse: marca como pagas todas as comissões em aberto de uma pessoa. */
export async function repassarComissoes(usuarioId: string) {
  const eu = await exigirSocio();
  const db = obterDb();
  const pagos = await db.update(ganhos).set({ status: "pago", pagoEm: hoje() }).where(and(eq(ganhos.usuarioId, usuarioId), eq(ganhos.status, "a_pagar"))).returning({ v: ganhos.valorCentavos });
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: "comissao.repasse", entidade: "usuario", entidadeId: usuarioId, dados: { total: pagos.reduce((s, x) => s + x.v, 0) } });
  recarregar();
}

// ─── Custos ──────────────────────────────────────────────────────────────────

export async function criarCusto(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSocio();
  const valores = formParaObjeto(fd);
  const r = z
    .object({
      descricao: z.string().trim().min(2, "Descreva o custo").max(120),
      categoria: z.enum(categoriaCustoEnum.enumValues),
      valor: z.string().trim().min(1, "Informe o valor"),
      recorrencia: z.enum(recorrenciaEnum.enumValues),
      inicio: mes,
      fim: vazio(mes),
      clienteId: vazio(z.string().uuid()),
    })
    .safeParse(valores);
  if (!r.success) return { erros: errosPorCampo(r.error), valores };
  const valor = lerReais(r.data.valor);
  if (!valor || valor <= 0) return { erros: { valor: "Valor inválido" }, valores };
  if (r.data.fim && r.data.fim < r.data.inicio) return { erros: { fim: "O fim vem antes do início" }, valores };
  await obterDb()
    .insert(custosUrutau)
    .values({ descricao: r.data.descricao, categoria: r.data.categoria, valorCentavos: valor, recorrencia: r.data.recorrencia, inicio: `${r.data.inicio}-01`, fim: r.data.fim ? `${r.data.fim}-01` : null, clienteId: r.data.clienteId ?? null, criadoPor: eu.id });
  recarregar();
  return { ok: "Custo lançado.", valores: {} };
}

/** Custo mensal que parou: `fim` é o último mês. */
export async function encerrarCusto(id: string, fd: FormData) {
  await exigirSocio();
  const r = mes.safeParse(String(fd.get("fim") ?? ""));
  if (!r.success) return;
  await obterDb().update(custosUrutau).set({ fim: `${r.data}-01` }).where(eq(custosUrutau.id, id));
  recarregar();
}

export async function excluirCusto(id: string) {
  await exigirSocio();
  await obterDb().update(custosUrutau).set({ excluidoEm: new Date() }).where(eq(custosUrutau.id, id));
  recarregar();
}

// ─── Regras ──────────────────────────────────────────────────────────────────

/** Tabela de comissões e parâmetros. Vale para serviços cadastrados daqui em diante (os antigos guardam a regra deles). */
export async function salvarRegras(_: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const eu = await exigirSocio();
  const db = obterDb();
  const erros: Record<string, string> = {};
  const pct = (campo: string) => {
    const v = lerPercentual(String(fd.get(campo) ?? ""));
    if (v == null || v > 100_000) erros[campo] = "De 0 a 100%";
    return v ?? 0;
  };
  const regras = servicoUrutauEnum.enumValues.map((s) => ({ servico: s, executorPcm: pct(`regra_${s}`) }));
  const trouxe = pct("trouxe");
  const caixa = pct("caixa");
  const diferenca = pct("diferenca");
  if (Object.keys(erros).length) return { erros };
  const socioMaior = String(fd.get("socioMaiorId") ?? "");
  if (socioMaior) {
    const [s] = await db.select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.id, socioMaior), eq(usuarios.papelEquipe, "socio"))).limit(1);
    if (!s) return { erros: { socioMaiorId: "Escolha um dos sócios" } };
  }
  await db.transaction(async (tx) => {
    for (const r of regras) await tx.insert(regrasComissao).values(r).onConflictDoUpdate({ target: regrasComissao.servico, set: { executorPcm: r.executorPcm } });
    for (const [chave, valor] of [
      ["trouxe_pcm", String(trouxe)],
      ["caixa_pcm", String(caixa)],
      ["diferenca_socios_pcm", String(diferenca)],
      ["socio_maior_id", socioMaior],
    ])
      await tx.insert(parametrosCentral).values({ chave, valor }).onConflictDoUpdate({ target: parametrosCentral.chave, set: { valor } });
  });
  await registrarAuditoria(db, { usuarioId: eu.id, ator: "usuario", acao: "regras.salvar" });
  recarregar();
  return { ok: "Regras salvas. Valem para os serviços cadastrados a partir de agora." };
}
