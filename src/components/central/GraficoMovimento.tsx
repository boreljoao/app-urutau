"use client";

import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatarReais } from "@/lib/dinheiro";

export interface PontoDia {
  dia: number;
  atual: number | null;
  anterior: number | null;
}

function compacto(centavos: number) {
  const reais = centavos / 100;
  if (reais >= 1_000_000) return `${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (reais >= 1_000) return `${Math.round(reais / 1_000)} mil`;
  return `${Math.round(reais)}`;
}

function Dica({ active, payload, label, nomes }: { active?: boolean; payload?: { dataKey: string; value: number | null }[]; label?: number; nomes: [string, string] }) {
  if (!active || !payload?.length) return null;
  const v = (k: string) => payload.find((p) => p.dataKey === k)?.value;
  return (
    <div className="rounded-lg bg-superficie-2 px-3 py-2 text-[12px] shadow-lg">
      <p className="mb-1 font-semibold">Dia {label}</p>
      <p className="flex justify-between gap-4"><span className="text-suave">{nomes[0]}</span><span className="numero">{v("atual") != null ? formatarReais(v("atual")!) : "–"}</span></p>
      <p className="flex justify-between gap-4"><span className="text-meta">{nomes[1]}</span><span className="numero text-suave">{v("anterior") != null ? formatarReais(v("anterior")!) : "–"}</span></p>
    </div>
  );
}

/**
 * Vendas de todos os clientes, dia a dia. As barras amarelas são este mês; a linha fina cinza
 * é o mesmo dia do mês anterior, para comparar sem precisar de legenda grande.
 */
export function GraficoMovimento({ dados, nomes }: { dados: PontoDia[]; nomes: [string, string] }) {
  return (
    <div className="h-[170px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dados} margin={{ top: 6, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
          <XAxis dataKey="dia" tickLine={false} axisLine={false} interval={4} tick={{ fill: "var(--texto-meta)", fontSize: 11 }} />
          <YAxis tickFormatter={compacto} tickLine={false} axisLine={false} width={44} tick={{ fill: "var(--texto-meta)", fontSize: 11 }} />
          <Tooltip cursor={{ fill: "var(--superficie-2)" }} content={<Dica nomes={nomes} />} />
          <Bar dataKey="atual" fill="var(--destaque)" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={700} />
          <Line dataKey="anterior" type="monotone" stroke="var(--texto-meta)" strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
