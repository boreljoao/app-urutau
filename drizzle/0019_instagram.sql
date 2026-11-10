CREATE TYPE "public"."situacao_post_instagram" AS ENUM('criando', 'analisando', 'pronto', 'enviando', 'enviado', 'erro');--> statement-breakpoint
CREATE TABLE "contas_instagram" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"buffer_token_cifrado" text NOT NULL,
	"canal_id" text NOT NULL,
	"canal_nome" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts_instagram" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tema" text NOT NULL,
	"situacao" "situacao_post_instagram" DEFAULT 'criando' NOT NULL,
	"conteudo" jsonb,
	"analise" jsonb,
	"envio" text,
	"buffer_post_id" text,
	"erro" text,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contas_instagram" ADD CONSTRAINT "contas_instagram_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD CONSTRAINT "posts_instagram_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_instagram_empresa_idx" ON "posts_instagram" USING btree ("empresa_id","criado_em");