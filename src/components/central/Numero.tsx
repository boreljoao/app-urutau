/** Um número do painel: rótulo pequeno, o valor grande e uma linha que explica. */
export function Numero({ rotulo, valor, linha, tom, destaque = false }: { rotulo: string; valor: string; linha?: string; tom?: "positivo" | "negativo"; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] leading-4 text-meta">{rotulo}</dt>
      <dd className={`numero mt-0.5 whitespace-nowrap text-[22px] font-bold leading-8 ${destaque ? "text-destaque-texto" : ""}`}>{valor}</dd>
      {linha && <dd className={`text-[12px] leading-4 ${tom === "positivo" ? "text-positivo" : tom === "negativo" ? "text-negativo" : "text-suave"}`}>{linha}</dd>}
    </div>
  );
}
