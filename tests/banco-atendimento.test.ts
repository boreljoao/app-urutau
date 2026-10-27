/**
 * Atendimento no WhatsApp contra um Postgres real, com o Claude e a Meta trocados por dublês:
 * entrada pelo webhook, respostas, ferramentas, aprovação, passagem para humano, erros e a Central.
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { criarPadroesDaEmpresa } from "@/db/padroes";
import { agentesWhatsapp, clientes, conversas, empresas, mensagensWhatsapp, tarefas, usuarios, vendas } from "@/db/schema";
import { CUSTO_META_MENSAGEM_MICROS, estadoDoAgente, type MensagemRecebida } from "@/lib/atendimento";
import {
  ErroAtendimento,
  aprovarRascunho,
  atualizarStatus,
  conversaDeTeste,
  listarConversas,
  movimentoRecente,
  mudarStatusConversa,
  painelAtendimento,
  receberMensagem,
  responderComoEquipe,
  responderConversa,
  resumoDaLoja,
  simularMensagem,
  type CriarMensagem,
  type EnviarWhatsapp,
} from "@/lib/servidor/atendimento";
import { cifrar, decifrar } from "@/lib/servidor/segredos";

process.env.CHAVE_SEGREDOS = "chave-de-teste-com-mais-de-16-caracteres";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");

// ─── Dublês ──────────────────────────────────────────────────────────────────

type Bloco = Record<string, unknown>;
const texto = (t: string): Bloco => ({ type: "text", text: t, citations: null });
let seq = 0;
const ferramenta = (name: string, input: Record<string, unknown>): Bloco => ({ type: "tool_use", id: `toolu_${++seq}`, name, input });

function resposta(content: Bloco[], stop_reason: string, model = "claude-opus-5-5"): BetaMessage {
  return {
    id: `msg_${++seq}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1_000, output_tokens: 200, cache_read_input_tokens: 3_000, cache_creation_input_tokens: 0 },
  } as unknown as BetaMessage;
}

/** Devolve as respostas na ordem e guarda o que o agente pediu ao Claude. */
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

let idsDaMeta = 0;
function metaFalsa(falhar = false) {
  const enviadas: { para: string; texto: string; token: string }[] = [];
  const enviar: EnviarWhatsapp = async (conexao, para, t) => {
    if (falhar) throw new ErroAtendimento("WhatsApp: (#131047) Re-engagement message");
    enviadas.push({ para, texto: t, token: conexao.token });
    return `wamid.R${++idsDaMeta}`;
  };
  return { enviar, enviadas };
}

// ─── Cenário ─────────────────────────────────────────────────────────────────

let loja: typeof empresas.$inferSelect;
let dono: { id: string };
let n = 0;

const chegou = (texto: string, de = "5521998887777", phoneNumberId = "PN-LOJA"): MensagemRecebida => ({
  phoneNumberId,
  waId: de,
  nome: "Ana Souza",
  waMessageId: `wamid.in${++n}`,
  em: new Date(),
  texto,
  tipo: "text",
});

async function conversaDe(telefone: string) {
  const [c] = await db.select().from(conversas).where(and(eq(conversas.empresaId, loja.id), eq(conversas.telefone, telefone)));
  return c;
}

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
  [loja] = await db.insert(empresas).values({ nome: "Café Tauá", atividade: "comercio", regime: "simples", anexoComercio: "I", perfil: "alimentacao" }).returning();
  await db.transaction((tx) => criarPadroesDaEmpresa(tx, loja.id, loja.atividade, "alimentacao"));
  [dono] = await db.insert(usuarios).values({ nome: "Dona", email: "dona@cafe.dev", senhaHash: "x" }).returning({ id: usuarios.id });
  await db.insert(agentesWhatsapp).values({
    empresaId: loja.id,
    nome: "Bia",
    conhecimento: "Café coado R$ 8. Pão de queijo R$ 6.",
    modo: "automatico",
    phoneNumberId: "PN-LOJA",
    tokenCifrado: cifrar("token-secreto-da-meta"),
  });
});

afterAll(async () => {
  await cliente.end();
});

describe("segredos", () => {
  it("o token volta igual e não fica legível no banco", async () => {
    const [a] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.empresaId, loja.id));
    expect(a.tokenCifrado).not.toContain("token-secreto");
    expect(decifrar(a.tokenCifrado!)).toBe("token-secreto-da-meta");
    expect(cifrar("x")).not.toBe(cifrar("x")); // IV novo a cada vez
  });
});

