/**
 * Comercial de exemplo (Fase 7): leads de várias origens, histórico de contatos, propostas
 * e um lote de prospecção em Maricá lido do mesmo jeito que o CSV do robô do Google Maps.
 * Tudo fictício; só para o banco local.
 */
import { eq } from "drizzle-orm";
import type { BancoDeDados } from "../src/db";
import { interacoes, leads, propostas, type usuarios } from "../src/db/schema";
import { prospectosDoCsv } from "../src/lib/comercial";
import { hoje, somarDias } from "../src/lib/datas";

type Usuario = typeof usuarios.$inferSelect;
const minutos = (m: number) => new Date(Date.now() - m * 60_000);
const dia = (m: number) => minutos(m * 60 * 24);

const RAMOS = [
  ["Clínica Odonto", "Dentista"],
  ["Studio Pilates", "Estúdio de pilates"],
  ["Pet Shop", "Pet shop"],
  ["Auto Center", "Oficina mecânica"],
  ["Imobiliária", "Imobiliária"],
  ["Provedor Net", "Provedor de internet"],
  ["Padaria", "Padaria"],
  ["Academia", "Academia"],
  ["Ótica", "Ótica"],
  ["Contabilidade", "Escritório de contabilidade"],
] as const;
const BAIRROS = ["Centro", "Itaipuaçu", "Inoã", "Ponta Negra", "São José do Imbassaí", "Araçatiba"];

/** Gera um CSV no formato do google-maps-scraper-kit com --full. */
function csvDeExemplo() {
  const linhas = ["title,phone,emails,website,category,address,review_rating,review_count,latitude,longitude,place_id"];
  let n = 0;
  for (const [nome, cat] of RAMOS)
    for (let k = 0; k < 3; k++) {
      n++;
      const bairro = BAIRROS[(n * 7) % BAIRROS.length];
      const lat = (-22.905 + Math.sin(n * 12.9898) * 0.02).toFixed(5);
      const lon = (-42.82 + Math.cos(n * 78.233) * 0.07).toFixed(5);
      const nota = (3.8 + ((n * 37) % 12) / 10).toFixed(1);
      linhas.push(
        `"${nome} ${bairro}${k ? ` ${k + 1}` : ""}",+55 21 99000-${String(1000 + n).slice(-4)},${n % 3 ? "" : `contato${n}@exemplo.com.br`},${n % 2 ? `exemplo${n}.com.br` : ""},${cat},"Rua ${n}, ${100 + n} - ${bairro}, Maricá - RJ, 24900-000",${nota},${10 + ((n * 13) % 200)},${lat},${lon},ChIJexemplo${n}`,
      );
    }
  return linhas.join("\n");
}

