import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { BancoDeDados } from "@/db";
import {
  type ServicoUrutau,
  clientesUrutau,
  cobrancaItens,
  cobrancas,
  contratoItens,
  contratos,
  custosUrutau,
  empresas,
  ganhos,
  parametrosCentral,
  regrasComissao,
  usuarios,
} from "@/db/schema";
import { type Data, type Mes, intervaloDoMes, mesDe, somarMeses } from "@/lib/datas";
import { type ContratoParaCalculo, type ItemParaCalculo, dividirEntreSocios, linhasDaCobranca, mensalidadeNoMes, mesesACobrar, repartirPagamento, ultimoMesDoContrato } from "@/lib/receita";

/** Receita da Urutau no banco: cobranças, pagamentos, comissões, custos e os números do mês. */

type Tx = Parameters<Parameters<BancoDeDados["transaction"]>[0]>[0];
type Banco = BancoDeDados | Tx;

// ─── Regras ──────────────────────────────────────────────────────────────────

export interface Parametros {
  trouxePcm: number;
  caixaPcm: number;
  diferencaPcm: number;
  /** Sócio que leva a diferença a mais; null = ainda não definido (a divisão sai igual). */
  socioMaiorId: string | null;
}

export async function lerParametros(db: Banco): Promise<Parametros> {
  const linhas = await db.select().from(parametrosCentral);
  const v = (k: string) => linhas.find((l) => l.chave === k)?.valor;
  const n = (k: string, padrao: number) => (v(k) != null && Number.isFinite(Number(v(k))) ? Number(v(k)) : padrao);
  return { trouxePcm: n("trouxe_pcm", 10_000), caixaPcm: n("caixa_pcm", 10_000), diferencaPcm: n("diferenca_socios_pcm", 5_000), socioMaiorId: v("socio_maior_id") || null };
}

export async function lerRegras(db: Banco): Promise<Record<ServicoUrutau, number>> {
  const linhas = await db.select().from(regrasComissao);
  return Object.fromEntries(linhas.map((l) => [l.servico, l.executorPcm])) as Record<ServicoUrutau, number>;
}

// ─── Cobranças ───────────────────────────────────────────────────────────────

const paraCalculo = (c: typeof contratos.$inferSelect): ContratoParaCalculo => ({
  inicio: c.inicio,
  meses: c.meses,
  descontoPcm: c.descontoPcm,
  descontoMeses: c.descontoMeses,
  encerradoEm: c.encerradoEm,
});

/**
 * Cria as cobranças que faltam até `ateMes` (inclusive) de todos os contratos, com as linhas
 * de cada serviço. Idempotente: o par contrato + mês é único. Chamada pelas telas e pela rotina diária.
 */
export async function gerarCobrancas(db: BancoDeDados, ateMes: Mes, contratoId?: string) {
  const lista = await db.select().from(contratos).where(contratoId ? eq(contratos.id, contratoId) : undefined);
  if (!lista.length) return 0;
  const itens = await db.select().from(contratoItens).where(inArray(contratoItens.contratoId, lista.map((c) => c.id)));
  const existentes = await db.select({ contratoId: cobrancas.contratoId, competencia: cobrancas.competencia }).from(cobrancas).where(inArray(cobrancas.contratoId, lista.map((c) => c.id)));
  const ja = new Set(existentes.map((e) => `${e.contratoId}|${e.competencia}`));
  let criadas = 0;
  for (const c of lista) {
    const meus = itens.filter((i) => i.contratoId === c.id);
    for (const mes of mesesACobrar(paraCalculo(c), ateMes)) {
      const competencia = `${mes}-01`;
      if (ja.has(`${c.id}|${competencia}`)) continue;
      const { linhas, total } = linhasDaCobranca(paraCalculo(c), meus, mes);
      if (!linhas.length) continue;
      await db.transaction(async (tx) => {
        const [nova] = await tx
          .insert(cobrancas)
          .values({ contratoId: c.id, competencia, vencimento: `${mes}-${String(c.diaVencimento).padStart(2, "0")}`, valorCentavos: total })
          .onConflictDoNothing()
          .returning({ id: cobrancas.id });
        if (!nova) return;
        await tx.insert(cobrancaItens).values(linhas.map((l) => ({ cobrancaId: nova.id, itemId: l.itemId, valorCentavos: l.valor, custoCentavos: l.custo })));
        criadas++;
      });
    }
  }
  return criadas;
}

