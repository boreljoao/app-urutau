/**
 * Regras do atendimento no WhatsApp que não dependem de banco nem de rede: custo de cada
 * resposta, janela de 24h, histórico no formato do Claude, prompt do agente e leitura do webhook.
 */

// ─── Custos ──────────────────────────────────────────────────────────────────

export interface PrecoModelo {
  id: string;
  nome: string;
  /** US$ por milhão de tokens. */
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  descricao: string;
}

/** Preços da API da Anthropic (out/2026). A escrita de cache custa 1,25× a entrada. */
export const MODELOS: PrecoModelo[] = [
  { id: "claude-opus-5-5", nome: "Claude Opus 5.5", entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5, descricao: "O mais capaz: entende pedidos confusos e conduz a venda com mais jeito." },
  { id: "claude-sonnet-5-5", nome: "Claude Sonnet 5.5", entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5, descricao: "Metade do custo do Opus, muito bom para atendimento do dia a dia." },
  { id: "claude-haiku-5-5", nome: "Claude Haiku 5.5", entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125, descricao: "O mais barato e rápido, para perguntas simples e muito volume." },
];
export const MODELO_PADRAO = "claude-haiku-5-5";
export const precoDo = (modelo: string) => MODELOS.find((m) => modelo.startsWith(m.id)) ?? MODELOS[0];

/**
 * Cada resposta da loja dentro da janela de 24h é cobrada pela Meta desde 01/10/2026.
 * No Brasil: US$ 0,0068 por mensagem entregue (mesmo valor das mensagens utilitárias).
 */
export const CUSTO_META_MENSAGEM_MICROS = 6_800;

