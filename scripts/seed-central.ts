/**
 * Central Urutau de exemplo (Fase 6): a equipe de quatro pessoas, as metas do mês, anotações,
 * clientes distribuídos e alguns sinais do site. Só para o banco local: as contas usam a
 * senha das contas de exemplo.
 */
import { eq } from "drizzle-orm";
import type { BancoDeDados } from "../src/db";
import { afazeres, auditoria, empresas, eventosSite, metas, notasEquipe, usuarios } from "../src/db/schema";
import { hoje, intervaloDoMes, mesAtual, somarDias } from "../src/lib/datas";

const minutos = (m: number) => new Date(Date.now() - m * 60_000);

export async function semearCentral(db: BancoDeDados, c: { senhaHash: string; admin: typeof usuarios.$inferSelect }) {
  const equipe = await db
    .insert(usuarios)
    .values([
      { nome: "Gabriel Ottaviano", email: "ottaviano@urutau.dev", senhaHash: c.senhaHash, superadmin: true, vistoEm: minutos(0.5), ondeEsta: "/admin" },
      { nome: "João Pedro Borel", email: "borel@urutau.dev", senhaHash: c.senhaHash, superadmin: true, vistoEm: minutos(14), ondeEsta: "/admin/empresas" },
      { nome: "Vinícius", email: "vinicius@urutau.dev", senhaHash: c.senhaHash, superadmin: true, vistoEm: minutos(60 * 26) },
      { nome: "Wanderley", email: "wanderley@urutau.dev", senhaHash: c.senhaHash, superadmin: true },
    ])
    .returning();
  const [gabriel, borel, vinicius, wanderley] = equipe;
  // A conta genérica de exemplo sai da equipe: quem aparece na Central são as pessoas.
  await db.update(usuarios).set({ superadmin: false }).where(eq(usuarios.id, c.admin.id));
  await db.update(auditoria).set({ usuarioId: gabriel.id }).where(eq(auditoria.usuarioId, c.admin.id));

  const lista = await db.select({ id: empresas.id, nome: empresas.nome }).from(empresas);
  const resp: Record<string, string> = { "Urutau Veículos": gabriel.id, "Padaria e Café Urutau": vinicius.id };
  for (const e of lista) {
    const r = resp[e.nome] ?? borel.id;
    await db.update(empresas).set({ responsavelId: r }).where(eq(empresas.id, e.id));
  }
  const loja = lista.find((e) => e.nome === "Urutau Veículos");

  const mes = intervaloDoMes(mesAtual()).inicio;
  await db.insert(metas).values([
    { usuarioId: gabriel.id, mes, titulo: "Fechar clientes novos", tipo: "quantidade", alvo: 3, atual: 2 },
    { usuarioId: gabriel.id, mes, titulo: "Receita nova no mês", tipo: "valor", alvo: 1_500_000, atual: 900_000 },
    { usuarioId: borel.id, mes, titulo: "Entregar a Central da equipe", tipo: "quantidade", alvo: 1, atual: 1 },
    { usuarioId: borel.id, mes, titulo: "Sites publicados", tipo: "quantidade", alvo: 4, atual: 1 },
    { usuarioId: vinicius.id, mes, titulo: "Reuniões com clientes", tipo: "quantidade", alvo: 12, atual: 9 },
    { usuarioId: vinicius.id, mes, titulo: "Investimento em tráfego gerido", tipo: "valor", alvo: 800_000, atual: 520_000 },
    { usuarioId: wanderley.id, mes, titulo: "Posts para clientes", tipo: "quantidade", alvo: 20, atual: 6 },
  ]);

  await db.insert(notasEquipe).values([
    { autorId: vinicius.id, texto: "Reunião de pauta toda segunda, 9h.", fixada: true },
    { autorId: gabriel.id, sobreUsuarioId: gabriel.id, empresaId: loja?.id, texto: "Ligar para a Urutau Veículos sexta: querem o atendente do WhatsApp para novembro." },
    { autorId: borel.id, sobreUsuarioId: wanderley.id, texto: "Fotos dos lançamentos da Betânia chegam quarta." },
    { autorId: wanderley.id, sobreUsuarioId: vinicius.id, texto: "Cliente da padaria pediu orçamento de tráfego para dezembro." },
  ]);

  await db.insert(auditoria).values([
    { usuarioId: gabriel.id, ator: "usuario", acao: "meta.progresso", dados: { titulo: "Fechar clientes novos" }, criadoEm: minutos(35) },
    { usuarioId: borel.id, ator: "usuario", acao: "meta.progresso", dados: { titulo: "Entregar a Central da equipe" }, criadoEm: minutos(80) },
    { usuarioId: vinicius.id, empresaId: loja?.id, ator: "admin", acao: "admin.modulos", criadoEm: minutos(60 * 5) },
    { usuarioId: gabriel.id, ator: "admin", acao: "equipe.adicionar", dados: { nome: "Wanderley" }, criadoEm: minutos(60 * 30) },
  ]);

  const hojeData = hoje();
  const padaria = lista.find((e) => e.nome === "Padaria e Café Urutau");
  await db.insert(afazeres).values([
    { titulo: "Mandar proposta do atendente de WhatsApp", responsavelId: gabriel.id, empresaId: loja?.id, prazo: somarDias(hojeData, 2), criadoPor: gabriel.id },
    { titulo: "Ligar para conferir as vendas paradas", responsavelId: gabriel.id, empresaId: loja?.id, prazo: somarDias(hojeData, -2), criadoPor: borel.id },
    { titulo: "Publicar o site da Betânia", responsavelId: borel.id, prazo: hojeData, criadoPor: borel.id },
    { titulo: "Ligar o site urutau.io à Central", responsavelId: borel.id, prazo: somarDias(hojeData, 5), criadoPor: borel.id },
    { titulo: "Orçamento de tráfego para dezembro", responsavelId: vinicius.id, empresaId: padaria?.id, prazo: somarDias(hojeData, 1), criadoPor: wanderley.id },
    { titulo: "Calendário de posts de novembro", responsavelId: wanderley.id, prazo: somarDias(hojeData, 4), criadoPor: vinicius.id },
    { titulo: "Responder a Ana Ribeiro (contato do site)", criadoPor: vinicius.id },
    { titulo: "Treinar a loja na caixa de conferência", responsavelId: gabriel.id, empresaId: loja?.id, feitoEm: minutos(60 * 20), feitoPor: gabriel.id, criadoPor: gabriel.id },
    { titulo: "Revisar metas de outubro", responsavelId: vinicius.id, feitoEm: minutos(60 * 50), feitoPor: vinicius.id, criadoPor: vinicius.id },
  ]);

  await db.insert(eventosSite).values([
    ...Array.from({ length: 46 }, (_, i) => ({ tipo: "visita" as const, pagina: i % 3 ? "/" : "/servicos", criadoEm: minutos(i * 190) })),
    { tipo: "whatsapp", pagina: "/", criadoEm: minutos(50) },
    { tipo: "whatsapp", pagina: "/servicos", criadoEm: minutos(60 * 20) },
    { tipo: "contato", pagina: "/contato", nome: "Ana Ribeiro", contato: "ana@clinicaribeiro.com.br", mensagem: "Quero um site e agenda online para a clínica.", criadoEm: minutos(95) },
  ]);
  return equipe;
}
