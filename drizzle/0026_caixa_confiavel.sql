ALTER TABLE "venda_itens" DROP CONSTRAINT "venda_itens_valores";--> statement-breakpoint
ALTER TABLE "venda_itens" ADD COLUMN "desconto_venda_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD COLUMN "custo_total_centavos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Itens que já existiam: custo da quantidade com o mesmo arredondamento do total (meio centavo sobe).
UPDATE "venda_itens" SET "custo_total_centavos" = round("custo_unitario_centavos"::numeric * "quantidade_mil" / 1000);--> statement-breakpoint
ALTER TABLE "vendas" ADD COLUMN "chave_idempotencia" text;--> statement-breakpoint
ALTER TABLE "vendas" ADD COLUMN "pedido_hash" text;--> statement-breakpoint
ALTER TABLE "vendas" ADD COLUMN "valor_entregue_centavos" bigint;--> statement-breakpoint
ALTER TABLE "vendas" ADD COLUMN "troco_centavos" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "vendas_chave_uq" ON "vendas" USING btree ("empresa_id","chave_idempotencia") WHERE "vendas"."chave_idempotencia" is not null;--> statement-breakpoint
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_valores" CHECK ("venda_itens"."quantidade_mil" > 0 and "venda_itens"."total_centavos" >= 0 and "venda_itens"."desconto_centavos" >= 0 and "venda_itens"."desconto_venda_centavos" >= 0);--> statement-breakpoint
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_troco" CHECK ("vendas"."troco_centavos" is null or ("vendas"."troco_centavos" >= 0 and "vendas"."valor_entregue_centavos" = "vendas"."valor_centavos" + "vendas"."troco_centavos"));