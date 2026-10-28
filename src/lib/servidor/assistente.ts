import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTextBlockParam, BetaTool, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { BancoDeDados } from "@/db";
import { etapaLeadEnum, origemLeadEnum } from "@/db/schema";
import { custoIaMicros } from "@/lib/atendimento";
import { SOBRE_A_URUTAU } from "@/lib/chat-site";
import { hoje, mesAtual, somarDias } from "@/lib/datas";
import { ErroAtendimento, comSubstituto, criarPadrao, formatoDaChave, type CriarMensagem } from "./atendimento";
import { conversaDoSiteParaEquipe, fichaEmTexto, listarConversasDoSite, oQueOsVisitantesQuerem, resumoDoChat } from "./chat-site";
import { contagemPorEtapa, listarLeads, obterLead, proximosContatos, resumoComercial } from "./comercial";

/**
 * O assistente da equipe na Central: sabe tudo da Urutau e lê o painel (leads, chat do site,
 * o que os visitantes querem) para responder perguntas como "quem pediu orçamento hoje?".
 * Só lê: não muda nada no banco. A conversa fica na tela de quem pergunta.
 */

export const MODELO_DO_ASSISTENTE = "claude-sonnet-5-5";
const MAX_VOLTAS = 6;
/** Tamanho máximo do que uma ferramenta devolve, para não estourar tokens. */
const MAX_RESULTADO = 12_000;

export interface FalaDoAssistente {
  papel: "equipe" | "assistente";
  texto: string;
}

export const historicoDoAssistente = z
  .array(z.object({ papel: z.enum(["equipe", "assistente"]), texto: z.string().trim().min(1).max(6000) }))
  .min(1)
  .max(30)
  .refine((h) => h[h.length - 1].papel === "equipe", "A última fala tem que ser da equipe.");

const PROMPT = `Você é o assistente da equipe Urutau dentro da Central (o painel interno da empresa). Quem fala com você é alguém da equipe, não um cliente. Responda sempre em português do Brasil.

${SOBRE_A_URUTAU}

O que você faz
- Responde perguntas sobre o comercial e o chat do site com os dados reais do painel: use as ferramentas, nunca invente número, nome ou contato. Se a ferramenta não trouxer, diga que não está no painel.
- Ajuda a vender: sugere a próxima ação para cada lead, escreve mensagens de abordagem para WhatsApp (curtas, no tom da Urutau), monta roteiro de diagnóstico e resume conversas.
- Conhece as frentes e o método da Urutau para ajudar a montar propostas. Preço é sempre sob medida: se perguntarem valores, ajude a raciocinar sobre escopo, sem inventar tabela.

Como responder (cada palavra custa)
- Direto e curto. Comece pela resposta; nada de introdução ou resumo no fim.
- Para listas, use linhas começando com "- ". Sem títulos, negrito ou tabelas.
- Cite nomes e datas como estão no painel. Ao falar de uma conversa do site ou de um lead, inclua o link relativo (/admin/comercial/chat/ID ou /admin/comercial/leads/ID).`;

