ALTER TYPE "public"."tipo_evento_site" ADD VALUE 'secao';--> statement-breakpoint
CREATE TABLE "visitantes" (
	"id" text PRIMARY KEY NOT NULL,
	"primeira_visita" timestamp with time zone DEFAULT now() NOT NULL,
	"ultima_visita" timestamp with time zone DEFAULT now() NOT NULL,
	"visitas" integer DEFAULT 0 NOT NULL,
	"cidade" text,
	"regiao" text,
	"pais" text,
	"aparelho" text,
	"origem" text,
	"meio" text,
	"campanha" text,
	"lead_id" uuid
);
--> statement-breakpoint
ALTER TABLE "eventos_site" ADD COLUMN "visitante_id" text;--> statement-breakpoint
ALTER TABLE "visitantes" ADD CONSTRAINT "visitantes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visitantes_ultima_idx" ON "visitantes" USING btree ("ultima_visita");--> statement-breakpoint
CREATE INDEX "visitantes_lead_idx" ON "visitantes" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "eventos_site" ADD CONSTRAINT "eventos_site_visitante_id_visitantes_id_fk" FOREIGN KEY ("visitante_id") REFERENCES "public"."visitantes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eventos_site_visitante_idx" ON "eventos_site" USING btree ("visitante_id","criado_em");