CREATE TABLE "afazeres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titulo" text NOT NULL,
	"responsavel_id" uuid,
	"empresa_id" uuid,
	"prazo" date,
	"feito_em" timestamp with time zone,
	"feito_por" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "afazeres" ADD CONSTRAINT "afazeres_responsavel_id_usuarios_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "afazeres" ADD CONSTRAINT "afazeres_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "afazeres" ADD CONSTRAINT "afazeres_feito_por_usuarios_id_fk" FOREIGN KEY ("feito_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "afazeres" ADD CONSTRAINT "afazeres_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "afazeres_abertos_idx" ON "afazeres" USING btree ("feito_em","prazo");