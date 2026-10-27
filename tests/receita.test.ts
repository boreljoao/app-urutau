import { describe, expect, it } from "vitest";
import {
  type ContratoParaCalculo,
  type ItemParaCalculo,
  dividirEntreSocios,
  itemNoMes,
  linhasDaCobranca,
  mensalidadeNoMes,
  mesesACobrar,
  multaDeRescisao,
  repartirPagamento,
  ultimoMesDoContrato,
  valorPorDia,
} from "@/lib/receita";

const contrato = (extra: Partial<ContratoParaCalculo> = {}): ContratoParaCalculo => ({ inicio: "2026-08-01", meses: 6, descontoPcm: 0, descontoMeses: null, encerradoEm: null, ...extra });
const item = (extra: Partial<ItemParaCalculo> = {}): ItemParaCalculo => ({
  id: "i1",
  recorrencia: "mensal",
  valorCentavos: 100_000,
  custoCentavos: 0,
  inicio: null,
  ate: null,
  executorId: null,
  executorPcm: 0,
  executorAbriuMao: false,
  trouxePcm: 10_000,
  ...extra,
});

describe("o que o contrato cobra em cada mês", () => {
  it("6 meses a partir de agosto vão até janeiro", () => {
    expect(ultimoMesDoContrato(contrato())).toBe("2027-01");
    expect(mesesACobrar(contrato(), "2026-10")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(mesesACobrar(contrato(), "2027-05")).toHaveLength(6);
    expect(ultimoMesDoContrato(contrato({ meses: null }))).toBeNull();
  });

  it("encerrado antes do prazo para de cobrar no mês do encerramento", () => {
    expect(mesesACobrar(contrato({ encerradoEm: "2026-09-01" }), "2026-12")).toEqual(["2026-08", "2026-09"]);
  });

  it("desconto só nos primeiros meses", () => {
    const c = contrato({ descontoPcm: 20_000, descontoMeses: 2 });
    expect(itemNoMes(c, item(), "2026-08")?.valor).toBe(80_000);
    expect(itemNoMes(c, item(), "2026-09")?.valor).toBe(80_000);
    expect(itemNoMes(c, item(), "2026-10")?.valor).toBe(100_000);
    expect(itemNoMes(contrato({ descontoPcm: 10_000 }), item(), "2026-12")?.valor).toBe(90_000);
  });

  it("projeto único entra só no mês dele; serviço acrescentado depois começa no seu mês", () => {
    const site = item({ id: "site", recorrencia: "unico", valorCentavos: 300_000 });
    const trafego = item({ id: "tr", inicio: "2026-10-01" });
    const ago = linhasDaCobranca(contrato(), [site, trafego], "2026-08");
    expect(ago).toEqual({ linhas: [{ itemId: "site", valor: 300_000, custo: 0 }], total: 300_000 });
    expect(linhasDaCobranca(contrato(), [site, trafego], "2026-10").total).toBe(100_000);
    expect(itemNoMes(contrato(), item({ ate: "2026-09-01" }), "2026-10")).toBeNull();
    expect(mensalidadeNoMes(contrato(), [site, trafego], "2026-11")).toBe(100_000);
  });
});

describe("pagamento vira comissão", () => {
  const regras = [
    { id: "site", executorId: "vinicius", executorPcm: 30_000, executorAbriuMao: false, trouxePcm: 10_000 },
    { id: "trafego", executorId: "vinicius", executorPcm: 35_000, executorAbriuMao: false, trouxePcm: 10_000 },
  ];

  it("site do Vinícius trazido pelo Wanderley: 30% para ele, 10% para quem trouxe", () => {
    const g = repartirPagamento([{ itemId: "site", valor: 100_000 }], regras, "wanderley", 100_000, 100_000);
    expect(g).toEqual([
      { itemId: "site", usuarioId: "wanderley", tipo: "trouxe", base: 100_000, pcm: 10_000, valor: 10_000 },
      { itemId: "site", usuarioId: "vinicius", tipo: "execucao", base: 100_000, pcm: 30_000, valor: 30_000 },
    ]);
  });

  it("quem trouxe e executou leva as duas partes (tráfego: 35 + 10 = 45%)", () => {
    const g = repartirPagamento([{ itemId: "trafego", valor: 100_000 }], regras, "vinicius", 100_000, 100_000);
    expect(g.reduce((s, x) => s + x.valor, 0)).toBe(45_000);
  });

  it("veio sozinho: os 10% ficam no bolo; sócio que abriu mão: a execução também", () => {
    expect(repartirPagamento([{ itemId: "site", valor: 100_000 }], regras, null, 100_000, 100_000).map((g) => g.tipo)).toEqual(["execucao"]);
    const abriuMao = [{ ...regras[0], executorId: "borel", executorAbriuMao: true }];
    expect(repartirPagamento([{ itemId: "site", valor: 100_000 }], abriuMao, null, 100_000, 100_000)).toEqual([]);
  });

  it("pagamento parcial reparte na mesma proporção; sem pagamento não há comissão", () => {
    const linhas = [
      { itemId: "site", valor: 60_000 },
      { itemId: "trafego", valor: 40_000 },
    ];
    const g = repartirPagamento(linhas, regras, null, 50_000, 100_000);
    expect(g.map((x) => x.base)).toEqual([30_000, 20_000]);
    expect(repartirPagamento(linhas, regras, null, 0, 100_000)).toEqual([]);
  });
});

describe("divisão teórica dos sócios", () => {
  it("o exemplo combinado: sobrou 70% → 37,5 e 32,5", () => {
    expect(dividirEntreSocios(100_000, 30_000, 0, 0, 5_000)).toMatchObject({ sobra: 70_000, socioMaior: 37_500, socioMenor: 32_500 });
  });

  it("custos e reserva de caixa saem antes; a soma sempre fecha", () => {
    const d = dividirEntreSocios(100_000, 40_000, 8_000, 10_000, 5_000);
    expect(d).toMatchObject({ sobra: 52_000, caixa: 10_000, paraSocios: 42_000, socioMaior: 23_500, socioMenor: 18_500 });
    expect(d.caixa + d.socioMaior + d.socioMenor + d.comissoes + d.custos).toBe(d.receita);
  });

  it("mês no vermelho não separa caixa", () => {
    expect(dividirEntreSocios(10_000, 3_000, 20_000, 10_000, 0)).toMatchObject({ sobra: -13_000, caixa: 0, paraSocios: -13_000 });
  });
});

describe("âncora e multa", () => {
  it("R$ 1.500 por mês = R$ 50 por dia", () => {
    expect(valorPorDia(150_000)).toBe(5_000);
  });

  it("multa fixa ou percentual do que falta", () => {
    expect(multaDeRescisao("valor", 50_000, 100_000, 4)).toBe(50_000);
    expect(multaDeRescisao("percentual_restante", 30_000, 100_000, 4)).toBe(120_000);
    expect(multaDeRescisao("nenhuma", 0, 100_000, 4)).toBe(0);
  });
});
