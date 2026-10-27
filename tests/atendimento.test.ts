import { describe, expect, it } from "vitest";
import { custoIaMicros, estimarCustoMensal, historicoParaClaude, janelaAberta, lerWebhook, promptDoAgente, tempoDaJanela } from "@/lib/atendimento";

describe("custo", () => {
  it("custo de uma resposta no Opus 5.5: entrada, saída e cache", () => {
    // 1.500 × 4 + 400 × 20 + 3.000 × 0,20 = 6.000 + 8.000 + 600 micros = US$ 0,0146
    expect(custoIaMicros("claude-opus-5-5", { input_tokens: 1_500, output_tokens: 400, cache_read_input_tokens: 3_000 })).toBe(14_600);
    expect(custoIaMicros("claude-haiku-5-5", { input_tokens: 1_500, output_tokens: 400, cache_read_input_tokens: 3_000 })).toBe(380);
  });

  it("estimativa do mês separa IA e Meta", () => {
    const e = estimarCustoMensal(300, 8, "claude-opus-5-5");
    expect(e.respostas).toBe(2_400);
    expect(e.metaUsd).toBeCloseTo(16.32, 2);
    expect(e.iaUsd).toBeGreaterThan(e.metaUsd);
    expect(estimarCustoMensal(300, 8, "claude-haiku-5-5").iaUsd).toBeLessThan(2);
  });
});

describe("janela de 24h", () => {
  const agora = new Date("2026-10-27T15:00:00-03:00");
  it("aberta até 24h depois da última mensagem do cliente", () => {
    expect(janelaAberta(new Date(agora.getTime() - 23 * 3_600_000), agora)).toBe(true);
    expect(janelaAberta(new Date(agora.getTime() - 25 * 3_600_000), agora)).toBe(false);
    expect(janelaAberta(null, agora)).toBe(false);
    expect(tempoDaJanela(new Date(agora.getTime() - 20 * 3_600_000), agora)).toBe("janela aberta por mais 4 h");
  });
});

describe("histórico para o Claude", () => {
  it("junta mensagens seguidas, ignora rascunhos e começa pelo cliente", () => {
    const h = historicoParaClaude([
      { autor: "agente", texto: "Oi! (mensagem antiga do agente)", status: "enviada" },
      { autor: "cliente", texto: "oi", status: "recebida" },
      { autor: "cliente", texto: "tem o tênis 42?", status: "recebida" },
      { autor: "agente", texto: "rascunho que ninguém aprovou", status: "rascunho" },
      { autor: "humano", texto: "Tem sim!", status: "enviada" },
      { autor: "sistema", texto: "conversa passou para humano", status: "enviada" },
      { autor: "cliente", texto: "quanto?", status: "recebida" },
    ]);
    expect(h).toEqual([
      { role: "user", content: "oi\ntem o tênis 42?" },
      { role: "assistant", content: "[resposta de alguém da loja] Tem sim!" },
      { role: "user", content: "quanto?" },
    ]);
  });
});

describe("prompt", () => {
  it("leva o nome, o conhecimento e não tem nada que mude a cada mensagem", () => {
    const p = promptDoAgente("Café Tauá", { nome: "Bia", tom: "alegre", conhecimento: "Café coado R$ 8", quandoChamarHumano: "" });
    expect(p).toContain("Bia, atendente da Café Tauá");
    expect(p).toContain("Café coado R$ 8");
    expect(promptDoAgente("Café Tauá", { nome: "Bia", tom: "alegre", conhecimento: "Café coado R$ 8", quandoChamarHumano: "" })).toBe(p);
  });
});

describe("webhook da Meta", () => {
  it("lê mensagem de texto, áudio e mudanças de status", () => {
    const corpo = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PN1" },
                contacts: [{ wa_id: "5521998887777", profile: { name: "Ana" } }],
                messages: [
                  { id: "wamid.A", from: "5521998887777", timestamp: "1793120000", type: "text", text: { body: "Oi, tem horário?" } },
                  { id: "wamid.B", from: "5521998887777", timestamp: "1793120005", type: "audio", audio: { id: "x" } },
                ],
                statuses: [
                  { id: "wamid.C", status: "read" },
                  { id: "wamid.D", status: "failed", errors: [{ title: "Re-engagement message" }] },
                  { id: "wamid.E", status: "esquisito" },
                ],
              },
            },
          ],
        },
      ],
    };
    const r = lerWebhook(corpo);
    expect(r.mensagens.map((m) => [m.waMessageId, m.nome, m.texto, m.phoneNumberId])).toEqual([
      ["wamid.A", "Ana", "Oi, tem horário?", "PN1"],
      ["wamid.B", "Ana", "[mandou um áudio]", "PN1"],
    ]);
    expect(r.status).toEqual([
      { waMessageId: "wamid.C", status: "lida", erro: null },
      { waMessageId: "wamid.D", status: "falhou", erro: "Re-engagement message" },
    ]);
  });

  it("corpo estranho não quebra", () => {
    expect(lerWebhook(null)).toEqual({ mensagens: [], status: [] });
    expect(lerWebhook({ entry: [{ changes: [{ value: {} }] }] })).toEqual({ mensagens: [], status: [] });
  });
});
