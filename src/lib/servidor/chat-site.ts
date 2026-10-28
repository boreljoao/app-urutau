import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTextBlockParam, BetaTool, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, asc, count, desc, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { BancoDeDados } from "@/db";
import { conversasSite, interacoes, leads, mensagensSite, usuarios, type StatusConversa } from "@/db/schema";
import { custoIaMicros, historicoParaClaude } from "@/lib/atendimento";
import {
  FRENTES_CHAT,
  LIMITES_CHAT,
  PROMPT_DO_SITE,
  TEMPERATURAS,
  URGENCIAS,
  equipeNoHorario,
  juntarFicha,
  limiteDiarioDoChat,
  textoParaWhatsapp,
  type FichaVisitante,
} from "@/lib/chat-site";
import { normalizarTelefone } from "@/lib/validacao";
import { ErroAtendimento, criarPadrao, formatoDaChave, type CriarMensagem } from "./atendimento";
import { leadDoSite } from "./comercial";

/**
 * O chat do site urutau.io: o visitante conversa com o agente da Urutau a qualquer hora.
 * O agente explica as frentes, oferece o diagnóstico e salva o contato como lead no Comercial;
 * quando precisa, chama a equipe, que responde pela Central e a resposta aparece no chat.
 */

export interface DependenciasDoChat {
  criar?: CriarMensagem;
  agora?: () => Date;
}

type Conversa = typeof conversasSite.$inferSelect;

/** O que o visitante pode ver: nada de mensagens do sistema, custo ou ferramentas. */
export interface MensagemVisivel {
  id: string;
  autor: "cliente" | "agente" | "humano";
  texto: string;
  criadoEm: string;
}

export type EstadoDoChat = "ok" | "equipe" | "indisponivel" | "limite" | "devagar";

export interface RespostaDoChat {
  estado: EstadoDoChat;
  status: StatusConversa;
  mensagens: MensagemVisivel[];
  /** Texto para mostrar no chat quando o agente não respondeu. */
  aviso?: string;
  /** A mensagem que já vai escrita no botão "Continuar no WhatsApp", com o que o visitante contou. */
  whatsapp?: string;
}

const WHATSAPP = "(21) 99368-9481";

export const AVISOS: Record<Exclude<EstadoDoChat, "ok">, string> = {
  equipe: "Já avisei a equipe. Alguém responde por aqui mesmo, no horário comercial.",
  indisponivel: `Meu atendimento automático está fora do ar agora. Deixe seu nome e WhatsApp que a equipe chama você, ou fale direto no ${WHATSAPP}.`,
  limite: `Essa conversa ficou longa! Para continuar, chame a gente no WhatsApp ${WHATSAPP}.`,
  devagar: "Calma que eu leio tudo 🙂 Espere um minutinho e mande de novo.",
};

const visivel = (m: { id: string; autor: string; texto: string; criadoEm: Date }): MensagemVisivel => ({
  id: m.id,
  autor: m.autor as MensagemVisivel["autor"],
  texto: m.texto,
  criadoEm: m.criadoEm.toISOString(),
});

// ─── O agente ────────────────────────────────────────────────────────────────

const MAX_VOLTAS = 4;