/**
 * Cliente pagou: grava o pagamento e cria as comissões (quem trouxe e quem executou) daquela
 * cobrança. Pagamento parcial reparte na mesma proporção.
 */
export async function registrarPagamento(db: BancoDeDados, cobrancaId: string, pagoEm: Data, valorPago?: number) {
  return db.transaction(async (tx) => {
    const [cob] = await tx.select().from(cobrancas).where(eq(cobrancas.id, cobrancaId)).for("update").limit(1);
    if (!cob) throw new Error("Cobrança não encontrada.");
    if (cob.status === "pago") throw new Error("Esta cobrança já está paga.");
    const pago = valorPago ?? cob.valorCentavos;
    const [{ clienteId }] = await tx.select({ clienteId: contratos.clienteId }).from(contratos).where(eq(contratos.id, cob.contratoId));
    const [cli] = await tx.select({ quemTrouxeId: clientesUrutau.quemTrouxeId }).from(clientesUrutau).where(eq(clientesUrutau.id, clienteId));
    const linhas = await tx.select({ itemId: cobrancaItens.itemId, valor: cobrancaItens.valorCentavos }).from(cobrancaItens).where(eq(cobrancaItens.cobrancaId, cobrancaId));
    const itens = await tx.select().from(contratoItens).where(inArray(contratoItens.id, linhas.map((l) => l.itemId)));
    await tx.update(cobrancas).set({ status: "pago", pagoEm, valorPagoCentavos: pago }).where(eq(cobrancas.id, cobrancaId));
    const calculados = repartirPagamento(linhas, itens, cli?.quemTrouxeId ?? null, pago, cob.valorCentavos);
    if (calculados.length)
      await tx.insert(ganhos).values(calculados.map((g) => ({ cobrancaId, itemId: g.itemId, usuarioId: g.usuarioId, tipo: g.tipo, baseCentavos: g.base, pcm: g.pcm, valorCentavos: g.valor })));
    return calculados;
  });
}

/** Desfaz um pagamento lançado errado. Não deixa se alguma comissão dele já foi paga à pessoa. */
export async function desfazerPagamento(db: BancoDeDados, cobrancaId: string) {
  return db.transaction(async (tx) => {
    const pagos = await tx.select({ id: ganhos.id }).from(ganhos).where(and(eq(ganhos.cobrancaId, cobrancaId), eq(ganhos.status, "pago"))).limit(1);
    if (pagos.length) throw new Error("Já tem comissão paga sobre este pagamento. Desfaça o repasse antes.");
    await tx.delete(ganhos).where(eq(ganhos.cobrancaId, cobrancaId));
    await tx.update(cobrancas).set({ status: "a_receber", pagoEm: null, valorPagoCentavos: null }).where(eq(cobrancas.id, cobrancaId));
  });
}

// ─── Clientes ────────────────────────────────────────────────────────────────

