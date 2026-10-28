import { sql } from "drizzle-orm";
import type { FichaVisitante } from "../lib/chat-site";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Convenções
 * - Dinheiro: bigint em centavos (sufixo _centavos). Percentuais: inteiro em pcm (1% = 1000).
 * - Toda tabela de negócio tem empresa_id. Referências entre tabelas de negócio usam
 *   chave composta (empresa_id, id), então o banco recusa ligar dados de empresas diferentes.
 * - Exclusão lógica via excluido_em.
 */

const centavos = (nome: string) => bigint(nome, { mode: "number" });
const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();
const atualizadoEm = () =>
  timestamp("atualizado_em", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const excluidoEm = () => timestamp("excluido_em", { withTimezone: true });

export const atividadeEnum = pgEnum("atividade", ["comercio", "servicos", "ambos"]);
export const regimeEnum = pgEnum("regime_tributario", ["mei", "simples", "presumido", "real"]);
export const anexoEnum = pgEnum("anexo_simples", ["I", "II", "III", "IV", "V"]);
export const papelEnum = pgEnum("papel", ["dono", "colaborador", "contador"]);
export const papelEquipeEnum = pgEnum("papel_equipe", ["socio", "equipe"]);
export const naturezaEnum = pgEnum("natureza_receita", ["comercio", "servico"]);
export const formaPagamentoEnum = pgEnum("forma_pagamento", [
  "dinheiro",
  "pix",
  "debito",
  "credito",
  "boleto",
  "transferencia",
  "outro",
]);
export const statusVendaEnum = pgEnum("status_venda", ["recebido", "a_receber"]);
export const statusDespesaEnum = pgEnum("status_despesa", ["pago", "a_pagar"]);
export const comportamentoEnum = pgEnum("comportamento_custo", ["fixo", "variavel"]);
export const chaveCategoriaEnum = pgEnum("chave_categoria", [
  "contas_fixas",
  "funcionarios",
  "mercadorias",
  "impostos",
  "pro_labore",
  "marketing",
  "juros_tarifas",
  "outras",
]);
export const origemDespesaEnum = pgEnum("origem_despesa", ["manual", "recorrente", "imposto"]);
export const tipoProvisaoEnum = pgEnum("tipo_provisao", ["decimo_terceiro", "ferias"]);
export const statusPagamentoEnum = pgEnum("status_pagamento", ["pago", "a_pagar"]);
export const tipoDividaEnum = pgEnum("tipo_divida", [
  "emprestimo",
  "financiamento",
  "fornecedor",
  "imposto_parcelado",
  "cartao",
  "outro",
]);
export const tratamentoMercadoriasEnum = pgEnum("tratamento_mercadorias", ["despesa_na_compra", "cmv"]);
/** Tipo de negócio: decide a tela inicial, o menu e os módulos ligados por padrão (src/lib/perfis.ts). */
export const perfilEnum = pgEnum("perfil_empresa", [
  "financas",
  "revenda_veiculos",
  "consultorio",
  "varejo",
  "servicos",
  "alimentacao",
]);
export const moduloEnum = pgEnum("modulo", ["financas", "agenda", "estoque", "whatsapp"]);
/** Por onde a venda entrou. Só "manual" já nasce conferida; as automáticas esperam o check do dono. */
export const origemVendaEnum = pgEnum("origem_venda", ["manual", "whatsapp", "agenda", "balcao", "site"]);
export const origemClienteEnum = pgEnum("origem_cliente", ["manual", "whatsapp", "site", "balcao", "indicacao"]);
export const atorEnum = pgEnum("ator", ["usuario", "admin", "agente", "sistema"]);
export const statusTarefaEnum = pgEnum("status_tarefa", ["pendente", "executando", "concluida", "falhou"]);
export const tipoMetaEnum = pgEnum("tipo_meta", ["valor", "quantidade"]);
export const tipoEventoSiteEnum = pgEnum("tipo_evento_site", ["visita", "contato", "whatsapp", "diagnostico", "secao"]);
/** Por onde o lead chegou até a Urutau. */
export const origemLeadEnum = pgEnum("origem_lead", ["site", "diagnostico", "whatsapp", "ligacao", "instagram", "indicacao", "prospeccao", "outro"]);
/** Funil comercial da Urutau, na ordem. */
export const etapaLeadEnum = pgEnum("etapa_lead", ["novo", "contatado", "diagnostico", "proposta", "negociacao", "ganho", "perdido"]);
export const tipoInteracaoEnum = pgEnum("tipo_interacao", ["ligacao", "whatsapp", "email", "reuniao", "visita", "nota"]);
export const statusPropostaEnum = pgEnum("status_proposta", ["rascunho", "enviada", "aceita", "recusada"]);

// ─── Acesso ──────────────────────────────────────────────────────────────────

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  email: text("email").notNull().unique(),
  senhaHash: text("senha_hash").notNull(),
  superadmin: boolean("superadmin").notNull().default(false),
  /** Dentro da equipe Urutau: sócio vê as finanças da empresa; equipe vê só as próprias. */
  papelEquipe: papelEquipeEnum("papel_equipe").notNull().default("equipe"),
  /** A senha foi gerada pelo painel Urutau: a pessoa ainda precisa trocar. */
  senhaProvisoria: boolean("senha_provisoria").notNull().default(false),
  /** Último sinal de vida de uma aba aberta (POST /api/presenca, a cada minuto). */
  vistoEm: timestamp("visto_em", { withTimezone: true }),
  /** Caminho da tela onde a pessoa estava no último sinal. */
  ondeEsta: text("onde_esta"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const sessoes = pgTable(
  "sessoes",
  {
    tokenHash: text("token_hash").primaryKey(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index("sessoes_usuario_idx").on(t.usuarioId)],
);

// ─── Empresa ─────────────────────────────────────────────────────────────────

export const empresas = pgTable(
  "empresas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    cnpj: text("cnpj"),
    atividade: atividadeEnum("atividade").notNull(),
    cidade: text("cidade"),
    uf: text("uf"),
    regime: regimeEnum("regime").notNull(),
    anexoComercio: anexoEnum("anexo_comercio"),
    anexoServicos: anexoEnum("anexo_servicos"),
    sujeitoFatorR: boolean("sujeito_fator_r").notNull().default(false),
    aliquotaIssPcm: integer("aliquota_iss_pcm"),
    aliquotaIcmsPcm: integer("aliquota_icms_pcm"),
    inicioAtividade: date("inicio_atividade"),
    tratamentoMercadorias: tratamentoMercadoriasEnum("tratamento_mercadorias")
      .notNull()
      .default("despesa_na_compra"),
    perfil: perfilEnum("perfil").notNull().default("financas"),
    /** Quem da equipe Urutau cuida deste cliente. */
    responsavelId: uuid("responsavel_id").references((): AnyPgColumn => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    check("empresas_cnpj_formato", sql`${t.cnpj} is null or ${t.cnpj} ~ '^[0-9]{14}$'`),
    check("empresas_uf_formato", sql`${t.uf} is null or ${t.uf} ~ '^[A-Z]{2}$'`),
    check("empresas_anexo_comercio", sql`${t.anexoComercio} is null or ${t.anexoComercio} in ('I','II')`),
    check(
      "empresas_anexo_servicos",
      sql`${t.anexoServicos} is null or ${t.anexoServicos} in ('III','IV','V')`,
    ),
  ],
);

export const empresaUsuarios = pgTable(
  "empresa_usuarios",
  {
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    papel: papelEnum("papel").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.empresaId, t.usuarioId] }), index("eu_usuario_idx").on(t.usuarioId)],
);

