import { Abas } from "@/components/central/Receita";
import { exigirSocio } from "@/lib/servidor/acesso";

/** Receita da Urutau: só os sócios entram; para a equipe a página não existe (404). */
export default async function LayoutReceita({ children }: { children: React.ReactNode }) {
  await exigirSocio();
  return (
    <div className="space-y-4">
      <Abas
        abas={[
          { href: "/admin/receita", rotulo: "Painel", exato: true },
          { href: "/admin/receita/comissoes", rotulo: "Comissões a pagar" },
          { href: "/admin/receita/custos", rotulo: "Custos" },
          { href: "/admin/receita/regras", rotulo: "Regras" },
        ]}
      />
      {children}
    </div>
  );
}