const FERRAMENTAS: BetaTool[] = [
  {
    name: "panorama",
    description: "Números do comercial no mês, leads por etapa, retornos marcados para os próximos 7 dias, números do chat do site e o que os visitantes querem (frentes, dúvidas, objetivos).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "listar_conversas_do_site",
    description: "Conversas do chat do urutau.io com a ficha de cada visitante (o que quer, dúvidas, urgência, temperatura).",
    input_schema: {
      type: "object",
      properties: {
        filtro: { type: "string", enum: ["abertas", "equipe", "quentes", "contato", "todas"], description: "equipe = esperando alguém da equipe; contato = deixaram contato." },
        limite: { type: "integer", minimum: 1, maximum: 30 },
      },
    },
  },
  {
    name: "ver_conversa_do_site",
    description: "A conversa inteira de um visitante do site, com a ficha.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "listar_leads",
    description: "Leads do comercial, os mais novos primeiro.",
    input_schema: {
      type: "object",
      properties: {
        etapa: { type: "string", enum: ["abertos", ...etapaLeadEnum.enumValues] },
        origem: { type: "string", enum: [...origemLeadEnum.enumValues] },
        busca: { type: "string", description: "Parte do nome, ramo, cidade ou telefone." },
        limite: { type: "integer", minimum: 1, maximum: 30 },
      },
    },
  },
  {
    name: "ver_lead",
    description: "Um lead com o histórico de contatos e as propostas.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

const UUID = z.uuid();
const entradas = {
  listar_conversas_do_site: z.object({
    filtro: z.enum(["abertas", "equipe", "quentes", "contato", "todas"]).optional().catch(undefined),
    limite: z.number().int().min(1).max(30).optional().catch(undefined),
  }),
  listar_leads: z.object({
    etapa: z.enum(["abertos", ...etapaLeadEnum.enumValues]).optional().catch(undefined),
    origem: z.enum(origemLeadEnum.enumValues).optional().catch(undefined),
    busca: z.string().trim().max(80).optional().catch(undefined),
    limite: z.number().int().min(1).max(30).optional().catch(undefined),
  }),
  id: z.object({ id: UUID }),
};

const data = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : null);

async function executar(db: BancoDeDados, nome: string, input: unknown, agora: Date): Promise<unknown> {
  if (nome === "panorama") {
    const [comercial, etapas, chat, querem, retornos] = await Promise.all([
      resumoComercial(db, mesAtual(agora)),
      contagemPorEtapa(db),
      resumoDoChat(db, agora),
      oQueOsVisitantesQuerem(db, agora),
      proximosContatos(db, somarDias(hoje(agora), 7), 15),
    ]);
    return { comercialDoMes: comercial, leadsPorEtapa: etapas.n, retornosAte7Dias: retornos, chatDoSite: chat, oQueOsVisitantesQuerem: querem };
  }
  if (nome === "listar_conversas_do_site") {
    const p = entradas.listar_conversas_do_site.parse(input ?? {});
    const lista = await listarConversasDoSite(db, p.filtro ?? "abertas", p.limite ?? 15);
    return lista.map((c) => ({
      id: c.id,
      nome: c.nome,
      contato: c.contato,
      status: c.status,
      esperandoEquipe: c.status === "humano" && c.ultimoAutor === "cliente",
      ficha: fichaEmTexto(c.ficha) || null,
      resumo: c.resumo,
      ultimaMensagem: c.ultimaMensagem,
      ultimaMensagemEm: data(c.ultimaMensagemEm),
      leadId: c.leadId,
    }));
  }
  if (nome === "ver_conversa_do_site") {
    const { id } = entradas.id.parse(input);
    const d = await conversaDoSiteParaEquipe(db, id);
    if (!d) return { erro: "Conversa não encontrada." };
    return {
      nome: d.conversa.nome,
      contato: d.conversa.contato,
      status: d.conversa.status,
      ficha: fichaEmTexto(d.conversa.ficha) || null,
      leadId: d.conversa.leadId,
      mensagens: d.mensagens.slice(-40).map((m) => `${data(m.criadoEm)} ${m.autor === "humano" ? `equipe (${m.quem ?? "?"})` : m.autor}: ${m.texto}`),
    };
  }
  if (nome === "listar_leads") {
    const p = entradas.listar_leads.parse(input ?? {});
    const lista = await listarLeads(db, { etapa: p.etapa, origem: p.origem, busca: p.busca, limite: p.limite ?? 15 });
    return lista.map((l) => ({
      id: l.id,
      nome: l.nome,
      telefone: l.telefone,
      email: l.email,
      ramo: l.categoria,
      cidade: l.cidade,
      origem: l.origem,
      etapa: l.etapa,
      interesses: l.interesses,
      responsavel: l.responsavel,
      proximoContato: l.proximoContato,
      ultimoContato: data(l.ultimoContato),
      criadoEm: data(l.criadoEm),
    }));
  }
  if (nome === "ver_lead") {
    const { id } = entradas.id.parse(input);
    const d = await obterLead(db, id);
    if (!d) return { erro: "Lead não encontrado." };
    const { lead } = d;
    return {
      lead: { ...lead, criadoEm: data(lead.criadoEm), atualizadoEm: data(lead.atualizadoEm), excluidoEm: undefined, chave: undefined },
      historico: d.historico.slice(0, 25).map((h) => `${data(h.criadoEm)} ${h.tipo}${h.autor ? ` (${h.autor})` : ""}: ${h.texto ?? ""}${h.etapaPara ? ` [→ ${h.etapaPara}]` : ""}`),
      propostas: d.propostas.map((p) => ({ status: p.status, titulo: p.titulo, mensal: p.valorMensalCentavos, unico: p.valorUnicoCentavos, criadoEm: data(p.criadoEm) })),
    };
  }
  return { erro: `Ferramenta ${nome} não existe.` };
}

export interface RespostaDoAssistente {
  texto: string;
  custoMicros: number;
  consultas: string[];
}

export async function perguntarAoAssistente(
  db: BancoDeDados,
  historico: FalaDoAssistente[],
  quem: { nome: string },
  deps: { criar?: CriarMensagem; agora?: () => Date } = {},
): Promise<RespostaDoAssistente> {
  const criar = deps.criar ?? criarPadrao;
  const agora = deps.agora?.() ?? new Date();
  const system: BetaTextBlockParam[] = [
    { type: "text", text: PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Agora: ${agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília). Quem pergunta: ${quem.nome}.` },
  ];
  const mensagens: BetaMessageParam[] = historico.map((f) => ({ role: f.papel === "equipe" ? "user" : "assistant", content: f.texto }));
  let texto = "";
  let custoMicros = 0;
  const consultas: string[] = [];
  try {
    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const modelo = process.env.ASSISTENTE_MODELO || MODELO_DO_ASSISTENTE;
      const r = await criar({
        model: modelo,
        max_tokens: 2048,
        system,
        tools: FERRAMENTAS,
        messages: mensagens,
        output_config: { effort: "low" },
        ...comSubstituto(modelo),
      });
      custoMicros += custoIaMicros(r.model, r.usage);
      if (r.stop_reason === "refusal") return { texto: "Não consigo ajudar com isso.", custoMicros, consultas };
      texto = r.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n")
        .trim();
      const usos = r.content.flatMap((b) => (b.type === "tool_use" ? [b] : []));
      if (r.stop_reason !== "tool_use" || usos.length === 0) break;
      mensagens.push({ role: "assistant", content: r.content });
      const resultados: BetaToolResultBlockParam[] = [];
      for (const u of usos) {
        consultas.push(u.name);
        let conteudo: string;
        let erro = false;
        try {
          conteudo = JSON.stringify(await executar(db, u.name, u.input, agora));
        } catch (e) {
          conteudo = e instanceof z.ZodError ? "Parâmetros inválidos." : "Não consegui ler isso agora.";
          erro = true;
        }
        if (conteudo.length > MAX_RESULTADO) conteudo = `${conteudo.slice(0, MAX_RESULTADO)}… (cortado: peça menos itens)`;
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: conteudo, ...(erro ? { is_error: true } : {}) });
      }
      mensagens.push({ role: "user", content: resultados });
    }
  } catch (e) {
    if (e instanceof ErroAtendimento) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new ErroAtendimento(`Chave da IA inválida: ${formatoDaChave()}.`);
    if (e instanceof Anthropic.RateLimitError) throw new ErroAtendimento("A IA atingiu o limite de uso. Tente de novo em instantes.");
    if (e instanceof Anthropic.APIError) throw new ErroAtendimento(`A IA não respondeu (${e.status ?? "erro"}). Tente de novo.`);
    throw e;
  }
  return { texto: texto || "Não consegui montar uma resposta. Pergunte de outro jeito?", custoMicros, consultas };
}