/** Módulos ligados para a empresa. Sem linha = vale o padrão do perfil. */
export const empresaModulos = pgTable(
  "empresa_modulos",
  {
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    modulo: moduloEnum("modulo").notNull(),
    ativo: boolean("ativo").notNull(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [primaryKey({ columns: [t.empresaId, t.modulo] })],
);

/** Faturamento e folha de meses anteriores ao uso do sistema (para RBT12 e Fator R). */
export const receitasHistoricas = pgTable(
  "receitas_historicas",
  {
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    competencia: text("competencia").notNull(), // AAAA-MM
    /** null = não informado (vale o que foi lançado no sistema). */
    receitaCentavos: centavos("receita_centavos"),
    folhaCentavos: centavos("folha_centavos"),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    primaryKey({ columns: [t.empresaId, t.competencia] }),
    check("rh_competencia", sql`${t.competencia} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("rh_valores", sql`${t.receitaCentavos} >= 0 and ${t.folhaCentavos} >= 0`),
  ],
);

// ─── Clientes ────────────────────────────────────────────────────────────────

/** Quem compra ou é atendido. No WhatsApp, o telefone identifica o cliente. */
export const clientes = pgTable(
  "clientes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    /** Só dígitos com DDI (ex.: 5521999998888), o mesmo formato que o WhatsApp entrega. */
    telefone: text("telefone"),
    email: text("email"),
    /** CPF ou CNPJ, só dígitos. */
    documento: text("documento"),
    observacao: text("observacao").notNull().default(""),
    origem: origemClienteEnum("origem").notNull().default("manual"),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [
    unique("clientes_empresa_id_uq").on(t.empresaId, t.id),
    check("clientes_telefone", sql`${t.telefone} is null or ${t.telefone} ~ '^[0-9]{10,15}$'`),
    check("clientes_documento", sql`${t.documento} is null or ${t.documento} ~ '^([0-9]{11}|[0-9]{14})$'`),
    index("clientes_empresa_nome_idx").on(t.empresaId, t.nome),
    // Um telefone identifica um cliente por empresa (é assim que o WhatsApp acha quem está falando).
    uniqueIndex("clientes_telefone_uq")
      .on(t.empresaId, t.telefone)
      .where(sql`${t.telefone} is not null and ${t.excluidoEm} is null`),
  ],
);

// ─── Vendas ──────────────────────────────────────────────────────────────────

export const fontesReceita = pgTable(
  "fontes_receita",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    natureza: naturezaEnum("natureza").notNull(),
    ativo: boolean("ativo").notNull().default(true),
    ordem: integer("ordem").notNull().default(0),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [unique("fontes_empresa_id_uq").on(t.empresaId, t.id)],
);

export const vendas = pgTable(
  "vendas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    data: date("data").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    descricao: text("descricao").notNull().default(""),
    fonteReceitaId: uuid("fonte_receita_id").notNull(),
    formaPagamento: formaPagamentoEnum("forma_pagamento").notNull(),
    status: statusVendaEnum("status").notNull(),
    /** Prevista enquanto a_receber; efetiva quando recebido. */
    dataRecebimento: date("data_recebimento").notNull(),
    clienteId: uuid("cliente_id"),
    origem: origemVendaEnum("origem").notNull().default("manual"),
    /**
     * null = entrou sozinha (WhatsApp, agenda…) e espera o check do dono. O padrão é "agora":
     * quem lança à mão já conferiu; os canais automáticos gravam null de propósito.
     */
    conferidoEm: timestamp("conferido_em", { withTimezone: true }).defaultNow(),
    conferidoPor: uuid("conferido_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [
    foreignKey({
      name: "vendas_fonte_fk",
      columns: [t.empresaId, t.fonteReceitaId],
      foreignColumns: [fontesReceita.empresaId, fontesReceita.id],
    }),
    foreignKey({
      name: "vendas_cliente_fk",
      columns: [t.empresaId, t.clienteId],
      foreignColumns: [clientes.empresaId, clientes.id],
    }),
    index("vendas_empresa_conferir_idx").on(t.empresaId).where(sql`${t.conferidoEm} is null and ${t.excluidoEm} is null`),
    index("vendas_empresa_cliente_idx").on(t.empresaId, t.clienteId),
    check("vendas_valor_positivo", sql`${t.valorCentavos} > 0`),
    index("vendas_empresa_data_idx").on(t.empresaId, t.data),
    index("vendas_empresa_receb_idx").on(t.empresaId, t.dataRecebimento),
  ],
);

// ─── Despesas ────────────────────────────────────────────────────────────────

export const categoriasDespesa = pgTable(
  "categorias_despesa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    /** Identifica as categorias padrão para os lançamentos automáticos; null nas criadas pelo usuário. */
    chaveSistema: chaveCategoriaEnum("chave_sistema"),
    comportamento: comportamentoEnum("comportamento").notNull(),
    entraNoLucro: boolean("entra_no_lucro").notNull().default(true),
    entraNaFolhaFatorR: boolean("entra_na_folha_fator_r").notNull().default(false),
    ativo: boolean("ativo").notNull().default(true),
    ordem: integer("ordem").notNull().default(0),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    unique("categorias_empresa_id_uq").on(t.empresaId, t.id),
    unique("categorias_chave_uq").on(t.empresaId, t.chaveSistema),
  ],
);

/** Despesa cadastrada uma vez e gerada todo mês (ex.: aluguel todo dia 10). */
export const despesasRecorrentes = pgTable(
  "despesas_recorrentes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    descricao: text("descricao").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    categoriaId: uuid("categoria_id").notNull(),
    diaVencimento: integer("dia_vencimento").notNull(),
    /** Primeiro e último mês (AAAA-MM) em que a despesa é gerada; fim null = sem fim. */
    inicio: text("inicio").notNull(),
    fim: text("fim"),
    ativo: boolean("ativo").notNull().default(true),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    unique("recorrentes_empresa_id_uq").on(t.empresaId, t.id),
    foreignKey({
      name: "recorrentes_categoria_fk",
      columns: [t.empresaId, t.categoriaId],
      foreignColumns: [categoriasDespesa.empresaId, categoriasDespesa.id],
    }),
    check("recorrentes_valor", sql`${t.valorCentavos} > 0`),
    check("recorrentes_dia", sql`${t.diaVencimento} between 1 and 31`),
    check("recorrentes_meses", sql`${t.inicio} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and (${t.fim} is null or ${t.fim} >= ${t.inicio})`),
  ],
);

export const despesas = pgTable(
  "despesas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    /** Competência: mês em que a despesa pesa no lucro. */
    data: date("data").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    descricao: text("descricao").notNull().default(""),
    categoriaId: uuid("categoria_id").notNull(),
    status: statusDespesaEnum("status").notNull(),
    vencimento: date("vencimento").notNull(),
    pagoEm: date("pago_em"),
    origem: origemDespesaEnum("origem").notNull().default("manual"),
    recorrenciaId: uuid("recorrencia_id"),
    /**
     * Chave dos lançamentos gerados pelo sistema ("recorrente:<id>:2026-10", "imposto:simples:2026-09"):
     * impede gerar duas vezes, mesmo que o usuário exclua o lançamento.
     */
    referencia: text("referencia"),
    /** Reservado para o controle de estoque (compra de mercadoria → entrada no estoque). */
    compraId: uuid("compra_id"),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [
    foreignKey({
      name: "despesas_categoria_fk",
      columns: [t.empresaId, t.categoriaId],
      foreignColumns: [categoriasDespesa.empresaId, categoriasDespesa.id],
    }),
    check("despesas_valor_positivo", sql`${t.valorCentavos} > 0`),
    check(
      "despesas_pago_coerente",
      sql`(${t.status} = 'pago') = (${t.pagoEm} is not null)`,
    ),
    index("despesas_empresa_data_idx").on(t.empresaId, t.data),
    index("despesas_empresa_venc_idx").on(t.empresaId, t.vencimento),
    unique("despesas_referencia_uq").on(t.empresaId, t.referencia),
    foreignKey({
      name: "despesas_recorrencia_fk",
      columns: [t.empresaId, t.recorrenciaId],
      foreignColumns: [despesasRecorrentes.empresaId, despesasRecorrentes.id],
    }),
  ],
);

// ─── Parâmetros fiscais (com vigência) ───────────────────────────────────────

/** Alíquotas, limites e valores definidos por lei. Nunca ficam no código. */
export const parametrosFiscais = pgTable(
  "parametros_fiscais",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chave: text("chave").notNull(),
    /** pcm para percentuais, centavos para valores. */
    valor: bigint("valor", { mode: "number" }).notNull(),
    unidade: text("unidade").notNull(), // 'pcm' | 'centavos'
    descricao: text("descricao").notNull(),
    fonteLegal: text("fonte_legal"),
    vigenciaInicio: date("vigencia_inicio").notNull(),
    vigenciaFim: date("vigencia_fim"),
    criadoEm: criadoEm(),
  },
  (t) => [
    index("parametros_chave_idx").on(t.chave, t.vigenciaInicio),
    check("parametros_vigencia", sql`${t.vigenciaFim} is null or ${t.vigenciaFim} >= ${t.vigenciaInicio}`),
  ],
);

/** Tabelas dos Anexos do Simples Nacional (LC 123/2006, Anexos I a V). */
export const simplesFaixas = pgTable(
  "simples_faixas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    anexo: anexoEnum("anexo").notNull(),
    faixa: integer("faixa").notNull(),
    /** Limite superior da faixa (RBT12), inclusivo. */
    receitaAteCentavos: centavos("receita_ate_centavos").notNull(),
    aliquotaNominalPcm: integer("aliquota_nominal_pcm").notNull(),
    parcelaDeduzirCentavos: centavos("parcela_deduzir_centavos").notNull(),
    vigenciaInicio: date("vigencia_inicio").notNull(),
    vigenciaFim: date("vigencia_fim"),
  },
  (t) => [
    unique("simples_faixas_uq").on(t.anexo, t.faixa, t.vigenciaInicio),
    check("sf_valores", sql`${t.receitaAteCentavos} > 0 and ${t.aliquotaNominalPcm} > 0 and ${t.parcelaDeduzirCentavos} >= 0`),
  ],
);

/** Valores que a empresa sobrescreve (ex.: RAT ajustado pelo FAP, alíquota de terceiros). */
export const empresaParametros = pgTable(
  "empresa_parametros",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    chave: text("chave").notNull(),
    valor: bigint("valor", { mode: "number" }).notNull(),
    vigenciaInicio: date("vigencia_inicio").notNull(),
    vigenciaFim: date("vigencia_fim"),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("empresa_parametros_uq").on(t.empresaId, t.chave, t.vigenciaInicio),
    check("ep_vigencia", sql`${t.vigenciaFim} is null or ${t.vigenciaFim} >= ${t.vigenciaInicio}`),
  ],
);

// ─── Funcionários ────────────────────────────────────────────────────────────

export const funcionarios = pgTable(
  "funcionarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    cargo: text("cargo").notNull().default(""),
    salarioBrutoCentavos: centavos("salario_bruto_centavos").notNull(),
    admissao: date("admissao").notNull(),
    desligamento: date("desligamento"),
    /** Valor que a empresa paga por mês (já descontada a parte do funcionário). */
    vtCentavos: centavos("vt_centavos").notNull().default(0),
    vrCentavos: centavos("vr_centavos").notNull().default(0),
    planoSaudeCentavos: centavos("plano_saude_centavos").notNull().default(0),
    outrosBeneficiosCentavos: centavos("outros_beneficios_centavos").notNull().default(0),
    /** Primeiro mês em que o urutau gera a folha (antes disso, o custo foi lançado à mão). */
    folhaDesde: text("folha_desde").notNull(),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [
    unique("funcionarios_empresa_id_uq").on(t.empresaId, t.id),
    check("func_salario", sql`${t.salarioBrutoCentavos} > 0`),
    check(
      "func_beneficios",
      sql`${t.vtCentavos} >= 0 and ${t.vrCentavos} >= 0 and ${t.planoSaudeCentavos} >= 0 and ${t.outrosBeneficiosCentavos} >= 0`,
    ),
    check("func_datas", sql`${t.desligamento} is null or ${t.desligamento} >= ${t.admissao}`),
    check("func_folha_desde", sql`${t.folhaDesde} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

/** Foto do custo de cada funcionário em cada mês: aumentos futuros não reescrevem o passado. */
export const folhaMensal = pgTable(
  "folha_mensal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    funcionarioId: uuid("funcionario_id").notNull(),
    competencia: text("competencia").notNull(), // AAAA-MM
    diasTrabalhados: integer("dias_trabalhados").notNull(),
    salario: centavos("salario").notNull(),
    fgts: centavos("fgts").notNull(),
    provisao13: centavos("provisao_13").notNull(),
    provisaoFerias: centavos("provisao_ferias").notNull(),
    fgtsProvisoes: centavos("fgts_provisoes").notNull(),
    inssPatronal: centavos("inss_patronal").notNull(),
    rat: centavos("rat").notNull(),
    terceiros: centavos("terceiros").notNull(),
    beneficios: centavos("beneficios").notNull(),
    custoTotal: centavos("custo_total").notNull(),
    /** Parte que sai do caixa no pagamento do mês (sem provisões de 13º e férias). */
    valorCaixa: centavos("valor_caixa").notNull(),
    vencimento: date("vencimento").notNull(),
    status: statusPagamentoEnum("status").notNull().default("a_pagar"),
    pagoEm: date("pago_em"),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    unique("folha_func_comp_uq").on(t.empresaId, t.funcionarioId, t.competencia),
    foreignKey({
      name: "folha_funcionario_fk",
      columns: [t.empresaId, t.funcionarioId],
      foreignColumns: [funcionarios.empresaId, funcionarios.id],
    }).onDelete("cascade"),
    check("folha_pago_coerente", sql`(${t.status} = 'pago') = (${t.pagoEm} is not null)`),
    index("folha_empresa_comp_idx").on(t.empresaId, t.competencia),
  ],
);

/**
 * Pagamento de 13º ou férias. O custo já entrou no lucro mês a mês pelas reservas;
 * aqui registramos só a saída do caixa.
 */
export const pagamentosProvisao = pgTable(
  "pagamentos_provisao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    funcionarioId: uuid("funcionario_id").notNull(),
    tipo: tipoProvisaoEnum("tipo").notNull(),
    pagoEm: date("pago_em").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    descricao: text("descricao").notNull().default(""),
    criadoEm: criadoEm(),
  },
  (t) => [
    foreignKey({
      name: "provisao_funcionario_fk",
      columns: [t.empresaId, t.funcionarioId],
      foreignColumns: [funcionarios.empresaId, funcionarios.id],
    }).onDelete("cascade"),
    check("provisao_valor", sql`${t.valorCentavos} > 0`),
    index("provisao_empresa_data_idx").on(t.empresaId, t.pagoEm),
  ],
);

// ─── Dívidas ─────────────────────────────────────────────────────────────────

export const dividas = pgTable(
  "dividas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    credor: text("credor").notNull(),
    tipo: tipoDividaEnum("tipo").notNull(),
    valorOriginalCentavos: centavos("valor_original_centavos").notNull(),
    /** Saldo no momento do cadastro, a partir do qual as parcelas restantes são geradas. */
    saldoDevedorCentavos: centavos("saldo_devedor_centavos").notNull(),
    jurosMensaisPcm: integer("juros_mensais_pcm").notNull(),
    numParcelas: integer("num_parcelas").notNull(),
    valorParcelaCentavos: centavos("valor_parcela_centavos").notNull(),
    /** true se o valor da parcela veio do contrato; false se calculado pela tabela Price. */
    parcelaInformada: boolean("parcela_informada").notNull().default(false),
    diaVencimento: integer("dia_vencimento").notNull(),
    primeiroVencimento: date("primeiro_vencimento").notNull(),
    observacao: text("observacao").notNull().default(""),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [
    unique("dividas_empresa_id_uq").on(t.empresaId, t.id),
    check("dividas_valores", sql`${t.valorOriginalCentavos} > 0 and ${t.saldoDevedorCentavos} > 0 and ${t.valorParcelaCentavos} > 0`),
    check("dividas_juros", sql`${t.jurosMensaisPcm} >= 0 and ${t.jurosMensaisPcm} <= 100000`),
    check("dividas_parcelas", sql`${t.numParcelas} between 1 and 600`),
    check("dividas_dia", sql`${t.diaVencimento} between 1 and 31`),
  ],
);

export const parcelasDivida = pgTable(
  "parcelas_divida",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    dividaId: uuid("divida_id").notNull(),
    numero: integer("numero").notNull(),
    vencimento: date("vencimento").notNull(),
    valor: centavos("valor").notNull(),
    /** Despesa do mês do vencimento. */
    juros: centavos("juros").notNull(),
    /** Reduz o saldo devedor; não é despesa. */
    amortizacao: centavos("amortizacao").notNull(),
    saldoApos: centavos("saldo_apos").notNull(),
    status: statusPagamentoEnum("status").notNull().default("a_pagar"),
    pagoEm: date("pago_em"),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    unique("parcelas_divida_numero_uq").on(t.dividaId, t.numero),
    foreignKey({
      name: "parcelas_divida_fk",
      columns: [t.empresaId, t.dividaId],
      foreignColumns: [dividas.empresaId, dividas.id],
    }).onDelete("cascade"),
    check("parcelas_valores", sql`${t.valor} = ${t.juros} + ${t.amortizacao} and ${t.juros} >= 0 and ${t.amortizacao} >= 0`),
    check("parcelas_pago_coerente", sql`(${t.status} = 'pago') = (${t.pagoEm} is not null)`),
    index("parcelas_empresa_venc_idx").on(t.empresaId, t.vencimento),
  ],
);

// ─── Auditoria e tarefas ─────────────────────────────────────────────────────

/** Quem fez o quê. O agente do WhatsApp e o painel Urutau também registram aqui. */
export const auditoria = pgTable(
  "auditoria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** null em ações fora de uma empresa (ex.: admin redefiniu a senha de alguém). */
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    ator: atorEnum("ator").notNull(),
    acao: text("acao").notNull(),
    entidade: text("entidade"),
    entidadeId: uuid("entidade_id"),
    dados: jsonb("dados").$type<Record<string, unknown>>(),
    criadoEm: criadoEm(),
  },
  (t) => [index("auditoria_empresa_idx").on(t.empresaId, t.criadoEm)],
);

/**
 * Trabalho feito fora de uma tela (rotinas diárias, depois mensagens do WhatsApp e lembretes).
 * O cron pega as pendentes com FOR UPDATE SKIP LOCKED; `chave` impede enfileirar a mesma coisa duas vezes.
 */
export const tarefas = pgTable(
  "tarefas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull(),
    dados: jsonb("dados").$type<Record<string, unknown>>().notNull().default({}),
    chave: text("chave").unique(),
    status: statusTarefaEnum("status").notNull().default("pendente"),
    executarEm: timestamp("executar_em", { withTimezone: true }).notNull().defaultNow(),
    tentativas: integer("tentativas").notNull().default(0),
    ultimoErro: text("ultimo_erro"),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [index("tarefas_fila_idx").on(t.status, t.executarEm)],
);

// ─── Central da equipe Urutau ────────────────────────────────────────────────

/** Meta do mês de uma pessoa da equipe. "valor" em centavos; "quantidade" em unidades. */
export const metas = pgTable(
  "metas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    /** Primeiro dia do mês da meta. */
    mes: date("mes").notNull(),
    titulo: text("titulo").notNull(),
    tipo: tipoMetaEnum("tipo").notNull(),
    alvo: bigint("alvo", { mode: "number" }).notNull(),
    atual: bigint("atual", { mode: "number" }).notNull().default(0),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    index("metas_usuario_mes_idx").on(t.usuarioId, t.mes),
    check("metas_alvo_positivo", sql`${t.alvo} > 0`),
    check("metas_atual_nao_negativo", sql`${t.atual} >= 0`),
    check("metas_mes_dia_1", sql`extract(day from ${t.mes}) = 1`),
  ],
);