/** Todos os clientes da Urutau com o que importa na lista: serviços, mensalidade, quem trouxe, fim do contrato e atrasos. */
export async function listarClientesUrutau(db: BancoDeDados, mes: Mes, hoje: Data) {
  const trouxe = alias(usuarios, "trouxe");
  const [clientes, listaContratos, itens, atrasos] = await Promise.all([
    db
      .select({ id: clientesUrutau.id, nome: clientesUrutau.nome, ramo: clientesUrutau.ramo, cidade: clientesUrutau.cidade, quemTrouxeId: clientesUrutau.quemTrouxeId, quemTrouxe: trouxe.nome, empresaId: clientesUrutau.empresaId, criadoEm: clientesUrutau.criadoEm })
      .from(clientesUrutau)
      .leftJoin(trouxe, eq(trouxe.id, clientesUrutau.quemTrouxeId))
      .where(isNull(clientesUrutau.excluidoEm))
      .orderBy(asc(clientesUrutau.nome)),
    db.select().from(contratos),
    db.select().from(contratoItens),
    db
      .select({ contratoId: cobrancas.contratoId, n: sql<number>`count(*)::int`, valor: sql<number>`coalesce(sum(${cobrancas.valorCentavos}), 0)::bigint`.mapWith(Number) })
      .from(cobrancas)
      .where(and(eq(cobrancas.status, "a_receber"), lt(cobrancas.vencimento, hoje)))
      .groupBy(cobrancas.contratoId),
  ]);
  return clientes.map((cli) => {
    const meus = listaContratos.filter((c) => c.clienteId === cli.id);
    const ativos = meus.filter((c) => c.status === "ativo");
    const itensAtivos = itens.filter((i) => ativos.some((c) => c.id === i.contratoId));
    const mensal = ativos.reduce((s, c) => s + mensalidadeNoMes(paraCalculo(c), itens.filter((i) => i.contratoId === c.id), mes), 0);
    const fins = ativos.map((c) => ultimoMesDoContrato(paraCalculo(c)));
    const atraso = atrasos.filter((a) => meus.some((c) => c.id === a.contratoId));
    return {
      ...cli,
      ativo: ativos.length > 0,
      servicos: [...new Set(itensAtivos.filter((i) => !i.ate || mesDe(i.ate) >= mes).map((i) => i.servico))],
      mensal,
      fimContrato: fins.includes(null) ? null : (fins.sort().at(-1) ?? null),
      semPrazo: fins.includes(null),
      atrasadas: atraso.reduce((s, a) => s + a.n, 0),
      valorAtrasado: atraso.reduce((s, a) => s + a.valor, 0),
    };
  });
}

export type ClienteDaLista = Awaited<ReturnType<typeof listarClientesUrutau>>[number];

export async function obterClienteUrutau(db: BancoDeDados, id: string) {
  const [cliente] = await db.select().from(clientesUrutau).where(and(eq(clientesUrutau.id, id), isNull(clientesUrutau.excluidoEm))).limit(1);
  if (!cliente) return null;
  const executor = alias(usuarios, "executor");
  const lista = await db.select().from(contratos).where(eq(contratos.clienteId, id)).orderBy(desc(contratos.inicio));
  const ids = lista.map((c) => c.id);
  const [itens, listaCobrancas, empresa, ganhosDoCliente] = await Promise.all([
    ids.length
      ? db
          .select({ item: contratoItens, executor: executor.nome })
          .from(contratoItens)
          .leftJoin(executor, eq(executor.id, contratoItens.executorId))
          .where(inArray(contratoItens.contratoId, ids))
          .orderBy(asc(contratoItens.criadoEm))
      : [],
    ids.length ? db.select().from(cobrancas).where(inArray(cobrancas.contratoId, ids)).orderBy(desc(cobrancas.competencia)).limit(36) : [],
    cliente.empresaId ? db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).where(eq(empresas.id, cliente.empresaId)).limit(1) : [],
    ids.length
      ? db
          .select({ usuarioId: ganhos.usuarioId, nome: usuarios.nome, tipo: ganhos.tipo, total: sql<number>`sum(${ganhos.valorCentavos})::bigint`.mapWith(Number) })
          .from(ganhos)
          .innerJoin(cobrancas, eq(cobrancas.id, ganhos.cobrancaId))
          .innerJoin(usuarios, eq(usuarios.id, ganhos.usuarioId))
          .where(inArray(cobrancas.contratoId, ids))
          .groupBy(ganhos.usuarioId, usuarios.nome, ganhos.tipo)
      : [],
  ]);
  return { cliente, contratos: lista, itens: itens.map((i) => ({ ...i.item, executor: i.executor })), cobrancas: listaCobrancas, empresa: empresa[0] ?? null, ganhos: ganhosDoCliente };
}

