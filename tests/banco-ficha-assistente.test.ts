/**
 * A ficha que o agente do site anota (o que o visitante quer, dúvidas, urgência) e o assistente
 * da equipe na Central lendo o painel, contra um Postgres real e com o Claude trocado por um dublê.
 */
import "dotenv/config";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { conversasSite, leads } from "@/db/schema";
import type { CriarMensagem } from "@/lib/servidor/atendimento";
import { perguntarAoAssistente } from "@/lib/servidor/assistente";
import { conversarNoSite, lerConversaDoSite, listarConversasDoSite, oQueOsVisitantesQuerem } from "@/lib/servidor/chat-site";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");

type Bloco = Record<string, unknown>;
const texto = (t: string): Bloco => ({ type: "text", text: t, citations: null });
let seq = 0;
const ferramenta = (name: string, input: Record<string, unknown>): Bloco => ({ type: "tool_use", id: `toolu_${++seq}`, name, input });

function resposta(content: Bloco[], stop_reason: string): BetaMessage {
  return {
    id: `msg_${++seq}`,
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 3_000, cache_creation_input_tokens: 0 },
  } as unknown as BetaMessage;
}

function claudeRoteirizado(...respostas: BetaMessage[]) {
  const chamadas: MessageCreateParamsNonStreaming[] = [];
  const criar: CriarMensagem = async (p) => {
    chamadas.push(structuredClone(p));
    const r = respostas.shift();
    if (!r) throw new Error("roteiro acabou");
    return r;
  };
  return { criar, chamadas };
}

let n = 0;
const novaChave = () => `chave-da-ficha-${String(++n).padStart(4, "0")}-abcdefgh`;

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await cliente.end();
});

describe("ficha do visitante", () => {
  it("anota junto com a resposta numa chamada só e devolve o texto para o WhatsApp", async () => {
    const chave = novaChave();
    const { criar, chamadas } = claudeRoteirizado(
      resposta(
        [
          texto("Dá sim! Hoje os clientes chegam como?"),
          ferramenta("anotar_visitante", {
            objetivo: "um site que traga clientes para a clínica",
            negocio: "clínica odontológica, 3 dentistas",
            duvidas: ["Vocês fazem SEO?"],
            urgencia: "este_mes",
            temperatura: "morno",
            interesses: ["sites"],
          }),
        ],
        "tool_use",
      ),
    );
    const r = await conversarNoSite(db, { chave, texto: "Quero um site que traga clientes pra minha clínica. Vocês fazem SEO?" }, { criar });

    expect(chamadas).toHaveLength(1);
    expect(r.estado).toBe("ok");
    expect(r.mensagens.at(-1)?.texto).toBe("Dá sim! Hoje os clientes chegam como?");
    expect(r.whatsapp).toContain("Procuro: um site que traga clientes para a clínica.");
    expect(r.whatsapp).toContain("Dúvida: Vocês fazem SEO?");

    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    expect(c.ficha).toMatchObject({ objetivo: "um site que traga clientes para a clínica", urgencia: "este_mes", temperatura: "morno" });
    expect(c.interesses).toEqual(["sites"]);
    expect(c.resumo).toBe("um site que traga clientes para a clínica");

    const lida = await lerConversaDoSite(db, chave);
    expect(lida?.whatsapp).toBe(r.whatsapp);
  });

  it("soma dúvidas sem repetir, vira quente e leva a ficha para o lead", async () => {
    const chave = novaChave();
    const { criar } = claudeRoteirizado(
      resposta([texto("Faz sentido."), ferramenta("anotar_visitante", { duvidas: ["Quanto custa?"], objetivo: "atendente no WhatsApp" })], "tool_use"),
      resposta([texto("Fechado."), ferramenta("anotar_visitante", { duvidas: ["quanto custa?", "Integra com a minha agenda?"], temperatura: "quente", urgencia: "agora" })], "tool_use"),
      resposta([ferramenta("salvar_contato", { nome: "Ana", whatsapp: "(21) 99999-1234", resumo: "Quer atendente no WhatsApp", interesses: ["atende"] })], "tool_use"),
      resposta([texto("Anotado, Ana! A equipe te chama.")], "end_turn"),
    );
    await conversarNoSite(db, { chave, texto: "Quero um atendente no WhatsApp. Quanto custa?" }, { criar });
    await conversarNoSite(db, { chave, texto: "Preciso pra já. Integra com a minha agenda?" }, { criar });
    await conversarNoSite(db, { chave, texto: "Ana, 21 99999-1234" }, { criar });

    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    expect(c.ficha.duvidas).toEqual(["Quanto custa?", "Integra com a minha agenda?"]);
    expect(c.ficha.temperatura).toBe("quente");
    const [lead] = await db.select().from(leads).where(eq(leads.id, c.leadId!));
    expect(lead.observacao).toContain("Quer: atendente no WhatsApp");
    expect(lead.observacao).toContain("Dúvidas: Quanto custa? | Integra com a minha agenda?");

    const quentes = await listarConversasDoSite(db, "quentes");
    expect(quentes.map((q) => q.id)).toContain(c.id);
    expect(quentes.every((q) => q.ficha.temperatura === "quente")).toBe(true);

    const querem = await oQueOsVisitantesQuerem(db);
    expect(querem.frentes).toEqual(expect.arrayContaining([{ frente: "sites", n: 1 }, { frente: "atende", n: 1 }]));
    expect(querem.temperaturas).toMatchObject({ quente: 1, morno: 1 });
    expect(querem.urgencias).toMatchObject({ agora: 1, este_mes: 1 });
    expect(querem.duvidas.map((d) => d.texto)).toContain("Integra com a minha agenda?");
    expect(querem.objetivos.map((o) => o.texto)).toContain("atendente no WhatsApp");
  });

  it("ficha com campo inválido não quebra a conversa", async () => {
    const { criar } = claudeRoteirizado(
      resposta([texto("Me conta mais?"), ferramenta("anotar_visitante", { urgencia: "ontem", objetivo: "automatizar o sistema" })], "tool_use"),
    );
    const chave = novaChave();
    const r = await conversarNoSite(db, { chave, texto: "Quero automatizar meu sistema" }, { criar });
    expect(r.estado).toBe("ok");
    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    expect(c.ficha).toEqual({ objetivo: "automatizar o sistema" });
  });
});

