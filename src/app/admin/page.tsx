import Link from "next/link";
import { FormAfazer } from "@/components/central/Afazeres";
import { Entrada } from "@/components/central/BarraMeta";
import { FormMeta, FormNota, Gaveta } from "@/components/central/Formularios";
import { GraficoMovimento } from "@/components/central/GraficoMovimento";
import { Linhas } from "@/components/central/Linhas";
import { ListaAfazeres, ListaAtencao } from "@/components/central/Listas";
import { ListaMetas } from "@/components/central/ListaMetas";
import { Avatar, Ponto, TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { fracaoDoMes, montarAtencao, presenca, primeiroNome, quando, ritmo, rotuloDaTela, variacao } from "@/lib/central";
import { hoje, mesAtual, nomeDoMes, somarMeses } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { criarAfazer, criarMeta, criarNota } from "@/lib/servidor/acoes-central";
import {
  afazeresFeitosDesde,
  atividadeRecente,
  contatosRecentesDoSite,
  empresasDaCentral,
  listarAfazeres,
  listarEquipe,
  metasDoMes,
  movimentoDiario,
  notasRecentes,
  pessoasOnlineNasEmpresas,
  resumoDoSite,
} from "@/lib/servidor/central";

export const metadata = { title: "Visão geral" };
export const dynamic = "force-dynamic";

const SEMANA_MS = 7 * 86_400_000;

export default async function VisaoGeral() {
  const db = obterDb();
  const agora = new Date();
  const hojeData = hoje(agora);
  const mes = mesAtual(agora);
  const diaDeHoje = Number(hojeData.slice(8, 10));
  const fracao = fracaoDoMes(mes, diaDeHoje);
  const nomeMes = nomeDoMes(mes).split(" ")[0];
  const nomeMesAnterior = nomeDoMes(somarMeses(mes, -1)).split(" ")[0];
  const [equipe, metas, empresas, notas, atividade, onlineNosClientes, site, movimento, abertas, feitas7, contatos] = await Promise.all([
    listarEquipe(db),
    metasDoMes(db, mes),
    empresasDaCentral(db, mes, undefined, hojeData),
    notasRecentes(db, { limite: 6 }),
    atividadeRecente(db, { limite: 10 }),
    pessoasOnlineNasEmpresas(db, agora),
    resumoDoSite(db, 7, agora),
    movimentoDiario(db, mes, hojeData),
    listarAfazeres(db),
    afazeresFeitosDesde(db, 7, agora),
    contatosRecentesDoSite(db, 48, agora),
  ]);
  const nomeDaEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome;
  const posicao = new Map(equipe.map((p, i) => [p.id, i]));
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));
  const opcoesEmpresas = empresas.map((e) => ({ id: e.id, nome: e.nome }));

  const atrasadas = abertas.filter((a) => a.prazo && a.prazo < hojeData);
  const atencao = montarAtencao({
    agora,
    hoje: hojeData,
    empresas,
    afazeresAtrasados: atrasadas.map((a) => ({ id: a.id, titulo: a.titulo, prazo: a.prazo!, responsavel: a.responsavel })),
    contatosSite: contatos,
    senhasProvisorias: equipe.filter((p) => p.senhaProvisoria),
  });

  const online = equipe.filter((p) => presenca(p.vistoEm, agora).estado === "online");
  const ritmos = metas.map((m) => ritmo(m, fracao));
  const batidas = ritmos.filter((r) => r === "batida").length;
  const metasAtras = ritmos.filter((r) => r === "atras").length;
  const vendido = empresas.reduce((s, e) => s + e.vendasMes, 0);
  const vendidoAntes = empresas.reduce((s, e) => s + e.vendasMesAnterior, 0);
  const delta = variacao(vendido, vendidoAntes);
  const ativos = empresas.filter((e) => e.ultimoAcesso && agora.getTime() - e.ultimoAcesso.getTime() < SEMANA_MS).length;
  const urgentes = atencao.filter((i) => i.nivel === "alto").length;

  const achado = [
    online.length ? `${online.map((p) => primeiroNome(p.nome)).join(" e ")} ${online.length === 1 ? "está" : "estão"} online` : "Ninguém da equipe online agora",
    urgentes ? `${urgentes} ${urgentes === 1 ? "coisa urgente" : "coisas urgentes"} na fila` : "nada urgente na fila",
    delta != null ? `clientes vendendo ${Math.abs(delta)}% ${delta >= 0 ? "a mais" : "a menos"} que em ${nomeMesAnterior}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-3">
        <div className="min-w-0">
          <h1 className="font-titulo text-2xl font-bold tracking-tight first-letter:uppercase">{nomeMes} na Urutau</h1>
          <p className="mt-1 text-[15px] text-suave">{achado.join(" · ")}.</p>
        </div>
        <div className="flex gap-2">
          <Gaveta rotulo="Nova tarefa" titulo="Nova tarefa">
            <FormAfazer acao={criarAfazer} equipe={pessoas} empresas={opcoesEmpresas} />
          </Gaveta>
          <Gaveta rotulo="Nova meta" titulo="Nova meta do mês" principal>
            <FormMeta acao={criarMeta} equipe={pessoas} />
          </Gaveta>
        </div>
      </header>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <section className="cartao lg:col-span-2" aria-labelledby="t-mes">
          <h2 id="t-mes" className="sr-only">Números do mês</h2>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1fr]">
            <Numero
              rotulo={`Vendido pelos clientes`}
              valor={formatarReais(vendido)}
              linha={delta == null ? `sem vendas em ${nomeMesAnterior} para comparar` : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}% sobre 1 a ${diaDeHoje} de ${nomeMesAnterior}`}
              tom={delta == null ? undefined : delta >= 0 ? "positivo" : "negativo"}
              largo
            />
            <Numero rotulo="Clientes ativos" valor={`${ativos} de ${empresas.length}`} linha="entraram no app em 7 dias" />
            <Numero rotulo="Metas batidas" valor={`${batidas} de ${metas.length}`} linha={metas.length ? `${metasAtras} atrás do ritmo` : "nenhuma meta no mês"} />
            <Numero rotulo="Tarefas abertas" valor={String(abertas.length)} linha={`${atrasadas.length} ${atrasadas.length === 1 ? "atrasada" : "atrasadas"} · ${feitas7} ${feitas7 === 1 ? "feita" : "feitas"} em 7 dias`} tom={atrasadas.length ? "negativo" : undefined} />
            <Numero rotulo="Contatos do site" valor={String(site.contatos + site.whatsapp)} linha={`${site.visitas} visitas em 7 dias`} />
          </dl>
          <div className="mt-5">
            <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-semibold">Vendas dos clientes por dia</span>
              <span className="flex items-center gap-3 text-meta">
                <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-destaque" />{nomeMes}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-3 border-t border-dashed border-[var(--texto-meta)]" />{nomeMesAnterior}</span>
              </span>
            </p>
            <GraficoMovimento dados={movimento} nomes={[nomeMes, nomeMesAnterior]} />
          </div>
        </section>

        <section id="atencao" className="cartao" aria-labelledby="t-atencao">
          <TituloBloco acao={<span className="numero text-[13px] text-meta">{atencao.length}</span>}>
            <span id="t-atencao">Precisa de atenção</span>
          </TituloBloco>
          <ListaAtencao itens={atencao} max={7} />
        </section>
      </div>

      {equipe.length === 0 ? (
        <Vazio>Ninguém na equipe ainda.</Vazio>
      ) : (
        <section aria-label="A equipe" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {equipe.map((p, i) => {
            const st = presenca(p.vistoEm, agora);
            const onde = st.estado === "online" ? rotuloDaTela(p.ondeEsta, nomeDaEmpresa) : null;
            const minhas = metas.filter((m) => m.usuarioId === p.id);
            const clientes = empresas.filter((e) => e.responsavelId === p.id);
            const tarefas = abertas.filter((a) => a.responsavelId === p.id);
            const vencidas = tarefas.filter((a) => a.prazo && a.prazo < hojeData).length;
            const nota = notas.find((n) => n.sobreUsuarioId === p.id || n.autorId === p.id);
            return (
              <Entrada key={p.id} ordem={i} className="flex">
                <article className="cartao flex w-full flex-col gap-4">
                  <Link href={`/admin/equipe/${p.id}`} className="group flex items-center gap-3">
                    <Avatar nome={p.nome} posicao={i} tamanho={40} />
                    <span className="min-w-0">
                      <span className="block truncate font-titulo text-[16px] font-bold group-hover:underline">{p.nome}</span>
                      <span className="flex items-center gap-1.5 text-[13px] text-suave">
                        <Ponto estado={st.estado} />
                        <span className="truncate">{onde ?? st.texto}</span>
                      </span>
                    </span>
                  </Link>
                  <ListaMetas metas={minhas} fracao={fracao} max={3} vazio="Sem meta neste mês." />
                  <div className="mt-auto space-y-1.5 text-[13px]">
                    <p className="text-suave">
                      <span className="numero text-texto">{tarefas.length}</span> {tarefas.length === 1 ? "tarefa aberta" : "tarefas abertas"}
                      {vencidas ? <span className="text-negativo"> · {vencidas} {vencidas === 1 ? "atrasada" : "atrasadas"}</span> : null}
                    </p>
                    <p className="text-suave">
                      {clientes.length === 0 ? (
                        <span className="text-meta">Nenhum cliente com {primeiroNome(p.nome)}</span>
                      ) : (
                        <>
                          <span className="numero text-texto">{clientes.length}</span> {clientes.length === 1 ? "cliente" : "clientes"} ·{" "}
                          <span className="numero">{formatarReais(clientes.reduce((s, c) => s + c.vendasMes, 0))}</span> vendidos
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
        <section id="afazeres" className="cartao" aria-labelledby="t-afazeres">
          <TituloBloco acao={<span className="text-[13px] text-meta">{feitas7} feitas em 7 dias</span>}>
            <span id="t-afazeres">Tarefas da equipe</span>
          </TituloBloco>
          <FormAfazer acao={criarAfazer} equipe={pessoas} empresas={opcoesEmpresas} />
          <div className="mt-4">
            <ListaAfazeres itens={abertas.slice(0, 10)} hoje={hojeData} posicao={posicao} vazio="Nenhuma tarefa aberta." />
            {abertas.length > 10 && <p className="mt-2 text-[12px] text-meta">e mais {abertas.length - 10} na área de cada pessoa</p>}
          </div>
        </section>

        <section className="cartao" aria-labelledby="t-aconteceu">
          <TituloBloco acao={<span className="text-[13px] text-meta">{onlineNosClientes} {onlineNosClientes === 1 ? "cliente online" : "clientes online"}</span>}>
            <span id="t-aconteceu">O que aconteceu</span>
          </TituloBloco>
          {atividade.length === 0 ? (
            <Vazio>Nada registrado ainda. Metas, tarefas, conferências e mudanças nos clientes aparecem aqui.</Vazio>
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
            <FormNota acao={criarNota} equipe={pessoas} empresas={opcoesEmpresas} />
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

          <section id="site" className="cartao" aria-labelledby="t-site">
            <TituloBloco acao={<span className="text-[13px] text-meta">últimos 7 dias</span>}>
              <span id="t-site">Site urutau.io</span>
            </TituloBloco>
            {site.algumDia ? (
              <>
                <dl className="grid grid-cols-3 gap-3">
                  <Numero rotulo="visitas" valor={String(site.visitas)} />
                  <Numero rotulo="contatos" valor={String(site.contatos)} />
                  <Numero rotulo="WhatsApp" valor={String(site.whatsapp)} />
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

function Numero({ rotulo, valor, linha, tom, largo = false }: { rotulo: string; valor: string; linha?: string; tom?: "positivo" | "negativo"; largo?: boolean }) {
  return (
    <div className={`min-w-0 ${largo ? "col-span-2 sm:col-span-1" : ""}`}>
      <dt className="text-[12px] leading-4 text-meta">{rotulo}</dt>
      <dd className="numero mt-0.5 whitespace-nowrap text-[22px] font-bold leading-8">{valor}</dd>
      {linha && <dd className={`text-[12px] leading-4 ${tom === "positivo" ? "text-positivo" : tom === "negativo" ? "text-negativo" : "text-suave"}`}>{linha}</dd>}
    </div>
  );
}
