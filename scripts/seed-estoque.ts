/**
 * Estoque e caixa de exemplo na padaria: produtos com código de barras, granel e itens sem
 * controle (café coado), 45 dias de vendas no caixa com reposições, alguns produtos parados e
 * outros abaixo do mínimo, para o painel mostrar tudo funcionando.
 */
import { and, asc, eq } from "drizzle-orm";
import type { BancoDeDados } from "../src/db";
import { empresaModulos, fontesReceita, movimentosEstoque, produtos, vendaItens, vendas, type FormaPagamento, type Unidade } from "../src/db/schema";
import { type Data, hoje, somarDias } from "../src/lib/datas";
import { MIL, novoCustoMedio, totalDoItem } from "../src/lib/estoque";

/** EAN-13 válido a partir de 12 dígitos (prefixo 789 = Brasil). */
function ean(n: number) {
  const corpo = `789${String(n).padStart(9, "0")}`;
  const soma = [...corpo].reverse().reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return corpo + ((10 - (soma % 10)) % 10);
}

interface Modelo {
  nome: string;
  categoria: string;
  unidade?: Unidade;
  preco: number;
  custo: number;
  minimo: number;
  /** Quanto sai por dia, em unidades. 0 = parado. */
  giro: number;
  codigo?: boolean;
  semControle?: boolean;
  saldoFinal?: number;
}

const CATALOGO: Modelo[] = [
  { nome: "Pão francês", categoria: "Pães", unidade: "kg", preco: 1_690, custo: 620, minimo: 5, giro: 9 },
  { nome: "Pão de forma integral", categoria: "Pães", preco: 1_190, custo: 640, minimo: 6, giro: 2.2, codigo: true },
  { nome: "Pão de queijo", categoria: "Salgados", preco: 600, custo: 210, minimo: 30, giro: 38 },
  { nome: "Coxinha de frango", categoria: "Salgados", preco: 850, custo: 300, minimo: 20, giro: 22 },
  { nome: "Empada de palmito", categoria: "Salgados", preco: 900, custo: 340, minimo: 10, giro: 9 },
  { nome: "Bolo de fubá (fatia)", categoria: "Doces", preco: 900, custo: 260, minimo: 8, giro: 11 },
  { nome: "Brigadeiro gourmet", categoria: "Doces", preco: 450, custo: 140, minimo: 20, giro: 16 },
  { nome: "Torta de limão (fatia)", categoria: "Doces", preco: 1_400, custo: 480, minimo: 6, giro: 5 },
  { nome: "Café coado", categoria: "Cafeteria", preco: 800, custo: 120, minimo: 0, giro: 45, semControle: true },
  { nome: "Cappuccino", categoria: "Cafeteria", preco: 1_200, custo: 260, minimo: 0, giro: 14, semControle: true },
  { nome: "Suco de laranja 300ml", categoria: "Bebidas", preco: 1_000, custo: 320, minimo: 0, giro: 12, semControle: true },
  { nome: "Água mineral 500ml", categoria: "Bebidas", preco: 400, custo: 130, minimo: 24, giro: 14, codigo: true },
  { nome: "Refrigerante lata 350ml", categoria: "Bebidas", preco: 650, custo: 310, minimo: 24, giro: 11, codigo: true },
  { nome: "Achocolatado 200ml", categoria: "Bebidas", preco: 450, custo: 210, minimo: 12, giro: 4, codigo: true, saldoFinal: 7 },
  { nome: "Leite integral 1L", categoria: "Mercearia", preco: 649, custo: 455, minimo: 12, giro: 6, codigo: true, saldoFinal: 3 },
  { nome: "Manteiga 200g", categoria: "Mercearia", preco: 1_390, custo: 890, minimo: 6, giro: 2, codigo: true },
  { nome: "Café torrado 500g", categoria: "Mercearia", preco: 2_690, custo: 1_780, minimo: 6, giro: 1.6, codigo: true },
  { nome: "Requeijão cremoso 200g", categoria: "Mercearia", preco: 990, custo: 610, minimo: 6, giro: 1.8, codigo: true },
  { nome: "Queijo minas frescal", categoria: "Frios", unidade: "kg", preco: 4_590, custo: 2_850, minimo: 2, giro: 0.9 },
  { nome: "Presunto cozido", categoria: "Frios", unidade: "kg", preco: 3_990, custo: 2_390, minimo: 2, giro: 0.7 },
  { nome: "Geleia artesanal de goiaba", categoria: "Mercearia", preco: 2_200, custo: 1_100, minimo: 2, giro: 0, codigo: true, saldoFinal: 14 },
  { nome: "Panetone trufado 500g", categoria: "Doces", preco: 4_990, custo: 2_600, minimo: 0, giro: 0, codigo: true, saldoFinal: 9 },
  { nome: "Biscoito amanteigado 300g", categoria: "Doces", preco: 1_590, custo: 790, minimo: 4, giro: 0.4, codigo: true },
];

