import { Assistente } from "@/components/central/Assistente";
import { exigirSuperadmin } from "@/lib/servidor/acesso";

export const metadata = { title: "Assistente" };

const SUGESTOES = [
  "Quem está esperando resposta da equipe?",
  "O que os visitantes do site mais querem este mês?",
  "Quais leads estão quentes e qual o próximo passo de cada um?",
  "Escreva uma mensagem de WhatsApp para o lead mais recente do site",
  "Monte um roteiro de diagnóstico para um provedor de internet",
];

export default async function PaginaDoAssistente() {
  await exigirSuperadmin();
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <header>
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Assistente</h1>
        <p className="mt-1 text-[15px] text-suave">
          Sabe tudo da Urutau e lê o painel: leads, chat do site e o que os visitantes pediram. Só consulta, não muda nada. A conversa fica só nesta aba.
        </p>
      </header>
      <Assistente sugestoes={SUGESTOES} />
    </div>
  );
}
