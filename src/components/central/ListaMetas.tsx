import { BarraMeta } from "@/components/central/BarraMeta";
import { BotaoLinha, FormAvanco } from "@/components/central/Formularios";
import { Vazio } from "@/components/central/Pecas";
import { TEXTO_RITMO, formatarValorMeta, porcentagem, ritmo } from "@/lib/central";
import { avancarMeta, excluirMeta } from "@/lib/servidor/acoes-central";
import type { MetaDoMes } from "@/lib/servidor/central";

/** Metas de uma pessoa. Com `editar`, cada uma ganha o "+ somar" e o excluir. */
export function ListaMetas({ metas, fracao, max, vazio, editar = false }: { metas: MetaDoMes[]; fracao: number; max?: number; vazio: string; editar?: boolean }) {
  if (metas.length === 0) return <Vazio>{vazio}</Vazio>;
  const mostrar = max ? metas.slice(0, max) : metas;
  return (
    <ul className="space-y-4">
      {mostrar.map((m, i) => {
        const r = ritmo(m, fracao);
        return (
          <li key={m.id} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate font-medium">{m.titulo}</span>
              <span className={`shrink-0 ${r === "atras" ? "text-meta" : r === "batida" ? "text-destaque-texto" : "text-suave"}`}>{TEXTO_RITMO[r]}</span>
            </div>
            <BarraMeta pct={porcentagem(m)} hoje={fracao} atrasada={r === "atras"} atraso={i * 0.08} />
            <p className="numero text-[13px] text-suave">
              <span className="text-texto">{formatarValorMeta(m.tipo, m.atual)}</span> de {formatarValorMeta(m.tipo, m.alvo)}
            </p>
            {editar && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <FormAvanco acao={avancarMeta.bind(null, m.id)} valor={m.tipo === "valor"} />
                <BotaoLinha acao={excluirMeta.bind(null, m.id)} rotulo="Excluir" confirmar={`Excluir a meta "${m.titulo}"?`} />
              </div>
            )}
          </li>
        );
      })}
      {max && metas.length > max && <li className="text-[13px] text-meta">e mais {metas.length - max}</li>}
    </ul>
  );
}
