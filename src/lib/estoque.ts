/**
 * Regras do estoque e do caixa que não dependem de banco: quantidades em milésimos, custo médio,
 * total do item, curva ABC, cobertura, sugestão de compra, código de barras e importação por CSV.
 */
import type { TipoMovimento, Unidade } from "@/db/schema";
import { lerCsv } from "@/lib/csv";
import { type Centavos, lerReais } from "@/lib/dinheiro";

export const MIL = 1000;

export const UNIDADES: Record<Unidade, { nome: string; curto: string; fracionada: boolean }> = {
  un: { nome: "Unidade", curto: "un", fracionada: false },
  kg: { nome: "Quilo", curto: "kg", fracionada: true },
  g: { nome: "Grama", curto: "g", fracionada: false },
  l: { nome: "Litro", curto: "L", fracionada: true },
  ml: { nome: "Mililitro", curto: "mL", fracionada: false },
  m: { nome: "Metro", curto: "m", fracionada: true },
  cx: { nome: "Caixa", curto: "cx", fracionada: false },
  pct: { nome: "Pacote", curto: "pct", fracionada: false },
};

export const NOME_MOVIMENTO: Record<TipoMovimento, string> = {
  entrada: "Entrada",
  venda: "Venda",
  devolucao: "Devolução",
  ajuste: "Ajuste de inventário",
  perda: "Perda",
  cancelamento: "Venda cancelada",
};

// ─── Quantidades ─────────────────────────────────────────────────────────────

/** "1,5" → 1500. Unidades inteiras (un, cx…) não aceitam fração. Devolve null se não der para ler. */
export function lerQuantidade(texto: string, unidade: Unidade = "un"): number | null {
  const t = texto.trim().replace(/\s/g, "");
  if (!/^-?\d{1,9}([.,]\d{1,3})?$/.test(t)) return null;
  const mil = Math.round(Number(t.replace(",", ".")) * MIL);
  if (!UNIDADES[unidade].fracionada && mil % MIL !== 0) return null;
  return mil;
}

const fmt3 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export function formatarQuantidade(mil: number, unidade: Unidade, comUnidade = true): string {
  const n = fmt3.format(mil / MIL);
  return comUnidade ? `${n} ${UNIDADES[unidade].curto}` : n;
}

// ─── Valores ─────────────────────────────────────────────────────────────────

/** Preço × quantidade − desconto, em centavos, nunca negativo. */
export function totalDoItem(quantidadeMil: number, precoCentavos: Centavos, descontoCentavos: Centavos = 0): Centavos {
  return Math.max(0, Math.round((quantidadeMil * precoCentavos) / MIL) - descontoCentavos);
}

/** Custo médio ponderado depois de uma entrada. Saldo negativo ou zerado não pesa: vale o custo novo. */
export function novoCustoMedio(saldoMil: number, custoMedio: Centavos, entradaMil: number, custoEntrada: Centavos): Centavos {
  if (saldoMil <= 0) return custoEntrada;
  return Math.round((saldoMil * custoMedio + entradaMil * custoEntrada) / (saldoMil + entradaMil));
}

export const valorEmEstoque = (saldoMil: number, custoCentavos: Centavos): Centavos => Math.round((Math.max(0, saldoMil) * custoCentavos) / MIL);

/** Margem sobre o preço de venda, em % (null sem preço). */
export function margem(precoCentavos: Centavos, custoCentavos: Centavos): number | null {
  if (precoCentavos <= 0) return null;
  return Math.round(((precoCentavos - custoCentavos) / precoCentavos) * 1000) / 10;
}

export function troco(pagoCentavos: Centavos, totalCentavos: Centavos): Centavos | null {
  return pagoCentavos >= totalCentavos ? pagoCentavos - totalCentavos : null;
}

/** A quantidade cabe na unidade? "un", "cx", "pct"… não vendem meia unidade. */
export const quantidadeCabe = (quantidadeMil: number, unidade: Unidade) => Number.isSafeInteger(quantidadeMil) && (UNIDADES[unidade].fracionada || quantidadeMil % MIL === 0);

/** Custo de uma quantidade, arredondado como o total do item (meio centavo sobe). */
export const custoDaQuantidade = (quantidadeMil: number, custoUnitarioCentavos: Centavos): Centavos => Math.round((quantidadeMil * custoUnitarioCentavos) / MIL);

/**
 * Reparte o desconto da venda inteira entre os itens, na proporção de cada um, em centavos
 * inteiros: os centavos que sobram do arredondamento vão para os maiores restos. A soma das
 * partes é sempre o desconto, e nenhum item fica com parte maior que o próprio total.
 */
