CREATE TYPE "public"."tipo_evento_site" AS ENUM('visita', 'contato', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."tipo_meta" AS ENUM('valor', 'quantidade');--> statement-breakpoint
CREATE TABLE "eventos_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "tipo_evento_site" NOT NULL,
	"pagina" text,
	"nome" text,
	"contato" text,
	"mensagem" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"mes" date NOT NULL,
	"titulo" text NOT NULL,
	"tipo" "tipo_meta" NOT NULL,
	"alvo" bigint NOT NULL,
	"atual" bigint DEFAULT 0 NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metas_alvo_positivo" CHECK ("metas"."alvo" > 0),
	CONSTRAINT "metas_atual_nao_negativo" CHECK ("metas"."atual" >= 0),
	CONSTRAINT "metas_mes_dia_1" CHECK (extract(day from "metas"."mes") = 1)
);
--> statement-breakpoint
CREATE TABLE "notas_equipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autor_id" uuid,
	"sobre_usuario_id" uuid,
	"empresa_id" uuid,
	"texto" text NOT NULL,
	"fixada" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "responsavel_id" uuid;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "senha_provisoria" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "visto_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "onde_esta" text;--> statement-breakpoint
ALTER TABLE "metas" ADD CONSTRAINT "metas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metas" ADD CONSTRAINT "metas_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_equipe" ADD CONSTRAINT "notas_equipe_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_equipe" ADD CONSTRAINT "notas_equipe_sobre_usuario_id_usuarios_id_fk" FOREIGN KEY ("sobre_usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_equipe" ADD CONSTRAINT "notas_equipe_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eventos_site_criado_idx" ON "eventos_site" USING btree ("criado_em");--> statement-breakpoint
CREATE INDEX "metas_usuario_mes_idx" ON "metas" USING btree ("usuario_id","mes");--> statement-breakpoint
CREATE INDEX "notas_equipe_criado_idx" ON "notas_equipe" USING btree ("criado_em");--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;