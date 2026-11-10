CREATE TYPE "public"."formato_post_instagram" AS ENUM('post', 'carrossel', 'reel', 'story');--> statement-breakpoint
ALTER TYPE "public"."situacao_post_instagram" ADD VALUE 'rascunho' BEFORE 'criando';--> statement-breakpoint
ALTER TYPE "public"."situacao_post_instagram" ADD VALUE 'agendado' BEFORE 'erro';--> statement-breakpoint
ALTER TYPE "public"."situacao_post_instagram" ADD VALUE 'publicado' BEFORE 'erro';--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "objetivo" text;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "orientacoes" text;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "formato" "formato_post_instagram" DEFAULT 'post' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "arquivos" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "modo" text DEFAULT 'revisar' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "agendado_para" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "publicado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "link_instagram" text;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "metricas" jsonb;--> statement-breakpoint
ALTER TABLE "posts_instagram" ADD COLUMN "metricas_em" timestamp with time zone;