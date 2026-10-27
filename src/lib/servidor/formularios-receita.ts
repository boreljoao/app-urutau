import "server-only";
import { asc } from "drizzle-orm";
import type { BancoDeDados } from "@/db";
import { empresas } from "@/db/schema";
import { SERVICOS_URUTAU } from "@/lib/receita";
import { listarEquipe } from "./central";
import { lerParametros, lerRegras } from "./receita";

/** O que os formulários de cliente e contrato precisam: serviços, equipe, sócios, empresas do sistema e a regra atual. */
export async function dadosDosFormularios(db: BancoDeDados) {
  const [equipe, listaEmpresas, regras, p] = await Promise.all([
    listarEquipe(db),
    db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).orderBy(asc(empresas.nome)),
    lerRegras(db),
    lerParametros(db),
  ]);
  return {
    servicos: SERVICOS_URUTAU,
    equipe: equipe.map((e) => ({ id: e.id, nome: e.nome })),
    socios: equipe.filter((e) => e.papel === "socio").map((e) => e.id),
    empresas: listaEmpresas,
    regras,
    trouxePcm: p.trouxePcm,
  };
}
