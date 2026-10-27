import { FormRegras } from "@/components/central/Receita";
import { obterDb } from "@/db";
import { SERVICOS_URUTAU } from "@/lib/receita";
import { exigirSocio } from "@/lib/servidor/acesso";
import { salvarRegras } from "@/lib/servidor/acoes-receita";
import { listarEquipe } from "@/lib/servidor/central";
import { lerParametros, lerRegras } from "@/lib/servidor/receita";

export const metadata = { title: "Regras" };
export const dynamic = "force-dynamic";

export default async function Regras() {
  await exigirSocio();
  const db = obterDb();
  const [regras, parametros, equipe] = await Promise.all([lerRegras(db), lerParametros(db), listarEquipe(db)]);
  return (
    <div className="space-y-3">
      <header>
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Regras de divisão</h1>
        <p className="mt-1 max-w-3xl text-[15px] text-suave">
          Ordem da conta em cada pagamento: {parametros.trouxePcm / 1000}% para quem trouxe o cliente, a comissão de quem executa, e o que sobra (menos
          custos e a reserva de caixa) é dos sócios. Mudar aqui vale para serviços cadastrados daqui em diante: os contratos já fechados guardam a regra
          do dia em que foram feitos.
        </p>
      </header>
      <FormRegras
        acao={salvarRegras}
        servicos={SERVICOS_URUTAU}
        regras={regras}
        parametros={parametros}
        socios={equipe.filter((e) => e.papel === "socio").map((e) => ({ id: e.id, nome: e.nome }))}
      />
    </div>
  );
}
