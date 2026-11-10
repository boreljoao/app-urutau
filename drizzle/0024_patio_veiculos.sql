CREATE TYPE "public"."status_veiculo" AS ENUM('preparacao', 'disponivel', 'reservado', 'vendido');--> statement-breakpoint
CREATE TABLE "veiculos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"modelo" text NOT NULL,
	"placa" text,
	"ano" integer,
	"km" integer,
	"cor" text,
	"status" "status_veiculo" DEFAULT 'preparacao' NOT NULL,
	"custo_compra_centavos" bigint DEFAULT 0 NOT NULL,
	"custo_preparacao_centavos" bigint DEFAULT 0 NOT NULL,
	"preco_centavos" bigint,
	"valor_venda_centavos" bigint,
	"entrada_em" date NOT NULL,
	"vendido_em" date,
	"venda_id" uuid,
	"cliente_id" uuid,
	"observacao" text DEFAULT '' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone,
	CONSTRAINT "veiculos_custos_positivos" CHECK ("veiculos"."custo_compra_centavos" >= 0 and "veiculos"."custo_preparacao_centavos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agendamentos" ADD COLUMN "veiculo_id" uuid;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "veiculos_empresa_status_idx" ON "veiculos" USING btree ("empresa_id","status");--> statement-breakpoint
CREATE INDEX "veiculos_empresa_vendido_idx" ON "veiculos" USING btree ("empresa_id","vendido_em");--> statement-breakpoint
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_veiculo_id_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."veiculos"("id") ON DELETE set null ON UPDATE no action;