export const paraCalculoDoContrato = paraCalculo;

// ─── Números da receita ──────────────────────────────────────────────────────

const custosNoMes = (mes: Mes) => {
  const { inicio, fim } = intervaloDoMes(mes);
  return and(
    isNull(custosUrutau.excluidoEm),
    or(
      and(eq(custosUrutau.recorrencia, "unico"), eq(custosUrutau.inicio, inicio)),
      and(eq(custosUrutau.recorrencia, "mensal"), lt(custosUrutau.inicio, fim), or(isNull(custosUrutau.fim), gte(custosUrutau.fim, inicio))),
    ),
  );
};

/**
 * Os números de um mês. Receita e comissões pelo dinheiro que entrou (data do pagamento);
 * custos pelo mês em que acontecem (custos da empresa + custo dos serviços cobrados no mês).
 */
export async function numerosDoMes(db: BancoDeDados, mes: Mes, p: Parametros) {
  const { inicio, fim } = intervaloDoMes(mes);
  const pagasNoMes = and(eq(cobrancas.status, "pago"), gte(cobrancas.pagoEm, inicio), lt(cobrancas.pagoEm, fim));
  const [[rec], [com], [custoEmpresa], [custoServicos], [fat]] = await Promise.all([
    db.select({ v: sql<number>`coalesce(sum(${cobrancas.valorPagoCentavos}), 0)::bigint`.mapWith(Number) }).from(cobrancas).where(pagasNoMes),
    db.select({ v: sql<number>`coalesce(sum(${ganhos.valorCentavos}), 0)::bigint`.mapWith(Number) }).from(ganhos).innerJoin(cobrancas, eq(cobrancas.id, ganhos.cobrancaId)).where(pagasNoMes),
    db.select({ v: sql<number>`coalesce(sum(${custosUrutau.valorCentavos}), 0)::bigint`.mapWith(Number) }).from(custosUrutau).where(custosNoMes(mes)),
    db
      .select({ v: sql<number>`coalesce(sum(${cobrancaItens.custoCentavos}), 0)::bigint`.mapWith(Number) })
      .from(cobrancaItens)
      .innerJoin(cobrancas, eq(cobrancas.id, cobrancaItens.cobrancaId))
      .where(and(eq(cobrancas.competencia, inicio), ne(cobrancas.status, "cancelada"))),
    db
      .select({ v: sql<number>`coalesce(sum(${cobrancas.valorCentavos}), 0)::bigint`.mapWith(Number) })
      .from(cobrancas)
      .where(and(eq(cobrancas.competencia, inicio), ne(cobrancas.status, "cancelada"))),
  ]);
  const custos = custoEmpresa.v + custoServicos.v;
  return { mes, faturado: fat.v, ...dividirEntreSocios(rec.v, com.v, custos, p.caixaPcm, p.diferencaPcm), custoEmpresa: custoEmpresa.v, custoServicos: custoServicos.v };
}

export type NumerosDoMes = Awaited<ReturnType<typeof numerosDoMes>>;