export async function semearComercial(db: BancoDeDados, equipe: Usuario[]) {
  const [gabriel, borel, vinicius, wanderley] = equipe;
  const hojeData = hoje();

  const { prospectos } = prospectosDoCsv(csvDeExemplo());
  const lote = await db
    .insert(leads)
    .values(prospectos.map((p, i) => ({ ...p, origem: "prospeccao" as const, lote: "comércios em Maricá", responsavelId: i % 2 ? gabriel.id : vinicius.id, criadoPor: borel.id, criadoEm: dia(6) })))
    .returning({ id: leads.id, nome: leads.nome });
  // Parte do lote já foi trabalhada.
  const etapasLote = ["contatado", "contatado", "diagnostico", "perdido", "contatado", "proposta"] as const;
  for (const [i, etapa] of etapasLote.entries()) {
    const l = lote[i * 4];
    await db.update(leads).set({ etapa, proximoContato: etapa === "perdido" ? null : somarDias(hojeData, i - 2), motivoPerda: etapa === "perdido" ? "Já tem agência" : null }).where(eqId(l.id));
    await db.insert(interacoes).values([
      { leadId: l.id, autorId: i % 2 ? gabriel.id : vinicius.id, tipo: "ligacao", texto: "Falei com a recepção, pediram para mandar no WhatsApp.", criadoEm: dia(4) },
      { leadId: l.id, autorId: i % 2 ? gabriel.id : vinicius.id, tipo: "nota", texto: "", etapaDe: "novo", etapaPara: etapa, criadoEm: dia(4) },
    ]);
  }

  const diretos = await db
    .insert(leads)
    .values([
      {
        nome: "Clínica Mar",
        contato: "Ana Ribeiro",
        telefone: "5521991234567",
        email: "ana@clinicamar.com.br",
        categoria: "Clínica de fisioterapia",
        cidade: "Maricá",
        origem: "diagnostico",
        etapa: "diagnostico",
        interesses: ["atende", "sites"],
        dores: ["Respondo cliente no WhatsApp até tarde da noite.", "Cliente esquece o horário e simplesmente não aparece."],
        tamanho: "2 a 5 pessoas",
        valorEstimadoCentavos: 89_000,
        proximoContato: hojeData,
        responsavelId: gabriel.id,
        criadoEm: minutos(95),
      },
      {
        nome: "LinkFibra Provedor",
        contato: "Marcos",
        telefone: "5521988887777",
        categoria: "Provedor de internet",
        cidade: "Niterói",
        origem: "indicacao",
        etapa: "proposta",
        interesses: ["gestao", "financas", "flow"],
        valorEstimadoCentavos: 350_000,
        proximoContato: somarDias(hojeData, 2),
        responsavelId: borel.id,
        criadoEm: dia(12),
      },
      {
        nome: "Café Tauá",
        contato: "Juliana",
        telefone: "5521977776666",
        instagram: "cafetaua",
        categoria: "Cafeteria",
        cidade: "Maricá",
        origem: "instagram",
        etapa: "negociacao",
        interesses: ["ads", "sites"],
        valorEstimadoCentavos: 120_000,
        proximoContato: somarDias(hojeData, -1),
        responsavelId: wanderley.id,
        criadoEm: dia(9),
      },
      {
        nome: "Studio Lume",
        contato: "Rafa",
        telefone: "5521966665555",
        categoria: "Estúdio de design",
        cidade: "Rio de Janeiro",
        origem: "whatsapp",
        etapa: "ganho",
        interesses: ["gestao"],
        valorEstimadoCentavos: 150_000,
        responsavelId: vinicius.id,
        criadoEm: dia(20),
      },
      { nome: "Rodrigo (ligou)", telefone: "5521955554444", origem: "ligacao", etapa: "novo", observacao: "Ligou perguntando de site para a loja de material de construção.", responsavelId: borel.id, criadoEm: minutos(40) },
    ])
    .returning({ id: leads.id, nome: leads.nome });
  const [clinica, provedor, cafe, lume] = diretos;

  await db.insert(interacoes).values([
    { leadId: clinica.id, tipo: "nota", texto: "Marcou no diagnóstico: Respondo cliente no WhatsApp até tarde da noite. · Cliente esquece o horário e simplesmente não aparece.\nEquipe: 2 a 5 pessoas", criadoEm: minutos(95) },
    { leadId: clinica.id, autorId: gabriel.id, tipo: "whatsapp", texto: "Mandei áudio explicando o atendente. Ela quer ver funcionando.", criadoEm: minutos(60) },
    { leadId: clinica.id, autorId: gabriel.id, tipo: "nota", texto: "", etapaDe: "novo", etapaPara: "diagnostico", criadoEm: minutos(59) },
    { leadId: provedor.id, autorId: borel.id, tipo: "reuniao", texto: "Reunião de diagnóstico: 1.400 assinantes, cobrança em planilha, churn alto.", criadoEm: dia(8) },
    { leadId: provedor.id, autorId: borel.id, tipo: "nota", texto: "", etapaDe: "diagnostico", etapaPara: "proposta", criadoEm: dia(3) },
    { leadId: cafe.id, autorId: wanderley.id, tipo: "ligacao", texto: "Quer começar só com tráfego e depois o site.", criadoEm: dia(5) },
    { leadId: lume.id, autorId: vinicius.id, tipo: "nota", texto: "Aceitou a proposta.", etapaDe: "negociacao", etapaPara: "ganho", criadoEm: dia(2) },
  ]);

  await db.insert(propostas).values([
    { leadId: provedor.id, titulo: "Gestão + finanças para provedor", servicos: ["gestao", "financas", "flow"], valorMensalCentavos: 350_000, valorUnicoCentavos: 600_000, status: "enviada", enviadaEm: dia(3), validade: somarDias(hojeData, 10), criadoPor: borel.id },
    { leadId: cafe.id, titulo: "Tráfego no Instagram", servicos: ["ads"], valorMensalCentavos: 120_000, status: "enviada", enviadaEm: dia(4), validade: somarDias(hojeData, -1), criadoPor: wanderley.id },
    { leadId: lume.id, titulo: "Sistema de gestão do estúdio", servicos: ["gestao"], valorMensalCentavos: 150_000, valorUnicoCentavos: 250_000, status: "aceita", enviadaEm: dia(6), respondidaEm: dia(2), criadoPor: vinicius.id },
    { leadId: clinica.id, titulo: "Atendente no WhatsApp + site", servicos: ["atende", "sites"], valorMensalCentavos: 89_000, valorUnicoCentavos: 180_000, status: "rascunho", criadoPor: gabriel.id },
  ]);
}

const eqId = (id: string) => eq(leads.id, id);
