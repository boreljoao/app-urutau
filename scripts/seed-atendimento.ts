/**
 * Atendimento no WhatsApp de exemplo: a revenda com o agente respondendo sozinho e a padaria
 * no modo aprovação, com conversas em todos os estados (respondida, com a equipe, para aprovar,
 * encerrada, chegando agora). Sem CHAVE_SEGREDOS no .env, os números ficam "só no simulador".
 */
import { and, eq } from "drizzle-orm";
import type { BancoDeDados } from "../src/db";
import { agentesWhatsapp, clientes, conversas, empresaModulos, mensagensWhatsapp } from "../src/db/schema";
import { CUSTO_META_MENSAGEM_MICROS } from "../src/lib/atendimento";
import { cifrar } from "../src/lib/servidor/segredos";

type Autor = "cliente" | "agente" | "humano" | "sistema";
type Linha = [minutosAtras: number, autor: Autor, texto: string, extra?: Partial<typeof mensagensWhatsapp.$inferInsert>];

const CONHECIMENTO_REVENDA = `SOBRE A URUTAU VEÍCULOS
Seminovos revisados, com garantia de 3 meses no motor e câmbio. Av. Roberto Silveira, 1200, Maricá.

CARROS DISPONÍVEIS
- Jeep Compass Longitude 2020, 58 mil km, cinza — R$ 112.900
- Hyundai Creta Pulse 2021, 41 mil km, branco — R$ 98.500
- Chevrolet Onix LT 1.0 2021, 48 mil km, prata — R$ 72.900
- Hyundai HB20 Comfort 2020, 61 mil km, branco — R$ 64.500

FINANCIAMENTO
Entrada a partir de 20%, até 60x. Simulação precisa de nome completo e CPF: chamar alguém da loja.

TROCA
Aceitamos carro na troca, com avaliação presencial.

HORÁRIO
Segunda a sexta, 9h às 18h. Sábado, 9h às 14h.`;

const CONHECIMENTO_PADARIA = `PADARIA E CAFÉ URUTAU
Pão francês R$ 0,90 · Pão de queijo R$ 6 · Café coado R$ 8 · Bolo de fubá (fatia) R$ 9.
Encomendas de bolo inteiro com 24h de antecedência: R$ 75 (fubá, cenoura, chocolate).
Entrega no bairro, taxa R$ 6. Aberto todos os dias, 6h às 20h. Pix, cartão e dinheiro.`;

async function conversa(
  db: BancoDeDados,
  empresaId: string,
  c: { telefone: string; nome: string; status?: "agente" | "humano" | "encerrada"; intencao?: string; resumo?: string; motivoHumano?: string; naoLidas?: number },
  linhas: Linha[],
) {
  const agora = Date.now();
  const em = (min: number) => new Date(agora - min * 60_000);
  const [cli] = await db.select({ id: clientes.id }).from(clientes).where(and(eq(clientes.empresaId, empresaId), eq(clientes.telefone, c.telefone)));
  const clienteId =
    cli?.id ?? (await db.insert(clientes).values({ empresaId, nome: c.nome, telefone: c.telefone, origem: "whatsapp" }).returning({ id: clientes.id }))[0].id;
  const entradas = linhas.filter((l) => l[1] === "cliente").map((l) => l[0]);
  const [conv] = await db
    .insert(conversas)
    .values({
      empresaId,
      canal: "whatsapp",
      telefone: c.telefone,
      nome: c.nome,
      clienteId,
      status: c.status ?? "agente",
      intencao: c.intencao,
      resumo: c.resumo,
      motivoHumano: c.motivoHumano,
      naoLidas: c.naoLidas ?? 0,
      ultimaEntradaEm: entradas.length ? em(Math.min(...entradas)) : null,
      ultimaMensagemEm: em(Math.min(...linhas.map((l) => l[0]))),
    })
    .returning({ id: conversas.id });
  let n = 0;
  await db.insert(mensagensWhatsapp).values(
    linhas.map(([min, autor, texto, extra]) => ({
      conversaId: conv.id,
      empresaId,
      autor,
      texto,
      status: autor === "cliente" ? ("recebida" as const) : ("lida" as const),
      waMessageId: autor === "sistema" ? null : `wamid.semente.${conv.id.slice(0, 8)}.${++n}`,
      // A resposta sai alguns segundos depois da pergunta do mesmo minuto.
      criadoEm: new Date(em(min).getTime() + (autor === "cliente" ? 0 : 6_000)),
      ...(autor === "agente"
        ? { tokensEntrada: 1_400, tokensSaida: 380, tokensCache: 3_100, custoMicrosUsd: 14_000 + CUSTO_META_MENSAGEM_MICROS, tempoRespostaMs: 3_000 + ((n * 1_700) % 6_000) }
        : autor === "humano"
          ? { custoMicrosUsd: CUSTO_META_MENSAGEM_MICROS }
          : {}),
      ...extra,
    })),
  );
}

