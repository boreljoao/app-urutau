CREATE TYPE "public"."tipo_movimento" AS ENUM('entrada', 'venda', 'devolucao', 'ajuste', 'perda', 'cancelamento');--> statement-breakpoint
CREATE TYPE "public"."unidade_produto" AS ENUM('un', 'kg', 'g', 'l', 'ml', 'm', 'cx', 'pct');--> statement-breakpoint
CREATE TABLE "movimentos_estoque" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"tipo" "tipo_movimento" NOT NULL,
	"quantidade_mil" bigint NOT NULL,
	"custo_unitario_centavos" bigint,
	"saldo_apos_mil" bigint NOT NULL,
	"custo_medio_apos_centavos" bigint NOT NULL,
	"venda_id" uuid,
	"compra_id" uuid,
	"documento" text,
	"observacao" text DEFAULT '' NOT NULL,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimentos_quantidade" CHECK ("movimentos_estoque"."quantidade_mil" <> 0 or "movimentos_estoque"."tipo" = 'ajuste')
);
--> statement-breakpoint
CREATE TABLE "produtos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"sku" text,
	"codigo_barras" text,
	"categoria" text DEFAULT '' NOT NULL,
	"unidade" "unidade_produto" DEFAULT 'un' NOT NULL,
	"preco_centavos" bigint DEFAULT 0 NOT NULL,
	"custo_medio_centavos" bigint DEFAULT 0 NOT NULL,
	"saldo_mil" bigint DEFAULT 0 NOT NULL,
	"minimo_mil" bigint DEFAULT 0 NOT NULL,
	"controla_estoque" boolean DEFAULT true NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultima_venda_em" timestamp with time zone,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone,
	CONSTRAINT "produtos_empresa_id_uq" UNIQUE("empresa_id","id"),
	CONSTRAINT "produtos_preco" CHECK ("produtos"."preco_centavos" >= 0 and "produtos"."custo_medio_centavos" >= 0 and "produtos"."minimo_mil" >= 0)
);
--> statement-breakpoint
CREATE TABLE "venda_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"venda_id" uuid NOT NULL,
	"produto_id" uuid,
	"descricao" text NOT NULL,
	"quantidade_mil" bigint NOT NULL,
	"preco_unitario_centavos" bigint NOT NULL,
	"desconto_centavos" bigint DEFAULT 0 NOT NULL,
	"total_centavos" bigint NOT NULL,
	"custo_unitario_centavos" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "venda_itens_valores" CHECK ("venda_itens"."quantidade_mil" > 0 and "venda_itens"."total_centavos" >= 0 and "venda_itens"."desconto_centavos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_produto_fk" FOREIGN KEY ("empresa_id","produto_id") REFERENCES "public"."produtos"("empresa_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_venda_id_vendas_id_fk" FOREIGN KEY ("venda_id") REFERENCES "public"."vendas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_produto_fk" FOREIGN KEY ("empresa_id","produto_id") REFERENCES "public"."produtos"("empresa_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movimentos_produto_idx" ON "movimentos_estoque" USING btree ("empresa_id","produto_id","criado_em");--> statement-breakpoint
CREATE INDEX "movimentos_empresa_idx" ON "movimentos_estoque" USING btree ("empresa_id","criado_em");--> statement-breakpoint
CREATE INDEX "movimentos_compra_idx" ON "movimentos_estoque" USING btree ("empresa_id","compra_id");--> statement-breakpoint
CREATE UNIQUE INDEX "produtos_codigo_uq" ON "produtos" USING btree ("empresa_id","codigo_barras") WHERE "produtos"."codigo_barras" is not null and "produtos"."excluido_em" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "produtos_sku_uq" ON "produtos" USING btree ("empresa_id","sku") WHERE "produtos"."sku" is not null and "produtos"."excluido_em" is null;--> statement-breakpoint
CREATE INDEX "produtos_empresa_nome_idx" ON "produtos" USING btree ("empresa_id","nome");--> statement-breakpoint
CREATE INDEX "venda_itens_venda_idx" ON "venda_itens" USING btree ("venda_id");--> statement-breakpoint
CREATE INDEX "venda_itens_produto_idx" ON "venda_itens" USING btree ("empresa_id","produto_id");