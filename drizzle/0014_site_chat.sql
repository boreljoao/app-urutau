CREATE TABLE "conversas_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chave" text NOT NULL,
	"visitante_id" text,
	"lead_id" uuid,
	"nome" text,
	"contato" text,
	"status" "status_conversa" DEFAULT 'agente' NOT NULL,
	"interesses" text[] DEFAULT '{}'::text[] NOT NULL,
	"resumo" text,
	"motivo_humano" text,
	"pagina" text,
	"nao_lidas" integer DEFAULT 0 NOT NULL,
	"ultima_mensagem_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversas_site_chave_unique" UNIQUE("chave")
);
--> statement-breakpoint
CREATE TABLE "mensagens_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversa_id" uuid NOT NULL,
	"autor" "autor_mensagem" NOT NULL,
	"texto" text NOT NULL,
	"usuario_id" uuid,
	"acoes" jsonb,
	"tokens_entrada" integer,
	"tokens_saida" integer,
	"tokens_cache" integer,
	"custo_micros_usd" integer,
	"tempo_resposta_ms" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversas_site" ADD CONSTRAINT "conversas_site_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagens_site" ADD CONSTRAINT "mensagens_site_conversa_id_conversas_site_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas_site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagens_site" ADD CONSTRAINT "mensagens_site_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversas_site_recentes_idx" ON "conversas_site" USING btree ("ultima_mensagem_em");--> statement-breakpoint
CREATE INDEX "mensagens_site_conversa_idx" ON "mensagens_site" USING btree ("conversa_id","criado_em");--> statement-breakpoint
CREATE INDEX "mensagens_site_criado_idx" ON "mensagens_site" USING btree ("criado_em");