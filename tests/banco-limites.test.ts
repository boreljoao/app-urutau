/** Freio de tentativas no banco (auditoria S01): conta certo mesmo com pedidos ao mesmo tempo. */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarConexao } from "@/db";
import { limitesUso } from "@/db/schema";
import { consumirLimite } from "@/lib/servidor/limites";

const url = process.env.TEST_DATABASE_URL;
const { db, cliente } = criarConexao(url ?? "postgres://invalido");

beforeAll(async () => {
  if (!url) throw new Error("Defina TEST_DATABASE_URL");
  await cliente.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await cliente.end();
});

describe("limites", () => {
  it("deixa passar até o máximo, inclusive com 30 pedidos simultâneos", async () => {
    const r = await Promise.all(Array.from({ length: 30 }, () => consumirLimite(db, "teste:ip:1", 5, 600)));
    expect(r.filter(Boolean)).toHaveLength(5);
    expect(await consumirLimite(db, "teste:ip:2", 5, 600)).toBe(true);
  });

  it("janela vencida recomeça a contagem", async () => {
    for (let i = 0; i < 3; i++) await consumirLimite(db, "teste:janela", 2, 600);
    expect(await consumirLimite(db, "teste:janela", 2, 600)).toBe(false);
    await db.update(limitesUso).set({ inicio: new Date(Date.now() - 3_600_000) }).where(eq(limitesUso.chave, "teste:janela"));
    expect(await consumirLimite(db, "teste:janela", 2, 600)).toBe(true);
  });
});
