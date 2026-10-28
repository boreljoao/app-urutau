import { describe, expect, it } from "vitest";
import { FRENTES_CHAT, PROMPT_DO_SITE, chaveDeChatValida, equipeNoHorario, limiteDiarioDoChat } from "@/lib/chat-site";
import { montarAtencao } from "@/lib/central";
import { NOME_SERVICO } from "@/lib/comercial";

describe("chat do site", () => {
  it("aceita só chaves aleatórias de tamanho razoável", () => {
    expect(chaveDeChatValida("3f2b8c1e-9d4a-4b7e-8f60-2a1c5e7d9b30")).toBe(true);
    expect(chaveDeChatValida("lq2x9k-a8f3k2m1p0")).toBe(false); // curta demais
    expect(chaveDeChatValida("abc def ghi jkl mno pqr")).toBe(false);
    expect(chaveDeChatValida("x".repeat(65))).toBe(false);
    expect(chaveDeChatValida(undefined)).toBe(false);
  });

  it("sabe quando a equipe está no horário (Brasília)", () => {
    expect(equipeNoHorario(new Date("2026-10-27T13:00:00Z"))).toBe(true); // terça, 10h
    expect(equipeNoHorario(new Date("2026-10-27T22:30:00Z"))).toBe(false); // terça, 19h30
    expect(equipeNoHorario(new Date("2026-10-28T02:00:00Z"))).toBe(false); // terça, 23h
    expect(equipeNoHorario(new Date("2026-10-27T10:59:00Z"))).toBe(false); // terça, 7h59
    expect(equipeNoHorario(new Date("2026-10-31T14:00:00Z"))).toBe(false); // sábado
    expect(equipeNoHorario(new Date("2026-11-01T14:00:00Z"))).toBe(false); // domingo
  });

  it("o teto diário vem da variável, com 600 como padrão", () => {
    expect(limiteDiarioDoChat({})).toBe(600);
    expect(limiteDiarioDoChat({ SITE_CHAT_LIMITE_DIA: "150" })).toBe(150);
    expect(limiteDiarioDoChat({ SITE_CHAT_LIMITE_DIA: "abc" })).toBe(600);
    expect(limiteDiarioDoChat({ SITE_CHAT_LIMITE_DIA: "0" })).toBe(600);
  });

  it("o prompt fala das seis frentes, do contato real e proíbe inventar preço", () => {
    for (const f of FRENTES_CHAT) expect(PROMPT_DO_SITE).toContain(`${NOME_SERVICO[f]}:`);
    expect(PROMPT_DO_SITE).toContain("(21) 99368-9481");
    expect(PROMPT_DO_SITE).toMatch(/Nunca invente preço/);
  });

  it("conversa que espera a equipe entra na fila da Central", () => {
    const agora = new Date("2026-10-27T13:00:00Z");
    const itens = montarAtencao({
      agora,
      hoje: "2026-10-27",
      empresas: [],
      afazeresAtrasados: [],
      contatosSite: [],
      senhasProvisorias: [],
      chatEsperando: [{ id: "c1", nome: "Marina", motivo: "Quer fechar hoje", desde: new Date("2026-10-27T12:50:00Z") }],
    });
    expect(itens).toEqual([
      { chave: "chat-c1", nivel: "alto", texto: "Marina espera a equipe no chat do site", detalhe: "Quer fechar hoje · há 10 min", link: "/admin/comercial/chat/c1" },
    ]);
  });
});

describe("ficha do visitante", () => {
  it("junta a ficha: texto novo substitui, dúvidas somam sem repetir", async () => {
    const { juntarFicha } = await import("@/lib/chat-site");
    const a = juntarFicha({ objetivo: "site", duvidas: ["Quanto custa?"] }, { objetivo: "site com agenda", duvidas: ["quanto custa?", "Faz SEO?"], orcamento: "" });
    expect(a).toEqual({ objetivo: "site com agenda", duvidas: ["Quanto custa?", "Faz SEO?"] });
  });

  it("monta a mensagem do WhatsApp com o que o visitante contou", async () => {
    const { textoParaWhatsapp } = await import("@/lib/chat-site");
    expect(textoParaWhatsapp({ nome: "Ana", resumo: null, ficha: { objetivo: "atendente no WhatsApp.", negocio: "salão", duvidas: ["Integra com a agenda?"] } })).toBe(
      "Oi, Urutau! Sou Ana e vim do chat do site. Procuro: atendente no WhatsApp. Meu negócio: salão. Dúvida: Integra com a agenda?",
    );
    expect(textoParaWhatsapp({ nome: null, resumo: null, ficha: {} })).toBe("Oi, Urutau! Vim do chat do site.");
  });

  it("o prompt manda anotar a ficha e explica redes sociais", async () => {
    const { PROMPT_DO_SITE, SOBRE_A_URUTAU } = await import("@/lib/chat-site");
    expect(PROMPT_DO_SITE).toContain("anotar_visitante");
    expect(PROMPT_DO_SITE).toContain(SOBRE_A_URUTAU);
    expect(SOBRE_A_URUTAU).toContain("Redes sociais");
  });
});