/** Anotações da equipe. `sobreUsuarioId` põe a nota na área de alguém; `empresaId`, num cliente. */
export const notasEquipe = pgTable(
  "notas_equipe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    autorId: uuid("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
    sobreUsuarioId: uuid("sobre_usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
    texto: text("texto").notNull(),
    fixada: boolean("fixada").notNull().default(false),
    criadoEm: criadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [index("notas_equipe_criado_idx").on(t.criadoEm)],
);

/** Tarefas da equipe Urutau: o que cada um tem para fazer, com prazo e cliente opcionais. */
export const afazeres = pgTable(
  "afazeres",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    titulo: text("titulo").notNull(),
    responsavelId: uuid("responsavel_id").references(() => usuarios.id, { onDelete: "set null" }),
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
    prazo: date("prazo"),
    feitoEm: timestamp("feito_em", { withTimezone: true }),
    feitoPor: uuid("feito_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
  },
  (t) => [index("afazeres_abertos_idx").on(t.feitoEm, t.prazo)],
);

// ─── Comercial da Urutau ─────────────────────────────────────────────────────

/**
 * Quem pode virar cliente da Urutau: veio pelo site, pelo diagnóstico, ligou, foi indicado
 * ou foi achado na prospecção (Google Maps). `chave` evita importar o mesmo lugar duas vezes.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    /** Pessoa de contato, quando o lead é uma empresa. */
    contato: text("contato"),
    telefone: text("telefone"),
    email: text("email"),
    site: text("site"),
    instagram: text("instagram"),
    categoria: text("categoria"),
    endereco: text("endereco"),
    cidade: text("cidade"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    /** Nota no Google (0 a 5) e quantas avaliações, quando veio da prospecção. */
    nota: doublePrecision("nota"),
    avaliacoes: integer("avaliacoes"),
    origem: origemLeadEnum("origem").notNull(),
    etapa: etapaLeadEnum("etapa").notNull().default("novo"),
    /** Frentes que interessam: atende, flow, financas, gestao, sites, ads. */
    interesses: text("interesses").array().notNull().default(sql`'{}'::text[]`),
    /** Frases marcadas no diagnóstico do site. */
    dores: text("dores").array().notNull().default(sql`'{}'::text[]`),
    tamanho: text("tamanho"),
    observacao: text("observacao"),
    valorEstimadoCentavos: centavos("valor_estimado_centavos"),
    proximoContato: date("proximo_contato"),
    motivoPerda: text("motivo_perda"),
    responsavelId: uuid("responsavel_id").references(() => usuarios.id, { onDelete: "set null" }),
    /** A empresa criada no app quando o lead fechou. */
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
    chave: text("chave").unique(),
    /** Nome do lote de prospecção ("dentistas em Maricá · 27/10"). */
    lote: text("lote"),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [
    index("leads_etapa_idx").on(t.etapa),
    index("leads_criado_idx").on(t.criadoEm),
    check("leads_nota_faixa", sql`${t.nota} is null or (${t.nota} >= 0 and ${t.nota} <= 5)`),
  ],
);

/** Cada conversa com um lead: ligação, WhatsApp, reunião… e as mudanças de etapa. */
export const interacoes = pgTable(
  "interacoes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    autorId: uuid("autor_id").references(() => usuarios.id, { onDelete: "set null" }),
    tipo: tipoInteracaoEnum("tipo").notNull(),
    texto: text("texto").notNull().default(""),
    /** Mudança de etapa registrada junto, quando houve. */
    etapaDe: etapaLeadEnum("etapa_de"),
    etapaPara: etapaLeadEnum("etapa_para"),
    criadoEm: criadoEm(),
  },
  (t) => [index("interacoes_lead_idx").on(t.leadId, t.criadoEm)],
);