/** Receita recorrente, clientes ativos, cancelamentos do mês e contratos acabando. */
export async function recorrencia(db: BancoDeDados, mes: Mes) {
  const [lista, itens] = await Promise.all([db.select().from(contratos), db.select().from(contratoItens)]);
  const ativosNoMes = lista.filter((c) => c.status === "ativo" || (c.encerradoEm && mesDe(c.encerradoEm) >= mes));
  const mrr = ativosNoMes.reduce((s, c) => s + mensalidadeNoMes(paraCalculo(c), itens.filter((i) => i.contratoId === c.id), mes), 0);
  const mrrAnterior = lista.reduce((s, c) => s + mensalidadeNoMes(paraCalculo(c), itens.filter((i) => i.contratoId === c.id), somarMeses(mes, -1)), 0);
  const clientesAtivos = new Set(lista.filter((c) => c.status === "ativo").map((c) => c.clienteId)).size;
  const clientesInicioMes = new Set(lista.filter((c) => c.inicio < `${mes}-01` && (!c.encerradoEm || mesDe(c.encerradoEm) >= somarMeses(mes, -1))).map((c) => c.clienteId)).size;
  const saidas = lista.filter((c) => c.status !== "ativo" && c.encerradoEm && mesDe(c.encerradoEm) === mes).length;
  const vencendo = lista
    .filter((c) => c.status === "ativo")
    .map((c) => ({ c, fim: ultimoMesDoContrato(paraCalculo(c)) }))
    .filter((x) => x.fim && x.fim >= mes && x.fim <= somarMeses(mes, 3))
    .map((x) => ({ contratoId: x.c.id, clienteId: x.c.clienteId, fim: x.fim! }));
  return {
    mrr,
    mrrAnterior,
    clientesAtivos,
    ticketMedio: clientesAtivos ? Math.round(mrr / clientesAtivos) : 0,
    cancelamentos: saidas,
    churnPcm: clientesInicioMes ? Math.round((saidas / clientesInicioMes) * 100_000) : null,
    vencendo,
  };
}

/** Receita do mês (pela competência) por tipo de serviço, com custo direto e comissões. */
export async function receitaPorServico(db: BancoDeDados, mes: Mes) {
  const inicio = `${mes}-01`;
  return db
    .select({
      servico: contratoItens.servico,
      valor: sql<number>`coalesce(sum(${cobrancaItens.valorCentavos}), 0)::bigint`.mapWith(Number),
      custo: sql<number>`coalesce(sum(${cobrancaItens.custoCentavos}), 0)::bigint`.mapWith(Number),
      comissoes: sql<number>`coalesce(sum((select sum(g.valor_centavos) from ganhos g where g.cobranca_id = ${cobrancaItens.cobrancaId} and g.item_id = ${cobrancaItens.itemId})), 0)::bigint`.mapWith(Number),
    })
    .from(cobrancaItens)
    .innerJoin(cobrancas, eq(cobrancas.id, cobrancaItens.cobrancaId))
    .innerJoin(contratoItens, eq(contratoItens.id, cobrancaItens.itemId))
    .where(and(eq(cobrancas.competencia, inicio), ne(cobrancas.status, "cancelada")))
    .groupBy(contratoItens.servico)
    .orderBy(desc(sql`sum(${cobrancaItens.valorCentavos})`));
}

/** Margem de cada cliente nos últimos `meses` meses (pela competência). */
export async function margemPorCliente(db: BancoDeDados, mes: Mes, meses = 3) {
  const de = `${somarMeses(mes, -(meses - 1))}-01`;
  const ate = intervaloDoMes(mes).fim;
  return db
    .select({
      clienteId: clientesUrutau.id,
      nome: clientesUrutau.nome,
      faturado: sql<number>`coalesce(sum(${cobrancaItens.valorCentavos}), 0)::bigint`.mapWith(Number),
      custo: sql<number>`coalesce(sum(${cobrancaItens.custoCentavos}), 0)::bigint`.mapWith(Number),
      comissoes: sql<number>`coalesce(sum((select sum(g.valor_centavos) from ganhos g where g.cobranca_id = ${cobrancaItens.cobrancaId} and g.item_id = ${cobrancaItens.itemId})), 0)::bigint`.mapWith(Number),
    })
    .from(cobrancaItens)
    .innerJoin(cobrancas, eq(cobrancas.id, cobrancaItens.cobrancaId))
    .innerJoin(contratos, eq(contratos.id, cobrancas.contratoId))
    .innerJoin(clientesUrutau, eq(clientesUrutau.id, contratos.clienteId))
    .where(and(gte(cobrancas.competencia, de), lt(cobrancas.competencia, ate), ne(cobrancas.status, "cancelada")))
    .groupBy(clientesUrutau.id, clientesUrutau.nome)
    .orderBy(desc(sql`sum(${cobrancaItens.valorCentavos})`));
}

