import Link from "next/link";
import { FormLead } from "@/components/central/Comercial";
import { Gaveta } from "@/components/central/Formularios";
import { MapaLeads } from "@/components/central/MapaLeads";
import { Numero } from "@/components/central/Numero";
import { Avatar, TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { ETAPAS, NOME_ETAPA, NOME_ORIGEM, SERVICOS, funil, linkWhatsapp } from "@/lib/comercial";
import { quando } from "@/lib/central";
import { hoje, mesAtual, nomeDoMes, somarDias } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { formatarTelefone } from "@/lib/validacao";
import { criarLead } from "@/lib/servidor/acoes-comercial";
import { listarEquipe } from "@/lib/servidor/central";
import { contagemPorEtapa, leadsNoMapa, listarLeads, proximosContatos, resumoComercial } from "@/lib/servidor/comercial";

export const metadata = { title: "Comercial" };
export const dynamic = "force-dynamic";

export default async function PainelComercial() {
  const db = obterDb();
  const agora = new Date();
  const hojeData = hoje(agora);
  const mes = mesAtual(agora);
  const nomeMes = nomeDoMes(mes).split(" ")[0];
  const [equipe, contagem, resumo, retornos, mapa, recentes] = await Promise.all([
    listarEquipe(db),
    contagemPorEtapa(db),
    resumoComercial(db, mes),
    proximosContatos(db, somarDias(hojeData, 3)),
    leadsNoMapa(db),
    listarLeads(db, { limite: 8 }),
  ]);
  const f = funil(contagem.n);
  const posicao = new Map(equipe.map((p, i) => [p.id, i]));
  const valorAberto = ETAPAS.filter((e) => e.aberta).reduce((s, e) => s + (contagem.valor[e.id] ?? 0), 0);
  const maiorEtapa = Math.max(1, ...ETAPAS.map((e) => contagem.n[e.id] ?? 0));
  const atrasados = retornos.filter((r) => r.proximoContato! < hojeData).length;
  const totalOrigem = resumo.porOrigem.reduce((s, o) => s + o.n, 0);
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));
  const origens = Object.entries(NOME_ORIGEM).map(([id, nome]) => ({ id, nome }));

  const achado = [
    `${resumo.novos} ${resumo.novos === 1 ? "lead novo" : "leads novos"} em ${nomeMes}`,
    resumo.propostasAbertas.n ? `${resumo.propostasAbertas.n} ${resumo.propostasAbertas.n === 1 ? "proposta esperando" : "propostas esperando"} resposta` : "nenhuma proposta esperando resposta",
    atrasados ? `${atrasados} ${atrasados === 1 ? "retorno atrasado" : "retornos atrasados"}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="font-titulo text-2xl font-bold tracking-tight">Comercial</h1>
          <p className="mt-1 text-[15px] text-suave">{achado.join(" · ")}.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/comercial/prospeccao" className="btn-leve">Importar prospecção</Link>
          <Gaveta rotulo="Novo lead" titulo="Novo lead" principal>
            <FormLead acao={criarLead} equipe={pessoas} origens={origens} servicos={SERVICOS} />
          </Gaveta>
        </div>
      </header>

      <section className="cartao" aria-labelledby="t-numeros">
        <h2 id="t-numeros" className="sr-only">Números do comercial</h2>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
          <Numero rotulo={`Leads novos em ${nomeMes}`} valor={String(resumo.novos)} linha={resumo.porOrigem[0] ? `mais por ${NOME_ORIGEM[resumo.porOrigem[0].origem].toLowerCase()}` : "nenhum ainda"} />
          <Numero rotulo="Em conversa" valor={String(f.abertas)} linha={valorAberto ? `${formatarReais(valorAberto)}/mês estimados` : "sem valor estimado"} />
          <Numero
            rotulo="Propostas na mesa"
            valor={formatarReais(resumo.propostasAbertas.mensal)}
            linha={`${resumo.propostasAbertas.n} ${resumo.propostasAbertas.n === 1 ? "proposta" : "propostas"} por mês${resumo.propostasAbertas.unico ? ` + ${formatarReais(resumo.propostasAbertas.unico)} de entrada` : ""}`}
          />
          <Numero
            rotulo={`Fechado em ${nomeMes}`}
            valor={formatarReais(resumo.aceitasNoMes.mensal)}
            linha={`por mês · ${resumo.ganhosNoMes} ${resumo.ganhosNoMes === 1 ? "cliente novo" : "clientes novos"}`}
            destaque={resumo.aceitasNoMes.mensal > 0}
          />
          <Numero rotulo="Taxa de fechamento" valor={f.taxaFechamento == null ? "–" : `${f.taxaFechamento}%`} linha={`${f.ganhos} fecharam · ${f.perdidos} perdidos`} />
        </dl>
      </section>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <section className="cartao lg:col-span-2" aria-labelledby="t-mapa">
          <TituloBloco
            acao={
              <span className="flex items-center gap-3 text-[12px] text-meta">
                <Legenda cor="#8c91a6" texto="novo" />
                <Legenda cor="#f5c518" texto="em conversa" />
                <Legenda cor="#6ee7a8" texto="fechou" />
                <Legenda cor="#ff8a80" texto="perdido" />
              </span>
            }
          >
            <span id="t-mapa">Mapa dos leads</span>
          </TituloBloco>
          {mapa.length === 0 ? (
            <Vazio>
              Nenhum lead com endereço no mapa ainda. Importe uma prospecção do Google Maps em{" "}
              <Link href="/admin/comercial/prospeccao" className="underline">Prospecção</Link>.
            </Vazio>
          ) : (
            <MapaLeads pontos={mapa} nomesEtapa={NOME_ETAPA} altura={380} />
          )}
          <p className="mt-2 text-[12px] text-meta">{mapa.length} {mapa.length === 1 ? "lead" : "leads"} com endereço no mapa</p>
        </section>

        <div className="space-y-3">
          <section className="cartao" aria-labelledby="t-funil">
            <TituloBloco acao={<Link href="/admin/comercial/leads?ver=funil" className="text-[13px] text-suave hover:text-texto">Ver funil ›</Link>}>
              <span id="t-funil">Funil</span>
            </TituloBloco>
            <ul className="space-y-2">
              {ETAPAS.map((e) => {
                const n = contagem.n[e.id] ?? 0;
                return (
                  <li key={e.id}>
                    <Link href={`/admin/comercial/leads?etapa=${e.id}`} className="grid grid-cols-[96px_minmax(0,1fr)_32px] items-center gap-3 text-[13px] hover:text-texto">
                      <span className="text-suave">{e.nome}</span>
                      <span className="h-2 rounded-full bg-superficie-2">
                        <span
                          className="block h-2 rounded-full"
                          style={{ width: `${(n / maiorEtapa) * 100}%`, background: e.id === "perdido" ? "var(--negativo)" : e.id === "ganho" ? "var(--positivo)" : "var(--destaque)", opacity: e.id === "perdido" ? 0.6 : 1 }}
                        />
                      </span>
                      <span className="numero text-right">{n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="cartao" aria-labelledby="t-retornos">
            <TituloBloco acao={<span className="text-[13px] text-meta">até {somarDias(hojeData, 3).slice(8, 10)}/{somarDias(hojeData, 3).slice(5, 7)}</span>}>
              <span id="t-retornos">Retornos marcados</span>
            </TituloBloco>
            {retornos.length === 0 ? (
              <Vazio>Nenhum retorno marcado para os próximos dias.</Vazio>
            ) : (
              <ul className="space-y-2.5">
                {retornos.map((r) => {
                  const atrasado = r.proximoContato! < hojeData;
                  const zap = linkWhatsapp(r.telefone);
                  return (
                    <li key={r.id} className="flex items-center gap-2.5 text-[13px]">
                      {r.responsavel && r.responsavelId ? <Avatar nome={r.responsavel} posicao={posicao.get(r.responsavelId) ?? 0} tamanho={22} /> : <span className="h-[22px] w-[22px]" />}
                      <Link href={`/admin/comercial/leads/${r.id}`} className="min-w-0 flex-1 hover:underline">
                        <span className="block truncate">{r.nome}</span>
                        <span className={`block text-[12px] ${atrasado ? "text-negativo" : "text-meta"}`}>
                          {r.proximoContato === hojeData ? "hoje" : atrasado ? `atrasado desde ${r.proximoContato!.slice(8, 10)}/${r.proximoContato!.slice(5, 7)}` : `${r.proximoContato!.slice(8, 10)}/${r.proximoContato!.slice(5, 7)}`} · {NOME_ETAPA[r.etapa]}
                        </span>
                      </Link>
                      {zap && (
                        <a href={zap} target="_blank" rel="noreferrer" className="btn-leve !min-h-7 !px-2.5 !text-[12px]">WhatsApp</a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <section className="cartao lg:col-span-2" aria-labelledby="t-recentes">
          <TituloBloco acao={<Link href="/admin/comercial/leads" className="text-[13px] text-suave hover:text-texto">Todos os leads ›</Link>}>
            <span id="t-recentes">Chegaram por último</span>
          </TituloBloco>
          {recentes.length === 0 ? (
            <Vazio>Nenhum lead ainda. Os contatos e diagnósticos do site entram aqui sozinhos.</Vazio>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {recentes.map((l) => (
                  <tr key={l.id} className="border-t border-superficie-2 first:border-0">
                    <td className="py-2.5 pr-3">
                      <Link href={`/admin/comercial/leads/${l.id}`} className="font-semibold hover:underline">{l.nome}</Link>
                      <span className="block text-meta">{[l.categoria, l.cidade].filter(Boolean).join(" · ") || (l.telefone ? formatarTelefone(l.telefone) : "—")}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-suave">{NOME_ORIGEM[l.origem]}</td>
                    <td className="py-2.5 pr-3">{NOME_ETAPA[l.etapa]}</td>
                    <td className="py-2.5 text-right text-meta">{quando(l.criadoEm, agora)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="cartao" aria-labelledby="t-origem">
          <TituloBloco acao={<span className="text-[13px] text-meta">{nomeMes}</span>}>
            <span id="t-origem">De onde vêm os leads</span>
          </TituloBloco>
          {totalOrigem === 0 ? (
            <Vazio>Nenhum lead novo neste mês.</Vazio>
          ) : (
            <ul className="space-y-2.5">
              {resumo.porOrigem.map((o) => (
                <li key={o.origem} className="text-[13px]">
                  <span className="flex justify-between">
                    <span>{NOME_ORIGEM[o.origem]}</span>
                    <span className="numero text-suave">{o.n} · {Math.round((o.n / totalOrigem) * 100)}%</span>
                  </span>
                  <span className="mt-1 block h-1.5 rounded-full bg-superficie-2">
                    <span className="block h-1.5 rounded-full bg-destaque" style={{ width: `${(o.n / totalOrigem) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Legenda({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: cor }} />
      {texto}
    </span>
  );
}
