/**
 * O site urutau.io chama a Central direto do navegador do visitante, então não há segredo
 * possível: as rotas /api/site/* aceitam só as origens de SITE_ORIGENS (separadas por vírgula).
 */
const ORIGENS_PADRAO = "https://urutau.io,https://www.urutau.io";

export function origemPermitida(req: Request): string | null {
  const origem = req.headers.get("origin");
  if (!origem) return null;
  const lista = (process.env.SITE_ORIGENS ?? ORIGENS_PADRAO).split(",").map((o) => o.trim()).filter(Boolean);
  return lista.includes(origem) ? origem : null;
}

export const cors = (origem: string, metodos = "POST, OPTIONS") => ({
  "Access-Control-Allow-Origin": origem,
  "Access-Control-Allow-Methods": metodos,
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
});