export function ratearDesconto(totais: Centavos[], descontoCentavos: Centavos): Centavos[] {
  const soma = totais.reduce((s, t) => s + t, 0);
  const desconto = Math.min(Math.max(0, descontoCentavos), soma);
  if (!desconto || !soma) return totais.map(() => 0);
  const partes = totais.map((t, i) => {
    const exato = BigInt(t) * BigInt(desconto);
    return { i, base: Number(exato / BigInt(soma)), resto: Number(exato % BigInt(soma)) };
  });
  let falta = desconto - partes.reduce((s, p) => s + p.base, 0);
  for (const p of [...partes].sort((a, b) => b.resto - a.resto || a.i - b.i)) {
    if (falta <= 0) break;
    if (p.base < totais[p.i]) {
      p.base++;
      falta--;
    }
  }
  return partes.map((p) => p.base);
}

// ─── Situação, giro e compra ─────────────────────────────────────────────────

export type Situacao = "negativo" | "sem_estoque" | "abaixo_minimo" | "ok" | "sem_controle";

export const NOME_SITUACAO: Record<Situacao, string> = {
  negativo: "Saldo negativo",
  sem_estoque: "Sem estoque",
  abaixo_minimo: "Abaixo do mínimo",
  ok: "Em estoque",
  sem_controle: "Sem controle de estoque",
};

export function situacao(p: { saldoMil: number; minimoMil: number; controlaEstoque: boolean }): Situacao {
  if (!p.controlaEstoque) return "sem_controle";
  if (p.saldoMil < 0) return "negativo";
  if (p.saldoMil === 0) return "sem_estoque";
  if (p.minimoMil > 0 && p.saldoMil <= p.minimoMil) return "abaixo_minimo";
  return "ok";
}

/** Quantos dias o saldo dura no ritmo de venda do período (null sem vendas). */
export function coberturaEmDias(saldoMil: number, vendidoMil: number, dias: number): number | null {
  if (vendidoMil <= 0) return null;
  return Math.max(0, Math.floor(saldoMil / (vendidoMil / dias)));
}

/**
 * Quanto comprar para cobrir `diasAlvo` no ritmo dos últimos 30 dias, sem ficar abaixo do mínimo.
 * Unidades inteiras arredondam para cima.
 */
export function sugestaoDeCompra(p: { saldoMil: number; minimoMil: number; vendido30dMil: number; unidade: Unidade }, diasAlvo = 30): number {
  const alvo = Math.max(p.minimoMil * 2, Math.ceil((p.vendido30dMil / 30) * diasAlvo));
  const falta = Math.max(0, alvo - Math.max(0, p.saldoMil));
  if (falta === 0) return 0;
  return UNIDADES[p.unidade].fracionada ? falta : Math.ceil(falta / MIL) * MIL;
}

/** Curva ABC pela receita: A soma os primeiros 80%, B até 95%, C o resto (e quem não vendeu). */
export function curvaABC(itens: { id: string; receita: number }[]): Map<string, "A" | "B" | "C"> {
  const total = itens.reduce((s, i) => s + Math.max(0, i.receita), 0);
  const classes = new Map<string, "A" | "B" | "C">();
  let acumulado = 0;
  for (const i of [...itens].sort((a, b) => b.receita - a.receita)) {
    if (i.receita <= 0 || total === 0) {
      classes.set(i.id, "C");
      continue;
    }
    const antes = acumulado / total;
    acumulado += i.receita;
    classes.set(i.id, antes < 0.8 ? "A" : antes < 0.95 ? "B" : "C");
  }
  return classes;
}

// ─── Código de barras ────────────────────────────────────────────────────────

/** EAN-8, UPC-A (12), EAN-13 e GTIN-14 com dígito verificador certo. */
export function eanValido(codigo: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(codigo)) return false;
  const d = [...codigo].map(Number);
  const verificador = d.pop()!;
  const soma = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === verificador;
}

/** Limpa o que o leitor mandou: leitores USB às vezes colam espaço ou quebra no fim. */
export const limparCodigo = (c: string) => c.trim().replace(/\s+/g, "");

// ─── Importação por CSV ──────────────────────────────────────────────────────

/**
 * Uma linha da planilha. Campo `undefined` = a coluna não veio ou a célula está vazia: na
 * atualização ele fica como está (zero só quando a planilha diz zero).
 */
export interface ProdutoImportado {
  nome: string;
  sku: string | null;
  codigoBarras: string | null;
  categoria?: string;
  unidade?: Unidade;
  precoCentavos?: Centavos;
  custoCentavos?: Centavos;
  saldoMil?: number;
  minimoMil?: number;
}

