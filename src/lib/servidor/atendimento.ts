import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { BancoDeDados } from "@/db";
import { agentesWhatsapp, clientes, conversas, empresas, fontesReceita, mensagensWhatsapp, vendas, type StatusConversa } from "@/db/schema";
import {
  CUSTO_META_MENSAGEM_MICROS,
  INTENCOES,
  MODELO_PADRAO,
  NOME_INTENCAO,
  custoIaMicros,
  historicoParaClaude,
  janelaAberta,
  promptDoAgente,
  type MensagemRecebida,
  type StatusRecebido,
} from "@/lib/atendimento";
import { hoje } from "@/lib/datas";
import { registrarAuditoria } from "./auditoria";
import { acharOuCriarPorTelefone } from "./clientes";
import { decifrar } from "./segredos";
import { enfileirar } from "./tarefas";

/**
 * O atendente de WhatsApp de cada loja: recebe o que chega pelo webhook da Meta, responde com o
 * Claude (ferramentas para anotar, salvar cliente, registrar venda e chamar uma pessoa), envia pela
 * Cloud API e guarda tokens, custo e tempo de cada resposta para a aba Atendimento da Central.
 */

// ─── Dependências de fora (trocadas nos testes) ──────────────────────────────

export type CriarMensagem = (p: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;
export type EnviarWhatsapp = (conexao: { phoneNumberId: string; token: string }, para: string, texto: string) => Promise<string>;

export interface Dependencias {
  criar?: CriarMensagem;
  enviar?: EnviarWhatsapp;
  agora?: () => Date;
}

let clienteClaude: Anthropic | null = null;

const criarPadrao: CriarMensagem = (p) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new ErroAtendimento("A IA ainda não foi ligada neste ambiente (falta a ANTHROPIC_API_KEY). Avise a equipe Urutau.");
  clienteClaude ??= new Anthropic({ maxRetries: 2, timeout: 60_000 });
  return clienteClaude.beta.messages.create(p);
};

