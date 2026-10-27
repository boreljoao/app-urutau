import { describe, expect, it } from "vitest";
import { descreverAcao, fracaoDoMes, iniciais, matizDa, porcentagem, presenca, primeiroNome, quando, ritmo, rotuloDaTela } from "@/lib/central";

const agora = new Date("2026-10-27T15:00:00-03:00");
const minutosAntes = (m: number) => new Date(agora.getTime() - m * 60_000);

describe("presença", () => {
  it("online até dois minutos sem sinal", () => {
    expect(presenca(minutosAntes(1), agora)).toEqual({ estado: "online", texto: "online agora" });
    expect(presenca(minutosAntes(3), agora).estado).toBe("ausente");
    expect(presenca(minutosAntes(45), agora).estado).toBe("offline");
    expect(presenca(null, agora)).toEqual({ estado: "nunca", texto: "ainda não entrou" });
  });

  it("diz quando foi visto em palavras", () => {
    expect(quando(minutosAntes(12), agora)).toBe("há 12 min");
    expect(quando(minutosAntes(180), agora)).toBe("há 3 h");
    expect(quando(new Date("2026-10-26T18:40:00-03:00"), agora)).toBe("ontem às 18:40");
    expect(quando(new Date("2026-10-12T10:00:00-03:00"), agora)).toMatch(/^em 12 de out/);
  });

  it("o dia vira à meia-noite de Brasília, não de Londres", () => {
    // 22h em Brasília já é dia seguinte em UTC: continua sendo "hoje".
    const noite = new Date("2026-10-26T22:00:00-03:00");
    expect(quando(new Date("2026-10-26T20:00:00-03:00"), noite)).toBe("há 2 h");
    const madrugada = new Date("2026-10-27T00:30:00-03:00");
    expect(quando(new Date("2026-10-26T23:00:00-03:00"), madrugada)).toBe("ontem às 23:00");
  });
});

describe("onde a pessoa está", () => {
  const nomes = (id: string) => (id === "abc" ? "Urutau Veículos" : undefined);
  it("traduz o caminho da tela", () => {
    expect(rotuloDaTela("/admin", nomes)).toBe("na Central");
    expect(rotuloDaTela("/e/abc/vendas/nova", nomes)).toBe("nas vendas · Urutau Veículos");
    expect(rotuloDaTela("/e/abc", nomes)).toBe("no painel · Urutau Veículos");
    expect(rotuloDaTela("/e/xyz/conferir", nomes)).toBe("conferindo vendas · uma empresa");
    expect(rotuloDaTela(null, nomes)).toBeNull();
  });
});

describe("metas", () => {
  it("porcentagem para em 100", () => {
    expect(porcentagem({ tipo: "quantidade", alvo: 4, atual: 1 })).toBe(25);
    expect(porcentagem({ tipo: "valor", alvo: 100_00, atual: 150_00 })).toBe(100);
  });

  it("no ritmo quando o feito acompanha o mês", () => {
    const metade = fracaoDoMes("2026-10", 15.5);
    expect(metade).toBe(0.5);
    expect(ritmo({ tipo: "quantidade", alvo: 10, atual: 5 }, metade)).toBe("no_ritmo");
    expect(ritmo({ tipo: "quantidade", alvo: 10, atual: 4 }, metade)).toBe("atras");
    expect(ritmo({ tipo: "quantidade", alvo: 10, atual: 10 }, 0.1)).toBe("batida");
  });
});

describe("pessoas", () => {
  it("iniciais e primeiro nome", () => {
    expect(iniciais("joao pedro borel")).toBe("JB");
    expect(iniciais("vinicius")).toBe("V");
    expect(primeiroNome("gabriel ottaviano")).toBe("Gabriel");
  });

  it("tons vizinhos ficam a 60° ou mais e longe do amarelo", () => {
    for (let i = 0; i < 4; i++) {
      const h = matizDa(i);
      expect(Math.abs(h - 48)).toBeGreaterThan(25);
      const d = Math.abs(h - matizDa(i + 1));
      expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(60);
    }
  });

  it("descreve o que aconteceu", () => {
    expect(descreverAcao("meta.progresso", { titulo: "Fechar 3 clientes" })).toBe('avançou na meta "Fechar 3 clientes"');
    expect(descreverAcao("venda.conferir", null)).toBe("conferiu uma venda");
    expect(descreverAcao("algo.novo", null)).toBe("algo novo");
  });
});
