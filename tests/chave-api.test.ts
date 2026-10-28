import { describe, expect, it } from "vitest";
import { chaveDaApi, formatoDaChave } from "@/lib/servidor/atendimento";

const BOA = "sk-ant-api03-" + "x".repeat(40);

describe("chave da API colada na Vercel", () => {
  it("ignora espaços, quebra de linha, aspas e o nome da variável", () => {
    expect(chaveDaApi(`  ${BOA}\n`)).toBe(BOA);
    expect(chaveDaApi(`"${BOA}"`)).toBe(BOA);
    expect(chaveDaApi(`ANTHROPIC_API_KEY=${BOA}`)).toBe(BOA);
  });

  it("explica o formato sem mostrar a chave", () => {
    const errada = formatoDaChave("sk-ant-usr-" + "y".repeat(40));
    expect(errada).toContain('não com "sk-ant-api"');
    expect(errada).not.toContain("yyyy");
    expect(formatoDaChave(` ${BOA} `)).toContain("já ignorados");
    expect(formatoDaChave(BOA)).toContain("formato certo");
  });
});