describe("assistente da equipe", () => {
  it("consulta o painel com as ferramentas e responde com os dados", async () => {
    const { criar, chamadas } = claudeRoteirizado(
      resposta([ferramenta("listar_conversas_do_site", { filtro: "quentes", limite: 5 })], "tool_use"),
      resposta([texto("- Ana quer atendente no WhatsApp, está quente.")], "end_turn"),
    );
    const r = await perguntarAoAssistente(db, [{ papel: "equipe", texto: "Quem está quente no site?" }], { nome: "Borel" }, { criar });

    expect(r.texto).toBe("- Ana quer atendente no WhatsApp, está quente.");
    expect(r.consultas).toEqual(["listar_conversas_do_site"]);
    expect(r.custoMicros).toBeGreaterThan(0);
    expect(chamadas[0]).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    const system = chamadas[0].system as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toContain("Borel");
    const resultado = (chamadas[1].messages.at(-1)?.content as { content: string }[])[0].content;
    expect(resultado).toContain("Ana");
    expect(resultado).toContain("Temperatura: quente");
  });

  it("parâmetro inválido volta como erro para a IA, sem derrubar a resposta", async () => {
    const { criar, chamadas } = claudeRoteirizado(
      resposta([ferramenta("ver_lead", { id: "nao-e-uuid" })], "tool_use"),
      resposta([texto("Não achei esse lead.")], "end_turn"),
    );
    const r = await perguntarAoAssistente(db, [{ papel: "equipe", texto: "Abre o lead X" }], { nome: "Borel" }, { criar });
    expect(r.texto).toBe("Não achei esse lead.");
    const bloco = (chamadas[1].messages.at(-1)?.content as { content: string; is_error?: boolean }[])[0];
    expect(bloco.is_error).toBe(true);
  });
});
