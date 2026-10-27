import type { Recorrencia, ServicoUrutau } from "@/db/schema";
import { type Mes, mesDe, somarMeses } from "./datas";
import { aplicarPcm, type Centavos, dividirArredondado, PCM_100, type Pcm } from "./dinheiro";

/**
 * Regras de dinheiro da Urutau, sem banco: o que cada contrato cobra em cada mês, como um
 * pagamento vira comissão de quem trouxe e de quem executou, e a divisão (teórica) dos sócios.
 *
 * Ordem combinada com os sócios (out/2026):
 *  1. A base é o valor do serviço depois do desconto. Verba de anúncio do cliente não entra.
 *  2. A comissão só nasce quando o cliente paga; mensal enquanto o contrato durar, projeto único uma vez.
 *  3. Quem trouxe o cliente leva `trouxePcm` (10%) direto. Ninguém trouxe = fica no bolo.
 *  4. Quem executa leva `executorPcm` do serviço (site 30%, tráfego 35%, reels/post 35%…),
 *     a não ser que tenha aberto mão (sócio pode).
 *  5. O resto, menos os custos, é dos sócios. Antes, `caixaPcm` (10%) da receita fica de reserva sugerida.
 *     O sócio "maior" leva `diferencaPcm` (5 pontos da receita) a mais que o outro.
 */

export const SERVICOS_URUTAU: { id: ServicoUrutau; nome: string }[] = [
  { id: "reels", nome: "Reels" },
  { id: "post", nome: "Post" },
  { id: "criativo", nome: "Criativo" },
  { id: "trafego", nome: "Tráfego pago" },
  { id: "gestao", nome: "Gestão" },
  { id: "automacao", nome: "Automação" },
  { id: "atendente", nome: "Atendente no WhatsApp" },
  { id: "site", nome: "Site" },
  { id: "sistema", nome: "Sistema" },
  { id: "outro", nome: "Outro" },
];
export const NOME_SERVICO_URUTAU = Object.fromEntries(SERVICOS_URUTAU.map((s) => [s.id, s.nome])) as Record<ServicoUrutau, string>;

export interface ContratoParaCalculo {
  /** "AAAA-MM-01" */
  inicio: string;
  meses: number | null;
  descontoPcm: Pcm;
  descontoMeses: number | null;
  /** Último mês cobrado de um contrato encerrado/cancelado ("AAAA-MM-01"). */
  encerradoEm: string | null;
}

export interface ItemParaCalculo {
  id: string;
  recorrencia: Recorrencia;
  valorCentavos: Centavos;
  custoCentavos: Centavos;
  inicio: string | null;
  ate: string | null;
  executorId: string | null;
  executorPcm: Pcm;
  executorAbriuMao: boolean;
  trouxePcm: Pcm;
}

/** Quantos meses entre dois meses ("AAAA-MM"), b − a. */
export function mesesEntre(a: Mes, b: Mes): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/** Último mês do contrato: o fim do prazo ou o encerramento, o que vier antes; null = sem fim. */
export function ultimoMesDoContrato(c: ContratoParaCalculo): Mes | null {
  const prazo = c.meses ? somarMeses(mesDe(c.inicio), c.meses - 1) : null;
  const encerrado = c.encerradoEm ? mesDe(c.encerradoEm) : null;
  if (prazo && encerrado) return prazo < encerrado ? prazo : encerrado;
  return prazo ?? encerrado;
}

export function contratoValeNoMes(c: ContratoParaCalculo, mes: Mes): boolean {
  if (mes < mesDe(c.inicio)) return false;
  const fim = ultimoMesDoContrato(c);
  return !fim || mes <= fim;
}

/** O desconto vale nos primeiros `descontoMeses` meses (contados do início do contrato); null = sempre. */
export function descontoNoMes(c: ContratoParaCalculo, mes: Mes): Pcm {
  if (!c.descontoPcm) return 0;
  if (c.descontoMeses == null) return c.descontoPcm;
  return mesesEntre(mesDe(c.inicio), mes) < c.descontoMeses ? c.descontoPcm : 0;
}

/** Valor e custo de um serviço em um mês, já com o desconto; null se o serviço não é cobrado nesse mês. */
export function itemNoMes(c: ContratoParaCalculo, i: ItemParaCalculo, mes: Mes): { valor: Centavos; custo: Centavos } | null {
  if (!contratoValeNoMes(c, mes)) return null;
  const primeiro = mesDe(i.inicio ?? c.inicio);
  if (i.recorrencia === "unico") {
    if (mes !== primeiro) return null;
  } else {
    if (mes < primeiro) return null;
    if (i.ate && mes > mesDe(i.ate)) return null;
  }
  const desconto = descontoNoMes(c, mes);
  return { valor: aplicarPcm(i.valorCentavos, PCM_100 - desconto), custo: i.custoCentavos };
}

