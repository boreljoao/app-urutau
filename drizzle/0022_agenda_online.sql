ALTER TABLE "agendamentos" ADD COLUMN "origem" text DEFAULT 'painel' NOT NULL;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD COLUMN "token_paciente" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD COLUMN "lembretes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD COLUMN "respondido_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "empresa_painel" ADD COLUMN "agenda_online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "empresa_painel" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "empresa_painel" ADD COLUMN "antecedencia_horas" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "empresa_painel" ADD COLUMN "dias_online" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_token_paciente_unique" UNIQUE("token_paciente");--> statement-breakpoint
ALTER TABLE "empresa_painel" ADD CONSTRAINT "empresa_painel_slug_unique" UNIQUE("slug");