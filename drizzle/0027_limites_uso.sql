CREATE TABLE "limites_uso" (
	"chave" text PRIMARY KEY NOT NULL,
	"inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"contagem" integer DEFAULT 0 NOT NULL
);