/** As linhas da cobrança de um mês (só os serviços cobrados nele). */
export function linhasDaCobranca(c: ContratoParaCalculo, itens: ItemParaCalculo[], mes: Mes) {
  const linhas: { itemId: string; valor: Centavos; custo: Centavos }[] = [];
  for (const i of itens) {
    const v = itemNoMes(c, i, mes);
    if (v) linhas.push({ itemId: i.id, ...v });
  }
  return { linhas, total: linhas.reduce((s, l) => s + l.valor, 0) };
}

/** Meses que já deveriam ter cobrança: do início do contrato até `ate` (inclusive), respeitando o fim. */
export function mesesACobrar(c: ContratoParaCalculo, ate: Mes): Mes[] {
  const meses: Mes[] = [];
  const fim = ultimoMesDoContrato(c);
  const limite = fim && fim < ate ? fim : ate;
  for (let m = mesDe(c.inicio); m <= limite; m = somarMeses(m, 1)) meses.push(m);
  return meses;
}

export interface GanhoCalculado {
  itemId: string;
  usuarioId: string;
  tipo: "trouxe" | "execucao";
  base: Centavos;
  pcm: Pcm;
  valor: Centavos;
}

/**
 * Transforma um pagamento em comissões. Pagamento parcial reparte proporcionalmente
 * (cada serviço recebe a mesma fração do que foi pago).
 */
export function repartirPagamento(
  linhas: { itemId: string; valor: Centavos }[],
  itens: Pick<ItemParaCalculo, "id" | "executorId" | "executorPcm" | "executorAbriuMao" | "trouxePcm">[],
  quemTrouxeId: string | null,
  pago: Centavos,
  total: Centavos,
): GanhoCalculado[] {
  const ganhos: GanhoCalculado[] = [];
  if (total <= 0 || pago <= 0) return ganhos;
  for (const l of linhas) {
    const item = itens.find((i) => i.id === l.itemId);
    if (!item) continue;
    const base = pago >= total ? l.valor : dividirArredondado(BigInt(l.valor) * BigInt(pago), total);
    if (base <= 0) continue;
    if (quemTrouxeId && item.trouxePcm > 0)
      ganhos.push({ itemId: l.itemId, usuarioId: quemTrouxeId, tipo: "trouxe", base, pcm: item.trouxePcm, valor: aplicarPcm(base, item.trouxePcm) });
    if (item.executorId && !item.executorAbriuMao && item.executorPcm > 0)
      ganhos.push({ itemId: l.itemId, usuarioId: item.executorId, tipo: "execucao", base, pcm: item.executorPcm, valor: aplicarPcm(base, item.executorPcm) });
  }
  return ganhos;
}

export interface Divisao {
  receita: Centavos;
  comissoes: Centavos;
  custos: Centavos;
  /** Receita − comissões − custos. */
  sobra: Centavos;
  caixa: Centavos;
  paraSocios: Centavos;
  socioMaior: Centavos;
  socioMenor: Centavos;
}

/**
 * Divisão teórica do mês: tira comissões e custos, separa a reserva de caixa e reparte o resto.
 * O sócio maior leva `diferencaPcm` da receita a mais: (paraSócios + diferença) ÷ 2.
 * Ex.: receita 1.000, comissões 300, sem custo nem caixa → 700 → 375 e 325.
 */
export function dividirEntreSocios(receita: Centavos, comissoes: Centavos, custos: Centavos, caixaPcm: Pcm, diferencaPcm: Pcm): Divisao {
  const sobra = receita - comissoes - custos;
  const caixa = sobra > 0 ? Math.min(aplicarPcm(receita, caixaPcm), sobra) : 0;
  const paraSocios = sobra - caixa;
  const diferenca = aplicarPcm(receita, diferencaPcm);
  const socioMaior = dividirArredondado(paraSocios + diferenca, 2);
  return { receita, comissoes, custos, sobra, caixa, paraSocios, socioMaior, socioMenor: paraSocios - socioMaior };
}

/** Âncora de preço: quanto custa por dia (mês comercial de 30 dias). */
export const valorPorDia = (mensal: Centavos): Centavos => dividirArredondado(mensal, 30);

/** Multa de rescisão hoje: valor fixo, ou percentual do que falta do contrato (mensalidade × meses restantes). */
export function multaDeRescisao(tipo: "nenhuma" | "valor" | "percentual_restante", valor: number, mensal: Centavos, mesesRestantes: number): Centavos {
  if (tipo === "valor") return valor;
  if (tipo === "percentual_restante") return aplicarPcm(mensal * Math.max(0, mesesRestantes), valor);
  return 0;
}

/** Valor mensal recorrente de um contrato num mês (só serviços mensais, com desconto). */
export function mensalidadeNoMes(c: ContratoParaCalculo, itens: ItemParaCalculo[], mes: Mes): Centavos {
  return itens.filter((i) => i.recorrencia === "mensal").reduce((s, i) => s + (itemNoMes(c, i, mes)?.valor ?? 0), 0);
}

/** Percentual que o executor recebe se for também quem trouxe: só para mostrar ("40% = 30 + 10"). */
export const percentualTotal = (executorPcm: Pcm, trouxePcm: Pcm, trouxe: boolean) => executorPcm + (trouxe ? trouxePcm : 0);
