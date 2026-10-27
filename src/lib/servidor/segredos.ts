import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifra segredos de clientes guardados no banco (o token da Meta de cada loja) com AES-256-GCM.
 * A chave vem de CHAVE_SEGREDOS (qualquer texto longo; é derivado para 32 bytes).
 * Formato gravado: v1.<iv>.<tag>.<cifrado>, em base64url.
 */

function chave() {
  const segredo = process.env.CHAVE_SEGREDOS;
  if (!segredo || segredo.length < 16) throw new Error("CHAVE_SEGREDOS não configurada (mínimo de 16 caracteres).");
  return createHash("sha256").update(segredo).digest();
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(".");
}

export function decifrar(guardado: string): string {
  const [versao, iv, tag, cifrado] = guardado.split(".");
  if (versao !== "v1" || !iv || !tag || !cifrado) throw new Error("Segredo em formato desconhecido.");
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(cifrado, "base64url")), d.final()]).toString("utf8");
}

/** Para mostrar na tela que existe um token sem revelar o valor. */
export const mascarar = (token: string) => (token.length > 8 ? `••••${token.slice(-4)}` : "••••");
