import { asc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AcoesProposta, FormInteracao, FormLead, FormProposta, SeletorEtapa } from "@/components/central/Comercial";
import { BotaoLinha, Gaveta } from "@/components/central/Formularios";
import { MapaLeads } from "@/components/central/MapaLeads";
import { Avatar, TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { exigirSuperadmin } from "@/lib/servidor/acesso";
import { empresas } from "@/db/schema";
import { quando } from "@/lib/central";
import { ETAPAS, NOME_ETAPA, NOME_INTERACAO, NOME_ORIGEM, NOME_SERVICO, NOME_STATUS_PROPOSTA, SECOES_DO_SITE, SERVICOS, linkWhatsapp } from "@/lib/comercial";
import { centavosParaInput, formatarReais } from "@/lib/dinheiro";
import { formatarTelefone } from "@/lib/validacao";
import { criarProposta, excluirLead, excluirProposta, ligarEmpresa, mudarEtapa, mudarStatusProposta, registrarInteracao, salvarLead } from "@/lib/servidor/acoes-comercial";
import { listarEquipe } from "@/lib/servidor/central";
import { obterLead } from "@/lib/servidor/comercial";
import { caminhoDoLead } from "@/lib/servidor/visitantes";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = /^[0-9a-f-]{36}$/i.test(id) ? await obterLead(obterDb(), id) : null;
  return { title: d?.lead.nome ?? "Lead" };
}