/** Cobranças vencidas e não pagas. */
export async function cobrancasAtrasadas(db: BancoDeDados, hoje: Data) {
  return db
    .select({ id: cobrancas.id, competencia: cobrancas.competencia, vencimento: cobrancas.vencimento, valor: cobrancas.valorCentavos, clienteId: clientesUrutau.id, cliente: clientesUrutau.nome })
    .from(cobrancas)
    .innerJoin(contratos, eq(contratos.id, cobrancas.contratoId))
    .innerJoin(clientesUrutau, eq(clientesUrutau.id, contratos.clienteId))
    .where(and(eq(cobrancas.status, "a_receber"), lt(cobrancas.vencimento, hoje)))
    .orderBy(asc(cobrancas.vencimento));
}

/** Cobranças do mês (para a lista "a receber" da Receita). */
export async function cobrancasDoMes(db: BancoDeDados, mes: Mes) {
  return db
    .select({ id: cobrancas.id, vencimento: cobrancas.vencimento, valor: cobrancas.valorCentavos, status: cobrancas.status, pagoEm: cobrancas.pagoEm, valorPago: cobrancas.valorPagoCentavos, clienteId: clientesUrutau.id, cliente: clientesUrutau.nome })
    .from(cobrancas)
    .innerJoin(contratos, eq(contratos.id, cobrancas.contratoId))
    .innerJoin(clientesUrutau, eq(clientesUrutau.id, contratos.clienteId))
    .where(eq(cobrancas.competencia, `${mes}-01`))
    .orderBy(asc(cobrancas.vencimento), asc(clientesUrutau.nome));
}

// ─── Custos ──────────────────────────────────────────────────────────────────

export async function listarCustos(db: BancoDeDados) {
  return db
    .select({ custo: custosUrutau, cliente: clientesUrutau.nome })
    .from(custosUrutau)
    .leftJoin(clientesUrutau, eq(clientesUrutau.id, custosUrutau.clienteId))
    .where(isNull(custosUrutau.excluidoEm))
    .orderBy(desc(custosUrutau.inicio), asc(custosUrutau.descricao));
}

// ─── Ganhos de cada pessoa ───────────────────────────────────────────────────

export async function extratoDeGanhos(db: BancoDeDados, usuarioId: string, limite = 200) {
  return db
    .select({
      id: ganhos.id,
      tipo: ganhos.tipo,
      base: ganhos.baseCentavos,
      pcm: ganhos.pcm,
      valor: ganhos.valorCentavos,
      status: ganhos.status,
      pagoEm: ganhos.pagoEm,
      competencia: cobrancas.competencia,
      clientePagouEm: cobrancas.pagoEm,
      servico: contratoItens.servico,
      descricao: contratoItens.descricao,
      clienteId: clientesUrutau.id,
      cliente: clientesUrutau.nome,
    })
    .from(ganhos)
    .innerJoin(cobrancas, eq(cobrancas.id, ganhos.cobrancaId))
    .innerJoin(contratoItens, eq(contratoItens.id, ganhos.itemId))
    .innerJoin(contratos, eq(contratos.id, cobrancas.contratoId))
    .innerJoin(clientesUrutau, eq(clientesUrutau.id, contratos.clienteId))
    .where(eq(ganhos.usuarioId, usuarioId))
    .orderBy(desc(cobrancas.pagoEm), asc(clientesUrutau.nome))
    .limit(limite);
}

