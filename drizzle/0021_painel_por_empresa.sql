ALTER TYPE "public"."status_agendamento" ADD VALUE 'bloqueado';--> statement-breakpoint
CREATE TABLE "empresa_painel" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"tela_inicial" text,
	"menu" jsonb,
	"especialidade" text,
	"meta_centavos" bigint,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "empresa_painel" ADD CONSTRAINT "empresa_painel_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;