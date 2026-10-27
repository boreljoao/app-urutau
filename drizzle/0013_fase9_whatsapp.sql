CREATE TYPE "public"."autor_mensagem" AS ENUM('cliente', 'agente', 'humano', 'sistema');--> statement-breakpoint
CREATE TYPE "public"."canal_conversa" AS ENUM('whatsapp', 'simulador');--> statement-breakpoint
CREATE TYPE "public"."modo_agente" AS ENUM('automatico', 'aprovacao', 'desligado');--> statement-breakpoint
CREATE TYPE "public"."status_conversa" AS ENUM('agente', 'humano', 'encerrada');--> statement-breakpoint
CREATE TYPE "public"."status_mensagem" AS ENUM('recebida', 'rascunho', 'pendente', 'enviada', 'entregue', 'lida', 'falhou', 'descartada');--> statement-breakpoint
CREATE TABLE "agentes_whatsapp" (
	"empresa_id" uuid PRIMARY KEY NOT NULL,
	"nome" text DEFAULT 'Atendente' NOT NULL,
	"tom" text DEFAULT '' NOT NULL,
	"conhecimento" text DEFAULT '' NOT NULL,
	"quando_chamar_humano" text DEFAULT '' NOT NULL,
	"modo" "modo_agente" DEFAULT 'aprovacao' NOT NULL,
	"modelo" text DEFAULT 'claude-opus-5-5' NOT NULL,
	"phone_number_id" text,
	"numero_exibicao" text,
	"token_cifrado" text,
	"ultimo_erro" text,
	"ultimo_erro_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentes_whatsapp_phone_number_id_unique" UNIQUE("phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "conversas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"canal" "canal_conversa" NOT NULL,
	"telefone" text NOT NULL,
	"nome" text,
	"cliente_id" uuid,
	"status" "status_conversa" DEFAULT 'agente' NOT NULL,
	"ultima_entrada_em" timestamp with time zone,
	"ultima_mensagem_em" timestamp with time zone DEFAULT now() NOT NULL,
	"nao_lidas" integer DEFAULT 0 NOT NULL,
	"intencao" text,
	"resumo" text,
	"motivo_humano" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversas_empresa_canal_tel" UNIQUE("empresa_id","canal","telefone")
);
--> statement-breakpoint
CREATE TABLE "mensagens_whatsapp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversa_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"autor" "autor_mensagem" NOT NULL,
	"texto" text NOT NULL,
	"wa_message_id" text,
	"status" "status_mensagem" NOT NULL,
	"erro" text,
	"usuario_id" uuid,
	"acoes" jsonb,
	"tokens_entrada" integer,
	"tokens_saida" integer,
	"tokens_cache" integer,
	"custo_micros_usd" integer,
	"tempo_resposta_ms" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mensagens_whatsapp_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
ALTER TABLE "agentes_whatsapp" ADD CONSTRAINT "agentes_whatsapp_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_conversa_id_conversas_id_fk" FOREIGN KEY ("conversa_id") REFERENCES "public"."conversas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversas_recentes_idx" ON "conversas" USING btree ("empresa_id","ultima_mensagem_em");--> statement-breakpoint
CREATE INDEX "mensagens_conversa_idx" ON "mensagens_whatsapp" USING btree ("conversa_id","criado_em");--> statement-breakpoint
CREATE INDEX "mensagens_empresa_idx" ON "mensagens_whatsapp" USING btree ("empresa_id","criado_em");