/** Proposta comercial da Urutau: o que entra, quanto por mês e quanto de entrada. */
export const propostas = pgTable(
  "propostas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
    titulo: text("titulo").notNull(),
    servicos: text("servicos").array().notNull().default(sql`'{}'::text[]`),
    valorMensalCentavos: centavos("valor_mensal_centavos").notNull().default(0),
    valorUnicoCentavos: centavos("valor_unico_centavos").notNull().default(0),
    status: statusPropostaEnum("status").notNull().default("rascunho"),
    validade: date("validade"),
    observacao: text("observacao"),
    enviadaEm: timestamp("enviada_em", { withTimezone: true }),
    respondidaEm: timestamp("respondida_em", { withTimezone: true }),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    check("propostas_valores", sql`${t.valorMensalCentavos} >= 0 and ${t.valorUnicoCentavos} >= 0`),
    index("propostas_status_idx").on(t.status),
  ],
);

/** O que o site urutau.io manda (POST /api/site/evento): visitas, contatos, cliques no WhatsApp. */
export const eventosSite = pgTable(
  "eventos_site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tipo: tipoEventoSiteEnum("tipo").notNull(),
    pagina: text("pagina"),
    nome: text("nome"),
    contato: text("contato"),
    mensagem: text("mensagem"),
    /** Código anônimo do navegador (null se a pessoa recusou no aviso de privacidade). */
    visitanteId: text("visitante_id").references(() => visitantes.id, { onDelete: "cascade" }),
    criadoEm: criadoEm(),
  },
  (t) => [index("eventos_site_criado_idx").on(t.criadoEm), index("eventos_site_visitante_idx").on(t.visitanteId, t.criadoEm)],
);

