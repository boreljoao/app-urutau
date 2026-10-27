import Link from "next/link";
import { CaixaFeito } from "@/components/central/Afazeres";
import { BotaoLinha } from "@/components/central/Formularios";
import { Avatar, Vazio } from "@/components/central/Pecas";
import type { ItemAtencao } from "@/lib/central";
import { concluirAfazer, excluirAfazer } from "@/lib/servidor/acoes-central";
import type { Afazer } from "@/lib/servidor/central";

/** "venceu 25/10" em vermelho, "hoje", "amanhã" ou "até 30/10". */
function prazoEmTexto(prazo: string, hoje: string): { texto: string; atrasado: boolean } {
  const [, m, d] = prazo.split("-");
  if (prazo < hoje) return { texto: `venceu ${d}/${m}`, atrasado: true };
  if (prazo === hoje) return { texto: "hoje", atrasado: false };
  const amanha = new Date(`${hoje}T12:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  if (prazo === amanha.toISOString().slice(0, 10)) return { texto: "amanhã", atrasado: false };
  return { texto: `até ${d}/${m}`, atrasado: false };
}

/** `eu`: a equipe só conclui e exclui as próprias tarefas; os sócios, todas. */
export function ListaAfazeres({ itens, hoje, posicao, vazio, eu, mostrarDono = true }: { itens: Afazer[]; hoje: string; posicao: Map<string, number>; vazio: string; eu: { id: string; socio: boolean }; mostrarDono?: boolean }) {
  if (itens.length === 0) return <Vazio>{vazio}</Vazio>;
  return (
    <ul className="divide-y divide-superficie-2">
      {itens.map((a) => {
        const p = a.prazo ? prazoEmTexto(a.prazo, hoje) : null;
        const feito = !!a.feitoEm;
        const meu = eu.socio || a.responsavelId === eu.id;
        return (
          <li key={a.id} className="group flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <CaixaFeito acao={concluirAfazer.bind(null, a.id)} feito={feito} titulo={a.titulo} desabilitado={!meu} />
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] leading-5 ${feito ? "text-meta line-through" : ""}`}>{a.titulo}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-meta">
                {p && <span className={p.atrasado && !feito ? "font-semibold text-negativo" : ""}>{p.texto}</span>}
                {a.empresa && a.empresaId && (
                  <Link href={`/admin/empresas/${a.empresaId}`} className="hover:text-texto">{a.empresa}</Link>
                )}
                {meu && (
                  <span className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <BotaoLinha acao={excluirAfazer.bind(null, a.id)} rotulo="Excluir" confirmar={`Excluir a tarefa "${a.titulo}"?`} />
                  </span>
                )}
              </p>
            </div>
            {mostrarDono &&
              (a.responsavel && a.responsavelId ? (
                <span title={a.responsavel}>
                  <Avatar nome={a.responsavel} posicao={posicao.get(a.responsavelId) ?? 0} tamanho={22} />
                </span>
              ) : (
                <span className="text-[12px] text-meta">sem dono</span>
              ))}
          </li>
        );
      })}
    </ul>
  );
}

/** A fila do que precisa de alguém: o urgente com o ponto vermelho, o resto com o ponto apagado. */
export function ListaAtencao({ itens, max = 6 }: { itens: ItemAtencao[]; max?: number }) {
  if (itens.length === 0) return <Vazio>Nada pendente. Vendas conferidas, clientes ativos e tarefas em dia.</Vazio>;
  return (
    <ul className="space-y-1">
      {itens.slice(0, max).map((i) => (
        <li key={i.chave}>
          <Link href={i.link} className="-mx-2 flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-superficie-2">
            <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: i.nivel === "alto" ? "var(--negativo)" : "var(--texto-meta)" }} />
            <span className="min-w-0">
              <span className="block text-[13px] leading-5">{i.texto}</span>
              {i.detalhe && <span className="block text-[12px] text-meta">{i.detalhe}</span>}
            </span>
          </Link>
        </li>
      ))}
      {itens.length > max && <li className="px-2 pt-1 text-[12px] text-meta">e mais {itens.length - max}</li>}
    </ul>
  );
}
