import { FormDadosConta, FormSenha } from "@/components/central/Formularios";
import { TituloBloco } from "@/components/central/Pecas";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { salvarDadosDaConta, trocarSenha } from "@/lib/servidor/acoes-conta";

export const metadata = { title: "Minha conta" };

export default async function MinhaConta() {
  const eu = await exigirSuperadmin();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-titulo text-2xl font-bold tracking-tight">Minha conta</h1>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="cartao" aria-labelledby="t-dados">
          <TituloBloco>
            <span id="t-dados">Nome e e-mail</span>
          </TituloBloco>
          <FormDadosConta acao={salvarDadosDaConta} nome={eu.nome} email={eu.email} />
        </section>
        <section className="cartao" aria-labelledby="t-senha">
          <TituloBloco>
            <span id="t-senha">{eu.senhaProvisoria ? "Troque a senha provisória" : "Trocar senha"}</span>
          </TituloBloco>
          <FormSenha acao={trocarSenha} />
        </section>
      </div>
    </div>
  );
}
