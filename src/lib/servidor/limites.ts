import "server-only";
import { sql } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { limitesUso } from "@/db/schema";

/**
 * Conta uma tentativa na janela e diz se ainda cabe. Atômico (um INSERT … ON CONFLICT): dois
 * pedidos ao mesmo tempo não passam os dois do limite, e vale entre servidores diferentes.
 * A chave já vem montada (ex.: "login:ip:1.2.3.4", "ia:empresa:<id>").
 */
export async function consumirLimite(db: BancoDeDados, chave: string, max: number, janelaSegundos: number): Promise<boolean> {
  const janela = sql`make_interval(secs => ${janelaSegundos})`;
  const [r] = await db
    .insert(limitesUso)
    .values({ chave: chave.slice(0, 300), contagem: 1 })
    .onConflictDoUpdate({
      target: limitesUso.chave,
      set: {
        contagem: sql`case when ${limitesUso.inicio} < now() - ${janela} then 1 else ${limitesUso.contagem} + 1 end`,
        inicio: sql`case when ${limitesUso.inicio} < now() - ${janela} then now() else ${limitesUso.inicio} end`,
      },
    })
    .returning({ contagem: limitesUso.contagem });
  // De vez em quando, limpa as janelas velhas (não precisa de cron).
  if (Math.random() < 0.01) await db.delete(limitesUso).where(sql`${limitesUso.inicio} < now() - interval '2 days'`);
  return r.contagem <= max;
}
