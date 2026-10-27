CREATE TYPE "public"."etapa_lead" AS ENUM('novo', 'contatado', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido');--> statement-breakpoint
CREATE TYPE "public"."origem_lead" AS ENUM('site', 'diagnostico', 'whatsapp', 'ligacao', 'instagram', 'indicacao', 'prospeccao', 'outro');--> statement-breakpoint
CREATE TYPE "public"."status_proposta" AS ENUM('rascunho', 'enviada', 'aceita', 'recusada');--> statement-breakpoint
CREATE TYPE "public"."tipo_interacao" AS ENUM('ligacao', 'whatsapp', 'email', 'reuniao', 'visita', 'nota');--> statement-breakpoint
ALTER TYPE "public"."tipo_evento_site" ADD VALUE 'diagnostico';--> statement-breakpoint
CREATE TABLE "interacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"autor_id" uuid,
	"tipo" "tipo_interacao" NOT NULL,
	"texto" text DEFAULT '' NOT NULL,
	"etapa_de" "etapa_lead",
	"etapa_para" "etapa_lead",
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"contato" text,
	"telefone" text,
	"email" text,
	"site" text,
	"instagram" text,
	"categoria" text,
	"endereco" text,
	"cidade" text,
	"latitude" double precision,
	"longitude" double precision,
	"nota" double precision,
	"avaliacoes" integer,
	"origem" "origem_lead" NOT NULL,
	"etapa" "etapa_lead" DEFAULT 'novo' NOT NULL,
	"interesses" text[] DEFAULT '{}'::text[] NOT NULL,
	"dores" text[] DEFAULT '{}'::text[] NOT NULL,
	"tamanho" text,
	"observacao" text,
	"valor_estimado_centavos" bigint,
	"proximo_contato" date,
	"motivo_perda" text,
	"responsavel_id" uuid,
	"empresa_id" uuid,
	"chave" text,
	"lote" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone,
	CONSTRAINT "leads_chave_unique" UNIQUE("chave"),
	CONSTRAINT "leads_nota_faixa" CHECK ("leads"."nota" is null or ("leads"."nota" >= 0 and "leads"."nota" <= 5))
);
--> statement-breakpoint
CREATE TABLE "propostas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"empresa_id" uuid,
	"titulo" text NOT NULL,
	"servicos" text[] DEFAULT '{}'::text[] NOT NULL,
	"valor_mensal_centavos" bigint DEFAULT 0 NOT NULL,
	"valor_unico_centavos" bigint DEFAULT 0 NOT NULL,
	"status" "status_proposta" DEFAULT 'rascunho' NOT NULL,
	"validade" date,
	"observacao" text,
	"enviada_em" timestamp with time zone,
	"respondida_em" timestamp with time zone,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "propostas_valores" CHECK ("propostas"."valor_mensal_centavos" >= 0 and "propostas"."valor_unico_centavos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "interacoes" ADD CONSTRAINT "interacoes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interacoes" ADD CONSTRAINT "interacoes_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propostas" ADD CONSTRAINT "propostas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interacoes_lead_idx" ON "interacoes" USING btree ("lead_id","criado_em");--> statement-breakpoint
CREATE INDEX "leads_etapa_idx" ON "leads" USING btree ("etapa");--> statement-breakpoint
CREATE INDEX "leads_criado_idx" ON "leads" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "propostas_status_idx" ON "propostas" USING btree ("status");