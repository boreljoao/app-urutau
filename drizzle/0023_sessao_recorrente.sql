ALTER TABLE "agendamentos" ADD COLUMN "online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agendamentos" ADD COLUMN "serie_id" uuid;