const FERRAMENTAS: BetaTool[] = [
  {
    name: "anotar_visitante",
    description:
      "Anota na ficha do visitante o que ele contou, para a equipe ler no painel. Chame junto com a resposta sempre que aprender algo novo; mande só os campos novos ou corrigidos.",
    input_schema: {
      type: "object",
      properties: {
        objetivo: { type: "string", description: "O que a pessoa quer, em uma frase curta." },
        negocio: { type: "string", description: "Ramo e tamanho do negócio." },
        usaHoje: { type: "string", description: "O que ela usa hoje (planilha, sistema, WhatsApp na mão…)." },
        duvidas: { type: "array", items: { type: "string" }, description: "Perguntas novas que ela fez, uma por item." },
        urgencia: { type: "string", enum: [...URGENCIAS], description: "agora = quer para já; este_mes = próximas semanas; pesquisando = sem pressa." },
        orcamento: { type: "string", description: "Quanto ela disse que pode investir, como falou." },
        temperatura: { type: "string", enum: [...TEMPERATURAS], description: "quente = quer fechar logo; morno = interessado; frio = só curiosidade." },
        interesses: { type: "array", items: { type: "string", enum: FRENTES_CHAT }, description: "Frentes da Urutau que resolvem o caso." },
        proximoPasso: { type: "string", description: "O que a equipe deve fazer a seguir." },
      },
    },
  },
  {
    name: "salvar_contato",
    description:
      "Salva o visitante como lead no Comercial da Urutau para a equipe chamar. Use assim que tiver o nome e um WhatsApp ou e-mail; pode chamar de novo se ele corrigir algo.",
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome da pessoa." },
        negocio: { type: "string", description: "Nome ou tipo da empresa, se ela disse." },
        whatsapp: { type: "string", description: "WhatsApp com DDD, como a pessoa escreveu." },
        email: { type: "string" },
        interesses: { type: "array", items: { type: "string", enum: FRENTES_CHAT }, description: "Frentes que interessam." },
        resumo: { type: "string", description: "Em uma ou duas frases: o negócio e o que a pessoa precisa." },
      },
      required: ["nome", "resumo"],
    },
  },
  {
    name: "chamar_equipe",
    description:
      "Avisa a equipe da Urutau para responder esta conversa. Depois disso você não responde mais aqui: na mesma resposta, diga que alguém da equipe vai responder no horário comercial.",
    input_schema: {
      type: "object",
      properties: { motivo: { type: "string", description: "Por que precisa de uma pessoa, em uma frase." } },
      required: ["motivo"],
    },
  },
];

const entradas = {
  salvar_contato: z.object({
    nome: z.string().trim().min(1).max(120),
    negocio: z.string().trim().max(120).optional(),
    whatsapp: z.string().trim().max(40).optional(),
    email: z.email().optional().catch(undefined),
    interesses: z.array(z.enum(FRENTES_CHAT as [string, ...string[]])).max(6).optional().catch(undefined),
    resumo: z.string().trim().max(600).optional(),
  }),
  chamar_equipe: z.object({ motivo: z.string().trim().min(1).max(300) }),
  anotar_visitante: z.object({
    objetivo: z.string().trim().max(300).optional().catch(undefined),
    negocio: z.string().trim().max(200).optional().catch(undefined),
    usaHoje: z.string().trim().max(200).optional().catch(undefined),
    duvidas: z.array(z.string().trim().min(1).max(300)).max(8).optional().catch(undefined),
    urgencia: z.enum(URGENCIAS).optional().catch(undefined),
    orcamento: z.string().trim().max(120).optional().catch(undefined),
    temperatura: z.enum(TEMPERATURAS).optional().catch(undefined),
    interesses: z.array(z.enum(FRENTES_CHAT as [string, ...string[]])).max(6).optional().catch(undefined),
    proximoPasso: z.string().trim().max(300).optional().catch(undefined),
  }),
};

interface ResultadoFerramenta {
  resumo: string;
  resultado: string;
  erro?: boolean;
}

const juntar = (a: string[], b: string[] = []) => [...new Set([...a, ...b])];

async function anotarVisitante(db: BancoDeDados, c: Conversa, input: unknown): Promise<ResultadoFerramenta> {
  const p = entradas.anotar_visitante.safeParse(input ?? {});
  if (!p.success) return { resumo: "ficha inválida", resultado: "Nada anotado: campos inválidos.", erro: true };
  const { interesses, ...nova } = p.data;
  const ficha = juntarFicha(c.ficha, nova);
  await db
    .update(conversasSite)
    .set({ ficha, interesses: juntar(c.interesses, interesses), ...(!c.resumo && ficha.objetivo ? { resumo: ficha.objetivo } : {}) })
    .where(eq(conversasSite.id, c.id));
  const anotado = [nova.objetivo && "objetivo", nova.negocio && "negócio", nova.duvidas?.length && "dúvida", nova.urgencia && "urgência", nova.orcamento && "orçamento", nova.temperatura && nova.temperatura]
    .filter(Boolean)
    .join(", ");
  return { resumo: `Anotou: ${anotado || "ficha"}`, resultado: "Anotado." };
}