/**
 * Um navegador que visitou o urutau.io, identificado só por um código aleatório guardado nele.
 * A origem (de onde veio, campanha) é a da primeira visita; cidade e aparelho, os da última.
 * Quando a pessoa manda o diagnóstico ou deixa contato, `leadId` liga o caminho ao lead.
 */
export const visitantes = pgTable(
  "visitantes",
  {
    id: text("id").primaryKey(),
    primeiraVisita: timestamp("primeira_visita", { withTimezone: true }).notNull().defaultNow(),
    ultimaVisita: timestamp("ultima_visita", { withTimezone: true }).notNull().defaultNow(),
    visitas: integer("visitas").notNull().default(0),
    cidade: text("cidade"),
    regiao: text("regiao"),
    pais: text("pais"),
    aparelho: text("aparelho"),
    /** "instagram.com", "google", "direto"… ou o utm_source. */
    origem: text("origem"),
    meio: text("meio"),
    campanha: text("campanha"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  },
  (t) => [index("visitantes_ultima_idx").on(t.ultimaVisita), index("visitantes_lead_idx").on(t.leadId)],
);

export type TipoDivida =(typeof tipoDividaEnum.enumValues)[number];
export type Papel = (typeof papelEnum.enumValues)[number];
export type Regime = (typeof regimeEnum.enumValues)[number];
export type Atividade = (typeof atividadeEnum.enumValues)[number];
export type FormaPagamento = (typeof formaPagamentoEnum.enumValues)[number];
export type ChaveCategoria = (typeof chaveCategoriaEnum.enumValues)[number];
export type Empresa = typeof empresas.$inferSelect;
export type Perfil = (typeof perfilEnum.enumValues)[number];
export type Modulo = (typeof moduloEnum.enumValues)[number];
export type OrigemVenda = (typeof origemVendaEnum.enumValues)[number];
export type TipoMeta = (typeof tipoMetaEnum.enumValues)[number];
export type OrigemLead = (typeof origemLeadEnum.enumValues)[number];
export type EtapaLead = (typeof etapaLeadEnum.enumValues)[number];
export type TipoInteracao = (typeof tipoInteracaoEnum.enumValues)[number];
export type StatusProposta = (typeof statusPropostaEnum.enumValues)[number];

// ─── Receita da Urutau: clientes, contratos, cobranças e ganhos ──────────────

export const servicoUrutauEnum = pgEnum("servico_urutau", ["reels", "post", "criativo", "trafego", "gestao", "automacao", "atendente", "site", "sistema", "outro"]);
export const recorrenciaEnum = pgEnum("recorrencia", ["mensal", "unico"]);
export const statusContratoEnum = pgEnum("status_contrato", ["ativo", "encerrado", "cancelado"]);
export const tipoMultaEnum = pgEnum("tipo_multa", ["nenhuma", "valor", "percentual_restante"]);
export const statusCobrancaEnum = pgEnum("status_cobranca", ["a_receber", "pago", "cancelada"]);
export const tipoGanhoEnum = pgEnum("tipo_ganho", ["trouxe", "execucao"]);
export const statusGanhoEnum = pgEnum("status_ganho", ["a_pagar", "pago"]);
export const categoriaCustoEnum = pgEnum("categoria_custo", ["ferramenta", "freelancer", "imposto", "marketing", "estrutura", "outro"]);

/**
 * Cliente da Urutau (quem paga a Urutau). Pode usar o sistema ou não: `empresaId` liga à empresa
 * no app para comparar o que ele vende com o que paga. `quemTrouxeId` null = veio sozinho (os 10% vão para o bolo).
 */
export const clientesUrutau = pgTable(
  "clientes_urutau",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    documento: text("documento"),
    contato: text("contato"),
    telefone: text("telefone"),
    email: text("email"),
    cidade: text("cidade"),
    ramo: text("ramo"),
    quemTrouxeId: uuid("quem_trouxe_id").references(() => usuarios.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
    /** Faturamento mensal do cliente informado à mão (quando ele não usa o sistema). */
    faturamentoInformadoCentavos: centavos("faturamento_informado_centavos"),
    observacao: text("observacao"),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [index("clientes_urutau_nome_idx").on(t.nome)],
);

export const contratos = pgTable(
  "contratos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clienteId: uuid("cliente_id")
      .notNull()
      .references(() => clientesUrutau.id, { onDelete: "cascade" }),
    /** Primeiro mês cobrado (dia 1). */
    inicio: date("inicio").notNull(),
    /** Duração em meses; null = sem prazo (até alguém encerrar). */
    meses: integer("meses"),
    diaVencimento: integer("dia_vencimento").notNull().default(10),
    /** Desconto sobre o contrato (pcm) nos primeiros `descontoMeses` meses; null = o contrato todo. */
    descontoPcm: integer("desconto_pcm").notNull().default(0),
    descontoMeses: integer("desconto_meses"),
    multaTipo: tipoMultaEnum("multa_tipo").notNull().default("nenhuma"),
    /** Centavos (multa em valor) ou pcm (percentual do que falta do contrato). */
    multaValor: bigint("multa_valor", { mode: "number" }).notNull().default(0),
    status: statusContratoEnum("status").notNull().default("ativo"),
    /** Último mês cobrado quando o contrato foi encerrado ou cancelado. */
    encerradoEm: date("encerrado_em"),
    motivoEncerramento: text("motivo_encerramento"),
    observacao: text("observacao"),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [
    index("contratos_cliente_idx").on(t.clienteId),
    check("contratos_dia_vencimento", sql`${t.diaVencimento} between 1 and 28`),
    check("contratos_desconto", sql`${t.descontoPcm} between 0 and 100000`),
    check("contratos_meses", sql`${t.meses} is null or ${t.meses} > 0`),
    check("contratos_inicio_dia_1", sql`extract(day from ${t.inicio}) = 1`),
  ],
);

/**
 * Cada serviço do contrato. Os percentuais ficam gravados aqui no dia do cadastro (regra congelada):
 * mudar a tabela de regras depois não mexe em contrato já fechado.
 */
export const contratoItens = pgTable(
  "contrato_itens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contratoId: uuid("contrato_id")
      .notNull()
      .references(() => contratos.id, { onDelete: "cascade" }),
    servico: servicoUrutauEnum("servico").notNull(),
    descricao: text("descricao").notNull().default(""),
    recorrencia: recorrenciaEnum("recorrencia").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    /** Custo para a Urutau, na mesma recorrência do serviço. */
    custoCentavos: centavos("custo_centavos").notNull().default(0),
    executorId: uuid("executor_id").references(() => usuarios.id, { onDelete: "set null" }),
    executorPcm: integer("executor_pcm").notNull().default(0),
    /** O executor (normalmente um sócio) abriu mão da comissão: o valor fica no bolo. */
    executorAbriuMao: boolean("executor_abriu_mao").notNull().default(false),
    trouxePcm: integer("trouxe_pcm").notNull().default(0),
    /** Primeiro mês cobrado deste serviço (dia 1); null = o início do contrato. Projeto único é cobrado só nesse mês. */
    inicio: date("inicio"),
    /** Último mês cobrado (serviço retirado do contrato); null = segue enquanto o contrato durar. */
    ate: date("ate"),
    criadoEm: criadoEm(),
  },
  (t) => [
    index("contrato_itens_contrato_idx").on(t.contratoId),
    check("contrato_itens_valores", sql`${t.valorCentavos} >= 0 and ${t.custoCentavos} >= 0`),
    check("contrato_itens_pcm", sql`${t.executorPcm} between 0 and 100000 and ${t.trouxePcm} between 0 and 100000`),
  ],
);

/** A cobrança de um mês do contrato. Projeto único entra na cobrança do primeiro mês. */
export const cobrancas = pgTable(
  "cobrancas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contratoId: uuid("contrato_id")
      .notNull()
      .references(() => contratos.id, { onDelete: "cascade" }),
    competencia: date("competencia").notNull(),
    vencimento: date("vencimento").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    status: statusCobrancaEnum("status").notNull().default("a_receber"),
    pagoEm: date("pago_em"),
    valorPagoCentavos: centavos("valor_pago_centavos"),
    observacao: text("observacao"),
    criadoEm: criadoEm(),
  },
  (t) => [unique("cobrancas_contrato_mes").on(t.contratoId, t.competencia), index("cobrancas_competencia_idx").on(t.competencia)],
);

