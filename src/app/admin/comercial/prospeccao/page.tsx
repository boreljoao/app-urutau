import Link from "next/link";
import { FormImportar } from "@/components/central/Comercial";
import { MapaLeads } from "@/components/central/MapaLeads";
import { TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { NOME_ETAPA, linkWhatsapp } from "@/lib/comercial";
import { formatarTelefone } from "@/lib/validacao";
import { importarCsv } from "@/lib/servidor/acoes-comercial";
import { listarEquipe } from "@/lib/servidor/central";
import { leadsNoMapa, listarLeads, lotesDeProspeccao } from "@/lib/servidor/comercial";

export const metadata = { title: "Prospecção" };
export const dynamic = "force-dynamic";

export default async function Prospeccao({ searchParams }: { searchParams: Promise<{ lote?: string }> }) {
  const { lote: loteBuscado } = await searchParams;
  const db = obterDb();
  const [equipe, lotes] = await Promise.all([listarEquipe(db), lotesDeProspeccao(db)]);
  const lote = loteBuscado && lotes.some((l) => l.lote === loteBuscado) ? loteBuscado : (lotes[0]?.lote ?? undefined);
  const [pontos, naoTrabalhados] = lote
    ? await Promise.all([leadsNoMapa(db, lote), listarLeads(db, { lote, etapa: "novo", limite: 400 })])
    : [[], []];
  const atual = lotes.find((l) => l.lote === lote);
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));

  return (
    <div className="space-y-3">
      <header>
        <h1 className="font-titulo text-2xl font-bold tracking-tight">Prospecção</h1>
        <p className="mt-1 text-[15px] text-suave">
          Empresas achadas no Google Maps pelo robô de prospecção, prontas para a equipe ligar.
          {lotes.length ? ` ${lotes.length} ${lotes.length === 1 ? "lote" : "lotes"}, ${lotes.reduce((s, l) => s + l.total, 0)} empresas.` : ""}
        </p>
      </header>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <section className="cartao" aria-labelledby="t-mapa">
            <TituloBloco acao={atual ? <span className="text-[13px] text-meta">{atual.comMapa} de {atual.total} no mapa</span> : undefined}>
              <span id="t-mapa">{lote ? `Mapa: ${lote}` : "Mapa"}</span>
            </TituloBloco>
            {pontos.length ? (
              <MapaLeads pontos={pontos} nomesEtapa={NOME_ETAPA} altura={420} />
            ) : (
              <Vazio>{lote ? "Este lote não trouxe coordenadas. Rode o robô com --full para as empresas aparecerem no mapa." : "Importe o primeiro lote ao lado para ver as empresas no mapa."}</Vazio>
            )}
          </section>

          {lote && (
            <section className="cartao" aria-labelledby="t-ligar">
              <TituloBloco acao={<Link href={`/admin/comercial/leads?lote=${encodeURIComponent(lote)}`} className="text-[13px] text-suave hover:text-texto">Ver o lote todo ›</Link>}>
                <span id="t-ligar">Ainda ninguém falou com</span>
              </TituloBloco>
              {naoTrabalhados.length === 0 ? (
                <Vazio>Todas as empresas deste lote já foram contatadas.</Vazio>
              ) : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {naoTrabalhados.slice(0, 25).map((l) => {
                      const zap = linkWhatsapp(l.telefone, "Oi! Aqui é da urutau, de Maricá.");
                      return (
                        <tr key={l.id} className="border-t border-superficie-2 first:border-0">
                          <td className="py-2 pr-3">
                            <Link href={`/admin/comercial/leads/${l.id}`} className="font-semibold hover:underline">{l.nome}</Link>
                            <span className="block text-meta">{[l.categoria, l.cidade].filter(Boolean).join(" · ")}</span>
                          </td>
                          <td className="numero py-2 pr-3 text-suave">{l.nota != null ? `★ ${l.nota.toLocaleString("pt-BR")}` : ""}</td>
                          <td className="py-2 pr-3 text-suave">{l.telefone ? formatarTelefone(l.telefone) : <span className="text-meta">sem telefone</span>}</td>
                          <td className="py-2 text-right">
                            <span className="inline-flex gap-1.5">
                              {l.telefone && <a href={`tel:+${l.telefone.replace(/\D/g, "")}`} className="btn-leve !min-h-7 !px-2.5 !text-[12px]">Ligar</a>}
                              {zap && <a href={zap} target="_blank" rel="noreferrer" className="btn-leve !min-h-7 !px-2.5 !text-[12px]">WhatsApp</a>}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {naoTrabalhados.length > 25 && <p className="mt-2 text-[12px] text-meta">e mais {naoTrabalhados.length - 25} no lote</p>}
            </section>
          )}
        </div>

        <div className="space-y-3">
          <section className="cartao" aria-labelledby="t-importar">
            <TituloBloco>
              <span id="t-importar">Importar lote</span>
            </TituloBloco>
            <FormImportar acao={importarCsv} equipe={pessoas} />
          </section>

          <section className="cartao" aria-labelledby="t-lotes">
            <TituloBloco>
              <span id="t-lotes">Lotes</span>
            </TituloBloco>
            {lotes.length === 0 ? (
              <Vazio>Nenhum lote importado ainda.</Vazio>
            ) : (
              <ul className="space-y-1">
                {lotes.map((l) => (
                  <li key={l.lote}>
                    <Link
                      href={`/admin/comercial/prospeccao?lote=${encodeURIComponent(l.lote!)}`}
                      aria-current={l.lote === lote ? "true" : undefined}
                      className={`-mx-2 block rounded-lg px-2 py-2 text-[13px] transition-colors hover:bg-superficie-2 ${l.lote === lote ? "bg-superficie-2" : ""}`}
                    >
                      <span className="flex justify-between gap-2">
                        <span className="truncate font-semibold">{l.lote}</span>
                        <span className="numero shrink-0 text-suave">{l.total}</span>
                      </span>
                      <span className="mt-1 block h-1.5 rounded-full bg-fundo">
                        <span className="block h-1.5 rounded-full bg-destaque" style={{ width: `${(l.trabalhados / Math.max(1, l.total)) * 100}%` }} />
                      </span>
                      <span className="mt-1 block text-[12px] text-meta">
                        {l.trabalhados} contatadas · {l.ganhos} {l.ganhos === 1 ? "fechou" : "fecharam"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-robo">
            <TituloBloco>
              <span id="t-robo">Como gerar um lote</span>
            </TituloBloco>
            <ol className="list-decimal space-y-2 pl-4 text-[13px] text-suave">
              <li>No computador com Docker, abra a pasta do <a href="https://github.com/Mahanaicoach/google-maps-scraper-kit" target="_blank" rel="noreferrer" className="underline">google-maps-scraper-kit</a> e ligue o robô: <code className="rounded bg-superficie-2 px-1">docker compose up -d</code></li>
              <li>
                Busque com <code className="rounded bg-superficie-2 px-1">--full</code> para vir a localização:
                <pre className="mt-1 overflow-x-auto rounded-lg bg-superficie-2 p-2 text-[12px] text-texto">python scripts/scrape.py "dentistas em Maricá RJ" --city "Maricá, RJ" --full</pre>
              </li>
              <li>Importe aqui o CSV que ele salvar. O mesmo lugar não entra duas vezes.</li>
            </ol>
            <p className="mt-3 text-[12px] text-meta">
              Telefones e e-mails de empresas também são dados pessoais (LGPD): use para oferecer o serviço e retire do painel quem pedir para não ser procurado.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
