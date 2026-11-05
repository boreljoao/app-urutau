CREATE TYPE "public"."status_agendamento" AS ENUM('marcado', 'confirmado', 'atendido', 'faltou', 'cancelado');--> statement-breakpoint
CREATE TABLE "agendamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"data" date NOT NULL,
	"hora" text NOT NULL,
	"duracao_min" integer DEFAULT 50 NOT NULL,
	"cliente_id" uuid,
	"nome" text NOT NULL,
	"servico" text DEFAULT '' NOT NULL,
	"profissional" text DEFAULT '' NOT NULL,
	"sala" text DEFAULT '' NOT NULL,
	"valor_centavos" bigint,
	"status" "status_agendamento" DEFAULT 'marcado' NOT NULL,
	"observacao" text DEFAULT '' NOT NULL,
	"venda_id" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone,
	CONSTRAINT "agendamentos_hora" CHECK ("agendamentos"."hora" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "agendamentos_duracao" CHECK ("agendamentos"."duracao_min" between 5 and 720),
	CONSTRAINT "agendamentos_valor" CHECK ("agendamentos"."valor_centavos" is null or "agendamentos"."valor_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_cliente_fk" FOREIGN KEY ("empresa_id","cliente_id") REFERENCES "public"."clientes"("empresa_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agendamentos_empresa_data_idx" ON "agendamentos" USING btree ("empresa_id","data");--> statement-breakpoint
CREATE INDEX "agendamentos_empresa_cliente_idx" ON "agendamentos" USING btree ("empresa_id","cliente_id");