const sem = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const COLUNAS: Record<keyof ProdutoImportado, string[]> = {
  nome: ["nome", "produto", "descricao", "descricao do produto", "item"],
  sku: ["sku", "codigo interno", "codigo", "ref", "referencia"],
  codigoBarras: ["codigo de barras", "ean", "gtin", "barras", "cod barras", "codigo barras"],
  categoria: ["categoria", "grupo", "departamento", "secao"],
  unidade: ["unidade", "un", "und", "medida"],
  precoCentavos: ["preco", "preco de venda", "valor", "valor de venda", "preco venda", "venda"],
  custoCentavos: ["custo", "preco de custo", "valor de custo", "custo unitario"],
  saldoMil: ["estoque", "saldo", "quantidade", "qtd", "estoque atual"],
  minimoMil: ["minimo", "estoque minimo", "qtd minima"],
};

const UNIDADE_POR_TEXTO: Record<string, Unidade> = { un: "un", und: "un", unid: "un", unidade: "un", pc: "un", kg: "kg", quilo: "kg", g: "g", gr: "g", l: "l", lt: "l", litro: "l", ml: "ml", m: "m", metro: "m", cx: "cx", caixa: "cx", pct: "pct", pacote: "pct" };

/** Lê a planilha exportada de outro sistema: reconhece os nomes de coluna mais comuns. */
export function produtosDoCsv(conteudo: string): { produtos: ProdutoImportado[]; erros: { linha: number; motivo: string }[]; colunas: string[] } {
  const linhas = lerCsv(conteudo);
  const [cabecalho = [], ...dados] = linhas;
  const indice = Object.fromEntries(
    (Object.keys(COLUNAS) as (keyof ProdutoImportado)[]).map((k) => {
      const i = cabecalho.findIndex((c) => COLUNAS[k].includes(sem(c)));
      return [k, i];
    }),
  ) as Record<keyof ProdutoImportado, number>;
  const erros: { linha: number; motivo: string }[] = [];
  if (indice.nome < 0) return { produtos: [], erros: [{ linha: 1, motivo: "Não achei a coluna com o nome do produto (nome, produto ou descrição)." }], colunas: cabecalho };
  const valor = (l: string[], k: keyof ProdutoImportado) => (indice[k] >= 0 ? (l[indice[k]] ?? "").trim() : "");
  const produtos: ProdutoImportado[] = [];
  dados.forEach((l, i) => {
    const n = i + 2;
    const nome = valor(l, "nome");
    if (!nome) return erros.push({ linha: n, motivo: "sem nome" });
    const textoUnidade = valor(l, "unidade");
    const unidade = textoUnidade ? UNIDADE_POR_TEXTO[sem(textoUnidade)] : undefined;
    if (textoUnidade && !unidade) return erros.push({ linha: n, motivo: `unidade "${textoUnidade}" desconhecida em "${nome}"` });
    // Sem coluna/célula: undefined (não mexe). Com valor: precisa ser lido e não negativo.
    const dinheiro = (k: keyof ProdutoImportado): Centavos | undefined | null => {
      const v = valor(l, k);
      if (!v) return undefined;
      const c = lerReais(v.replace(/^R\$\s*/i, ""));
      return c === null || c < 0 ? null : c;
    };
    const quantidade = (k: keyof ProdutoImportado): number | undefined | null => {
      const v = valor(l, k);
      if (!v) return undefined;
      // Sem a coluna unidade, a fração é conferida no servidor contra a unidade do cadastro.
      const q = lerQuantidade(v, unidade ?? "kg");
      return q === null || q < 0 ? null : q;
    };
    const preco = dinheiro("precoCentavos");
    const custo = dinheiro("custoCentavos");
    const saldo = quantidade("saldoMil");
    const minimo = quantidade("minimoMil");
    if (preco === null || custo === null) return erros.push({ linha: n, motivo: `valor inválido ou negativo em "${nome}"` });
    if (saldo === null || minimo === null)
      return erros.push({ linha: n, motivo: `quantidade inválida em "${nome}"${unidade && !UNIDADES[unidade].fracionada ? " (esta unidade não aceita fração)" : ""}` });
    const codigo = limparCodigo(valor(l, "codigoBarras")).replace(/\.0+$/, "");
    const categoria = valor(l, "categoria").slice(0, 60);
    produtos.push({
      nome: nome.slice(0, 200),
      sku: valor(l, "sku").slice(0, 60) || null,
      codigoBarras: codigo || null,
      categoria: categoria || undefined,
      unidade,
      precoCentavos: preco,
      custoCentavos: custo,
      saldoMil: saldo,
      minimoMil: minimo,
    });
  });
  return { produtos, erros, colunas: cabecalho };
}
