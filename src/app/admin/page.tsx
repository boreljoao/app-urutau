import Link from "next/link";
import { Entrada } from "@/components/central/BarraMeta";
import { FormMeta, FormNota, Gaveta } from "@/components/central/Formularios";
import { Linhas } from "@/components/central/Linhas";
import { Avatar, Ponto, TituloBloco, Vazio } from "@/components/central/Pecas";
import { ListaMetas } from "@/components/central/ListaMetas";
import { obterDb } from "@/db";
import { fracaoDoMes, presenca, primeiroNome, quando, ritmo, rotuloDaTela } from "@/lib/central";
import { hoje, mesAtual, nomeDoMes } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { criarMeta, criarNota } from "@/lib/servidor/acoes-central";
import { atividadeRecente, empresasDaCentral, listarEquipe, metasDoMes, notasRecentes, pessoasOnlineNasEmpresas, resumoDoSite } from "@/lib/servidor/central";

export const metadata = { title: "Visão geral" };
export const dynamic = "force-dynamic";

export default async function VisaoGeral() {
  const db = obterDb();
  const agora = new Date();
  const mes = mesAtual(agora);
  const fracao = fracaoDoMes(mes, Number(hoje(agora).slice(8, 10)));
  const [equipe, metas, empresas, notas, atividade, onlineNosClientes, site] = await Promise.all([
    listarEquipe(db),
    metasDoMes(db, mes),
    empresasDaCentral(db, mes),
    notasRecentes(db, { limite: 6 }),
    atividadeRecente(db, { limite: 12 }),
    pessoasOnlineNasEmpresas(db, agora),
    resumoDoSite(db, 7, agora),
  ]);
  const nomeDaEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome;
  const posicao = new Map(equipe.map((p, i) => [p.id, i]));

  const online = equipe.filter((p) => presenca(p.vistoEm, agora).estado === "online");
  const batidas = metas.filter((m) => ritmo(m, fracao) === "batida").length;
  const atrasadas = metas.filter((m) => ritmo(m, fracao) === "atras").length;
  const aConferir = empresas.reduce((s, e) => s + e.aConferir, 0);
  const achado = [
    online.length ? `${online.map((p) => primeiroNome(p.nome)).join(" e ")} ${online.length === 1 ? "está" : "estão"} online` : "Ninguém da equipe online agora",
    metas.length ? `${batidas} de ${metas.length} metas batidas${atrasadas ? `, ${atrasadas} atrás do ritmo` : ""}` : "nenhuma meta para este mês ainda",
    aConferir ? `${aConferir} ${aConferir === 1 ? "venda espera" : "vendas esperam"} o check dos clientes` : null,
  ].filter(Boolean);
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-titulo text-2xl font-bold tracking-tight first-letter:uppercase">{nomeDoMes(mes).replace(/ de \d+$/, "")} na Urutau</h1>
          <p className="mt-1 text-[15px] text-suave">{achado.join(" · ")}.</p>
        </div>
        <div className="flex gap-2">
          <Gaveta rotulo="Nova meta" titulo="Nova meta do mês" principal>
            <FormMeta acao={criarMeta} equipe={pessoas} />
          </Gaveta>
        </div>
      </header>

      {equipe.length === 0 ? (
        <Vazio>Ninguém na equipe ainda.</Vazio>
      ) : (
        <section aria-label="A equipe" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {equipe.map((p, i) => {
            const st = presenca(p.vistoEm, agora);
            const onde = st.estado === "online" ? rotuloDaTela(p.ondeEsta, nomeDaEmpresa) : null;
            const minhas = metas.filter((m) => m.usuarioId === p.id);
            const clientes = empresas.filter((e) => e.responsavelId === p.id);
            const nota = notas.find((n) => n.sobreUsuarioId === p.id || n.autorId === p.id);
            return (
              <Entrada key={p.id} ordem={i} className="flex">
                <article className="cartao flex w-full flex-col gap-4 bg-superficie">
                  <Link href={`/admin/equipe/${p.id}`} className="group flex items-center gap-3">
                    <Avatar nome={p.nome} posicao={i} tamanho={40} />
                    <span className="min-w-0">
                      <span className="block truncate font-titulo text-[16px] font-bold group-hover:underline">{p.nome}</span>
                      <span className="flex items-center gap-1.5 text-[13px] text-suave">
                        <Ponto estado={st.estado} />
                        <span className="truncate">{onde ? onde : st.texto}</span>
                      </span>
                    </span>
                  </Link>

                  <ListaMetas metas={minhas} fracao={fracao} max={3} vazio="Sem meta neste mês." />

                  <div className="mt-auto space-y-1.5 text-[13px]">
                    <p className="text-suave">
                      {clientes.length === 0 ? (
                        <span className="text-meta">Nenhum cliente com {primeiroNome(p.nome)}</span>
                      ) : (
                        <>
                          <span className="numero text-texto">{clientes.length}</span> {clientes.length === 1 ? "cliente" : "clientes"}:{" "}
                          {clientes.slice(0, 3).map((c) => c.nome).join(", ")}
                          {clientes.length > 3 ? "…" : ""}
                        </>
                      )}
                    </p>
                    {nota && <p className="line-clamp-2 text-meta">“{nota.texto}”</p>}
                  </div>
                </article>
              </Entrada>
            );
          })}
        </section>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <section className="cartao lg:col-span-2" aria-labelledby="t-aconteceu">
          <TituloBloco acao={<span className="text-[13px] text-meta">equipe e clientes</span>}>
            <span id="t-aconteceu">O que aconteceu</span>
          </TituloBloco>
          {atividade.length === 0 ? (
            <Vazio>Nada registrado ainda. Metas, conferências e mudanças nos clientes aparecem aqui.</Vazio>
          ) : (
            <Linhas
              itens={atividade.map((a) => ({
                id: a.id,
                quem: a.quem,
                posicao: a.usuarioId && posicao.has(a.usuarioId) ? posicao.get(a.usuarioId)! : null,
                cliente: a.quem != null && !a.daEquipe,
                ator: a.ator,
                acao: a.acao,
                dados: a.dados,
                empresa: a.empresa,
                quando: quando(a.criadoEm, agora),
              }))}
            />
          )}
        </section>

        <div className="space-y-3">
          <section className="cartao" aria-labelledby="t-notas">
            <TituloBloco>
              <span id="t-notas">Anotações</span>
            </TituloBloco>
            <FormNota acao={criarNota} equipe={pessoas} empresas={empresas.map((e) => ({ id: e.id, nome: e.nome }))} />
            <ul className="mt-4 space-y-3">
              {notas.slice(0, 4).map((n) => (
                <li key={n.id} className="text-[13px]">
                  <p className="whitespace-pre-line">{n.fixada && <span className="mr-1 text-destaque-texto">●</span>}{n.texto}</p>
                  <p className="mt-0.5 text-meta">
                    {n.autor ? primeiroNome(n.autor) : "Alguém"} · {quando(n.criadoEm, agora)}
                    {n.empresa ? ` · ${n.empresa}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="cartao" aria-labelledby="t-agora">
            <TituloBloco acao={<Link href="/admin/empresas" className="text-[13px] text-suave hover:text-texto">Clientes ›</Link>}>
              <span id="t-agora">Nos clientes</span>
            </TituloBloco>
            <dl className="grid grid-cols-3 gap-3">
              <Numero rotulo="online agora" valor={onlineNosClientes} />
              <Numero rotulo="a conferir" valor={aConferir} />
              <Numero rotulo="vendido no mês" valor={formatarReais(empresas.reduce((s, e) => s + e.vendasMes, 0))} pequeno />
            </dl>
          </section>

          <section className="cartao" aria-labelledby="t-site">
            <TituloBloco acao={<span className="text-[13px] text-meta">últimos 7 dias</span>}>
              <span id="t-site">Site urutau.io</span>
            </TituloBloco>
            {site.algumDia ? (
              <>
                <dl className="grid grid-cols-3 gap-3">
                  <Numero rotulo="visitas" valor={site.visitas} />
                  <Numero rotulo="contatos" valor={site.contatos} />
                  <Numero rotulo="WhatsApp" valor={site.whatsapp} />
                </dl>
                {site.ultimos.length > 0 && (
                  <ul className="mt-4 space-y-2 text-[13px]">
                    {site.ultimos.map((c) => (
                      <li key={c.id} className="flex justify-between gap-3">
                        <span className="truncate">{c.nome ?? (c.tipo === "whatsapp" ? "Clique no WhatsApp" : "Contato")}{c.contato ? ` · ${c.contato}` : ""}</span>
                        <span className="shrink-0 text-meta">{quando(c.criadoEm, agora)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <Vazio>O site ainda não manda as visitas e os contatos para cá. Falta ligar o aviso no site.</Vazio>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, pequeno = false }: { rotulo: string; valor: number | string; pequeno?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[12px] text-meta">{rotulo}</dt>
      <dd className={`numero truncate font-bold ${pequeno ? "text-[15px] leading-7" : "text-2xl"}`}>{valor}</dd>
    </div>
  );
}