export interface UsoDaChamada {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Custo de uma chamada ao Claude em milionésimos de dólar. */
export function custoIaMicros(modelo: string, u: UsoDaChamada): number {
  const p = precoDo(modelo);
  return Math.round(u.input_tokens * p.entrada + u.output_tokens * p.saida + (u.cache_read_input_tokens ?? 0) * p.cacheLeitura + (u.cache_creation_input_tokens ?? 0) * p.cacheEscrita);
}

/**
 * Estimativa do mês para uma loja. Por resposta: ~3.000 tokens do prompt fixo vindos do cache,
 * ~1.500 de conversa, ~450 escritos (pensamento curto + resposta) e, em 1 de cada 3, uma
 * ferramenta (registrar venda, anotar) que faz mais uma volta.
 */
export function estimarCustoMensal(conversasNoMes: number, respostasPorConversa: number, modelo: string) {
  const respostas = conversasNoMes * respostasPorConversa;
  const voltas = 1 + 1 / 3;
  const ia = custoIaMicros(modelo, { input_tokens: 1_500 * voltas, output_tokens: 450 * voltas, cache_read_input_tokens: 3_000 * voltas, cache_creation_input_tokens: 0 }) * respostas;
  const meta = CUSTO_META_MENSAGEM_MICROS * respostas;
  return { respostas, iaUsd: ia / 1e6, metaUsd: meta / 1e6, totalUsd: (ia + meta) / 1e6 };
}

/** Dólar para real, para mostrar estimativas (ajuste quando o câmbio mudar muito). */
export const DOLAR_EM_REAIS = 5.5;
export const usdParaReais = (usd: number) => usd * DOLAR_EM_REAIS;

// ─── Janela de 24h ───────────────────────────────────────────────────────────

export const JANELA_MS = 24 * 3_600_000;

/** Fora da janela a loja só pode mandar modelo aprovado (template), não texto livre. */
export function janelaAberta(ultimaEntradaEm: Date | null, agora = new Date()): boolean {
  return !!ultimaEntradaEm && agora.getTime() - ultimaEntradaEm.getTime() < JANELA_MS;
}

export function tempoDaJanela(ultimaEntradaEm: Date | null, agora = new Date()): string {
  if (!ultimaEntradaEm) return "janela fechada";
  const resta = JANELA_MS - (agora.getTime() - ultimaEntradaEm.getTime());
  if (resta <= 0) return "janela fechada";
  const h = Math.floor(resta / 3_600_000);
  return h >= 1 ? `janela aberta por mais ${h} h` : `janela fecha em ${Math.max(1, Math.round(resta / 60_000))} min`;
}

// ─── Histórico para o Claude ─────────────────────────────────────────────────

export interface MensagemDoHistorico {
  autor: "cliente" | "agente" | "humano" | "sistema";
  texto: string;
  status: string;
}

export interface TurnoDoClaude {
  role: "user" | "assistant";
  content: string;
}

/**
 * Converte a conversa em turnos: cliente → user; agente e humano da loja → assistant.
 * Junta mensagens seguidas do mesmo lado, descarta rascunhos e falhas, começa no cliente.
 */
export function historicoParaClaude(mensagens: MensagemDoHistorico[], limite = 40): TurnoDoClaude[] {
  const validas = mensagens.filter((m) => m.autor !== "sistema" && !["rascunho", "descartada", "falhou"].includes(m.status) && m.texto.trim());
  const turnos: TurnoDoClaude[] = [];
  for (const m of validas.slice(-limite)) {
    const role = m.autor === "cliente" ? "user" : "assistant";
    const texto = m.autor === "humano" ? `[resposta de alguém da loja] ${m.texto}` : m.texto;
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += `\n${texto}`;
    else turnos.push({ role, content: texto });
  }
  while (turnos.length && turnos[0].role !== "user") turnos.shift();
  return turnos;
}

// ─── Prompt do agente ────────────────────────────────────────────────────────

export interface ConfigAgente {
  nome: string;
  tom: string;
  conhecimento: string;
  quandoChamarHumano: string;
}

/**
 * A parte fixa do prompt (vai para o cache). Nada que muda a cada mensagem entra aqui:
 * data, hora e dados do cliente vão num bloco separado depois.
 */
export function promptDoAgente(empresa: string, a: ConfigAgente): string {
  return [
    `Você é ${a.nome || "o atendente"}, atendente da ${empresa} no WhatsApp. Responda sempre em português do Brasil.`,
    a.tom ? `Seu jeito de falar: ${a.tom}.` : "Seu jeito de falar: simpático, direto e educado.",
    "",
    "Como escrever no WhatsApp:",
    "- Mensagens curtas, de 1 a 3 frases. Sem markdown, sem listas longas, no máximo um emoji quando combinar.",
    "- Uma pergunta por vez. Use o nome do cliente quando souber.",
    "- Nunca invente preço, prazo, estoque ou política. Se não estiver nas informações abaixo, diga que vai confirmar com a equipe e chame um humano.",
    "- Não prometa desconto que não esteja nas informações.",
    "",
    "Ferramentas:",
    "- anotar_atendimento: use logo que entender o que o cliente quer, e de novo se mudar.",
    "- registrar_venda: só quando o cliente confirmar a compra com produto, valor e forma de pagamento. A venda entra para o dono conferir.",
    "- chamar_humano: quando o cliente pedir uma pessoa, reclamar, quando houver algo fora das informações ou nos casos abaixo. Depois avise o cliente que alguém da loja já vai falar com ele e pare.",
    "",
    "Quando chamar alguém da loja:",
    a.quandoChamarHumano || "Reclamações, trocas, pedidos fora do comum ou quando o cliente pedir.",
    "",
    "Informações da loja (a sua única fonte):",
    a.conhecimento || "(A loja ainda não cadastrou informações. Diga que vai confirmar com a equipe e chame um humano para qualquer pergunta sobre produtos ou preços.)",
  ].join("\n");
}

// ─── Webhook da Meta ─────────────────────────────────────────────────────────

export interface MensagemRecebida {
  phoneNumberId: string;
  waId: string;
  nome: string | null;
  waMessageId: string;
  em: Date;
  texto: string;
  tipo: string;
}

export interface StatusRecebido {
  waMessageId: string;
  status: "enviada" | "entregue" | "lida" | "falhou";
  erro: string | null;
}

const TIPO_SEM_TEXTO: Record<string, string> = {
  audio: "[mandou um áudio]",
  image: "[mandou uma foto]",
  video: "[mandou um vídeo]",
  document: "[mandou um arquivo]",
  sticker: "[mandou uma figurinha]",
  location: "[mandou uma localização]",
  contacts: "[mandou um contato]",
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Lê o corpo do webhook da Cloud API: mensagens novas e mudanças de status das enviadas. */
export function lerWebhook(corpo: unknown): { mensagens: MensagemRecebida[]; status: StatusRecebido[] } {
  const mensagens: MensagemRecebida[] = [];
  const status: StatusRecebido[] = [];
  for (const entry of lista(obj(corpo).entry))
    for (const change of lista(obj(entry).changes)) {
      const value = obj(obj(change).value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const contatos = lista(value.contacts).map(obj);
      for (const m of lista(value.messages).map(obj)) {
        const id = str(m.id);
        const de = str(m.from);
        if (!id || !de) continue;
        const tipo = str(m.type) ?? "desconhecido";
        const texto =
          tipo === "text"
            ? (str(obj(m.text).body) ?? "")
            : tipo === "button"
              ? (str(obj(m.button).text) ?? "")
              : tipo === "interactive"
                ? (str(obj(obj(m.interactive).button_reply).title) ?? str(obj(obj(m.interactive).list_reply).title) ?? "")
                : (TIPO_SEM_TEXTO[tipo] ?? `[mandou ${tipo}]`);
        const contato = contatos.find((c) => str(c.wa_id) === de);
        const ts = Number(str(m.timestamp));
        mensagens.push({
          phoneNumberId,
          waId: de.replace(/\D/g, ""),
          nome: str(obj(contato?.profile).name),
          waMessageId: id,
          em: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          texto: texto.slice(0, 4000),
          tipo,
        });
      }
      for (const s of lista(value.statuses).map(obj)) {
        const id = str(s.id);
        const st = str(s.status);
        const mapa = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" } as const;
        if (!id || !st || !(st in mapa)) continue;
        const erro = lista(s.errors).map(obj)[0];
        status.push({ waMessageId: id, status: mapa[st as keyof typeof mapa], erro: erro ? (str(erro.title) ?? str(erro.message) ?? "erro") : null });
      }
    }
  return { mensagens, status };
}

// ─── Situação de cada agente (aba Atendimento da Central) ────────────────────

export type EstadoAgente = "erro" | "no_ar" | "aprovacao" | "simulador" | "pausado" | "sem_agente";

export const NOME_ESTADO: Record<EstadoAgente, string> = {
  erro: "Com erro",
  no_ar: "No ar",
  aprovacao: "No ar, com aprovação",
  simulador: "Só no simulador",
  pausado: "Pausado",
  sem_agente: "Sem agente",
};

/** Erro nas últimas 24h pesa mais que tudo: é o que a equipe precisa ver primeiro. */
export function estadoDoAgente(
  a: { modo: "automatico" | "aprovacao" | "desligado"; conectado: boolean; ultimoErroEm: Date | null } | null,
  agora = new Date(),
): EstadoAgente {
  if (!a) return "sem_agente";
  if (a.ultimoErroEm && agora.getTime() - a.ultimoErroEm.getTime() < JANELA_MS) return "erro";
  if (a.modo === "desligado") return "pausado";
  if (!a.conectado) return "simulador";
  return a.modo === "automatico" ? "no_ar" : "aprovacao";
}

export const INTENCOES = ["comprar", "orcamento", "agendar", "duvida", "reclamacao", "outro"] as const;
export const NOME_INTENCAO: Record<string, string> = { comprar: "Quer comprar", orcamento: "Orçamento", agendar: "Agendar", duvida: "Dúvida", reclamacao: "Reclamação", outro: "Outro" };