const FORMAS: FormaPagamento[] = ["pix", "pix", "pix", "debito", "debito", "credito", "dinheiro", "dinheiro"];

export async function semearEstoque(db: BancoDeDados, c: { padariaId: string; donoId: string }) {
  const empresaId = c.padariaId;
  await db.insert(empresaModulos).values({ empresaId, modulo: "estoque", ativo: true }).onConflictDoNothing();
  const [fonte] = await db
    .select({ id: fontesReceita.id })
    .from(fontesReceita)
    .where(and(eq(fontesReceita.empresaId, empresaId), eq(fontesReceita.ativo, true)))
    .orderBy(asc(fontesReceita.ordem))
    .limit(1);

  // Sorteio repetível: o painel fica igual a cada seed.
  let semente = 42;
  const sorte = () => ((semente = (semente * 16_807) % 2_147_483_647) - 1) / 2_147_483_646;

  const criados = await db
    .insert(produtos)
    .values(
      CATALOGO.map((m, i) => ({
        empresaId,
        nome: m.nome,
        categoria: m.categoria,
        unidade: m.unidade ?? "un",
        codigoBarras: m.codigo ? ean(100_200 + i * 37) : null,
        sku: `PAD-${String(i + 1).padStart(3, "0")}`,
        precoCentavos: m.preco,
        custoMedioCentavos: m.custo,
        minimoMil: m.minimo * MIL,
        controlaEstoque: !m.semControle,
        criadoPor: c.donoId,
      })),
    )
    .returning();

  const estado = criados.map((p, i) => ({ p, m: CATALOGO[i], saldo: 0, custo: CATALOGO[i].custo, ultimaVenda: null as Date | null }));
  const movs: (typeof movimentosEstoque.$inferInsert)[] = [];
  const listaVendas: (typeof vendas.$inferInsert)[] = [];
  const itens: (typeof vendaItens.$inferInsert)[] = [];
  const quando = (dia: Data, hora: number) => new Date(`${dia}T${String(hora).padStart(2, "0")}:${String(Math.floor(sorte() * 60)).padStart(2, "0")}:00-03:00`);

  const entrada = (e: (typeof estado)[number], qtdMil: number, dia: Data) => {
    const custoCompra = Math.round(e.m.custo * (0.95 + sorte() * 0.12));
    e.custo = novoCustoMedio(e.saldo, e.custo, qtdMil, custoCompra);
    e.saldo += qtdMil;
    movs.push({ empresaId, produtoId: e.p.id, tipo: "entrada", quantidadeMil: qtdMil, custoUnitarioCentavos: custoCompra, saldoAposMil: e.saldo, custoMedioAposCentavos: e.custo, observacao: "Fornecedor: Distribuidora Minas", usuarioId: c.donoId, criadoEm: quando(dia, 7) });
  };

  const inicio = somarDias(hoje(), -45);
  for (const e of estado) if (e.p.controlaEstoque) entrada(e, Math.max(e.m.minimo * 3, Math.ceil(e.m.giro * 12), e.m.saldoFinal ?? 0) * MIL, inicio);

  for (let d = -44; d <= 0; d++) {
    const dia = somarDias(hoje(), d);
    const nVendas = d === 0 ? 9 : 14 + Math.floor(sorte() * 10);
    for (let v = 0; v < nVendas; v++) {
      const escolhidos = new Map<number, number>();
      const qtdItens = 1 + Math.floor(sorte() * 3);
      for (let k = 0; k < qtdItens; k++) {
        // Escolha pesada pelo giro: o pão de queijo sai muito mais que a manteiga.
        const pesos = estado.map((e) => e.m.giro);
        let alvo = sorte() * pesos.reduce((s, x) => s + x, 0);
        const i = pesos.findIndex((w) => (alvo -= w) <= 0);
        const e = estado[i];
        const fracionada = e.m.unidade === "kg";
        const q = fracionada ? Math.round((0.2 + sorte() * 0.6) * 20) * 50 : (1 + Math.floor(sorte() * (e.m.giro > 10 ? 4 : 2))) * MIL;
        escolhidos.set(i, (escolhidos.get(i) ?? 0) + q);
      }
      const vendaId = crypto.randomUUID();
      // Hoje, só até a hora atual: venda no futuro confundiria o "há quanto tempo".
      const horaAgora = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" }).format(new Date()));
      const criadoEm = quando(dia, 7 + Math.floor(sorte() * (d === 0 ? Math.max(1, Math.min(12, horaAgora - 7)) : 12)));
      let total = 0;
      for (const [i, q] of escolhidos) {
        const e = estado[i];
        if (e.p.controlaEstoque && e.saldo - q < e.m.minimo * MIL * 0.5 && e.m.saldoFinal === undefined) entrada(e, Math.ceil(e.m.giro * 10 + e.m.minimo) * MIL, dia);
        const linha = totalDoItem(q, e.m.preco);
        total += linha;
        itens.push({ empresaId, vendaId, produtoId: e.p.id, descricao: e.m.nome, quantidadeMil: q, precoUnitarioCentavos: e.m.preco, totalCentavos: linha, custoUnitarioCentavos: e.custo });
        e.ultimaVenda = criadoEm;
        if (e.p.controlaEstoque) {
          e.saldo -= q;
          movs.push({ empresaId, produtoId: e.p.id, tipo: "venda", quantidadeMil: -q, saldoAposMil: e.saldo, custoMedioAposCentavos: e.custo, vendaId, usuarioId: c.donoId, criadoEm });
        }
      }
      const nomes = [...escolhidos.keys()].map((i) => estado[i].m.nome);
      listaVendas.push({
        id: vendaId,
        empresaId,
        data: dia,
        valorCentavos: total,
        descricao: `Caixa: ${nomes.length === 1 ? nomes[0] : `${nomes[0]} e mais ${nomes.length - 1} ${nomes.length === 2 ? "item" : "itens"}`}`,
        fonteReceitaId: fonte.id,
        formaPagamento: FORMAS[Math.floor(sorte() * FORMAS.length)],
        status: "recebido",
        dataRecebimento: dia,
        origem: "balcao",
        criadoPor: c.donoId,
        criadoEm,
      });
    }
  }

  // Produtos "de vitrine": parados há meses, ou acabando de propósito para o painel ter o que mostrar.
  for (const e of estado) {
    if (e.m.saldoFinal === undefined || !e.p.controlaEstoque) continue;
    const diferenca = e.m.saldoFinal * MIL - e.saldo;
    if (diferenca === 0) continue;
    e.saldo += diferenca;
    movs.push({ empresaId, produtoId: e.p.id, tipo: "ajuste", quantidadeMil: diferenca, saldoAposMil: e.saldo, custoMedioAposCentavos: e.custo, observacao: "Contagem de inventário", usuarioId: c.donoId, criadoEm: quando(somarDias(hoje(), -1), 19) });
  }

  for (let i = 0; i < listaVendas.length; i += 500) await db.insert(vendas).values(listaVendas.slice(i, i + 500));
  for (let i = 0; i < itens.length; i += 1000) await db.insert(vendaItens).values(itens.slice(i, i + 1000));
  for (let i = 0; i < movs.length; i += 1000) await db.insert(movimentosEstoque).values(movs.slice(i, i + 1000));
  for (const e of estado)
    await db.update(produtos).set({ saldoMil: e.saldo, custoMedioCentavos: e.custo, ultimaVendaEm: e.m.giro > 0 ? e.ultimaVenda : null }).where(eq(produtos.id, e.p.id));
  return { produtos: criados.length, vendas: listaVendas.length };
}
