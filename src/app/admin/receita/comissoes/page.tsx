import Link from "next/link";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { BotaoComErro } from "@/components/central/Receita";
import { obterDb } from "@/db";
import { formatarReais } from "@/lib/dinheiro";
import { exigirSocio } from "@/lib/servidor/acesso";
import { repassarComissoes } from "@/lib/servidor/acoes-receita";
import { comissoesAPagar } from "@/lib/servidor/receita";

export const metadata = { title: "Comissões a pagar" };
export const dynamic = "force-dynamic";

export default async function Comissoes() {
  await exigirSocio();
  const lista = await comissoesAPagar(obterDb());
  const total = lista.reduce((s, l) => s + l.total, 0);
  return (
    <section className="cartao max-w-3xl" aria-labelledby="t-com">
      <TituloBloco acao={<span className="numero text-[13px] text-meta">{formatarReais(total)}</span>}>
        <span id="t-com">Comissões a repassar</span>
      </TituloBloco>
      <p className="mb-4 text-[13px] text-suave">
        Comissões de pagamentos que os clientes já fizeram e que a Urutau ainda não repassou. Quando pagar a pessoa, marque o repasse: cada uma vê
        tudo explicado em Meus ganhos.
      </p>
      {lista.length === 0 ? (
        <Vazio>Nada a repassar.</Vazio>
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {lista.map((l) => (
              <tr key={l.usuarioId} className="border-t border-superficie-2 align-middle first:border-0">
                <td className="py-3 pr-3">
                  <Link href={`/admin/ganhos?pessoa=${l.usuarioId}`} className="font-semibold hover:underline">{l.nome}</Link>
                  <span className="block text-[12px] text-meta">
                    {l.n} {l.n === 1 ? "comissão" : "comissões"}
                    {l.socio ? " · sócio" : ""}
                  </span>
                </td>
                <td className="numero py-3 pr-3 text-right text-[15px]">{formatarReais(l.total)}</td>
                <td className="py-3 text-right">
                  <BotaoComErro acao={repassarComissoes.bind(null, l.usuarioId)} rotulo="Marcar como repassado" confirmar={`Marcar ${formatarReais(l.total)} como pago para ${l.nome}?`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