export async function semearAtendimento(db: BancoDeDados, c: { revendaId: string; padariaId: string }) {
  const conectado = (phoneNumberId: string, numeroExibicao: string) =>
    process.env.CHAVE_SEGREDOS ? { phoneNumberId, numeroExibicao, tokenCifrado: cifrar("token-de-demonstracao") } : {};

  await db.insert(agentesWhatsapp).values([
    {
      empresaId: c.revendaId,
      nome: "Duda",
      tom: "simpática, direta, trata por você e fala de carro com segurança",
      conhecimento: CONHECIMENTO_REVENDA,
      quandoChamarHumano: "Simulação de financiamento, proposta de troca, desconto acima de R$ 2 mil, reclamação.",
      modo: "automatico",
      ...conectado("109876543210", "+55 21 3333-4444"),
    },
    {
      empresaId: c.padariaId,
      nome: "Bia",
      tom: "carinhosa e rápida, como atendente de padaria de bairro",
      conhecimento: CONHECIMENTO_PADARIA,
      quandoChamarHumano: "Encomenda para mais de 30 pessoas, reclamação, pedido de desconto.",
      modo: "aprovacao",
      ...conectado("109876543211", "+55 21 2222-1111"),
    },
  ]);
  // A padaria nasceu só com finanças: liga o atendente.
  await db.insert(empresaModulos).values({ empresaId: c.padariaId, modulo: "whatsapp", ativo: true }).onConflictDoNothing();

  const venda = { acoes: [{ nome: "anotar_atendimento", resumo: "Quer comprar: SUV até R$ 100 mil, tem Onix 2019 na troca" }] };
  await conversa(db, c.revendaId, { telefone: "5521998761234", nome: "Rafael Moura", intencao: "comprar", resumo: "SUV até R$ 100 mil, tem Onix 2019 na troca" }, [
    [42, "cliente", "Boa tarde! Vocês têm algum SUV até uns 100 mil?"],
    [42, "agente", "Boa tarde, Rafael! Tenho o Creta Pulse 2021, 41 mil km, por R$ 98.500 — revisado e com garantia de 3 meses. Quer ver fotos?", venda],
    [38, "cliente", "Quero sim. E vocês pegam meu Onix 2019 na troca?"],
    [38, "agente", "Pegamos, sim! A avaliação é presencial e leva uns 20 minutos. Quer passar aqui amanhã para ver o Creta e já avaliar o Onix?"],
    [31, "cliente", "Amanhã 10h pode ser?"],
    [31, "agente", "Combinado, amanhã às 10h. Vou deixar o Creta separado pra você 🚙", { acoes: [{ nome: "anotar_atendimento", resumo: "Agendar: visita amanhã 10h, Creta + avaliação do Onix" }] }],
  ]);
  await conversa(
    db,
    c.revendaId,
    { telefone: "5521987654321", nome: "Patrícia Gomes", status: "humano", intencao: "orcamento", resumo: "Financiar o Compass em 48x", motivoHumano: "Simulação de financiamento precisa de CPF", naoLidas: 1 },
    [
      [95, "cliente", "Oi, quanto fica o Compass financiado em 48x?"],
      [95, "agente", "Oi, Patrícia! Para simular certinho preciso que alguém da equipe veja com o banco. Já chamei o Diego, ele te responde em instantes.", { acoes: [{ nome: "chamar_humano", resumo: "Chamou a equipe: Simulação de financiamento precisa de CPF" }] }],
      [95, "sistema", "O agente chamou a equipe: Simulação de financiamento precisa de CPF"],
      [70, "humano", "Oi Patrícia, aqui é o Diego! Me passa seu nome completo e CPF que eu simulo agora."],
      [12, "cliente", "Patrícia Gomes Ferreira, o CPF eu mando por áudio pode ser?"],
    ],
  );
  await conversa(db, c.revendaId, { telefone: "5521912345678", nome: "João Victor", intencao: "agendar", resumo: "Test drive do Compass no sábado" }, [
    [180, "cliente", "Posso fazer test drive do Compass no sábado?"],
    [180, "agente", "Pode sim, João! Sábado abrimos das 9h às 14h. Qual horário fica melhor? Só preciso que traga a CNH."],
    [176, "cliente", "11h"],
    [176, "agente", "Fechado: sábado às 11h, test drive do Compass. Te espero aqui na Av. Roberto Silveira, 1200!", { acoes: [{ nome: "anotar_atendimento", resumo: "Agendar: test drive do Compass sábado 11h" }] }],
  ]);
  await conversa(db, c.revendaId, { telefone: "5521955550001", nome: "Marcos Pereira", status: "encerrada", intencao: "duvida", resumo: "Perguntou da garantia" }, [
    [1_500, "cliente", "A garantia cobre o ar-condicionado?"],
    [1_500, "agente", "A garantia de 3 meses cobre motor e câmbio. O ar-condicionado é revisado antes da venda, mas não entra na garantia."],
    [1_490, "cliente", "Entendi, obrigado"],
    [1_480, "sistema", "Conversa encerrada."],
  ]);
  await conversa(db, c.revendaId, { telefone: "5521966660002", nome: "Carla Nunes", naoLidas: 1 }, [[1, "cliente", "Boa tarde, o HB20 2020 ainda tá aí?"]]);

  await conversa(db, c.padariaId, { telefone: "5521977770003", nome: "Dona Lúcia", intencao: "comprar", resumo: "Bolo de cenoura inteiro para amanhã", naoLidas: 1 }, [
    [8, "cliente", "Bom dia! Consigo encomendar um bolo de cenoura pra amanhã à tarde?"],
    [8, "agente", "Bom dia, dona Lúcia! Consegue sim 🥕 O bolo inteiro sai por R$ 75. Prefere retirar aqui ou receber em casa (taxa de R$ 6)?", {
      status: "rascunho",
      waMessageId: null,
      tempoRespostaMs: null,
      custoMicrosUsd: 14_000,
      acoes: [{ nome: "anotar_atendimento", resumo: "Quer comprar: bolo de cenoura inteiro para amanhã" }],
    }],
  ]);
  await conversa(db, c.padariaId, { telefone: "5521977770004", nome: "Pedro Henrique", status: "humano", intencao: "comprar", resumo: "6 pães de queijo e 2 cafés para entrega", motivoHumano: "Cliente pediu a chave pix" }, [
    [55, "cliente", "Vocês entregam? Queria 6 pães de queijo e 2 cafés"],
    [52, "agente", "Entregamos sim, Pedro! 6 pães de queijo (R$ 36) + 2 cafés (R$ 16) + entrega (R$ 6) = R$ 58. Pode ser no pix?", { acoes: [{ nome: "anotar_atendimento", resumo: "Quer comprar: 6 pães de queijo e 2 cafés, entrega" }] }],
    [47, "cliente", "Pode, manda a chave"],
    [46, "humano", "Chave pix: padaria@urutau.dev ✅ Assim que cair, o motoboy sai daqui!"],
  ]);
}
