import type { EtapaLead, OrigemLead, StatusProposta, TipoInteracao } from "@/db/schema";
import { normalizarTelefone } from "./validacao";

/**
 * Regras do Comercial da Urutau que não dependem do banco: nomes do funil, leitura do CSV da
 * prospecção (google-maps-scraper-kit) e as contas do funil.
 */

export const ETAPAS: { id: EtapaLead; nome: string; aberta: boolean }[] = [
  { id: "novo", nome: "Novo", aberta: true },
  { id: "contatado", nome: "Contatado", aberta: true },
  { id: "diagnostico", nome: "Diagnóstico", aberta: true },
  { id: "proposta", nome: "Proposta", aberta: true },
  { id: "negociacao", nome: "Negociação", aberta: true },
  { id: "ganho", nome: "Fechou", aberta: false },
  { id: "perdido", nome: "Perdido", aberta: false },
];
export const NOME_ETAPA = Object.fromEntries(ETAPAS.map((e) => [e.id, e.nome])) as Record<EtapaLead, string>;
export const ETAPAS_ABERTAS = ETAPAS.filter((e) => e.aberta).map((e) => e.id);

export const NOME_ORIGEM: Record<OrigemLead, string> = {
  site: "Site",
  diagnostico: "Diagnóstico do site",
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  instagram: "Instagram",
  indicacao: "Indicação",
  prospeccao: "Prospecção",
  outro: "Outro",
};

/** As seis frentes do site urutau.io. */
export const SERVICOS = [
  { id: "atende", nome: "urutau atende" },
  { id: "flow", nome: "urutau flow" },
  { id: "financas", nome: "urutau finanças" },
  { id: "gestao", nome: "urutau gestão" },
  { id: "sites", nome: "urutau sites" },
  { id: "ads", nome: "urutau ads" },
] as const;
export const NOME_SERVICO: Record<string, string> = Object.fromEntries(SERVICOS.map((s) => [s.id, s.nome]));

export const NOME_INTERACAO: Record<TipoInteracao, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  reuniao: "Reunião",
  visita: "Visita",
  nota: "Anotação",
};

