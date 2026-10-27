import type { TipoMeta } from "@/db/schema";
import { diasNoMes, type Mes } from "./datas";
import { formatarReais } from "./dinheiro";

/**
 * Regras da Central Urutau (o painel da equipe) que não dependem do banco: presença,
 * ritmo das metas, o nome da tela onde cada pessoa está e o texto do que aconteceu.
 */

/** A aba manda sinal a cada minuto; dois minutos sem sinal já não é "online". */
export const ONLINE_MS = 2 * 60_000;
/** Até meia hora sem sinal: saiu há pouco. */
export const AUSENTE_MS = 30 * 60_000;

export type EstadoPresenca = "online" | "ausente" | "offline" | "nunca";

const FUSO = "America/Sao_Paulo";
const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
const diaMes = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "numeric", month: "short" });
const diaIso = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO });

export function presenca(vistoEm: Date | null, agora = new Date()): { estado: EstadoPresenca; texto: string } {
  if (!vistoEm) return { estado: "nunca", texto: "ainda não entrou" };
  const ms = agora.getTime() - vistoEm.getTime();
  if (ms < ONLINE_MS) return { estado: "online", texto: "online agora" };
  return { estado: ms < AUSENTE_MS ? "ausente" : "offline", texto: `visto ${quando(vistoEm, agora)}` };
}

/** "há 5 min", "há 3 h", "ontem às 18:40", "em 12 de out." */
export function quando(d: Date, agora = new Date()): string {
  const min = Math.floor((agora.getTime() - d.getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hoje = diaIso.format(agora);
  const dia = diaIso.format(d);
  if (dia === hoje) return `há ${Math.floor(min / 60)} h`;
  const ontem = diaIso.format(new Date(agora.getTime() - 86_400_000));
  if (dia === ontem) return `ontem às ${hora.format(d)}`;
  return `em ${diaMes.format(d)}`;
}

const TELAS: Record<string, string> = {
  painel: "no painel",
  vendas: "nas vendas",
  despesas: "nas despesas",
  clientes: "nos clientes",
  conferir: "conferindo vendas",
  relatorios: "nos relatórios",
  impostos: "nos impostos",
  funcionarios: "nos funcionários",
  dividas: "nas dívidas",
  contas: "nas contas",
  lancar: "lançando",
  ajustes: "nos ajustes",
  mais: "no menu",
};

/** Traduz o caminho guardado pela presença em "nas vendas · Urutau Veículos". */
export function rotuloDaTela(caminho: string | null, nomeDaEmpresa: (id: string) => string | undefined): string | null {
  if (!caminho) return null;
  const partes = caminho.split("?")[0].split("/").filter(Boolean);
  if (partes[0] === "admin") {
    if (partes[1] === "equipe" && partes[2]) return "na área de alguém da equipe";
    if (partes[1] === "empresas") return "nas empresas";
    if (partes[1] === "conta") return "na própria conta";
    return "na Central";
  }
  if (partes[0] === "e" && partes[1]) {
    const empresa = nomeDaEmpresa(partes[1]) ?? "uma empresa";
    return `${TELAS[partes[2] ?? "painel"] ?? "em"} · ${empresa}`;
  }
  if (partes[0] === "empresas") return "escolhendo empresa";
  return null;
}

export interface MetaParaRitmo {
  tipo: TipoMeta;
  alvo: number;
  atual: number;
}

export function porcentagem(m: MetaParaRitmo): number {
  return Math.min(100, Math.round((m.atual / m.alvo) * 100));
}

/** Quanto do mês já passou (0 a 1), contando o dia de hoje inteiro. */
export function fracaoDoMes(mes: Mes, diaDeHoje: number): number {
  return Math.min(1, diaDeHoje / diasNoMes(mes));
}

export type Ritmo = "batida" | "no_ritmo" | "atras";

/** Uma meta está no ritmo quando o feito acompanha a parte do mês que já passou. */
export function ritmo(m: MetaParaRitmo, fracao: number): Ritmo {
  if (m.atual >= m.alvo) return "batida";
  return m.atual / m.alvo >= fracao ? "no_ritmo" : "atras";
}

export const TEXTO_RITMO: Record<Ritmo, string> = { batida: "batida", no_ritmo: "no ritmo", atras: "atrás do ritmo" };

export function formatarValorMeta(tipo: TipoMeta, v: number): string {
  return tipo === "valor" ? formatarReais(v) : new Intl.NumberFormat("pt-BR").format(v);
}

/**
 * Tom de cada pessoa da equipe (só identidade, nunca dado): matizes a 60° ou mais de distância
 * e longe do amarelo, que é a cor dos números.
 */
const MATIZES = [195, 15, 135, 315, 255, 75];
export function matizDa(posicao: number): number {
  return MATIZES[posicao % MATIZES.length];
}

export function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  const primeira = p[0][0];
  const ultima = p.length > 1 ? p[p.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

export function primeiroNome(nome: string): string {
  const p = nome.trim().split(/\s+/)[0] ?? nome;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Frase do que aconteceu, a partir da ação gravada na auditoria. */
export function descreverAcao(acao: string, dados: Record<string, unknown> | null): string {
  const d = dados ?? {};
  const t = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
  switch (acao) {
    case "admin.criar_empresa":
      return "cadastrou a empresa";
    case "admin.modulos":
      return "mudou os módulos da empresa";
    case "admin.adicionar_pessoa":
      return `deu acesso a ${t("email") || "uma pessoa"}`;
    case "admin.redefinir_senha":
      return "gerou uma senha nova para alguém";
    case "admin.responsavel":
      return `passou o cliente para ${t("para") || "outra pessoa"}`;
    case "venda.conferir":
      return "conferiu uma venda";
    case "venda.registrar":
      return "registrou uma venda que chegou pelo WhatsApp";
    case "cliente.excluir":
      return "excluiu um cliente";
    case "meta.criar":
      return `criou a meta "${t("titulo")}"`;
    case "meta.progresso":
      return `avançou na meta "${t("titulo")}"`;
    case "meta.excluir":
      return `tirou a meta "${t("titulo")}"`;
    case "equipe.adicionar":
      return `colocou ${t("nome") || "alguém"} na equipe`;
    case "equipe.senha":
      return `gerou uma senha nova para ${t("nome") || "alguém"}`;
    case "conta.trocar_senha":
      return "trocou a própria senha";
    default:
      return acao.replace(/[._]/g, " ");
  }
}