/** O que compõe a cobrança, serviço a serviço, já com o desconto do mês. Base dos ganhos. */
export const cobrancaItens = pgTable(
  "cobranca_itens",
  {
    cobrancaId: uuid("cobranca_id")
      .notNull()
      .references(() => cobrancas.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => contratoItens.id, { onDelete: "cascade" }),
    valorCentavos: centavos("valor_centavos").notNull(),
    custoCentavos: centavos("custo_centavos").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.cobrancaId, t.itemId] })],
);

/** Comissão de alguém sobre uma cobrança paga: por ter trazido o cliente ou por executar o serviço. */
export const ganhos = pgTable(
  "ganhos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cobrancaId: uuid("cobranca_id")
      .notNull()
      .references(() => cobrancas.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => contratoItens.id, { onDelete: "cascade" }),
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    tipo: tipoGanhoEnum("tipo").notNull(),
    baseCentavos: centavos("base_centavos").notNull(),
    pcm: integer("pcm").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    status: statusGanhoEnum("status").notNull().default("a_pagar"),
    pagoEm: date("pago_em"),
    criadoEm: criadoEm(),
  },
  (t) => [index("ganhos_usuario_idx").on(t.usuarioId, t.status), index("ganhos_cobranca_idx").on(t.cobrancaId)],
);

