ALTER TABLE "agentes_whatsapp" ALTER COLUMN "modelo" SET DEFAULT 'claude-haiku-5-5';--> statement-breakpoint
-- Os agentes criados até aqui ficaram no Opus por padrão: passam para o Haiku, que custa uns 40x menos.
UPDATE "agentes_whatsapp" SET "modelo" = 'claude-haiku-5-5' WHERE "modelo" = 'claude-opus-5-5';
