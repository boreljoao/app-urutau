/**
 * Chat do site contra um Postgres real, com o Claude trocado por um dublê: resposta do agente,
 * contato virando lead, chamada da equipe, resposta da equipe chegando ao visitante, limites e falhas.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { conversasSite, interacoes, leads, mensagensSite, usuarios } from "@/db/schema";
import { LIMITES_CHAT } from "@/lib/chat-site";
import type { CriarMensagem } from "@/lib/servidor/atendimento";
import {
  AVISOS,
  conversarNoSite,
  lerConversaDoSite,
  listarConversasDoSite,
  mudarStatusDoSite,
  responderNoSiteComoEquipe,
  resumoDoChat,
} from "@/lib/servidor/chat-site";

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
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 200, cache_read_input_tokens: 3_000, cache_creation_input_tokens: 0 },
  } as unknown as BetaMessage;
}

function claudeRoteirizado(...respostas: (BetaMessage | Error)[]) {
  const chamadas: MessageCreateParamsNonStreaming[] = [];
  const criar: CriarMensagem = async (p) => {
    chamadas.push(structuredClone(p));
    const r = respostas.shift();
    if (!r) throw new Error("roteiro acabou");
    if (r instanceof Error) throw r;
    return r;
  };
  return { criar, chamadas };
}

let n = 0;
const novaChave = () => `chave-de-teste-${String(++n).padStart(4, "0")}-abcdefgh`;
let equipe: { id: string };

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
  [equipe] = await db.insert(usuarios).values({ nome: "Borel Urutau", email: "borel@urutau.dev", senhaHash: "x", superadmin: true }).returning({ id: usuarios.id });
});

afterAll(async () => {
  await cliente.end();
});

describe("chat do site", () => {
  it("o agente responde com o prompt da Urutau em cache e a hora num bloco à parte", async () => {
    const chave = novaChave();
    const { criar, chamadas } = claudeRoteirizado(resposta([texto("Oi! Me conta um pouco do seu negócio?")], "end_turn"));
    const r = await conversarNoSite(db, { chave, texto: "Oi, vocês fazem site?", pagina: "/#topo", visitanteId: "visitante-abc-123" }, { criar });

    expect(r.estado).toBe("ok");
    expect(r.status).toBe("agente");
    expect(r.mensagens.map((m) => [m.autor, m.texto])).toEqual([
      ["cliente", "Oi, vocês fazem site?"],
      ["agente", "Oi! Me conta um pouco do seu negócio?"],
    ]);
    const p = chamadas[0];
    expect(p.model).toBe("claude-haiku-5-5");
    expect(p).not.toHaveProperty("fallbacks");
    expect(p.output_config).toEqual({ effort: "low" });
    const system = p.system as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].text).toContain("urutau sites");
    expect(system[1].text).toMatch(/Agora: .*Brasília/);
    expect(p.messages).toEqual([{ role: "user", content: "Oi, vocês fazem site?" }]);

    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    expect(c).toMatchObject({ pagina: "/#topo", visitanteId: "visitante-abc-123", naoLidas: 1 });
    const [m] = await db.select().from(mensagensSite).where(eq(mensagensSite.autor, "agente"));
    expect(m.custoMicrosUsd).toBeGreaterThan(0);
    expect(m.tokensCache).toBe(3_000);
  });

  it("salvar_contato cria o lead com as frentes e liga à conversa; a segunda vez não duplica", async () => {
    const chave = novaChave();
    const { criar } = claudeRoteirizado(
      resposta([ferramenta("salvar_contato", { nome: "Marina Lopes", negocio: "Provedor Onda", whatsapp: "(21) 98888-7777", interesses: ["gestao", "atende"], resumo: "Provedor com 2 mil clientes, cobrança na planilha." })], "tool_use"),
      resposta([texto("Anotado, Marina! A equipe te chama amanhã cedo.")], "end_turn"),
      resposta([ferramenta("salvar_contato", { nome: "Marina Lopes", whatsapp: "21988887777", interesses: ["financas"], resumo: "Quer também cobrança automática." })], "tool_use"),
      resposta([texto("Atualizei aqui.")], "end_turn"),
    );
    await conversarNoSite(db, { chave, texto: "Sou a Marina, do Provedor Onda. 21 98888-7777" }, { criar });
    await conversarNoSite(db, { chave, texto: "Ah, e cobrança automática também" }, { criar });

    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    expect(c.nome).toBe("Marina Lopes");
    expect(c.contato).toBe("5521988887777");
    expect(c.interesses.sort()).toEqual(["atende", "financas", "gestao"]);
    const lista = await db.select().from(leads).where(eq(leads.telefone, "5521988887777"));
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: c.leadId, nome: "Provedor Onda", contato: "Marina Lopes", origem: "site" });
    expect(lista[0].interesses.sort()).toEqual(["atende", "financas", "gestao"]);
    const msgs = await db.select().from(mensagensSite).where(eq(mensagensSite.conversaId, c.id));
    expect(msgs.find((m) => m.autor === "agente")?.acoes).toEqual([{ nome: "salvar_contato", resumo: "Contato salvo: Marina Lopes · 5521988887777" }]);
  });

  it("sem WhatsApp ou e-mail, o agente é avisado para pedir o contato", async () => {
    const { criar, chamadas } = claudeRoteirizado(
      resposta([ferramenta("salvar_contato", { nome: "João", resumo: "Quer site" })], "tool_use"),
      resposta([texto("Qual seu WhatsApp, João?")], "end_turn"),
    );
    await conversarNoSite(db, { chave: novaChave(), texto: "Sou o João" }, { criar });
    const resultado = (chamadas[1].messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0];
    expect(resultado.is_error).toBe(true);
    expect(resultado.content).toMatch(/WhatsApp ou e-mail/);
  });

  it("chamar_equipe para o agente; a equipe responde pela Central e o visitante recebe", async () => {
    const chave = novaChave();
    const { criar, chamadas } = claudeRoteirizado(
      resposta([ferramenta("chamar_equipe", { motivo: "Quer fechar contrato hoje" }), texto("Já chamei a equipe!")], "tool_use"),
      resposta([texto("Já chamei a equipe! Alguém responde por aqui.")], "end_turn"),
    );
    const r = await conversarNoSite(db, { chave, texto: "Quero fechar hoje, falo com quem?" }, { criar });
    expect(r.estado).toBe("equipe");
    expect(r.status).toBe("humano");

    // Com a equipe, nova mensagem do visitante não chama o Claude.
    const r2 = await conversarNoSite(db, { chave, texto: "Tô aguardando" }, { criar });
    expect(r2.estado).toBe("equipe");
    expect(chamadas).toHaveLength(2);

    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    expect(c.motivoHumano).toBe("Quer fechar contrato hoje");
    expect((await listarConversasDoSite(db, "equipe")).map((x) => x.id)).toContain(c.id);

    expect((await resumoDoChat(db)).esperandoEquipe).toBe(1);
    const antes = new Date(Date.now() - 1);
    await responderNoSiteComoEquipe(db, c.id, "Oi! Aqui é o Borel, vamos fechar.", equipe.id);
    // Respondida, continua com a equipe mas sai da fila de quem espera.
    expect((await listarConversasDoSite(db, "equipe")).find((x) => x.id === c.id)?.ultimoAutor).toBe("humano");
    expect((await resumoDoChat(db)).esperandoEquipe).toBe(0);
    const novas = await lerConversaDoSite(db, chave, antes);
    expect(novas?.mensagens.map((m) => [m.autor, m.texto])).toEqual([["humano", "Oi! Aqui é o Borel, vamos fechar."]]);
    // O que o sistema anota não aparece para o visitante.
    const tudo = await lerConversaDoSite(db, chave);
    expect(tudo?.mensagens.some((m) => (m.autor as string) === "sistema")).toBe(false);

    // Devolvida ao agente, o histórico leva a resposta da equipe como contexto.
    await mudarStatusDoSite(db, c.id, "agente");
    const outro = claudeRoteirizado(resposta([texto("Combinado!")], "end_turn"));
    await conversarNoSite(db, { chave, texto: "Valeu!" }, { criar: outro.criar });
    const historico = outro.chamadas[0].messages.map((m) => m.content as string);
    expect(historico.some((t) => t.includes("[resposta de alguém da equipe Urutau] Oi! Aqui é o Borel"))).toBe(true);
  });

  it("conversa encerrada volta ao agente quando o visitante escreve de novo", async () => {
    const chave = novaChave();
    const um = claudeRoteirizado(resposta([texto("Oi!")], "end_turn"));
    await conversarNoSite(db, { chave, texto: "Oi" }, { criar: um.criar });
    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    await mudarStatusDoSite(db, c.id, "encerrada");
    const dois = claudeRoteirizado(resposta([texto("De volta!")], "end_turn"));
    const r = await conversarNoSite(db, { chave, texto: "Voltei" }, { criar: dois.criar });
    expect(r).toMatchObject({ estado: "ok", status: "agente" });
  });

  it("sem a chave da IA, o visitante vê o aviso e a Central registra a falha", async () => {
    const chave = novaChave();
    const falha = new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
    const { criar } = claudeRoteirizado(falha);
    const r = await conversarNoSite(db, { chave, texto: "Tem alguém aí?" }, { criar });
    expect(r).toMatchObject({ estado: "indisponivel", aviso: AVISOS.indisponivel });
    expect(r.mensagens.map((m) => m.autor)).toEqual(["cliente"]);
    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    const [sistema] = await db.select().from(mensagensSite).where(eq(mensagensSite.conversaId, c.id)).orderBy(mensagensSite.criadoEm).offset(1);
    expect(sistema.texto).toMatch(/^O agente não respondeu: Claude: chave da API inválida \(ANTHROPIC_API_KEY\): chave com \d+ caracteres/);
    expect((await resumoDoChat(db)).falhas7d).toBe(1);
  });

  it("recusa do modelo passa a conversa para a equipe", async () => {
    const { criar } = claudeRoteirizado(resposta([], "refusal"));
    const r = await conversarNoSite(db, { chave: novaChave(), texto: "algo estranho" }, { criar });
    expect(r.estado).toBe("equipe");
    expect(r.mensagens.at(-1)?.texto).toBe(AVISOS.equipe);
  });

  it("limita mensagens por conversa e em rajada, sem chamar o Claude", async () => {
    const chave = novaChave();
    const { criar, chamadas } = claudeRoteirizado(...Array.from({ length: LIMITES_CHAT.porDezMinutos }, () => resposta([texto("ok")], "end_turn")));
    for (let i = 0; i < LIMITES_CHAT.porDezMinutos; i++) await conversarNoSite(db, { chave, texto: `msg ${i}` }, { criar });
    const rajada = await conversarNoSite(db, { chave, texto: "mais uma" }, { criar });
    expect(rajada).toMatchObject({ estado: "devagar", mensagens: [] });
    expect(chamadas).toHaveLength(LIMITES_CHAT.porDezMinutos);

    // Daqui a uma hora a rajada passou, mas a conversa já tem mensagens demais.
    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    const antigas = Array.from({ length: LIMITES_CHAT.porConversa - LIMITES_CHAT.porDezMinutos }, (_, i) => ({ conversaId: c.id, autor: "cliente" as const, texto: `antiga ${i}`, criadoEm: new Date(Date.now() - 3600_000) }));
    await db.insert(mensagensSite).values(antigas);
    const limite = await conversarNoSite(db, { chave, texto: "e agora?" }, { criar, agora: () => new Date(Date.now() + 3600_000) });
    expect(limite).toMatchObject({ estado: "limite", aviso: AVISOS.limite });
  });

  it("respeita o teto diário de respostas da IA", async () => {
    process.env.SITE_CHAT_LIMITE_DIA = "1";
    try {
      const { criar, chamadas } = claudeRoteirizado(resposta([texto("não deveria")], "end_turn"));
      const r = await conversarNoSite(db, { chave: novaChave(), texto: "Oi" }, { criar });
      expect(r.estado).toBe("indisponivel");
      expect(chamadas).toHaveLength(0);
    } finally {
      delete process.env.SITE_CHAT_LIMITE_DIA;
    }
  });

  it("a equipe que responde assume a conversa e o lead ganha a nota", async () => {
    const chave = novaChave();
    const { criar } = claudeRoteirizado(
      resposta([ferramenta("salvar_contato", { nome: "Rui", email: "rui@saas.dev", resumo: "SaaS B2B" })], "tool_use"),
      resposta([texto("Salvo!")], "end_turn"),
    );
    await conversarNoSite(db, { chave, texto: "Rui, rui@saas.dev" }, { criar });
    const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
    await responderNoSiteComoEquipe(db, c.id, "Oi Rui, tudo bem?", equipe.id);
    const [depois] = await db.select().from(conversasSite).where(eq(conversasSite.id, c.id));
    expect(depois).toMatchObject({ status: "humano", naoLidas: 0 });
    const notas = await db.select({ texto: interacoes.texto }).from(interacoes).where(eq(interacoes.leadId, c.leadId!));
    expect(notas.map((x) => x.texto)).toContain("Respondeu no chat do site: Oi Rui, tudo bem?");
    const [lead] = await db.select().from(leads).where(eq(leads.id, c.leadId!));
    expect(lead.email).toBe("rui@saas.dev");
  });
});