export type LinhaDoExtrato = Awaited<ReturnType<typeof extratoDeGanhos>>[number];

/**
 * O que uma pessoa ganha: no mês (pelo dia em que o cliente pagou), a receber da Urutau,
 * já recebido, e quanto deve ganhar por mês com os contratos ativos (previsão).
 */
export async function resumoDeGanhos(db: BancoDeDados, usuarioId: string, mes: Mes) {
  const { inicio, fim } = intervaloDoMes(mes);
  const [[noMes], [totais], trouxe, executa, listaContratos, itens] = await Promise.all([
    db
      .select({ v: sql<number>`coalesce(sum(${ganhos.valorCentavos}), 0)::bigint`.mapWith(Number) })
      .from(ganhos)
      .innerJoin(cobrancas, eq(cobrancas.id, ganhos.cobrancaId))
      .where(and(eq(ganhos.usuarioId, usuarioId), gte(cobrancas.pagoEm, inicio), lt(cobrancas.pagoEm, fim))),
    db
      .select({
        aReceber: sql<number>`coalesce(sum(${ganhos.valorCentavos}) filter (where ${ganhos.status} = 'a_pagar'), 0)::bigint`.mapWith(Number),
        recebido: sql<number>`coalesce(sum(${ganhos.valorCentavos}) filter (where ${ganhos.status} = 'pago'), 0)::bigint`.mapWith(Number),
      })
      .from(ganhos)
      .where(eq(ganhos.usuarioId, usuarioId)),
    db.select({ id: clientesUrutau.id, nome: clientesUrutau.nome }).from(clientesUrutau).where(and(eq(clientesUrutau.quemTrouxeId, usuarioId), isNull(clientesUrutau.excluidoEm))),
    db.select().from(contratoItens).where(eq(contratoItens.executorId, usuarioId)),
    db.select().from(contratos).where(eq(contratos.status, "ativo")),
    db.select().from(contratoItens),
  ]);
  // Previsão do mês: o que os serviços ativos rendem a esta pessoa se todos pagarem.
  let previsto = 0;
  const trouxeIds = new Set(trouxe.map((t) => t.id));
  for (const c of listaContratos) {
    const calc = paraCalculo(c);
    for (const i of itens.filter((x) => x.contratoId === c.id)) {
      const valor = linhasDaCobranca(calc, [i], mes).total;
      if (!valor) continue;
      if (trouxeIds.has(c.clienteId)) previsto += Math.round((valor * i.trouxePcm) / 100_000);
      if (i.executorId === usuarioId && !i.executorAbriuMao) previsto += Math.round((valor * i.executorPcm) / 100_000);
    }
  }
  const executaAtivo = executa.filter((i) => listaContratos.some((c) => c.id === i.contratoId));
  return { noMes: noMes.v, aReceber: totais.aReceber, recebido: totais.recebido, previstoNoMes: previsto, clientesQueTrouxe: trouxe, servicosQueExecuta: executaAtivo.length };
}

/** Comissões a pagar, por pessoa (para o fechamento do mês). */
export async function comissoesAPagar(db: BancoDeDados) {
  return db
    .select({ usuarioId: ganhos.usuarioId, nome: usuarios.nome, socio: sql<boolean>`${usuarios.papelEquipe} = 'socio'`, total: sql<number>`sum(${ganhos.valorCentavos})::bigint`.mapWith(Number), n: sql<number>`count(*)::int` })
    .from(ganhos)
    .innerJoin(usuarios, eq(usuarios.id, ganhos.usuarioId))
    .where(eq(ganhos.status, "a_pagar"))
    .groupBy(ganhos.usuarioId, usuarios.nome, usuarios.papelEquipe)
    .orderBy(desc(sql`sum(${ganhos.valorCentavos})`));
}