describe("entrada pelo webhook", () => {
  it("número de nenhuma loja é ignorado", async () => {
    expect(await receberMensagem(db, chegou("oi", "5521900000000", "PN-DESCONHECIDO"))).toBeNull();
  });

  it("cria conversa e cliente, enfileira a resposta e não grava duas vezes o mesmo webhook", async () => {
    const m = chegou("Oi, tem pão de queijo?");
    const r = await receberMensagem(db, m);
    expect(r).toMatchObject({ responder: true });
    expect(await receberMensagem(db, m)).toBeNull();
    const c = await conversaDe("5521998887777");
    expect(c).toMatchObject({ nome: "Ana Souza", status: "agente", naoLidas: 1, canal: "whatsapp" });
    const [cli] = await db.select().from(clientes).where(eq(clientes.id, c.clienteId!));
    expect(cli).toMatchObject({ telefone: "5521998887777", origem: "whatsapp" });
    const fila = await db.select().from(tarefas).where(eq(tarefas.tipo, "whatsapp_responder"));
    expect(fila).toHaveLength(1);
    expect(fila[0].dados).toEqual({ conversaId: c.id });
  });
});

describe("o agente responde", () => {
  it("usa as ferramentas, registra a venda para conferir e envia pela Meta", async () => {
    const c = await conversaDe("5521998887777");
    await receberMensagem(db, chegou("Quero 2, pago no pix"));
    const claude = claudeRoteirizado(
      resposta(
        [
          ferramenta("anotar_atendimento", { intencao: "comprar", resumo: "2 pães de queijo, pix" }),
          ferramenta("registrar_venda", { descricao: "2 pães de queijo", valor_reais: 12, forma_pagamento: "pix" }),
        ],
        "tool_use",
      ),
      resposta([texto("Prontinho, Ana! São R$ 12 no pix. Já separei pra você 😊")], "end_turn"),
    );
    const meta = metaFalsa();
    const r = await responderConversa(db, c.id, { criar: claude.criar, enviar: meta.enviar });
    expect(r).toMatchObject({ resultado: "enviada", texto: "Prontinho, Ana! São R$ 12 no pix. Já separei pra você 😊" });

    // As duas mensagens seguidas do cliente viram um turno só, e o prompt fixo vai para o cache.
    const p = claude.chamadas[0];
    expect(p.messages).toEqual([{ role: "user", content: "Oi, tem pão de queijo?\nQuero 2, pago no pix" }]);
    expect(p).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" }, fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    const sistema = p.system as { text: string; cache_control?: unknown }[];
    expect(sistema[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(sistema[0].text).toContain("Café coado R$ 8");
    expect(sistema[1].cache_control).toBeUndefined();
    // Na segunda volta vão o tool_use do assistente e os resultados.
    expect(claude.chamadas[1].messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result" }, { type: "tool_result" }] });

    expect(meta.enviadas).toEqual([{ para: "5521998887777", texto: r.resultado === "pulou" ? "" : r.texto, token: "token-secreto-da-meta" }]);
    const [m] = await db.select().from(mensagensWhatsapp).where(eq(mensagensWhatsapp.waMessageId, "wamid.R1"));
    // 2 chamadas × (1.000×4 + 200×20 + 3.000×0,2) = 2 × 8.600 micros de IA + a mensagem da Meta
    expect(m).toMatchObject({ autor: "agente", status: "enviada", tokensEntrada: 2_000, tokensSaida: 400, tokensCache: 6_000, custoMicrosUsd: 17_200 + CUSTO_META_MENSAGEM_MICROS });
    expect(m.acoes?.map((a) => a.nome)).toEqual(["anotar_atendimento", "registrar_venda"]);

    const [v] = await db.select().from(vendas).where(eq(vendas.empresaId, loja.id));
    expect(v).toMatchObject({ valorCentavos: 1_200, origem: "whatsapp", status: "a_receber", conferidoEm: null, clienteId: c.clienteId, formaPagamento: "pix" });
    expect(await conversaDe("5521998887777")).toMatchObject({ intencao: "comprar", resumo: "2 pães de queijo, pix" });
  });

  it("conversa já respondida: a tarefa seguinte pula sem chamar o Claude", async () => {
    const c = await conversaDe("5521998887777");
    const claude = claudeRoteirizado();
    expect(await responderConversa(db, c.id, { criar: claude.criar })).toEqual({ resultado: "pulou", motivo: "já respondida" });
    expect(claude.chamadas).toHaveLength(0);
  });

  it("status da Meta só anda para frente", async () => {
    expect(await atualizarStatus(db, { waMessageId: "wamid.R1", status: "lida", erro: null })).toBe(true);
    expect(await atualizarStatus(db, { waMessageId: "wamid.R1", status: "entregue", erro: null })).toBe(false);
    const [m] = await db.select().from(mensagensWhatsapp).where(eq(mensagensWhatsapp.waMessageId, "wamid.R1"));
    expect(m.status).toBe("lida");
  });
});

describe("modo aprovação", () => {
  it("o agente escreve um rascunho e a pessoa aprova (editando) antes de sair", async () => {
    await db.update(agentesWhatsapp).set({ modo: "aprovacao" }).where(eq(agentesWhatsapp.empresaId, loja.id));
    await receberMensagem(db, chegou("Vocês abrem domingo?", "5521977776666"));
    const c = await conversaDe("5521977776666");
    const meta = metaFalsa();
    const r = await responderConversa(db, c.id, { criar: claudeRoteirizado(resposta([texto("Abrimos sim, das 8h às 12h!")], "end_turn")).criar, enviar: meta.enviar });
    expect(r).toMatchObject({ resultado: "rascunho" });
    expect(meta.enviadas).toHaveLength(0);
    expect(await resumoDaLoja(db, loja.id)).toMatchObject({ aprovar: 1 });
    expect((await listarConversas(db, loja.id, "aprovar")).map((x) => x.id)).toEqual([c.id]);

    if (r.resultado === "pulou") throw new Error("esperava rascunho");
    await aprovarRascunho(db, loja.id, r.mensagemId, "Abrimos sim, das 8h às 13h!", dono.id, { enviar: meta.enviar });
    expect(meta.enviadas.map((e) => e.texto)).toEqual(["Abrimos sim, das 8h às 13h!"]);
    const [m] = await db.select().from(mensagensWhatsapp).where(eq(mensagensWhatsapp.id, r.mensagemId));
    expect(m).toMatchObject({ status: "enviada", texto: "Abrimos sim, das 8h às 13h!", usuarioId: dono.id });
    await expect(aprovarRascunho(db, loja.id, r.mensagemId, "", dono.id, { enviar: meta.enviar })).rejects.toThrow("já foi enviado");
    await db.update(agentesWhatsapp).set({ modo: "automatico" }).where(eq(agentesWhatsapp.empresaId, loja.id));
  });
});

describe("passar para a equipe", () => {
  it("chamar_humano tira o agente da conversa até alguém devolver", async () => {
    await receberMensagem(db, chegou("Meu pedido veio errado!!", "5521966665555"));
    const c = await conversaDe("5521966665555");
    const meta = metaFalsa();
    await responderConversa(db, c.id, {
      criar: claudeRoteirizado(
        resposta([ferramenta("chamar_humano", { motivo: "Reclamação de pedido errado" })], "tool_use"),
        resposta([texto("Sinto muito! Já chamei alguém da loja para resolver com você.")], "end_turn"),
      ).criar,
      enviar: meta.enviar,
    });
    expect(await conversaDe("5521966665555")).toMatchObject({ status: "humano", motivoHumano: "Reclamação de pedido errado" });
    expect(meta.enviadas).toHaveLength(1);

    // Cliente fala de novo: chega, mas o agente não entra.
    expect(await receberMensagem(db, chegou("alô?", "5521966665555"))).toMatchObject({ responder: false });

    // A equipe responde e depois devolve: como o cliente não falou depois, nada é enfileirado.
    await responderComoEquipe(db, loja.id, c.id, "Oi! Aqui é a Dona, vou trocar seu pedido agora.", dono.id, { enviar: meta.enviar });
    expect(await mudarStatusConversa(db, loja.id, c.id, "agente")).toBe(false);
    expect(await conversaDe("5521966665555")).toMatchObject({ status: "agente", motivoHumano: null, naoLidas: 0 });
  });

  it("recusa do modelo vira conversa com a equipe e uma resposta educada", async () => {
    await receberMensagem(db, chegou("assunto estranho", "5521955554444"));
    const c = await conversaDe("5521955554444");
    const meta = metaFalsa();
    const r = await responderConversa(db, c.id, { criar: claudeRoteirizado(resposta([], "refusal")).criar, enviar: meta.enviar });
    expect(r).toMatchObject({ resultado: "enviada", texto: "Um momento, já vou chamar alguém da equipe para falar com você." });
    expect(await conversaDe("5521955554444")).toMatchObject({ status: "humano" });
  });
});

describe("erros", () => {
  it("falha da Meta marca a mensagem e o agente fica 'com erro' na Central", async () => {
    await receberMensagem(db, chegou("oi", "5521944443333"));
    const c = await conversaDe("5521944443333");
    const r = await responderConversa(db, c.id, { criar: claudeRoteirizado(resposta([texto("Oi! Tudo bem?")], "end_turn")).criar, enviar: metaFalsa(true).enviar });
    expect(r).toMatchObject({ resultado: "falhou" });
    const [a] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.empresaId, loja.id));
    expect(a.ultimoErro).toContain("Re-engagement");
    expect(estadoDoAgente({ modo: a.modo, conectado: true, ultimoErroEm: a.ultimoErroEm })).toBe("erro");
  });

  it("erro da API do Claude é anotado e repassado para a fila tentar de novo", async () => {
    await receberMensagem(db, chegou("tem café?", "5521933332222"));
    const c = await conversaDe("5521933332222");
    const erro = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers());
    await expect(responderConversa(db, c.id, { criar: claudeRoteirizado(erro).criar })).rejects.toBe(erro);
    const [a] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.empresaId, loja.id));
    expect(a.ultimoErro).toBe("Claude: limite de uso atingido, tentando de novo.");
  });

  it("depois de 24h sem o cliente falar, a equipe não consegue escrever", async () => {
    const c = await conversaDe("5521977776666");
    const amanha = () => new Date(Date.now() + 25 * 3_600_000);
    await expect(responderComoEquipe(db, loja.id, c.id, "oi?", dono.id, { agora: amanha, enviar: metaFalsa().enviar })).rejects.toThrow("24h");
  });
});