/** Custos da Urutau: ferramentas, freelancers, DAS… Mensal vale de `inicio` até `fim`; único só no mês de `inicio`. */
export const custosUrutau = pgTable(
  "custos_urutau",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    descricao: text("descricao").notNull(),
    categoria: categoriaCustoEnum("categoria").notNull(),
    valorCentavos: centavos("valor_centavos").notNull(),
    recorrencia: recorrenciaEnum("recorrencia").notNull(),
    inicio: date("inicio").notNull(),
    fim: date("fim"),
    clienteId: uuid("cliente_id").references(() => clientesUrutau.id, { onDelete: "set null" }),
    criadoPor: uuid("criado_por").references(() => usuarios.id, { onDelete: "set null" }),
    criadoEm: criadoEm(),
    excluidoEm: excluidoEm(),
  },
  (t) => [check("custos_urutau_valor", sql`${t.valorCentavos} > 0`), check("custos_urutau_inicio_dia_1", sql`extract(day from ${t.inicio}) = 1`)],
);

/** Comissão de quem executa, por serviço (os sócios editam em Receita → Regras). */
export const regrasComissao = pgTable("regras_comissao", {
  servico: servicoUrutauEnum("servico").primaryKey(),
  executorPcm: integer("executor_pcm").notNull(),
});

/** Parâmetros da divisão: % de quem trouxe, reserva de caixa, diferença entre os sócios e qual sócio leva a mais. */
export const parametrosCentral = pgTable("parametros_central", {
  chave: text("chave").primaryKey(),
  valor: text("valor").notNull(),
});

export type ServicoUrutau = (typeof servicoUrutauEnum.enumValues)[number];
export type Recorrencia = (typeof recorrenciaEnum.enumValues)[number];

// ─── Atendimento no WhatsApp (agente de IA de cada loja) ─────────────────────

/** automático = responde sozinho; aprovação = escreve e um humano aprova; desligado = só registra. */
export const modoAgenteEnum = pgEnum("modo_agente", ["automatico", "aprovacao", "desligado"]);
/** Com quem está a conversa agora. */
export const statusConversaEnum = pgEnum("status_conversa", ["agente", "humano", "encerrada"]);
export const autorMensagemEnum = pgEnum("autor_mensagem", ["cliente", "agente", "humano", "sistema"]);
export const statusMensagemEnum = pgEnum("status_mensagem", ["recebida", "rascunho", "pendente", "enviada", "entregue", "lida", "falhou", "descartada"]);
/** simulador = teste dentro do painel, sem WhatsApp e sem custo da Meta. */
export const canalConversaEnum = pgEnum("canal_conversa", ["whatsapp", "simulador"]);

/**
 * O agente de atendimento de uma loja: quem ele é, o que sabe do negócio e como se conecta
 * ao número da loja na API oficial do WhatsApp (Cloud API). O token da Meta fica cifrado.
 */
