import { Cabecalho } from "@/components/Campos";
import { FormEmpresa } from "@/components/FormEmpresa";
import { criarEmpresaAdmin } from "@/lib/servidor/acoes-admin";

export const metadata = { title: "Nova empresa" };

export default function NovaEmpresaAdmin() {
  return (
    <div className="mx-auto max-w-3xl">
      <Cabecalho titulo="Nova empresa" voltar="/admin/empresas" />
      <FormEmpresa acao={criarEmpresaAdmin} textoBotao="Criar empresa" comDono />
    </div>
  );
}