describe("simulador", () => {
  it("responde sem WhatsApp e não grava venda", async () => {
    const meta = metaFalsa();
    const antes = (await db.select().from(vendas).where(eq(vendas.empresaId, loja.id))).length;
    const r = await simularMensagem(db, loja.id, dono.id, "quero 1 café, pix", {
      criar: claudeRoteirizado(
        resposta([ferramenta("registrar_venda", { descricao: "1 café", valor_reais: 8, forma_pagamento: "pix" })], "tool_use"),
        resposta([texto("Anotado! R$ 8 no pix.")], "end_turn"),
      ).criar,
      enviar: meta.enviar,
    });
    expect(r).toMatchObject({ resultado: "enviada", texto: "Anotado! R$ 8 no pix." });
    expect(meta.enviadas).toHaveLength(0);
    expect((await db.select().from(vendas).where(eq(vendas.empresaId, loja.id))).length).toBe(antes);
    const t = await conversaDeTeste(db, loja.id, dono.id);
    expect(t.mensagens.map((m) => m.autor)).toEqual(["cliente", "agente"]);
    expect(t.mensagens[1].acoes?.[0].resumo).toContain("(simulação)");
    // A conversa de teste não aparece nas conversas de verdade.
    expect((await listarConversas(db, loja.id, "todas")).every((x) => !x.telefone.startsWith("teste-"))).toBe(true);
  });
});

describe("Central", () => {
  it("uma linha por loja com volume, equipe, vendas e custo", async () => {
    const [l] = await painelAtendimento(db);
    expect(l).toMatchObject({ empresa: "Café Tauá", nome: "Bia", conectado: true, vendas30d: 1, vendas30dCentavos: 1_200 });
    expect(l.conversas7d).toBe(6);
    expect(l.comEquipe).toBe(1);
    expect(l.respostasEquipe7d).toBe(1);
    expect(l.custo30dMicros).toBeGreaterThan(0);
    const feed = await movimentoRecente(db, 5);
    expect(feed[0]).toMatchObject({ empresa: "Café Tauá" });
    expect(feed.every((m) => !m.telefone.startsWith("teste-"))).toBe(true);
  });
});