const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION ?? "v23.0"}`;

async function chamarGraph(caminho: string, token: string, corpo?: unknown) {
  const r = await fetch(`${GRAPH}/${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(corpo ? { "content-type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await r.json().catch(() => ({}))) as { error?: { message?: string }; messages?: { id?: string }[] } & Record<string, unknown>;
  if (!r.ok) throw new ErroAtendimento(`WhatsApp: ${json.error?.message ?? `HTTP ${r.status}`}`);
  return json;
}

const enviarPadrao: EnviarWhatsapp = async ({ phoneNumberId, token }, para, texto) => {
  const json = await chamarGraph(`${encodeURIComponent(phoneNumberId)}/messages`, token, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: para,
    type: "text",
    text: { preview_url: false, body: texto },
  });
  const id = json.messages?.[0]?.id;
  if (!id) throw new ErroAtendimento("WhatsApp: a Meta não devolveu o id da mensagem.");
  return id;
};

/** Confere se o número e o token funcionam, sem enviar nada. */
export async function testarConexao(phoneNumberId: string, token: string) {
  const json = await chamarGraph(`${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, token);
  return {
    numero: typeof json.display_phone_number === "string" ? json.display_phone_number : null,
    nome: typeof json.verified_name === "string" ? json.verified_name : null,
    qualidade: typeof json.quality_rating === "string" ? json.quality_rating : null,
  };
}

export class ErroAtendimento extends Error {}

// ─── Entrada ─────────────────────────────────────────────────────────────────

async function registrarEntrada(
  db: BancoDeDados,
  e: { empresaId: string; canal: "whatsapp" | "simulador"; telefone: string; nome: string | null; texto: string; waMessageId: string | null; em: Date },
) {
  if (e.waMessageId) {
    const [repetida] = await db.select({ id: mensagensWhatsapp.id }).from(mensagensWhatsapp).where(eq(mensagensWhatsapp.waMessageId, e.waMessageId));
    if (repetida) return null; // a Meta reenvia o mesmo webhook quando demoramos a responder
  }
  let clienteId: string | null = null;
  if (e.canal === "whatsapp" && /^[0-9]{10,15}$/.test(e.telefone)) {
    const { cliente } = await acharOuCriarPorTelefone(db, e.empresaId, e.telefone, e.nome ?? "");
    clienteId = cliente?.id ?? null;
  }
  const [conversa] = await db
    .insert(conversas)
    .values({ empresaId: e.empresaId, canal: e.canal, telefone: e.telefone, nome: e.nome, clienteId, ultimaEntradaEm: e.em, ultimaMensagemEm: e.em, naoLidas: 1 })
    .onConflictDoUpdate({
      target: [conversas.empresaId, conversas.canal, conversas.telefone],
      set: {
        ultimaEntradaEm: e.em,
        ultimaMensagemEm: e.em,
        naoLidas: sql`${conversas.naoLidas} + 1`,
        nome: sql`coalesce(${conversas.nome}, excluded.nome)`,
        clienteId: sql`coalesce(${conversas.clienteId}, excluded.cliente_id)`,
        // Cliente que volta depois de encerrada reabre a conversa com o agente.
        status: sql`case when ${conversas.status} = 'encerrada' then 'agente'::status_conversa else ${conversas.status} end`,
      },
    })
    .returning();
  const [mensagem] = await db
    .insert(mensagensWhatsapp)
    .values({ conversaId: conversa.id, empresaId: e.empresaId, autor: "cliente", texto: e.texto, waMessageId: e.waMessageId, status: "recebida", criadoEm: e.em })
    .onConflictDoNothing()
    .returning({ id: mensagensWhatsapp.id });
  if (!mensagem) return null;
  return { conversa, mensagemId: mensagem.id };
}

/** Mensagem que chegou pelo webhook. Devolve null quando o número não é de nenhuma loja ou já foi gravada. */
export async function receberMensagem(db: BancoDeDados, m: MensagemRecebida) {
  const [agente] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.phoneNumberId, m.phoneNumberId));
  if (!agente) return null;
  const r = await registrarEntrada(db, { empresaId: agente.empresaId, canal: "whatsapp", telefone: m.waId, nome: m.nome, texto: m.texto, waMessageId: m.waMessageId, em: m.em });
  if (!r) return null;
  const responder = r.conversa.status === "agente" && agente.modo !== "desligado";
  if (responder)
    await enfileirar(db, { tipo: "whatsapp_responder", empresaId: agente.empresaId, dados: { conversaId: r.conversa.id }, chave: `responder:${r.mensagemId}` });
  return { ...r, responder };
}

const ORDEM_STATUS = { pendente: 0, enviada: 1, entregue: 2, lida: 3 } as const;

/** Entregue e lida chegam fora de ordem às vezes: o status nunca anda para trás (falha sempre vale). */
export async function atualizarStatus(db: BancoDeDados, s: StatusRecebido) {
  const [m] = await db.select({ id: mensagensWhatsapp.id, status: mensagensWhatsapp.status }).from(mensagensWhatsapp).where(eq(mensagensWhatsapp.waMessageId, s.waMessageId));
  if (!m) return false;
  if (s.status !== "falhou") {
    const atual = ORDEM_STATUS[m.status as keyof typeof ORDEM_STATUS];
    if (atual === undefined || atual >= ORDEM_STATUS[s.status]) return false;
  }
  await db.update(mensagensWhatsapp).set({ status: s.status, erro: s.erro }).where(eq(mensagensWhatsapp.id, m.id));
  return true;
}

// ─── O agente ────────────────────────────────────────────────────────────────

const MAX_VOLTAS = 5;

const FERRAMENTAS: BetaTool[] = [
  {
    name: "anotar_atendimento",
    description: "Anota o que o cliente quer, para a equipe da loja ver na lista de conversas. Use assim que entender o pedido e de novo se ele mudar.",
    input_schema: {
      type: "object",
      properties: {
        intencao: { type: "string", enum: [...INTENCOES], description: "comprar, orcamento, agendar, duvida, reclamacao ou outro" },
        resumo: { type: "string", description: "Uma frase com o que o cliente quer: produto, quantidade, prazo." },
      },
      required: ["intencao", "resumo"],
    },
  },
  {
    name: "salvar_cliente",
    description: "Guarda o nome certo do cliente e o que for útil para a loja (e-mail, endereço de entrega, preferência). Use quando o cliente informar.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome como o cliente se apresentou." },
        email: { type: "string" },
        observacao: { type: "string", description: "Endereço, preferência ou outro detalhe útil." },
      },
      required: ["nome"],
    },
  },
  {
    name: "registrar_venda",
    description:
      "Registra uma venda que o cliente confirmou, com produto, valor total e forma de pagamento. A venda entra como 'a receber' para o dono da loja conferir e confirmar o pagamento.",
    input_schema: {
      type: "object",
      properties: {
        descricao: { type: "string", description: "O que foi vendido, com quantidade." },
        valor_reais: { type: "number", description: "Valor total em reais, ex.: 89.9" },
        forma_pagamento: { type: "string", enum: ["pix", "dinheiro", "debito", "credito", "boleto", "transferencia", "outro"] },
      },
      required: ["descricao", "valor_reais", "forma_pagamento"],
    },
  },
  {
    name: "chamar_humano",
    description:
      "Passa a conversa para uma pessoa da loja. Depois disso você não responde mais esta conversa: na mesma resposta, avise o cliente que alguém da loja já vai falar com ele.",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string", description: "Por que precisa de uma pessoa, em uma frase." } },
      required: ["motivo"],
    },
  },
];

const entradas = {
  anotar_atendimento: z.object({ intencao: z.enum(INTENCOES), resumo: z.string().trim().min(1).max(500) }),
  salvar_cliente: z.object({ nome: z.string().trim().min(1).max(120), email: z.email().optional().catch(undefined), observacao: z.string().trim().max(500).optional() }),
  registrar_venda: z.object({
    descricao: z.string().trim().min(1).max(300),
    valor_reais: z.number().positive().max(10_000_000),
    forma_pagamento: z.enum(["pix", "dinheiro", "debito", "credito", "boleto", "transferencia", "outro"]),
  }),
  chamar_humano: z.object({ motivo: z.string().trim().min(1).max(300) }),
};

type Conversa = typeof conversas.$inferSelect;

interface ResultadoFerramenta {
  resumo: string;
  resultado: string;
  erro?: boolean;
}

async function executarFerramenta(db: BancoDeDados, c: Conversa, nome: string, input: unknown): Promise<ResultadoFerramenta> {
  const simulado = c.canal === "simulador";
  if (nome === "anotar_atendimento") {
    const p = entradas.anotar_atendimento.safeParse(input);
    if (!p.success) return { resumo: "anotação inválida", resultado: "Dados inválidos: informe intencao e resumo.", erro: true };
    await db.update(conversas).set({ intencao: p.data.intencao, resumo: p.data.resumo }).where(eq(conversas.id, c.id));
    return { resumo: `${NOME_INTENCAO[p.data.intencao]}: ${p.data.resumo}`, resultado: "Anotado." };
  }
  if (nome === "salvar_cliente") {
    const p = entradas.salvar_cliente.safeParse(input);
    if (!p.success) return { resumo: "cliente inválido", resultado: "Dados inválidos: informe ao menos o nome.", erro: true };
    await db.update(conversas).set({ nome: p.data.nome }).where(eq(conversas.id, c.id));
    if (c.clienteId && !simulado) {
      const obs = p.data.observacao ? sql`trim(both from concat_ws(E'\n', nullif(${clientes.observacao}, ''), ${p.data.observacao}::text))` : undefined;
      await db
        .update(clientes)
        .set({ nome: p.data.nome, ...(p.data.email ? { email: p.data.email } : {}), ...(obs ? { observacao: obs } : {}) })
        .where(and(eq(clientes.id, c.clienteId), eq(clientes.empresaId, c.empresaId)));
    }
    return { resumo: `Cliente: ${p.data.nome}${p.data.email ? ` · ${p.data.email}` : ""}`, resultado: "Cliente salvo." };
  }
  if (nome === "registrar_venda") {
    const p = entradas.registrar_venda.safeParse(input);
    if (!p.success) return { resumo: "venda inválida", resultado: "Dados inválidos: informe descrição, valor em reais e forma de pagamento.", erro: true };
    const centavos = Math.round(p.data.valor_reais * 100);
    const valor = (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const resumo = `Venda: ${p.data.descricao} · ${valor} · ${p.data.forma_pagamento}`;
    if (simulado) return { resumo: `${resumo} (simulação)`, resultado: "Venda registrada (simulação: nada foi gravado)." };
    const [fonte] = await db
      .select({ id: fontesReceita.id })
      .from(fontesReceita)
      .where(and(eq(fontesReceita.empresaId, c.empresaId), eq(fontesReceita.ativo, true)))
      .orderBy(sql`(${fontesReceita.nome} ilike '%whats%') desc`, asc(fontesReceita.ordem))
      .limit(1);
    if (!fonte) return { resumo: "venda sem fonte de receita", resultado: "A loja não tem fonte de receita cadastrada. Chame um humano.", erro: true };
    const dia = hoje();
    const [v] = await db
      .insert(vendas)
      .values({
        empresaId: c.empresaId,
        data: dia,
        valorCentavos: centavos,
        descricao: p.data.descricao,
        fonteReceitaId: fonte.id,
        formaPagamento: p.data.forma_pagamento,
        status: "a_receber",
        dataRecebimento: dia,
        clienteId: c.clienteId,
        origem: "whatsapp",
        conferidoEm: null,
      })
      .returning({ id: vendas.id });
    await registrarAuditoria(db, { empresaId: c.empresaId, ator: "agente", acao: "venda.registrar", entidade: "venda", entidadeId: v.id, dados: { valorCentavos: centavos, conversaId: c.id } });
    return { resumo, resultado: "Venda registrada. O dono da loja vai conferir e confirmar o pagamento." };
  }
  if (nome === "chamar_humano") {
    const p = entradas.chamar_humano.safeParse(input);
    const motivo = p.success ? p.data.motivo : "O agente pediu ajuda.";
    await passarParaHumano(db, c, motivo);
    return { resumo: `Chamou a equipe: ${motivo}`, resultado: "Pronto, a equipe foi avisada. Avise o cliente e não responda mais." };
  }
  return { resumo: `ferramenta desconhecida: ${nome}`, resultado: `Ferramenta ${nome} não existe.`, erro: true };
}

async function passarParaHumano(db: BancoDeDados, c: Conversa, motivo: string) {
  await db.update(conversas).set({ status: "humano", motivoHumano: motivo }).where(eq(conversas.id, c.id));
  await db.insert(mensagensWhatsapp).values({ conversaId: c.id, empresaId: c.empresaId, autor: "sistema", texto: `O agente chamou a equipe: ${motivo}`, status: "enviada" });
}

const formatoAgora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** A parte do prompt que muda a cada resposta: fica fora do cache. */
function contextoDoMomento(c: Conversa, agora: Date) {
  return [
    `Agora: ${formatoAgora.format(agora)} (horário de Brasília).`,
    `Cliente: ${c.nome ?? "nome ainda não informado"}.`,
    c.intencao ? `Já anotado nesta conversa: ${NOME_INTENCAO[c.intencao] ?? c.intencao}: ${c.resumo ?? ""}` : "",
    c.canal === "simulador" ? "Esta é uma conversa de teste dentro do painel da loja." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function marcarErro(db: BancoDeDados, empresaId: string, erro: string) {
  await db.update(agentesWhatsapp).set({ ultimoErro: erro.slice(0, 500), ultimoErroEm: new Date() }).where(eq(agentesWhatsapp.empresaId, empresaId));
}

function conexaoDo(agente: typeof agentesWhatsapp.$inferSelect) {
  if (!agente.phoneNumberId || !agente.tokenCifrado) throw new ErroAtendimento("O número do WhatsApp desta loja ainda não foi conectado.");
  return { phoneNumberId: agente.phoneNumberId, token: decifrar(agente.tokenCifrado) };
}

export type ResultadoResposta =
  | { resultado: "pulou"; motivo: string }
  | { resultado: "enviada" | "rascunho" | "falhou"; mensagemId: string; texto: string };

/**
 * Responde a conversa se a última mensagem for do cliente. Mensagens seguidas do cliente viram uma
 * resposta só: as tarefas seguintes encontram a conversa já respondida e pulam.
 */
export async function responderConversa(db: BancoDeDados, conversaId: string, deps: Dependencias = {}): Promise<ResultadoResposta> {
  const criar = deps.criar ?? criarPadrao;
  const enviar = deps.enviar ?? enviarPadrao;
  const agora = deps.agora?.() ?? new Date();

  const [c] = await db.select().from(conversas).where(eq(conversas.id, conversaId));
  if (!c) return { resultado: "pulou", motivo: "conversa não existe" };
  if (c.status !== "agente") return { resultado: "pulou", motivo: "conversa com a equipe" };
  const [agente] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.empresaId, c.empresaId));
  if (!agente) return { resultado: "pulou", motivo: "loja sem agente" };
  if (agente.modo === "desligado" && c.canal === "whatsapp") return { resultado: "pulou", motivo: "agente pausado" };
  const [empresa] = await db.select({ nome: empresas.nome }).from(empresas).where(eq(empresas.id, c.empresaId));

  const recentes = await db
    .select({ autor: mensagensWhatsapp.autor, texto: mensagensWhatsapp.texto, status: mensagensWhatsapp.status, criadoEm: mensagensWhatsapp.criadoEm })
    .from(mensagensWhatsapp)
    .where(and(eq(mensagensWhatsapp.conversaId, c.id), ne(mensagensWhatsapp.status, "descartada")))
    .orderBy(desc(mensagensWhatsapp.criadoEm))
    .limit(60);
  const historico = recentes.reverse();
  const ultima = historico.filter((m) => m.autor !== "sistema").at(-1);
  if (!ultima || ultima.autor !== "cliente") return { resultado: "pulou", motivo: "já respondida" };

  const system: BetaTextBlockParam[] = [
    { type: "text", text: promptDoAgente(empresa?.nome ?? "loja", agente), cache_control: { type: "ephemeral" } },
    { type: "text", text: contextoDoMomento(c, agora) },
  ];
  const mensagens: BetaMessageParam[] = historicoParaClaude(historico).map((t) => ({ role: t.role, content: t.content }));
  const uso = { entrada: 0, saida: 0, cache: 0, micros: 0 };
  const acoes: { nome: string; resumo: string }[] = [];
  let texto = "";
  let recusou = false;

  try {
    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const r = await criar({
        model: agente.modelo || MODELO_PADRAO,
        max_tokens: 4096,
        system,
        tools: FERRAMENTAS,
        messages: mensagens,
        output_config: { effort: "low" },
        // Se o modelo recusar por política, a API tenta o substituto padrão em vez de deixar o cliente sem resposta.
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01"],
      });
      uso.entrada += r.usage.input_tokens;
      uso.saida += r.usage.output_tokens;
      uso.cache += r.usage.cache_read_input_tokens ?? 0;
      uso.micros += custoIaMicros(r.model, r.usage);
      if (r.stop_reason === "refusal") {
        recusou = true;
        break;
      }
      texto = r.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n")
        .trim();
      const usos = r.content.flatMap((b) => (b.type === "tool_use" ? [b] : []));
      if (r.stop_reason !== "tool_use" || usos.length === 0) break;
      mensagens.push({ role: "assistant", content: r.content });
      const resultados: BetaToolResultBlockParam[] = [];
      for (const u of usos) {
        const [atual] = await db.select().from(conversas).where(eq(conversas.id, c.id));
        const res = await executarFerramenta(db, atual ?? c, u.name, u.input);
        acoes.push({ nome: u.name, resumo: res.resumo });
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: res.resultado, ...(res.erro ? { is_error: true } : {}) });
      }
      mensagens.push({ role: "user", content: resultados });
    }
  } catch (e) {
    const msg =
      e instanceof Anthropic.AuthenticationError
        ? "Claude: chave da API inválida (ANTHROPIC_API_KEY)."
        : e instanceof Anthropic.RateLimitError
          ? "Claude: limite de uso atingido, tentando de novo."
          : e instanceof Anthropic.APIError
            ? `Claude: ${e.status ?? ""} ${e.message}`.trim()
            : e instanceof Error
              ? e.message
              : String(e);
    await marcarErro(db, c.empresaId, msg);
    throw e; // a fila tenta de novo com espera crescente
  }

  if (recusou) {
    await passarParaHumano(db, c, "O modelo não quis responder esta mensagem.");
    acoes.push({ nome: "chamar_humano", resumo: "Recusa do modelo: passou para a equipe" });
  }
  const [depois] = await db.select({ status: conversas.status }).from(conversas).where(eq(conversas.id, c.id));
  if (!texto && depois?.status === "humano") texto = "Um momento, já vou chamar alguém da equipe para falar com você.";
  if (!texto) return { resultado: "pulou", motivo: "o agente não escreveu resposta" };

  // Rascunho antigo que ninguém aprovou perde o sentido: o cliente já falou de novo.
  await db
    .update(mensagensWhatsapp)
    .set({ status: "descartada" })
    .where(and(eq(mensagensWhatsapp.conversaId, c.id), eq(mensagensWhatsapp.status, "rascunho")));

  let status: "enviada" | "rascunho" | "falhou" = "enviada";
  let waMessageId: string | null = null;
  let erro: string | null = null;
  if (c.canal === "whatsapp") {
    if (agente.modo !== "automatico") status = "rascunho";
    else if (!janelaAberta(c.ultimaEntradaEm, agora)) {
      status = "falhou";
      erro = "A janela de 24h fechou antes da resposta.";
    } else {
      try {
        waMessageId = await enviar(conexaoDo(agente), c.telefone, texto);
      } catch (e) {
        status = "falhou";
        erro = e instanceof Error ? e.message : String(e);
        await marcarErro(db, c.empresaId, erro);
      }
    }
  }
  const tempoRespostaMs = Math.max(0, agora.getTime() - ultima.criadoEm.getTime());
  const [m] = await db
    .insert(mensagensWhatsapp)
    .values({
      conversaId: c.id,
      empresaId: c.empresaId,
      autor: "agente",
      texto,
      waMessageId,
      status,
      erro,
      acoes,
      tokensEntrada: uso.entrada,
      tokensSaida: uso.saida,
      tokensCache: uso.cache,
      custoMicrosUsd: uso.micros + (waMessageId ? CUSTO_META_MENSAGEM_MICROS : 0),
      tempoRespostaMs: status === "rascunho" ? null : tempoRespostaMs,
    })
    .returning({ id: mensagensWhatsapp.id });
  await db.update(conversas).set({ ultimaMensagemEm: new Date() }).where(eq(conversas.id, c.id));
  if (status !== "falhou" && agente.ultimoErro) await db.update(agentesWhatsapp).set({ ultimoErro: null, ultimoErroEm: null }).where(eq(agentesWhatsapp.empresaId, c.empresaId));
  return { resultado: status, mensagemId: m.id, texto };
}

// ─── Ações da equipe da loja ─────────────────────────────────────────────────

async function conversaDaEmpresa(db: BancoDeDados, empresaId: string, conversaId: string) {
  const [c] = await db.select().from(conversas).where(and(eq(conversas.id, conversaId), eq(conversas.empresaId, empresaId)));
  if (!c) throw new ErroAtendimento("Conversa não encontrada.");
  return c;
}

async function entregar(db: BancoDeDados, c: Conversa, texto: string, deps: Dependencias) {
  if (c.canal === "simulador") return null;
  if (!janelaAberta(c.ultimaEntradaEm, deps.agora?.())) throw new ErroAtendimento("Passaram 24h da última mensagem do cliente: o WhatsApp só deixa responder quando ele falar de novo.");
  const [agente] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.empresaId, c.empresaId));
  if (!agente) throw new ErroAtendimento("A loja não tem atendente configurado.");
  try {
    return await (deps.enviar ?? enviarPadrao)(conexaoDo(agente), c.telefone, texto);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await marcarErro(db, c.empresaId, msg);
    throw new ErroAtendimento(msg);
  }
}

/** Uma pessoa da loja responde: a conversa passa a ser dela (o agente para de responder). */
export async function responderComoEquipe(db: BancoDeDados, empresaId: string, conversaId: string, texto: string, usuarioId: string, deps: Dependencias = {}) {
  const c = await conversaDaEmpresa(db, empresaId, conversaId);
  const waMessageId = await entregar(db, c, texto, deps);
  await db.insert(mensagensWhatsapp).values({
    conversaId,
    empresaId,
    autor: "humano",
    texto,
    waMessageId,
    status: "enviada",
    usuarioId,
    custoMicrosUsd: waMessageId ? CUSTO_META_MENSAGEM_MICROS : 0,
  });
  await db.update(conversas).set({ status: "humano", naoLidas: 0, ultimaMensagemEm: new Date() }).where(eq(conversas.id, conversaId));
}

/** Modo aprovação: a pessoa revisa (e pode editar) o que o agente escreveu e envia. */
export async function aprovarRascunho(db: BancoDeDados, empresaId: string, mensagemId: string, texto: string, usuarioId: string, deps: Dependencias = {}) {
  const [m] = await db
    .select()
    .from(mensagensWhatsapp)
    .where(and(eq(mensagensWhatsapp.id, mensagemId), eq(mensagensWhatsapp.empresaId, empresaId), eq(mensagensWhatsapp.status, "rascunho")));
  if (!m) throw new ErroAtendimento("Este rascunho já foi enviado ou descartado.");
  const c = await conversaDaEmpresa(db, empresaId, m.conversaId);
  const final = texto.trim() || m.texto;
  const waMessageId = await entregar(db, c, final, deps);
  await db
    .update(mensagensWhatsapp)
    .set({
      texto: final,
      status: "enviada",
      waMessageId,
      usuarioId,
      custoMicrosUsd: (m.custoMicrosUsd ?? 0) + (waMessageId ? CUSTO_META_MENSAGEM_MICROS : 0),
      tempoRespostaMs: sql`(extract(epoch from now() - (select max(criado_em) from mensagens_whatsapp where conversa_id = ${m.conversaId} and autor = 'cliente')) * 1000)::int`,
    })
    .where(eq(mensagensWhatsapp.id, m.id));
  await db.update(conversas).set({ naoLidas: 0, ultimaMensagemEm: new Date() }).where(eq(conversas.id, c.id));
}

export async function descartarRascunho(db: BancoDeDados, empresaId: string, mensagemId: string) {
  await db
    .update(mensagensWhatsapp)
    .set({ status: "descartada" })
    .where(and(eq(mensagensWhatsapp.id, mensagemId), eq(mensagensWhatsapp.empresaId, empresaId), eq(mensagensWhatsapp.status, "rascunho")));
}

const TEXTO_STATUS: Record<StatusConversa, string> = {
  agente: "A conversa voltou para o agente.",
  humano: "Alguém da equipe assumiu a conversa.",
  encerrada: "Conversa encerrada.",
};

/** Assumir, devolver ao agente ou encerrar. Devolver com o cliente esperando já enfileira a resposta. */
export async function mudarStatusConversa(db: BancoDeDados, empresaId: string, conversaId: string, status: StatusConversa) {
  const c = await conversaDaEmpresa(db, empresaId, conversaId);
  if (c.status === status) return false;
  await db.update(conversas).set({ status, ...(status === "agente" ? { motivoHumano: null } : {}) }).where(eq(conversas.id, conversaId));
  await db.insert(mensagensWhatsapp).values({ conversaId, empresaId, autor: "sistema", texto: TEXTO_STATUS[status], status: "enviada" });
  if (status !== "agente") return false;
  const [ultima] = await db
    .select({ autor: mensagensWhatsapp.autor })
    .from(mensagensWhatsapp)
    .where(and(eq(mensagensWhatsapp.conversaId, conversaId), inArray(mensagensWhatsapp.autor, ["cliente", "agente", "humano"]), ne(mensagensWhatsapp.status, "descartada")))
    .orderBy(desc(mensagensWhatsapp.criadoEm))
    .limit(1);
  if (ultima?.autor !== "cliente") return false;
  await enfileirar(db, { tipo: "whatsapp_responder", empresaId, dados: { conversaId }, chave: `responder:devolvida:${conversaId}:${Date.now()}` });
  return true;
}

export async function marcarConversaLida(db: BancoDeDados, empresaId: string, conversaId: string) {
  await db.update(conversas).set({ naoLidas: 0 }).where(and(eq(conversas.id, conversaId), eq(conversas.empresaId, empresaId), ne(conversas.naoLidas, 0)));
}

// ─── Simulador ───────────────────────────────────────────────────────────────

const telefoneDeTeste = (usuarioId: string) => `teste-${usuarioId}`;

/** Testar o agente dentro do painel: mesma inteligência, sem WhatsApp, sem gravar vendas. */
export async function simularMensagem(db: BancoDeDados, empresaId: string, usuarioId: string, texto: string, deps: Dependencias = {}) {
  // Testar antes de configurar vale: nasce o atendente padrão (modo aprovação), sem número.
  await db.insert(agentesWhatsapp).values({ empresaId }).onConflictDoNothing();
  const r = await registrarEntrada(db, { empresaId, canal: "simulador", telefone: telefoneDeTeste(usuarioId), nome: null, texto, waMessageId: null, em: deps.agora?.() ?? new Date() });
  if (!r) throw new ErroAtendimento("Não deu para registrar a mensagem de teste.");
  if (r.conversa.status !== "agente") await db.update(conversas).set({ status: "agente" }).where(eq(conversas.id, r.conversa.id));
  return responderConversa(db, r.conversa.id, deps);
}

export async function limparSimulador(db: BancoDeDados, empresaId: string, usuarioId: string) {
  await db.delete(conversas).where(and(eq(conversas.empresaId, empresaId), eq(conversas.canal, "simulador"), eq(conversas.telefone, telefoneDeTeste(usuarioId))));
}

export async function conversaDeTeste(db: BancoDeDados, empresaId: string, usuarioId: string) {
  const [c] = await db
    .select()
    .from(conversas)
    .where(and(eq(conversas.empresaId, empresaId), eq(conversas.canal, "simulador"), eq(conversas.telefone, telefoneDeTeste(usuarioId))));
  if (!c) return { conversa: null, mensagens: [] };
  return { conversa: c, mensagens: await mensagensDaConversa(db, c.id) };
}

// ─── Consultas ───────────────────────────────────────────────────────────────

export type FiltroConversas = "abertas" | "agente" | "humano" | "aprovar" | "encerrada" | "todas";

export async function listarConversas(db: BancoDeDados, empresaId: string, filtro: FiltroConversas = "abertas", busca = "") {
  const termo = busca.trim();
  const rascunhos = sql<number>`(select count(*)::int from ${mensagensWhatsapp} m where m.conversa_id = "conversas"."id" and m.status = 'rascunho')`;
  return db
    .select({
      id: conversas.id,
      nome: conversas.nome,
      telefone: conversas.telefone,
      status: conversas.status,
      naoLidas: conversas.naoLidas,
      intencao: conversas.intencao,
      resumo: conversas.resumo,
      motivoHumano: conversas.motivoHumano,
      ultimaMensagemEm: conversas.ultimaMensagemEm,
      ultimaEntradaEm: conversas.ultimaEntradaEm,
      clienteId: conversas.clienteId,
      rascunhos,
      ultimoTexto: sql<string | null>`(select m.texto from ${mensagensWhatsapp} m where m.conversa_id = "conversas"."id" and m.autor <> 'sistema' and m.status <> 'descartada' order by m.criado_em desc limit 1)`,
      ultimoAutor: sql<string | null>`(select m.autor::text from ${mensagensWhatsapp} m where m.conversa_id = "conversas"."id" and m.autor <> 'sistema' and m.status <> 'descartada' order by m.criado_em desc limit 1)`,
    })
    .from(conversas)
    .where(
      and(
        eq(conversas.empresaId, empresaId),
        eq(conversas.canal, "whatsapp"),
        filtro === "abertas" ? ne(conversas.status, "encerrada") : filtro === "todas" ? undefined : filtro === "aprovar" ? sql`${rascunhos} > 0` : eq(conversas.status, filtro),
        termo ? or(ilike(conversas.nome, `%${termo}%`), ilike(conversas.telefone, `%${termo.replace(/\D/g, "") || termo}%`), ilike(conversas.resumo, `%${termo}%`)) : undefined,
      ),
    )
    .orderBy(desc(conversas.ultimaMensagemEm))
    .limit(200);
}

export async function mensagensDaConversa(db: BancoDeDados, conversaId: string) {
  const linhas = await db
    .select({
      id: mensagensWhatsapp.id,
      autor: mensagensWhatsapp.autor,
      texto: mensagensWhatsapp.texto,
      status: mensagensWhatsapp.status,
      erro: mensagensWhatsapp.erro,
      acoes: mensagensWhatsapp.acoes,
      custoMicrosUsd: mensagensWhatsapp.custoMicrosUsd,
      tempoRespostaMs: mensagensWhatsapp.tempoRespostaMs,
      criadoEm: mensagensWhatsapp.criadoEm,
    })
    .from(mensagensWhatsapp)
    .where(and(eq(mensagensWhatsapp.conversaId, conversaId), ne(mensagensWhatsapp.status, "descartada")))
    .orderBy(desc(mensagensWhatsapp.criadoEm))
    .limit(300);
  return linhas.reverse();
}

export async function obterConversa(db: BancoDeDados, empresaId: string, conversaId: string) {
  const [c] = await db
    .select()
    .from(conversas)
    .where(and(eq(conversas.id, conversaId), eq(conversas.empresaId, empresaId), eq(conversas.canal, "whatsapp")));
  if (!c) return null;
  return { conversa: c, mensagens: await mensagensDaConversa(db, c.id) };
}

export async function obterAgente(db: BancoDeDados, empresaId: string) {
  const [a] = await db.select().from(agentesWhatsapp).where(eq(agentesWhatsapp.empresaId, empresaId));
  return a ?? null;
}

/** Números da loja para o topo da tela de conversas. */
export async function resumoDaLoja(db: BancoDeDados, empresaId: string, agora = new Date()) {
  const inicioDoDia = new Date(`${hoje(agora)}T00:00:00-03:00`);
  const [r] = await db
    .select({
      abertas: sql<number>`count(*) filter (where ${conversas.status} <> 'encerrada')::int`,
      comEquipe: sql<number>`count(*) filter (where ${conversas.status} = 'humano')::int`,
      naoLidas: sql<number>`coalesce(sum(${conversas.naoLidas}), 0)::int`,
      hoje: sql<number>`count(*) filter (where ${conversas.ultimaEntradaEm} >= ${inicioDoDia.toISOString()})::int`,
    })
    .from(conversas)
    .where(and(eq(conversas.empresaId, empresaId), eq(conversas.canal, "whatsapp")));
  const [{ aprovar }] = await db
    .select({ aprovar: sql<number>`count(*)::int` })
    .from(mensagensWhatsapp)
    .innerJoin(conversas, eq(conversas.id, mensagensWhatsapp.conversaId))
    .where(and(eq(mensagensWhatsapp.empresaId, empresaId), eq(mensagensWhatsapp.status, "rascunho"), eq(conversas.canal, "whatsapp")));
  return { ...r, aprovar };
}

// ─── Central: todas as lojas ─────────────────────────────────────────────────

/** Uma linha por loja com agente: situação, volume, quem está atendendo, custo e erros. */
export async function painelAtendimento(db: BancoDeDados, agora = new Date()) {
  const inicioDoDia = new Date(`${hoje(agora)}T00:00:00-03:00`).toISOString();
  const seteDias = new Date(agora.getTime() - 7 * 86_400_000).toISOString();
  const trintaDias = new Date(agora.getTime() - 30 * 86_400_000);
  // Subconsultas com o nome da tabela escrito: o Drizzle só qualifica a coluna quando há join.
  const linhas = await db
    .select({
      empresaId: agentesWhatsapp.empresaId,
      empresa: empresas.nome,
      perfil: empresas.perfil,
      nome: agentesWhatsapp.nome,
      modo: agentesWhatsapp.modo,
      modelo: agentesWhatsapp.modelo,
      numero: agentesWhatsapp.numeroExibicao,
      conectado: sql<boolean>`(${agentesWhatsapp.phoneNumberId} is not null and ${agentesWhatsapp.tokenCifrado} is not null)`,
      ultimoErro: agentesWhatsapp.ultimoErro,
      ultimoErroEm: agentesWhatsapp.ultimoErroEm,
      conversasHoje: sql<number>`(select count(*)::int from ${conversas} c where c.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp' and c.ultima_entrada_em >= ${inicioDoDia})`,
      conversas7d: sql<number>`(select count(*)::int from ${conversas} c where c.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp' and c.ultima_entrada_em >= ${seteDias})`,
      comEquipe: sql<number>`(select count(*)::int from ${conversas} c where c.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp' and c.status = 'humano')`,
      naoLidas: sql<number>`(select coalesce(sum(c.nao_lidas), 0)::int from ${conversas} c where c.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp')`,
      ultimaAtividade: sql<Date | null>`(select max(c.ultima_mensagem_em) from ${conversas} c where c.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp')`,
      respostasAgente7d: sql<number>`(select count(*)::int from ${mensagensWhatsapp} m join ${conversas} c on c.id = m.conversa_id where m.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp' and m.autor = 'agente' and m.status in ('enviada','entregue','lida') and m.criado_em >= ${seteDias})`,
      respostasEquipe7d: sql<number>`(select count(*)::int from ${mensagensWhatsapp} m join ${conversas} c on c.id = m.conversa_id where m.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp' and m.autor = 'humano' and m.criado_em >= ${seteDias})`,
      aprovar: sql<number>`(select count(*)::int from ${mensagensWhatsapp} m join ${conversas} c on c.id = m.conversa_id where m.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp' and m.status = 'rascunho')`,
      falhas7d: sql<number>`(select count(*)::int from ${mensagensWhatsapp} m where m.empresa_id = "agentes_whatsapp"."empresa_id" and m.status = 'falhou' and m.criado_em >= ${seteDias})`,
      tempoMedioMs: sql<number | null>`(select avg(m.tempo_resposta_ms)::int from ${mensagensWhatsapp} m join ${conversas} c on c.id = m.conversa_id where m.empresa_id = "agentes_whatsapp"."empresa_id" and c.canal = 'whatsapp' and m.autor = 'agente' and m.tempo_resposta_ms is not null and m.criado_em >= ${seteDias})`,
      custo30dMicros: sql<number>`(select coalesce(sum(m.custo_micros_usd), 0)::bigint from ${mensagensWhatsapp} m where m.empresa_id = "agentes_whatsapp"."empresa_id" and m.criado_em >= ${trintaDias.toISOString()})`,
      vendas30d: sql<number>`(select count(*)::int from ${vendas} v where v.empresa_id = "agentes_whatsapp"."empresa_id" and v.origem = 'whatsapp' and v.excluido_em is null and v.data >= ${hoje(trintaDias)})`,
      vendas30dCentavos: sql<number>`(select coalesce(sum(v.valor_centavos), 0)::bigint from ${vendas} v where v.empresa_id = "agentes_whatsapp"."empresa_id" and v.origem = 'whatsapp' and v.excluido_em is null and v.data >= ${hoje(trintaDias)})`,
    })
    .from(agentesWhatsapp)
    .innerJoin(empresas, eq(empresas.id, agentesWhatsapp.empresaId))
    .orderBy(asc(empresas.nome));
  return linhas.map((l) => ({
    ...l,
    custo30dMicros: Number(l.custo30dMicros),
    vendas30dCentavos: Number(l.vendas30dCentavos),
    ultimaAtividade: l.ultimaAtividade ? new Date(l.ultimaAtividade) : null,
  }));
}

/** As últimas mensagens de todas as lojas, para o "ao vivo" da Central. */
export async function movimentoRecente(db: BancoDeDados, limite = 25, empresaId?: string) {
  return db
    .select({
      id: mensagensWhatsapp.id,
      empresaId: mensagensWhatsapp.empresaId,
      empresa: empresas.nome,
      conversaId: mensagensWhatsapp.conversaId,
      cliente: conversas.nome,
      telefone: conversas.telefone,
      autor: mensagensWhatsapp.autor,
      texto: mensagensWhatsapp.texto,
      status: mensagensWhatsapp.status,
      acoes: mensagensWhatsapp.acoes,
      criadoEm: mensagensWhatsapp.criadoEm,
    })
    .from(mensagensWhatsapp)
    .innerJoin(conversas, eq(conversas.id, mensagensWhatsapp.conversaId))
    .innerJoin(empresas, eq(empresas.id, mensagensWhatsapp.empresaId))
    .where(and(eq(conversas.canal, "whatsapp"), ne(mensagensWhatsapp.status, "descartada"), empresaId ? eq(mensagensWhatsapp.empresaId, empresaId) : undefined))
    .orderBy(desc(mensagensWhatsapp.criadoEm))
    .limit(limite);
}

/** Lojas com o módulo WhatsApp ligado que ainda não têm agente (para a Central oferecer criar). */
export async function lojasSemAgente(db: BancoDeDados) {
  return db
    .select({ id: empresas.id, nome: empresas.nome, perfil: empresas.perfil })
    .from(empresas)
    .leftJoin(agentesWhatsapp, eq(agentesWhatsapp.empresaId, empresas.id))
    .where(isNull(agentesWhatsapp.empresaId))
    .orderBy(asc(empresas.nome));
}
