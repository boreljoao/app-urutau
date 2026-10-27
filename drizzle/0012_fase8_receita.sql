CREATE TYPE "public"."categoria_custo" AS ENUM('ferramenta', 'freelancer', 'imposto', 'marketing', 'estrutura', 'outro');--> statement-breakpoint
CREATE TYPE "public"."papel_equipe" AS ENUM('socio', 'equipe');--> statement-breakpoint
CREATE TYPE "public"."recorrencia" AS ENUM('mensal', 'unico');--> statement-breakpoint
CREATE TYPE "public"."servico_urutau" AS ENUM('reels', 'post', 'criativo', 'trafego', 'gestao', 'automacao', 'atendente', 'site', 'sistema', 'outro');--> statement-breakpoint
CREATE TYPE "public"."status_cobranca" AS ENUM('a_receber', 'pago', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."status_contrato" AS ENUM('ativo', 'encerrado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."status_ganho" AS ENUM('a_pagar', 'pago');--> statement-breakpoint
CREATE TYPE "public"."tipo_ganho" AS ENUM('trouxe', 'execucao');--> statement-breakpoint
CREATE TYPE "public"."tipo_multa" AS ENUM('nenhuma', 'valor', 'percentual_restante');--> statement-breakpoint
CREATE TABLE "clientes_urutau" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"documento" text,
	"contato" text,
	"telefone" text,
	"email" text,
	"cidade" text,
	"ramo" text,
	"quem_trouxe_id" uuid,
	"lead_id" uuid,
	"empresa_id" uuid,
	"faturamento_informado_centavos" bigint,
	"observacao" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cobranca_itens" (
	"cobranca_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"custo_centavos" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "cobranca_itens_cobranca_id_item_id_pk" PRIMARY KEY("cobranca_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "cobrancas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"vencimento" date NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"status" "status_cobranca" DEFAULT 'a_receber' NOT NULL,
	"pago_em" date,
	"valor_pago_centavos" bigint,
	"observacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cobrancas_contrato_mes" UNIQUE("contrato_id","competencia")
);
--> statement-breakpoint
CREATE TABLE "contrato_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"servico" "servico_urutau" NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"recorrencia" "recorrencia" NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"custo_centavos" bigint DEFAULT 0 NOT NULL,
	"executor_id" uuid,
	"executor_pcm" integer DEFAULT 0 NOT NULL,
	"executor_abriu_mao" boolean DEFAULT false NOT NULL,
	"trouxe_pcm" integer DEFAULT 0 NOT NULL,
	"inicio" date,
	"ate" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contrato_itens_valores" CHECK ("contrato_itens"."valor_centavos" >= 0 and "contrato_itens"."custo_centavos" >= 0),
	CONSTRAINT "contrato_itens_pcm" CHECK ("contrato_itens"."executor_pcm" between 0 and 100000 and "contrato_itens"."trouxe_pcm" between 0 and 100000)
);
--> statement-breakpoint
CREATE TABLE "contratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"inicio" date NOT NULL,
	"meses" integer,
	"dia_vencimento" integer DEFAULT 10 NOT NULL,
	"desconto_pcm" integer DEFAULT 0 NOT NULL,
	"desconto_meses" integer,
	"multa_tipo" "tipo_multa" DEFAULT 'nenhuma' NOT NULL,
	"multa_valor" bigint DEFAULT 0 NOT NULL,
	"status" "status_contrato" DEFAULT 'ativo' NOT NULL,
	"encerrado_em" date,
	"motivo_encerramento" text,
	"observacao" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contratos_dia_vencimento" CHECK ("contratos"."dia_vencimento" between 1 and 28),
	CONSTRAINT "contratos_desconto" CHECK ("contratos"."desconto_pcm" between 0 and 100000),
	CONSTRAINT "contratos_meses" CHECK ("contratos"."meses" is null or "contratos"."meses" > 0),
	CONSTRAINT "contratos_inicio_dia_1" CHECK (extract(day from "contratos"."inicio") = 1)
);
--> statement-breakpoint
CREATE TABLE "custos_urutau" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"descricao" text NOT NULL,
	"categoria" "categoria_custo" NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"recorrencia" "recorrencia" NOT NULL,
	"inicio" date NOT NULL,
	"fim" date,
	"cliente_id" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone,
	CONSTRAINT "custos_urutau_valor" CHECK ("custos_urutau"."valor_centavos" > 0),
	CONSTRAINT "custos_urutau_inicio_dia_1" CHECK (extract(day from "custos_urutau"."inicio") = 1)
);
--> statement-breakpoint
CREATE TABLE "ganhos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cobranca_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"tipo" "tipo_ganho" NOT NULL,
	"base_centavos" bigint NOT NULL,
	"pcm" integer NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"status" "status_ganho" DEFAULT 'a_pagar' NOT NULL,
	"pago_em" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parametros_central" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regras_comissao" (
	"servico" "servico_urutau" PRIMARY KEY NOT NULL,
	"executor_pcm" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "papel_equipe" "papel_equipe" DEFAULT 'equipe' NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes_urutau" ADD CONSTRAINT "clientes_urutau_quem_trouxe_id_usuarios_id_fk" FOREIGN KEY ("quem_trouxe_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes_urutau" ADD CONSTRAINT "clientes_urutau_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes_urutau" ADD CONSTRAINT "clientes_urutau_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes_urutau" ADD CONSTRAINT "clientes_urutau_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca_itens" ADD CONSTRAINT "cobranca_itens_cobranca_id_cobrancas_id_fk" FOREIGN KEY ("cobranca_id") REFERENCES "public"."cobrancas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca_itens" ADD CONSTRAINT "cobranca_itens_item_id_contrato_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."contrato_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobrancas" ADD CONSTRAINT "cobrancas_contrato_id_contratos_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato_itens" ADD CONSTRAINT "contrato_itens_contrato_id_contratos_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contrato_itens" ADD CONSTRAINT "contrato_itens_executor_id_usuarios_id_fk" FOREIGN KEY ("executor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_cliente_id_clientes_urutau_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes_urutau"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custos_urutau" ADD CONSTRAINT "custos_urutau_cliente_id_clientes_urutau_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes_urutau"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custos_urutau" ADD CONSTRAINT "custos_urutau_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganhos" ADD CONSTRAINT "ganhos_cobranca_id_cobrancas_id_fk" FOREIGN KEY ("cobranca_id") REFERENCES "public"."cobrancas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganhos" ADD CONSTRAINT "ganhos_item_id_contrato_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."contrato_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganhos" ADD CONSTRAINT "ganhos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clientes_urutau_nome_idx" ON "clientes_urutau" USING btree ("nome");--> statement-breakpoint
CREATE INDEX "cobrancas_competencia_idx" ON "cobrancas" USING btree ("competencia");--> statement-breakpoint
CREATE INDEX "contrato_itens_contrato_idx" ON "contrato_itens" USING btree ("contrato_id");--> statement-breakpoint
CREATE INDEX "contratos_cliente_idx" ON "contratos" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "ganhos_usuario_idx" ON "ganhos" USING btree ("usuario_id","status");--> statement-breakpoint
CREATE INDEX "ganhos_cobranca_idx" ON "ganhos" USING btree ("cobranca_id");--> statement-breakpoint
INSERT INTO "regras_comissao" ("servico", "executor_pcm") VALUES ('site', 30000), ('trafego', 35000), ('reels', 35000), ('post', 35000), ('criativo', 35000), ('gestao', 30000), ('automacao', 30000), ('atendente', 30000), ('sistema', 30000), ('outro', 30000);--> statement-breakpoint
--> statement-breakpoint
INSERT INTO "parametros_central" ("chave", "valor") VALUES ('trouxe_pcm', '10000'), ('caixa_pcm', '10000'), ('diferenca_socios_pcm', '5000');--> statement-breakpoint
--> statement-breakpoint
UPDATE "usuarios" SET "papel_equipe" = 'socio' WHERE "id" = (SELECT "id" FROM "usuarios" WHERE "superadmin" ORDER BY "criado_em" LIMIT 1);