export const agentesWhatsapp = pgTable(
  "agentes_whatsapp",
  {
    empresaId: uuid("empresa_id")
      .primaryKey()
      .references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull().default("Atendente"),
    /** Jeito de falar: "simpática e direta", "formal"… */
    tom: text("tom").notNull().default(""),
    /** O que o agente precisa saber: produtos, preços, horários, entrega, pagamento, regras. */
    conhecimento: text("conhecimento").notNull().default(""),
    /** Quando chamar uma pessoa da loja. */
    quandoChamarHumano: text("quando_chamar_humano").notNull().default(""),
    modo: modoAgenteEnum("modo").notNull().default("aprovacao"),
    modelo: text("modelo").notNull().default("claude-haiku-5-5"),
    /** Cloud API: o phone_number_id do número da loja (chega em todo webhook). */
    phoneNumberId: text("phone_number_id").unique(),
    numeroExibicao: text("numero_exibicao"),
    tokenCifrado: text("token_cifrado"),
    ultimoErro: text("ultimo_erro"),
    ultimoErroEm: timestamp("ultimo_erro_em", { withTimezone: true }),
    criadoEm: criadoEm(),
    atualizadoEm: atualizadoEm(),
  },
);

export const conversas = pgTable(
  "conversas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    canal: canalConversaEnum("canal").notNull(),
    /** Só dígitos, com DDI (o "wa_id" do WhatsApp). */
    telefone: text("telefone").notNull(),
    nome: text("nome"),
    clienteId: uuid("cliente_id").references(() => clientes.id, { onDelete: "set null" }),
    status: statusConversaEnum("status").notNull().default("agente"),
    /** Última mensagem do cliente: abre a janela de 24h em que a loja pode responder. */
    ultimaEntradaEm: timestamp("ultima_entrada_em", { withTimezone: true }),
    ultimaMensagemEm: timestamp("ultima_mensagem_em", { withTimezone: true }).notNull().defaultNow(),
    naoLidas: integer("nao_lidas").notNull().default(0),
    /** O que o cliente quer (o agente anota): comprar, agendar, dúvida, reclamação… */
    intencao: text("intencao"),
    resumo: text("resumo"),
    motivoHumano: text("motivo_humano"),
    criadoEm: criadoEm(),
  },
  (t) => [unique("conversas_empresa_canal_tel").on(t.empresaId, t.canal, t.telefone), index("conversas_recentes_idx").on(t.empresaId, t.ultimaMensagemEm)],
);

export const mensagensWhatsapp = pgTable(
  "mensagens_whatsapp",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversaId: uuid("conversa_id")
      .notNull()
      .references(() => conversas.id, { onDelete: "cascade" }),
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => empresas.id, { onDelete: "cascade" }),
    autor: autorMensagemEnum("autor").notNull(),
    texto: text("texto").notNull(),
    /** Id da mensagem no WhatsApp: evita gravar duas vezes o mesmo webhook. */
    waMessageId: text("wa_message_id").unique(),
    status: statusMensagemEnum("status").notNull(),
    erro: text("erro"),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    /** Ferramentas que o agente usou para chegar nesta resposta. */
    acoes: jsonb("acoes").$type<{ nome: string; resumo: string }[]>(),
    tokensEntrada: integer("tokens_entrada"),
    tokensSaida: integer("tokens_saida"),
    tokensCache: integer("tokens_cache"),
    /** Custo estimado em milionésimos de dólar (IA + mensagem da Meta). */
    custoMicrosUsd: integer("custo_micros_usd"),
    /** Quanto o agente levou para responder (ms), desde a mensagem do cliente. */
    tempoRespostaMs: integer("tempo_resposta_ms"),
    criadoEm: criadoEm(),
  },
  (t) => [index("mensagens_conversa_idx").on(t.conversaId, t.criadoEm), index("mensagens_empresa_idx").on(t.empresaId, t.criadoEm)],
);

export type ModoAgente = (typeof modoAgenteEnum.enumValues)[number];
export type StatusConversa = (typeof statusConversaEnum.enumValues)[number];

// ─── Chat do site urutau.io ──────────────────────────────────────────────────

/**
 * Conversa de um visitante com o agente da própria Urutau no chat do site, a qualquer hora.
 * `chave` é um segredo aleatório que fica no navegador do visitante: só quem tem a chave lê e
 * continua a conversa. Quando o visitante deixa contato, a conversa ganha um lead no Comercial.
 */
export const conversasSite = pgTable(
  "conversas_site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chave: text("chave").notNull().unique(),
    /** Código anônimo do navegador (o mesmo da aba Site), quando a pessoa não recusou. */
    visitanteId: text("visitante_id"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    nome: text("nome"),
    /** WhatsApp ou e-mail que o visitante deixou. */
    contato: text("contato"),
    status: statusConversaEnum("status").notNull().default("agente"),
    /** Frentes que interessam: atende, flow, financas, gestao, sites, ads. */
    interesses: text("interesses").array().notNull().default(sql`'{}'::text[]`),
    resumo: text("resumo"),
    /** O que o agente anotou do visitante: o que quer, dúvidas, urgência, orçamento… (ver FichaVisitante). */
    ficha: jsonb("ficha").$type<FichaVisitante>().notNull().default({}),
    motivoHumano: text("motivo_humano"),
    /** Onde o chat foi aberto pela primeira vez. */
    pagina: text("pagina"),
    naoLidas: integer("nao_lidas").notNull().default(0),
    ultimaMensagemEm: timestamp("ultima_mensagem_em", { withTimezone: true }).notNull().defaultNow(),
    criadoEm: criadoEm(),
  },
  (t) => [index("conversas_site_recentes_idx").on(t.ultimaMensagemEm)],
);

export const mensagensSite = pgTable(
  "mensagens_site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversaId: uuid("conversa_id")
      .notNull()
      .references(() => conversasSite.id, { onDelete: "cascade" }),
    autor: autorMensagemEnum("autor").notNull(),
    texto: text("texto").notNull(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id, { onDelete: "set null" }),
    acoes: jsonb("acoes").$type<{ nome: string; resumo: string }[]>(),
    tokensEntrada: integer("tokens_entrada"),
    tokensSaida: integer("tokens_saida"),
    tokensCache: integer("tokens_cache"),
    /** Custo estimado da IA em milionésimos de dólar. */
    custoMicrosUsd: integer("custo_micros_usd"),
    tempoRespostaMs: integer("tempo_resposta_ms"),
    criadoEm: criadoEm(),
  },
  (t) => [index("mensagens_site_conversa_idx").on(t.conversaId, t.criadoEm), index("mensagens_site_criado_idx").on(t.criadoEm)],
);
