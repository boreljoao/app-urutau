/**
 * Receita de exemplo (Fase 8): sócios e equipe, clientes da Urutau com contratos começando há
 * alguns meses, pagamentos (com atrasos), custos da empresa e um repasse já feito.
 * Tudo fictício; só para o banco local.
 */
import { eq } from "drizzle-orm";
import type { BancoDeDados } from "../src/db";
import { clientesUrutau, cobrancas, contratoItens, contratos, custosUrutau, empresas, ganhos, leads, parametrosCentral, usuarios } from "../src/db/schema";
import { mesAtual, somarDias, somarMeses } from "../src/lib/datas";
import { gerarCobrancas, lerParametros, lerRegras, registrarPagamento } from "../src/lib/servidor/receita";

type Usuario = typeof usuarios.$inferSelect;

export async function semearReceita(db: BancoDeDados, equipe: Usuario[], senhaHash: string) {
  const [gabriel, borel, vinicius, wanderley] = equipe;
  const [matheus] = await db
    .insert(usuarios)
    .values({ nome: "Matheus", email: "matheus@urutau.dev", senhaHash, superadmin: true, vistoEm: new Date(Date.now() - 3 * 3_600_000) })
    .returning();
  await db.update(usuarios).set({ papelEquipe: "socio" }).where(eq(usuarios.id, gabriel.id));
  await db.update(usuarios).set({ papelEquipe: "socio" }).where(eq(usuarios.id, borel.id));
  await db.insert(parametrosCentral).values({ chave: "socio_maior_id", valor: gabriel.id }).onConflictDoUpdate({ target: parametrosCentral.chave, set: { valor: gabriel.id } });

  const regras = await lerRegras(db);
  const p = await lerParametros(db);
  const mes = mesAtual();
  const m = (n: number) => `${somarMeses(mes, n)}-01`;
  const [lume] = await db.select({ id: leads.id }).from(leads).where(eq(leads.nome, "Studio Lume")).limit(1);

  type Item = { servico: keyof typeof regras; recorrencia: "mensal" | "unico"; valor: number; custo?: number; executor?: Usuario | null; abriuMao?: boolean; descricao?: string; inicio?: string };
  async function cliente(nome: string, dados: Partial<typeof clientesUrutau.$inferInsert>, contrato: Partial<typeof contratos.$inferInsert> & { inicio: string }, itens: Item[]) {
    const [c] = await db.insert(clientesUrutau).values({ nome, ...dados, criadoPor: borel.id }).returning({ id: clientesUrutau.id });
    const [k] = await db.insert(contratos).values({ clienteId: c.id, criadoPor: borel.id, ...contrato }).returning({ id: contratos.id });
    await db.insert(contratoItens).values(
      itens.map((i) => ({
        contratoId: k.id,
        servico: i.servico,
        descricao: i.descricao ?? "",
        recorrencia: i.recorrencia,
        valorCentavos: i.valor,
        custoCentavos: i.custo ?? 0,
        executorId: i.executor?.id ?? null,
        executorPcm: i.executor ? regras[i.servico] : 0,
        executorAbriuMao: i.abriuMao ?? false,
        trouxePcm: p.trouxePcm,
        inicio: i.inicio ?? null,
      })),
    );
    return { clienteId: c.id, contratoId: k.id };
  }

  const urutauVeiculos = await cliente(
    "Urutau Veículos",
    { ramo: "Revenda de veículos", cidade: "Maricá", contato: "Marina Souza", quemTrouxeId: gabriel.id },
    { inicio: m(-5), meses: 12, descontoPcm: 10_000, descontoMeses: 3, multaTipo: "percentual_restante", multaValor: 30_000 },
    [
      { servico: "sistema", recorrencia: "mensal", valor: 90_000, custo: 5_000, executor: borel, abriuMao: true, descricao: "Sistema de gestão + caixa de conferência" },
      { servico: "trafego", recorrencia: "mensal", valor: 120_000, executor: vinicius, descricao: "Meta Ads e Google, verba do cliente" },
      { servico: "reels", recorrencia: "mensal", valor: 80_000, executor: matheus, descricao: "8 reels por mês" },
      { servico: "site", recorrencia: "unico", valor: 250_000, custo: 15_000, executor: borel, descricao: "Site com estoque de veículos" },
    ],
  );
  await cliente(
    "Studio Lume",
    { ramo: "Estúdio de design", cidade: "Rio de Janeiro", contato: "Rafa", quemTrouxeId: vinicius.id, leadId: lume?.id ?? null },
    { inicio: m(-2), meses: 6 },
    [
      { servico: "gestao", recorrencia: "mensal", valor: 150_000, executor: gabriel, descricao: "Gestão e indicadores" },
      { servico: "automacao", recorrencia: "unico", valor: 250_000, executor: borel, descricao: "Onboarding automático" },
    ],
  );
  const padaria = await cliente(
    "Padaria e Café Urutau",
    { ramo: "Padaria", cidade: "Belo Horizonte", contato: "Joana", quemTrouxeId: wanderley.id },
    { inicio: m(-4), meses: null },
    [
      { servico: "post", recorrencia: "mensal", valor: 60_000, executor: wanderley, descricao: "12 posts por mês" },
      { servico: "trafego", recorrencia: "mensal", valor: 70_000, executor: vinicius, inicio: m(-2) },
    ],
  );
  const betania = await cliente(
    "Betânia Serafim Semijoias",
    { ramo: "Loja de semijoias", cidade: "Maricá", faturamentoInformadoCentavos: 1_800_000 },
    { inicio: m(-3), meses: 12, multaTipo: "valor", multaValor: 50_000 },
    [
      { servico: "site", recorrencia: "unico", valor: 350_000, custo: 20_000, executor: borel, descricao: "Loja virtual" },
      { servico: "criativo", recorrencia: "mensal", valor: 45_000, executor: matheus, descricao: "Criativos para anúncios" },
    ],
  );
  // Um cliente que saiu: tráfego por 3 meses e cancelou.
  await cliente("Ótica Visão", { ramo: "Ótica", cidade: "Niterói", quemTrouxeId: vinicius.id }, { inicio: m(-4), meses: 6, status: "cancelado", encerradoEm: m(-2), motivoEncerramento: "Cortou custos" }, [
    { servico: "trafego", recorrencia: "mensal", valor: 90_000, executor: vinicius },
  ]);

  // Liga a revenda ao sistema (empresa de exemplo com o mesmo nome).
  const [empresa] = await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.nome, "Urutau Veículos")).limit(1);
  if (empresa) await db.update(clientesUrutau).set({ empresaId: empresa.id }).where(eq(clientesUrutau.id, urutauVeiculos.clienteId));

  await gerarCobrancas(db, mes);

  // Paga tudo dos meses passados, menos: a padaria atrasou o mês passado; neste mês só a revenda pagou.
  const todas = await db.select().from(cobrancas);
  for (const c of todas) {
    const doMes = c.competencia === m(0);
    const padariaAtrasou = c.contratoId === padaria.contratoId && c.competencia === m(-1);
    if (padariaAtrasou) continue;
    if (doMes && c.contratoId !== urutauVeiculos.contratoId) continue;
    await registrarPagamento(db, c.id, somarDias(c.vencimento, c.contratoId === betania.contratoId ? 3 : 0));
  }
  // Repasse feito até o mês retrasado.
  const antigos = await db.select({ id: ganhos.id, competencia: cobrancas.competencia }).from(ganhos).innerJoin(cobrancas, eq(cobrancas.id, ganhos.cobrancaId));
  for (const g of antigos.filter((x) => x.competencia <= m(-2))) await db.update(ganhos).set({ status: "pago", pagoEm: `${somarMeses(mes, -1)}-05` }).where(eq(ganhos.id, g.id));

  await db.insert(custosUrutau).values([
    { descricao: "DAS do MEI", categoria: "imposto", valorCentavos: 8_100, recorrencia: "mensal", inicio: m(-6), criadoPor: borel.id },
    { descricao: "Claude (assinatura)", categoria: "ferramenta", valorCentavos: 55_000, recorrencia: "mensal", inicio: m(-6), criadoPor: borel.id },
    { descricao: "Vercel Pro", categoria: "ferramenta", valorCentavos: 11_000, recorrencia: "mensal", inicio: m(0), criadoPor: borel.id },
    { descricao: "Canva Pro", categoria: "ferramenta", valorCentavos: 3_500, recorrencia: "mensal", inicio: m(-6), criadoPor: gabriel.id },
    { descricao: "Domínio urutau.io", categoria: "estrutura", valorCentavos: 18_000, recorrencia: "unico", inicio: m(-1), criadoPor: borel.id },
    { descricao: "Freelancer de edição (Betânia)", categoria: "freelancer", valorCentavos: 40_000, recorrencia: "unico", inicio: m(-3), clienteId: betania.clienteId, criadoPor: gabriel.id },
  ]);
  return { matheus };
}