export const NOME_STATUS_PROPOSTA: Record<StatusProposta, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  aceita: "Aceita",
  recusada: "Recusada",
};

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** Lê CSV com aspas (RFC 4180). Separador vírgula ou ponto e vírgula, decidido pela 1ª linha. */
export function lerCsv(texto: string): string[][] {
  const limpo = texto.replace(/^﻿/, "");
  const primeira = limpo.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const c = limpo[i];
    if (aspas) {
      if (c === '"' && limpo[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpo[i + 1] === "\n") i++;
      linha.push(campo);
      if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
  return linhas;
}

export interface Prospecto {
  nome: string;
  telefone: string | null;
  email: string | null;
  site: string | null;
  instagram: string | null;
  categoria: string | null;
  endereco: string | null;
  cidade: string | null;
  latitude: number | null;
  longitude: number | null;
  nota: number | null;
  avaliacoes: number | null;
  chave: string;
}

/** "R. das Flores, 120 - Centro, Maricá - RJ, 24900-000" → "Maricá". */
export function cidadeDoEndereco(endereco: string | null): string | null {
  if (!endereco) return null;
  const m = endereco.match(/,\s*([^,]+?)\s+-\s+[A-Z]{2}\b/);
  return m ? m[1].trim() : null;
}

const numero = (v: string | undefined) => {
  if (!v || !v.trim()) return null;
  const n = Number(v.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const texto = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Nomes de coluna aceitos para cada campo (o kit usa os primeiros; os outros cobrem planilhas feitas à mão). */
const COLUNAS: Record<string, string[]> = {
  nome: ["title", "name", "nome", "empresa"],
  telefone: ["phone", "telefone", "phone_number"],
  email: ["emails", "email", "e-mail"],
  site: ["website", "site"],
  instagram: ["instagram"],
  categoria: ["category", "categoria"],
  endereco: ["address", "complete_address", "endereco", "endereço"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon", "lng"],
  nota: ["review_rating", "rating", "nota"],
  avaliacoes: ["review_count", "reviews", "avaliacoes"],
  id: ["place_id", "cid", "data_id", "link"],
};

/**
 * Converte o CSV do google-maps-scraper-kit (ou uma planilha parecida) em prospectos.
 * Linhas sem nome são ignoradas; a `chave` vem do place_id/cid/link ou de nome + endereço,
 * para que importar o mesmo lugar de novo não crie outro lead.
 */
export function prospectosDoCsv(conteudo: string): { prospectos: Prospecto[]; ignoradas: number; colunas: string[] } {
  const [cab, ...linhas] = lerCsv(conteudo);
  if (!cab) return { prospectos: [], ignoradas: 0, colunas: [] };
  const nomes = cab.map((c) => semAcento(c.trim()));
  const idx = (campo: string) => {
    for (const alvo of COLUNAS[campo]) {
      const i = nomes.indexOf(semAcento(alvo));
      if (i >= 0) return i;
    }
    return -1;
  };
  const pos = Object.fromEntries(Object.keys(COLUNAS).map((k) => [k, idx(k)]));
  const pegar = (l: string[], campo: string) => (pos[campo] >= 0 ? l[pos[campo]] : undefined);
  const vistos = new Set<string>();
  const prospectos: Prospecto[] = [];
  let ignoradas = 0;
  for (const l of linhas) {
    const nome = texto(pegar(l, "nome"));
    if (!nome) {
      ignoradas++;
      continue;
    }
    const endereco = texto(pegar(l, "endereco"));
    const idOriginal = texto(pegar(l, "id"));
    const chave = idOriginal ? `maps:${idOriginal}` : `nome:${semAcento(nome)}|${semAcento(endereco ?? "")}`;
    if (vistos.has(chave)) {
      ignoradas++;
      continue;
    }
    vistos.add(chave);
    const telBruto = texto(pegar(l, "telefone"));
    const lat = numero(pegar(l, "latitude"));
    const lon = numero(pegar(l, "longitude"));
    const coordenadaOk = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    const nota = numero(pegar(l, "nota"));
    const avaliacoes = numero(pegar(l, "avaliacoes"));
    prospectos.push({
      nome,
      telefone: telBruto ? (normalizarTelefone(telBruto) ?? telBruto) : null,
      email: texto(pegar(l, "email")?.split(/[,;\s]+/)[0]),
      site: texto(pegar(l, "site")),
      instagram: texto(pegar(l, "instagram")),
      categoria: texto(pegar(l, "categoria")),
      endereco,
      cidade: cidadeDoEndereco(endereco),
      latitude: coordenadaOk ? lat : null,
      longitude: coordenadaOk ? lon : null,
      nota: nota != null && nota >= 0 && nota <= 5 ? nota : null,
      avaliacoes: avaliacoes != null && avaliacoes >= 0 ? Math.round(avaliacoes) : null,
      chave,
    });
  }
  return { prospectos, ignoradas, colunas: cab };
}

// ─── Funil ───────────────────────────────────────────────────────────────────

/**
 * Conversão do funil: de quem já saiu de "novo", quantos chegaram a cada etapa.
 * Um lead em "proposta" também passou por "contatado" e "diagnóstico".
 */
export function funil(contagem: Partial<Record<EtapaLead, number>>) {
  const c = (e: EtapaLead) => contagem[e] ?? 0;
  const abertas = ETAPAS_ABERTAS.reduce((s, e) => s + c(e), 0);
  const fechados = c("ganho") + c("perdido");
  const decididos = fechados;
  return {
    abertas,
    total: abertas + fechados,
    ganhos: c("ganho"),
    perdidos: c("perdido"),
    /** Dos que já tiveram resposta (fechou ou perdeu), quantos fecharam; null sem nenhum decidido. */
    taxaFechamento: decididos ? Math.round((c("ganho") / decididos) * 100) : null,
  };
}

/** Link do WhatsApp para um telefone salvo (só dígitos, com DDI). */
export function linkWhatsapp(telefone: string | null, mensagem?: string): string | null {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ""}`;
}

// ─── Visitantes do site ──────────────────────────────────────────────────────

/** Seções do urutau.io (id da âncora → nome). */
export const SECOES_DO_SITE: Record<string, string> = {
  ecossistema: "Ecossistema",
  gestao: "Gestão",
  diagnostico: "Diagnóstico",
  metodo: "Método",
  cases: "Cases",
  duvidas: "Dúvidas",
};

const ORIGENS_CONHECIDAS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$|^l\.instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$|^fb\.me$|^m\.facebook\.com$/, "Facebook"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
  [/(^|\.)whatsapp\.com$|^wa\.me$/, "WhatsApp"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, "X"],
];

/**
 * De onde o visitante veio: o utm_source quando o link tem etiqueta; senão, o site que mandou
 * (referrer) com nome conhecido; sem nenhum dos dois, "Direto".
 */
export function origemDaVisita(utmSource: string | null | undefined, referrer: string | null | undefined, hostDoSite = "urutau.io"): string {
  const utm = utmSource?.trim();
  if (utm) {
    const conhecido = ORIGENS_CONHECIDAS.find(([, nome]) => nome.toLowerCase() === utm.toLowerCase().replace(/^ig$/, "instagram").replace(/^fb$/, "facebook"));
    return conhecido ? conhecido[1] : utm.slice(0, 60);
  }
  if (!referrer) return "Direto";
  let host: string;
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "Direto";
  }
  if (host === hostDoSite || host.endsWith(`.${hostDoSite}`)) return "Direto";
  const conhecido = ORIGENS_CONHECIDAS.find(([re]) => re.test(host));
  return conhecido ? conhecido[1] : host;
}

/** Código do visitante aceito: só letras minúsculas, números e hífen (o site gera um UUID). */
export const codigoDeVisitanteValido = (c: unknown): c is string => typeof c === "string" && /^[a-z0-9-]{8,64}$/.test(c);