/** A ficha em texto, para a nota do lead e para o assistente da equipe. */
export function fichaEmTexto(f: FichaVisitante) {
  return [
    f.objetivo && `Quer: ${f.objetivo}`,
    f.negocio && `Negócio: ${f.negocio}`,
    f.usaHoje && `Usa hoje: ${f.usaHoje}`,
    f.urgencia && `Urgência: ${f.urgencia}`,
    f.orcamento && `Orçamento: ${f.orcamento}`,
    f.temperatura && `Temperatura: ${f.temperatura}`,
    f.duvidas?.length && `Dúvidas: ${f.duvidas.join(" | ")}`,
    f.proximoPasso && `Próximo passo: ${f.proximoPasso}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function salvarContato(db: BancoDeDados, c: Conversa, input: unknown): Promise<ResultadoFerramenta> {
  const p = entradas.salvar_contato.safeParse(input);
  if (!p.success) return { resumo: "contato inválido", resultado: "Dados inválidos: informe ao menos nome e resumo.", erro: true };
  const d = p.data;
  const telefone = d.whatsapp ? normalizarTelefone(d.whatsapp) : null;
  const email = d.email?.toLowerCase() ?? null;
  if (!telefone && !email) {
    return {
      resumo: "faltou o contato",
      resultado: d.whatsapp ? "Esse WhatsApp não parece completo. Peça o número com DDD." : "Ainda falta um WhatsApp ou e-mail. Peça antes de salvar.",
      erro: true,
    };
  }
  const contato = telefone ?? email;
  let leadId = c.leadId;
  if (leadId) {
    const [l] = await db.select({ interesses: leads.interesses, telefone: leads.telefone, email: leads.email }).from(leads).where(eq(leads.id, leadId));
    if (l) {
      await db
        .update(leads)
        .set({ interesses: juntar(l.interesses, d.interesses), ...(telefone && !l.telefone ? { telefone } : {}), ...(email && !l.email ? { email } : {}) })
        .where(eq(leads.id, leadId));
    } else leadId = null;
  }
  if (!leadId) {
    const r = await leadDoSite(db, {
      tipo: "contato",
      nome: d.nome,
      negocio: d.negocio ?? null,
      telefone,
      email: telefone ? null : email,
      mensagem: [`Pelo chat do site: ${d.resumo ?? "deixou contato."}`, fichaEmTexto(c.ficha)].filter(Boolean).join("\n"),
      dores: [],
      tamanho: null,
      pagina: c.pagina,
      visitanteId: c.visitanteId,
    });
    leadId = r?.id ?? null;
    if (leadId && d.interesses?.length) {
      const [l] = await db.select({ interesses: leads.interesses }).from(leads).where(eq(leads.id, leadId));
      await db.update(leads).set({ interesses: juntar(l?.interesses ?? [], d.interesses) }).where(eq(leads.id, leadId));
    }
  }
  await db
    .update(conversasSite)
    .set({ leadId, nome: d.nome, contato, interesses: juntar(c.interesses, d.interesses), ...(d.resumo ? { resumo: d.resumo } : {}) })
    .where(eq(conversasSite.id, c.id));
  return {
    resumo: `Contato salvo: ${d.nome} · ${contato}`,
    resultado: "Contato salvo no Comercial. A equipe chama no próximo horário comercial; avise a pessoa.",
  };
}

async function passarParaEquipe(db: BancoDeDados, c: Conversa, motivo: string) {
  await db.update(conversasSite).set({ status: "humano", motivoHumano: motivo }).where(eq(conversasSite.id, c.id));
  await db.insert(mensagensSite).values({ conversaId: c.id, autor: "sistema", texto: `O agente chamou a equipe: ${motivo}` });
  if (c.leadId) await db.insert(interacoes).values({ leadId: c.leadId, tipo: "nota", texto: `Pediu a equipe no chat do site: ${motivo}` });
}

async function executarFerramenta(db: BancoDeDados, c: Conversa, nome: string, input: unknown): Promise<ResultadoFerramenta> {
  if (nome === "anotar_visitante") return anotarVisitante(db, c, input);
  if (nome === "salvar_contato") return salvarContato(db, c, input);
  if (nome === "chamar_equipe") {
    const p = entradas.chamar_equipe.safeParse(input);
    const motivo = p.success ? p.data.motivo : "O agente pediu ajuda.";
    await passarParaEquipe(db, c, motivo);
    return { resumo: `Chamou a equipe: ${motivo}`, resultado: "A equipe foi avisada. Avise a pessoa e não responda mais." };
  }
  return { resumo: `ferramenta desconhecida: ${nome}`, resultado: `Ferramenta ${nome} não existe.`, erro: true };
}

const formatoAgora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** A parte do prompt que muda a cada resposta: fica fora do cache. */
function contextoDoMomento(c: Conversa, agora: Date) {
  return [
    `Agora: ${formatoAgora.format(agora)} (horário de Brasília). ${equipeNoHorario(agora) ? "A equipe está no horário." : "A equipe está fora do horário."}`,
    c.nome ? `Visitante: ${c.nome}${c.contato ? `, contato já salvo (${c.contato})` : ""}.` : "Visitante: nome ainda não informado.",
    c.resumo ? `Resumo: ${c.resumo}` : "",
    Object.keys(c.ficha).length ? `Ficha já anotada (não repita):\n${fichaEmTexto(c.ficha)}` : "Ficha ainda vazia.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** O chat do site usa o Sonnet: inteligente o bastante para vender e metade do custo do Opus. */
export const MODELO_DO_CHAT = "claude-sonnet-5-5";
const modeloDoChat = () => process.env.SITE_CHAT_MODELO || MODELO_DO_CHAT;

async function rodarAgente(db: BancoDeDados, c: Conversa, criar: CriarMensagem, agora: Date) {
  const recentes = await db
    .select({ autor: mensagensSite.autor, texto: mensagensSite.texto })
    .from(mensagensSite)
    .where(eq(mensagensSite.conversaId, c.id))
    .orderBy(desc(mensagensSite.criadoEm))
    .limit(30);
  const historico = recentes.reverse().map((m) =>
    m.autor === "humano" ? { autor: "agente" as const, texto: `[resposta de alguém da equipe Urutau] ${m.texto}`, status: "enviada" } : { ...m, status: "enviada" },
  );
  const system: BetaTextBlockParam[] = [
    { type: "text", text: PROMPT_DO_SITE, cache_control: { type: "ephemeral" } },
    { type: "text", text: contextoDoMomento(c, agora) },
  ];
  const mensagens: BetaMessageParam[] = historicoParaClaude(historico).map((t) => ({ role: t.role, content: t.content }));
  const uso = { entrada: 0, saida: 0, cache: 0, micros: 0 };
  const acoes: { nome: string; resumo: string }[] = [];
  let texto = "";
  let recusou = false;

  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const r = await criar({
      model: modeloDoChat(),
      max_tokens: 1024,
      system,
      tools: FERRAMENTAS,
      messages: mensagens,
      output_config: { effort: "low" },
      // Se o modelo recusar por política, a API tenta o substituto padrão antes de desistir.
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
      const [atual] = await db.select().from(conversasSite).where(eq(conversasSite.id, c.id));
      const res = await executarFerramenta(db, atual ?? c, u.name, u.input);
      acoes.push({ nome: u.name, resumo: res.resumo });
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: res.resultado, ...(res.erro ? { is_error: true } : {}) });
    }
    mensagens.push({ role: "user", content: resultados });
    // Só anotou e a resposta já está escrita: não precisa de outra volta (economiza uma chamada).
    if (texto && usos.every((u) => u.name === "anotar_visitante")) break;
  }

  if (recusou) {
    await passarParaEquipe(db, c, "O modelo não quis responder esta mensagem.");
    acoes.push({ nome: "chamar_equipe", resumo: "Recusa do modelo: passou para a equipe" });
  }
  const [depois] = await db.select({ status: conversasSite.status }).from(conversasSite).where(eq(conversasSite.id, c.id));
  if (!texto && depois?.status === "humano") texto = AVISOS.equipe;
  return { texto, uso, acoes };
}

function descreverErro(e: unknown) {
  if (e instanceof ErroAtendimento) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return `Claude: chave da API inválida (ANTHROPIC_API_KEY): ${formatoDaChave()}.`;
  if (e instanceof Anthropic.RateLimitError) return "Claude: limite de uso atingido.";
  if (e instanceof Anthropic.APIError) return `Claude: ${e.status ?? ""} ${e.message}`.trim();
  return e instanceof Error ? e.message : String(e);
}

// ─── O que o site chama ──────────────────────────────────────────────────────

export interface EntradaDoChat {
  chave: string;
  texto: string;
  visitanteId?: string | null;
  pagina?: string | null;
}

/** Grava a mensagem do visitante e, se a conversa está com o agente, responde na hora. */
export async function conversarNoSite(db: BancoDeDados, e: EntradaDoChat, deps: DependenciasDoChat = {}): Promise<RespostaDoChat> {
  const criar = deps.criar ?? criarPadrao;
  const agora = deps.agora?.() ?? new Date();
  const texto = e.texto.trim().slice(0, LIMITES_CHAT.texto);
  if (!texto) throw new ErroAtendimento("Mensagem vazia.");

  await db
    .insert(conversasSite)
    .values({ chave: e.chave, visitanteId: e.visitanteId ?? null, pagina: e.pagina?.slice(0, 200) ?? null, ultimaMensagemEm: agora })
    .onConflictDoNothing({ target: conversasSite.chave });
  let [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, e.chave));

  const desde = new Date(agora.getTime() - 10 * 60_000);
  const [n] = await db
    .select({ total: count(), recentes: sql<number>`count(*) filter (where ${gt(mensagensSite.criadoEm, desde)})`.mapWith(Number) })
    .from(mensagensSite)
    .where(and(eq(mensagensSite.conversaId, c.id), eq(mensagensSite.autor, "cliente")));
  if (n.total >= LIMITES_CHAT.porConversa) return { estado: "limite", status: c.status, mensagens: [], aviso: AVISOS.limite };
  if (n.recentes >= LIMITES_CHAT.porDezMinutos) return { estado: "devagar", status: c.status, mensagens: [], aviso: AVISOS.devagar };

  const [doCliente] = await db.insert(mensagensSite).values({ conversaId: c.id, autor: "cliente", texto, criadoEm: agora }).returning();
  [c] = await db
    .update(conversasSite)
    .set({
      ultimaMensagemEm: agora,
      naoLidas: sql`${conversasSite.naoLidas} + 1`,
      ...(e.visitanteId && !c.visitanteId ? { visitanteId: e.visitanteId } : {}),
      // Quem volta depois de a equipe encerrar fala de novo com o agente.
      ...(c.status === "encerrada" ? { status: "agente" as const } : {}),
    })
    .where(eq(conversasSite.id, c.id))
    .returning();
  const mensagens = [visivel(doCliente)];

  if (c.status === "humano") {
    if (c.leadId) await db.insert(interacoes).values({ leadId: c.leadId, tipo: "nota", texto: `Escreveu no chat do site: ${texto.slice(0, 300)}` });
    return { estado: "equipe", status: c.status, mensagens };
  }

  const [hoje] = await db
    .select({ n: count() })
    .from(mensagensSite)
    .where(and(eq(mensagensSite.autor, "agente"), gt(mensagensSite.criadoEm, new Date(agora.getTime() - 24 * 3600_000))));
  if (hoje.n >= limiteDiarioDoChat()) {
    await db.insert(mensagensSite).values({ conversaId: c.id, autor: "sistema", texto: "Limite diário de respostas da IA atingido: o visitante viu o aviso para deixar contato." });
    return { estado: "indisponivel", status: c.status, mensagens, aviso: AVISOS.indisponivel };
  }

  let resposta: Awaited<ReturnType<typeof rodarAgente>>;
  try {
    resposta = await rodarAgente(db, c, criar, agora);
  } catch (erro) {
    const motivo = descreverErro(erro);
    console.error("[chat do site]", motivo);
    await db.insert(mensagensSite).values({ conversaId: c.id, autor: "sistema", texto: `O agente não respondeu: ${motivo}`.slice(0, 500) });
    return { estado: "indisponivel", status: c.status, mensagens, aviso: AVISOS.indisponivel };
  }

  const [atual] = await db.select().from(conversasSite).where(eq(conversasSite.id, c.id));
  const whatsapp = textoParaWhatsapp(atual);
  if (!resposta.texto) return { estado: atual.status === "humano" ? "equipe" : "ok", status: atual.status, mensagens, whatsapp };
  const fim = deps.agora?.() ?? new Date();
  const [doAgente] = await db
    .insert(mensagensSite)
    .values({
      conversaId: c.id,
      autor: "agente",
      texto: resposta.texto,
      acoes: resposta.acoes,
      tokensEntrada: resposta.uso.entrada,
      tokensSaida: resposta.uso.saida,
      tokensCache: resposta.uso.cache,
      custoMicrosUsd: resposta.uso.micros,
      tempoRespostaMs: Math.max(0, fim.getTime() - agora.getTime()),
      // Um milissegundo depois da pergunta, para a ordem nunca empatar.
      criadoEm: new Date(Math.max(fim.getTime(), agora.getTime() + 1)),
    })
    .returning();
  await db.update(conversasSite).set({ ultimaMensagemEm: doAgente.criadoEm }).where(eq(conversasSite.id, c.id));
  return { estado: atual.status === "humano" ? "equipe" : "ok", status: atual.status, mensagens: [...mensagens, visivel(doAgente)], whatsapp };
}

/** Para o chat buscar o que chegou (resposta da equipe) e para retomar a conversa ao recarregar. */
export async function lerConversaDoSite(db: BancoDeDados, chave: string, depois?: Date | null) {
  const [c] = await db.select().from(conversasSite).where(eq(conversasSite.chave, chave));
  if (!c) return null;
  const lista = await db
    .select({ id: mensagensSite.id, autor: mensagensSite.autor, texto: mensagensSite.texto, criadoEm: mensagensSite.criadoEm })
    .from(mensagensSite)
    .where(and(eq(mensagensSite.conversaId, c.id), ne(mensagensSite.autor, "sistema"), depois ? gt(mensagensSite.criadoEm, depois) : undefined))
    .orderBy(asc(mensagensSite.criadoEm))
    .limit(80);
  return { status: c.status, mensagens: lista.map(visivel), whatsapp: textoParaWhatsapp(c) };
}

// ─── A equipe, pela Central ──────────────────────────────────────────────────

export async function responderNoSiteComoEquipe(db: BancoDeDados, conversaId: string, texto: string, usuarioId: string) {
  const t = texto.trim();
  if (!t) throw new ErroAtendimento("Escreva a resposta.");
  const [c] = await db.select().from(conversasSite).where(eq(conversasSite.id, conversaId));
  if (!c) throw new ErroAtendimento("Conversa não encontrada.");
  const agora = new Date();
  await db.insert(mensagensSite).values({ conversaId, autor: "humano", texto: t.slice(0, 4000), usuarioId, criadoEm: agora });
  // Quem responde assume a conversa: o agente para de responder até a equipe devolver.
  await db.update(conversasSite).set({ status: "humano", naoLidas: 0, ultimaMensagemEm: agora }).where(eq(conversasSite.id, conversaId));
  if (c.leadId) await db.insert(interacoes).values({ leadId: c.leadId, autorId: usuarioId, tipo: "nota", texto: `Respondeu no chat do site: ${t.slice(0, 300)}` });
}

const TEXTO_STATUS: Record<StatusConversa, string> = {
  agente: "A equipe devolveu a conversa ao agente.",
  humano: "A equipe assumiu a conversa.",
  encerrada: "A equipe encerrou a conversa.",
};

export async function mudarStatusDoSite(db: BancoDeDados, conversaId: string, status: StatusConversa) {
  const [c] = await db.update(conversasSite).set({ status, naoLidas: 0 }).where(eq(conversasSite.id, conversaId)).returning({ id: conversasSite.id });
  if (!c) throw new ErroAtendimento("Conversa não encontrada.");
  await db.insert(mensagensSite).values({ conversaId, autor: "sistema", texto: TEXTO_STATUS[status] });
}

export async function marcarSiteLida(db: BancoDeDados, conversaId: string) {
  await db.update(conversasSite).set({ naoLidas: 0 }).where(eq(conversasSite.id, conversaId));
}

export type FiltroChat = "abertas" | "equipe" | "quentes" | "contato" | "todas";

export async function listarConversasDoSite(db: BancoDeDados, filtro: FiltroChat = "abertas", limite = 80) {
  const onde =
    filtro === "abertas"
      ? ne(conversasSite.status, "encerrada")
      : filtro === "equipe"
        ? eq(conversasSite.status, "humano")
        : filtro === "quentes"
          ? sql`${conversasSite.ficha}->>'temperatura' = 'quente'`
          : filtro === "contato"
            ? isNotNull(conversasSite.leadId)
            : undefined;
  return db
    .select({
      id: conversasSite.id,
      nome: conversasSite.nome,
      contato: conversasSite.contato,
      status: conversasSite.status,
      resumo: conversasSite.resumo,
      ficha: conversasSite.ficha,
      interesses: conversasSite.interesses,
      motivoHumano: conversasSite.motivoHumano,
      leadId: conversasSite.leadId,
      naoLidas: conversasSite.naoLidas,
      ultimaMensagemEm: conversasSite.ultimaMensagemEm,
      criadoEm: conversasSite.criadoEm,
      mensagens: sql<number>`(select count(*) from "mensagens_site" m where m."conversa_id" = "conversas_site"."id" and m."autor" <> 'sistema')`.mapWith(Number),
      ultimaMensagem: sql<string | null>`(select m."texto" from "mensagens_site" m where m."conversa_id" = "conversas_site"."id" and m."autor" <> 'sistema' order by m."criado_em" desc limit 1)`,
      /** Quem falou por último (sem contar o sistema): se foi o visitante, a equipe deve uma resposta. */
      ultimoAutor: sql<"cliente" | "agente" | "humano" | null>`(select m."autor" from "mensagens_site" m where m."conversa_id" = "conversas_site"."id" and m."autor" <> 'sistema' order by m."criado_em" desc limit 1)`,
      custoMicros: sql<number>`(select coalesce(sum(m."custo_micros_usd"), 0) from "mensagens_site" m where m."conversa_id" = "conversas_site"."id")`.mapWith(Number),
    })
    .from(conversasSite)
    .where(onde)
    .orderBy(desc(conversasSite.ultimaMensagemEm))
    .limit(limite);
}

export async function conversaDoSiteParaEquipe(db: BancoDeDados, conversaId: string) {
  const [c] = await db.select().from(conversasSite).where(eq(conversasSite.id, conversaId));
  if (!c) return null;
  const mensagens = await db
    .select({
      id: mensagensSite.id,
      autor: mensagensSite.autor,
      texto: mensagensSite.texto,
      acoes: mensagensSite.acoes,
      custoMicrosUsd: mensagensSite.custoMicrosUsd,
      tempoRespostaMs: mensagensSite.tempoRespostaMs,
      criadoEm: mensagensSite.criadoEm,
      quem: usuarios.nome,
    })
    .from(mensagensSite)
    .leftJoin(usuarios, eq(usuarios.id, mensagensSite.usuarioId))
    .where(eq(mensagensSite.conversaId, conversaId))
    .orderBy(asc(mensagensSite.criadoEm));
  return { conversa: c, mensagens };
}

/** Números do chat para a Central: conversas, quem espera a equipe, contatos salvos e custo. */
export async function resumoDoChat(db: BancoDeDados, agora = new Date()) {
  const dia = new Date(agora.getTime() - 24 * 3600_000);
  const semana = new Date(agora.getTime() - 7 * 24 * 3600_000);
  const mes = new Date(agora.getTime() - 30 * 24 * 3600_000);
  const [conversas] = await db
    .select({
      hoje: sql<number>`count(*) filter (where ${gt(conversasSite.criadoEm, dia)})`.mapWith(Number),
      semana: sql<number>`count(*) filter (where ${gt(conversasSite.criadoEm, semana)})`.mapWith(Number),
      // Com a equipe e a última palavra é do visitante: alguém precisa responder.
      esperandoEquipe: sql<number>`count(*) filter (where "conversas_site"."status" = 'humano' and (select m."autor" from "mensagens_site" m where m."conversa_id" = "conversas_site"."id" and m."autor" <> 'sistema' order by m."criado_em" desc limit 1) = 'cliente')`.mapWith(Number),
      contatos30d: sql<number>`count(*) filter (where ${conversasSite.leadId} is not null and ${gt(conversasSite.criadoEm, mes)})`.mapWith(Number),
      conversas30d: sql<number>`count(*) filter (where ${gt(conversasSite.criadoEm, mes)})`.mapWith(Number),
      naoLidas: sql<number>`coalesce(sum(${conversasSite.naoLidas}) filter (where ${eq(conversasSite.status, "humano")}), 0)`.mapWith(Number),
    })
    .from(conversasSite);
  const [respostas] = await db
    .select({
      agente7d: sql<number>`count(*) filter (where ${eq(mensagensSite.autor, "agente")} and ${gt(mensagensSite.criadoEm, semana)})`.mapWith(Number),
      equipe7d: sql<number>`count(*) filter (where ${eq(mensagensSite.autor, "humano")} and ${gt(mensagensSite.criadoEm, semana)})`.mapWith(Number),
      agente24h: sql<number>`count(*) filter (where ${eq(mensagensSite.autor, "agente")} and ${gt(mensagensSite.criadoEm, dia)})`.mapWith(Number),
      custo30dMicros: sql<number>`coalesce(sum(${mensagensSite.custoMicrosUsd}) filter (where ${gt(mensagensSite.criadoEm, mes)}), 0)`.mapWith(Number),
      tempoMedioMs: sql<number | null>`avg(${mensagensSite.tempoRespostaMs}) filter (where ${eq(mensagensSite.autor, "agente")} and ${gt(mensagensSite.criadoEm, semana)})`.mapWith((v) => (v == null ? null : Number(v))),
      falhas7d: sql<number>`count(*) filter (where ${eq(mensagensSite.autor, "sistema")} and ${mensagensSite.texto} like 'O agente não respondeu%' and ${gt(mensagensSite.criadoEm, semana)})`.mapWith(Number),
    })
    .from(mensagensSite);
  return { ...conversas, ...respostas, limiteDiario: limiteDiarioDoChat() };
}

/** O que os visitantes do site querem: frentes, urgência, temperatura e as dúvidas mais recentes. */
export async function oQueOsVisitantesQuerem(db: BancoDeDados, agora = new Date(), dias = 30) {
  const desde = new Date(agora.getTime() - dias * 24 * 3600_000);
  const recentes = gt(conversasSite.criadoEm, desde);
  const [frentes, urgencias, temperaturas, fichas] = await Promise.all([
    db
      .select({ frente: sql<string>`unnest(${conversasSite.interesses})`.as("frente"), n: count() })
      .from(conversasSite)
      .where(recentes)
      .groupBy(sql`1`)
      .orderBy(desc(count())),
    db
      .select({ valor: sql<string | null>`${conversasSite.ficha}->>'urgencia'`, n: count() })
      .from(conversasSite)
      .where(and(recentes, sql`${conversasSite.ficha}->>'urgencia' is not null`))
      .groupBy(sql`1`),
    db
      .select({ valor: sql<string | null>`${conversasSite.ficha}->>'temperatura'`, n: count() })
      .from(conversasSite)
      .where(and(recentes, sql`${conversasSite.ficha}->>'temperatura' is not null`))
      .groupBy(sql`1`),
    db
      .select({ id: conversasSite.id, nome: conversasSite.nome, ficha: conversasSite.ficha, criadoEm: conversasSite.criadoEm })
      .from(conversasSite)
      .where(and(recentes, sql`${conversasSite.ficha} <> '{}'::jsonb`))
      .orderBy(desc(conversasSite.ultimaMensagemEm))
      .limit(40),
  ]);
  const contagem = (l: { valor: string | null; n: number }[]) => Object.fromEntries(l.filter((x) => x.valor).map((x) => [x.valor as string, x.n]));
  return {
    dias,
    frentes: frentes.map((f) => ({ frente: f.frente, n: f.n })),
    urgencias: contagem(urgencias),
    temperaturas: contagem(temperaturas),
    duvidas: fichas.flatMap((f) => (f.ficha.duvidas ?? []).map((texto) => ({ conversaId: f.id, nome: f.nome, texto }))).slice(0, 12),
    objetivos: fichas.filter((f) => f.ficha.objetivo).map((f) => ({ conversaId: f.id, nome: f.nome, texto: f.ficha.objetivo as string, temperatura: f.ficha.temperatura })).slice(0, 12),
  };
}