export default async function Lead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = obterDb();
  const dados = /^[0-9a-f-]{36}$/i.test(id) ? await obterLead(db, id) : null;
  if (!dados) notFound();
  const { lead: l, historico, propostas } = dados;
  const { socio } = await exigirSuperadmin();
  const [equipe, listaEmpresas, caminho] = await Promise.all([
    listarEquipe(db),
    db.select({ id: empresas.id, nome: empresas.nome }).from(empresas).orderBy(asc(empresas.nome)),
    caminhoDoLead(db, id),
  ]);
  const agora = new Date();
  const posicao = new Map(equipe.map((p, i) => [p.id, i]));
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));
  const origens = Object.entries(NOME_ORIGEM).map(([oid, nome]) => ({ id: oid, nome }));
  const zap = linkWhatsapp(l.telefone, `Oi${l.contato ? `, ${l.contato.split(" ")[0]}` : ""}! Aqui é da urutau.`);
  const mapsLink = l.latitude != null && l.longitude != null ? `https://www.google.com/maps/search/?api=1&query=${l.latitude},${l.longitude}` : l.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.endereco)}` : null;
  const responsavel = equipe.find((p) => p.id === l.responsavelId);
  const etapaIdx = ETAPAS.findIndex((e) => e.id === l.etapa);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-1">
        <div className="min-w-0">
          <p className="mb-1 text-[13px]">
            <Link href="/admin/comercial/leads" className="text-meta hover:text-texto">‹ Leads</Link>
          </p>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">{l.nome}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-suave">
            {l.contato && <span>{l.contato}</span>}
            {[l.categoria, l.cidade].filter(Boolean).length > 0 && <span>{[l.categoria, l.cidade].filter(Boolean).join(" · ")}</span>}
            {l.nota != null && <span className="numero">★ {l.nota.toLocaleString("pt-BR")}{l.avaliacoes ? ` (${l.avaliacoes})` : ""}</span>}
            <span className="text-meta">· {NOME_ORIGEM[l.origem]} · chegou {quando(l.criadoEm, agora)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {zap && <a href={zap} target="_blank" rel="noreferrer" className="btn-central">WhatsApp</a>}
          {l.telefone && <a href={`tel:+${l.telefone.replace(/\D/g, "")}`} className="btn-leve">Ligar</a>}
          {l.email && <a href={`mailto:${l.email}`} className="btn-leve">E-mail</a>}
          <Gaveta rotulo="Editar" titulo={`Editar ${l.nome}`}>
            <FormLead
              acao={salvarLead.bind(null, l.id)}
              equipe={pessoas}
              origens={origens}
              servicos={SERVICOS}
              rotulo="Salvar"
              inicial={{ ...l, valorEstimado: l.valorEstimadoCentavos ? centavosParaInput(l.valorEstimadoCentavos) : "" }}
            />
          </Gaveta>
        </div>
      </header>

      <section className="cartao !py-4" aria-label="Etapa do funil">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[12px]">
          {ETAPAS.filter((e) => e.aberta || e.id === l.etapa || !["ganho", "perdido"].includes(l.etapa)).map((e, i) => {
            const passou = i < etapaIdx && l.etapa !== "perdido";
            const atual = e.id === l.etapa;
            return (
              <li key={e.id} className="flex items-center gap-1">
                <span
                  className={`rounded-full px-3 py-1 ${atual ? (e.id === "perdido" ? "bg-negativo/20 font-semibold text-negativo" : e.id === "ganho" ? "bg-positivo/20 font-semibold text-positivo" : "bg-destaque font-semibold text-fundo") : passou ? "bg-superficie-2 text-texto" : "text-meta"}`}
                >
                  {e.nome}
                </span>
                {i < ETAPAS.length - 1 && <span aria-hidden className="text-meta">›</span>}
              </li>
            );
          })}
          <li className="ml-auto flex items-center gap-2">
            <span className="text-meta">Mudar etapa</span>
            <SeletorEtapa key={l.etapa} acao={mudarEtapa.bind(null, l.id)} atual={l.etapa} etapas={ETAPAS} nome={l.nome} />
          </li>
        </ol>
        {l.etapa === "perdido" && l.motivoPerda && <p className="mt-2 text-[13px] text-suave">Motivo: {l.motivoPerda}</p>}
      </section>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <section className="cartao" aria-labelledby="t-registrar">
            <TituloBloco
              acao={
                l.proximoContato ? (
                  <span className="text-[13px] text-suave">retorno marcado para {l.proximoContato.slice(8, 10)}/{l.proximoContato.slice(5, 7)}</span>
                ) : (
                  <span className="text-[13px] text-meta">sem retorno marcado</span>
                )
              }
            >
              <span id="t-registrar">Registrar contato</span>
            </TituloBloco>
            <FormInteracao acao={registrarInteracao.bind(null, l.id)} etapas={ETAPAS} etapaAtual={l.etapa} />
          </section>

          <section className="cartao" aria-labelledby="t-historico">
            <TituloBloco acao={<span className="text-[13px] text-meta">{historico.filter((h) => h.tipo !== "nota").length} contatos</span>}>
              <span id="t-historico">Histórico</span>
            </TituloBloco>
            {historico.length === 0 ? (
              <Vazio>Nenhum contato registrado ainda. Ligou ou mandou mensagem? Registre acima.</Vazio>
            ) : (
              <ol className="space-y-4">
                {historico.map((h) => (
                  <li key={h.id} className="flex gap-3 text-[13px]">
                    {h.autor && h.autorId ? (
                      <Avatar nome={h.autor} posicao={posicao.get(h.autorId) ?? 0} tamanho={24} />
                    ) : (
                      <span aria-hidden className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-full bg-superficie-2 text-[11px] text-suave">·</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{h.autor ? h.autor.split(" ")[0] : "Site"}</span>
                        <span className="text-suave">
                          {h.etapaPara ? `moveu de ${NOME_ETAPA[h.etapaDe!]} para ${NOME_ETAPA[h.etapaPara]}` : NOME_INTERACAO[h.tipo]}
                        </span>
                        <span className="ml-auto text-[12px] text-meta">{quando(h.criadoEm, agora)}</span>
                      </p>
                      {h.texto && <p className="mt-0.5 whitespace-pre-line text-texto/90">{h.texto}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {caminho.visitantes.length > 0 && (
            <section className="cartao" aria-labelledby="t-caminho">
              <TituloBloco acao={<Link href="/admin/comercial/site" className="text-[13px] text-suave hover:text-texto">Visitantes do site ›</Link>}>
                <span id="t-caminho">Caminho no site</span>
              </TituloBloco>
              {caminho.visitantes.map((v) => (
                <p key={v.id} className="mb-3 text-[13px] text-suave">
                  Chegou por <span className="font-semibold text-texto">{v.origem ?? "Direto"}</span>
                  {v.campanha ? ` (campanha ${v.campanha})` : ""} {quando(v.primeiraVisita, agora)}
                  {v.cidade ? `, de ${v.cidade}${v.regiao ? `/${v.regiao}` : ""}` : ""}
                  {v.aparelho ? `, no ${v.aparelho}` : ""} · {v.visitas} {v.visitas === 1 ? "visita" : "visitas"}
                </p>
              ))}
              <ol className="space-y-1.5 text-[13px]">
                {caminho.eventos.slice(0, 20).map((e) => (
                  <li key={e.id} className="flex justify-between gap-3">
                    <span>
                      {e.tipo === "visita"
                        ? "Abriu o site"
                        : e.tipo === "secao"
                          ? `Viu ${SECOES_DO_SITE[e.pagina ?? ""] ?? e.pagina}`
                          : e.tipo === "whatsapp"
                            ? "Clicou no WhatsApp"
                            : e.tipo === "diagnostico"
                              ? "Mandou o diagnóstico"
                              : "Deixou contato"}
                    </span>
                    <span className="shrink-0 text-meta">{quando(e.criadoEm, agora)}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {mapsLink && l.latitude != null && (
            <section className="cartao" aria-labelledby="t-onde">
              <TituloBloco acao={<a href={mapsLink} target="_blank" rel="noreferrer" className="text-[13px] text-suave hover:text-texto">Abrir no Google Maps ›</a>}>
                <span id="t-onde">Onde fica</span>
              </TituloBloco>
              <MapaLeads pontos={[{ id: l.id, nome: l.nome, etapa: l.etapa, categoria: l.categoria, telefone: l.telefone, nota: l.nota, latitude: l.latitude, longitude: l.longitude }]} nomesEtapa={NOME_ETAPA} altura={220} />
              {l.endereco && <p className="mt-2 text-[13px] text-suave">{l.endereco}</p>}
            </section>
          )}
        </div>

        <div className="space-y-3">
          <section className="cartao" aria-labelledby="t-dados">
            <TituloBloco>
              <span id="t-dados">Dados</span>
            </TituloBloco>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
              <dt className="text-meta">Responsável</dt>
              <dd>{responsavel ? responsavel.nome : <span className="text-meta">ninguém</span>}</dd>
              <dt className="text-meta">Telefone</dt>
              <dd>{l.telefone ? formatarTelefone(l.telefone) : "—"}</dd>
              <dt className="text-meta">E-mail</dt>
              <dd className="truncate">{l.email ?? "—"}</dd>
              <dt className="text-meta">Site</dt>
              <dd className="truncate">{l.site ? <a href={l.site.startsWith("http") ? l.site : `https://${l.site}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{l.site.replace(/^https?:\/\//, "")}</a> : "—"}</dd>
              <dt className="text-meta">Instagram</dt>
              <dd>{l.instagram ? <a href={`https://instagram.com/${l.instagram}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">@{l.instagram}</a> : "—"}</dd>
              {!l.latitude && l.endereco && (
                <>
                  <dt className="text-meta">Endereço</dt>
                  <dd>{mapsLink ? <a href={mapsLink} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{l.endereco}</a> : l.endereco}</dd>
                </>
              )}
              <dt className="text-meta">Valor/mês</dt>
              <dd className="numero">{l.valorEstimadoCentavos ? formatarReais(l.valorEstimadoCentavos) : "—"}</dd>
              <dt className="text-meta">Equipe</dt>
              <dd>{l.tamanho ?? "—"}</dd>
              {l.lote && (
                <>
                  <dt className="text-meta">Lote</dt>
                  <dd><Link href={`/admin/comercial/leads?lote=${encodeURIComponent(l.lote)}`} className="underline-offset-2 hover:underline">{l.lote}</Link></dd>
                </>
              )}
            </dl>
            {l.interesses.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[12px] text-meta">Interesse em</p>
                <ul className="flex flex-wrap gap-1.5">
                  {l.interesses.map((s) => (
                    <li key={s} className="rounded-full bg-superficie-2 px-2.5 py-0.5 text-[12px]">{NOME_SERVICO[s] ?? s}</li>
                  ))}
                </ul>
              </div>
            )}
            {l.dores.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[12px] text-meta">O que marcou no diagnóstico</p>
                <ul className="space-y-1 text-[13px]">
                  {l.dores.map((d) => (
                    <li key={d}>“{d}”</li>
                  ))}
                </ul>
              </div>
            )}
            {l.observacao && <p className="mt-4 whitespace-pre-line text-[13px] text-suave">{l.observacao}</p>}
          </section>

          <section className="cartao" aria-labelledby="t-propostas">
            <TituloBloco
              acao={
                <Gaveta rotulo="Nova" titulo={`Proposta para ${l.nome}`}>
                  <FormProposta acao={criarProposta} servicos={SERVICOS} leadId={l.id} />
                </Gaveta>
              }
            >
              <span id="t-propostas">Propostas</span>
            </TituloBloco>
            {propostas.length === 0 ? (
              <Vazio>Nenhuma proposta ainda.</Vazio>
            ) : (
              <ul className="space-y-3">
                {propostas.map((p) => (
                  <li key={p.id} className="rounded-lg bg-superficie-2 p-3 text-[13px]">
                    <p className="flex items-start justify-between gap-2">
                      <span className="font-semibold">{p.titulo}</span>
                      <span className={`shrink-0 text-[12px] ${p.status === "aceita" ? "text-positivo" : p.status === "recusada" ? "text-negativo" : "text-suave"}`}>{NOME_STATUS_PROPOSTA[p.status]}</span>
                    </p>
                    <p className="numero mt-1">
                      {p.valorMensalCentavos ? `${formatarReais(p.valorMensalCentavos)}/mês` : ""}
                      {p.valorMensalCentavos && p.valorUnicoCentavos ? " + " : ""}
                      {p.valorUnicoCentavos ? `${formatarReais(p.valorUnicoCentavos)} de entrada` : ""}
                    </p>
                    {p.servicos.length > 0 && <p className="mt-1 text-[12px] text-meta">{p.servicos.map((s) => NOME_SERVICO[s] ?? s).join(" · ")}</p>}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <AcoesProposta acao={mudarStatusProposta.bind(null, p.id)} status={p.status} />
                      <BotaoLinha acao={excluirProposta.bind(null, p.id)} rotulo="Excluir" confirmar={`Excluir a proposta "${p.titulo}"?`} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {socio && (
            <section className="cartao" aria-labelledby="t-virou">
              <TituloBloco>
                <span id="t-virou">Fechou?</span>
              </TituloBloco>
              <p className="mb-3 text-[13px] text-suave">Cadastre o contrato e os serviços: o lead vai para Fechou e as cobranças e comissões passam a ser contadas.</p>
              <Link href={`/admin/clientes/novo?lead=${l.id}`} className="btn-central">Virar cliente da Urutau</Link>
            </section>
          )}

          <section className="cartao" aria-labelledby="t-cliente">
            <TituloBloco>
              <span id="t-cliente">Cliente no app</span>
            </TituloBloco>
            <form action={ligarEmpresa.bind(null, l.id)} className="flex flex-wrap items-center gap-2">
              <select name="empresaId" defaultValue={l.empresaId ?? ""} aria-label="Empresa no app" className="campo !w-auto max-w-full flex-1">
                <option value="">Ainda não é cliente</option>
                {listaEmpresas.map((e) => (
                  <option key={e.id} value={e.id}>{e.nome}</option>
                ))}
              </select>
              <button className="btn-leve">Ligar</button>
            </form>
            {l.empresaId ? (
              <Link href={`/admin/empresas/${l.empresaId}`} className="mt-2 inline-block text-[13px] text-suave hover:text-texto">Abrir o cliente ›</Link>
            ) : (
              l.etapa === "ganho" && (
                <Link href="/admin/empresas/nova" className="mt-2 inline-block text-[13px] text-suave hover:text-texto">Fechou? Cadastre a empresa no app ›</Link>
              )
            )}
          </section>

          <div className="px-1">
            <BotaoLinha acao={excluirLead.bind(null, l.id)} rotulo="Excluir este lead" confirmar={`Excluir ${l.nome}? O histórico some junto.`} />
          </div>
        </div>
      </div>
    </div>
  );
}
