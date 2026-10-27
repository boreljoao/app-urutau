import { describe, expect, it } from "vitest";
import {
  coberturaEmDias,
  curvaABC,
  eanValido,
  formatarQuantidade,
  lerQuantidade,
  margem,
  novoCustoMedio,
  produtosDoCsv,
  situacao,
  sugestaoDeCompra,
  totalDoItem,
  troco,
  valorEmEstoque,
} from "@/lib/estoque";

describe("quantidades", () => {
  it("lê com vírgula ou ponto, em milésimos, e recusa fração em unidade inteira", () => {
    expect(lerQuantidade("1,5", "kg")).toBe(1_500);
    expect(lerQuantidade("0.250", "kg")).toBe(250);
    expect(lerQuantidade("3", "un")).toBe(3_000);
    expect(lerQuantidade("1,5", "un")).toBeNull();
    expect(lerQuantidade("abc")).toBeNull();
    expect(formatarQuantidade(1_250, "kg")).toBe("1,25 kg");
    expect(formatarQuantidade(12_000, "un")).toBe("12 un");
  });
});

describe("valores", () => {
  it("total do item com granel e desconto", () => {
    expect(totalDoItem(1_250, 4_590)).toBe(5_738); // 1,25 kg × R$ 45,90 = R$ 57,375 → 57,38
    expect(totalDoItem(3_000, 600, 200)).toBe(1_600);
    expect(totalDoItem(1_000, 500, 900)).toBe(0);
  });

  it("custo médio ponderado e valor do estoque", () => {
    expect(novoCustoMedio(10_000, 400, 10_000, 600)).toBe(500);
    expect(novoCustoMedio(-2_000, 400, 5_000, 700)).toBe(700);
    expect(valorEmEstoque(2_500, 1_000)).toBe(2_500);
    expect(valorEmEstoque(-1_000, 1_000)).toBe(0);
    expect(margem(1_000, 600)).toBe(40);
    expect(margem(0, 600)).toBeNull();
    expect(troco(5_000, 3_250)).toBe(1_750);
    expect(troco(1_000, 3_250)).toBeNull();
  });
});

describe("situação, cobertura e compra", () => {
  it("classifica o saldo", () => {
    expect(situacao({ saldoMil: -1_000, minimoMil: 0, controlaEstoque: true })).toBe("negativo");
    expect(situacao({ saldoMil: 0, minimoMil: 0, controlaEstoque: true })).toBe("sem_estoque");
    expect(situacao({ saldoMil: 4_000, minimoMil: 5_000, controlaEstoque: true })).toBe("abaixo_minimo");
    expect(situacao({ saldoMil: 9_000, minimoMil: 5_000, controlaEstoque: true })).toBe("ok");
    expect(situacao({ saldoMil: 0, minimoMil: 0, controlaEstoque: false })).toBe("sem_controle");
  });

  it("cobertura e sugestão de compra no ritmo do mês", () => {
    expect(coberturaEmDias(10_000, 30_000, 30)).toBe(10);
    expect(coberturaEmDias(10_000, 0, 30)).toBeNull();
    // vende 1 por dia: para 30 dias precisa de 30, tem 10 → comprar 20
    expect(sugestaoDeCompra({ saldoMil: 10_000, minimoMil: 5_000, vendido30dMil: 30_000, unidade: "un" })).toBe(20_000);
    // sem venda, só repõe até o dobro do mínimo
    expect(sugestaoDeCompra({ saldoMil: 2_000, minimoMil: 5_000, vendido30dMil: 0, unidade: "un" })).toBe(8_000);
    expect(sugestaoDeCompra({ saldoMil: 1_500, minimoMil: 1_000, vendido30dMil: 3_300, unidade: "un" })).toBe(2_000);
    expect(sugestaoDeCompra({ saldoMil: 50_000, minimoMil: 5_000, vendido30dMil: 3_000, unidade: "un" })).toBe(0);
  });

  it("curva ABC pela receita", () => {
    const c = curvaABC([
      { id: "a", receita: 7_000 },
      { id: "b", receita: 2_000 },
      { id: "c", receita: 600 },
      { id: "d", receita: 400 },
      { id: "e", receita: 0 },
    ]);
    expect(Object.fromEntries(c)).toEqual({ a: "A", b: "A", c: "B", d: "C", e: "C" });
  });
});

describe("código de barras", () => {
  it("confere o dígito verificador", () => {
    expect(eanValido("7891000315507")).toBe(true);
    expect(eanValido("7891000315508")).toBe(false);
    expect(eanValido("96385074")).toBe(true);
    expect(eanValido("123")).toBe(false);
  });
});

describe("importação por CSV", () => {
  it("reconhece colunas de outros sistemas, reais e granel", () => {
    const csv = [
      "Descrição;Código de barras;Unidade;Preço de venda;Custo;Estoque;Estoque mínimo;Categoria",
      "Pão de queijo;7891000315507;UN;R$ 6,00;2,40;30;10;Salgados",
      "Queijo minas;;KG;45,90;28,50;3,250;1;Frios",
      ";;UN;1;1;1;1;",
      "Bolo;;UN;abc;1;1;1;",
    ].join("\n");
    const r = produtosDoCsv(csv);
    expect(r.produtos).toEqual([
      { nome: "Pão de queijo", sku: null, codigoBarras: "7891000315507", categoria: "Salgados", unidade: "un", precoCentavos: 600, custoCentavos: 240, saldoMil: 30_000, minimoMil: 10_000 },
      { nome: "Queijo minas", sku: null, codigoBarras: null, categoria: "Frios", unidade: "kg", precoCentavos: 4_590, custoCentavos: 2_850, saldoMil: 3_250, minimoMil: 1_000 },
    ]);
    expect(r.erros).toEqual([
      { linha: 4, motivo: "sem nome" },
      { linha: 5, motivo: 'valor inválido em "Bolo"' },
    ]);
  });

  it("sem coluna de nome, avisa", () => {
    expect(produtosDoCsv("sku,preco\n1,2").erros[0].motivo).toContain("nome do produto");
  });
});
