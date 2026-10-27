import { Abas } from "@/components/central/Receita";

/** Clientes da Urutau (quem paga a Urutau) e as empresas que usam o sistema. */
export function AbasClientes() {
  return (
    <Abas
      abas={[
        { href: "/admin/clientes", rotulo: "Clientes da Urutau" },
        { href: "/admin/empresas", rotulo: "No sistema" },
      ]}
    />
  );
}
