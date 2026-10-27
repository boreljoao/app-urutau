import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoLinha, FormMeta, FormNota, Gaveta } from "@/components/central/Formularios";
import { Linhas } from "@/components/central/Linhas";
import { ListaMetas } from "@/components/central/ListaMetas";
import { Avatar, Ponto, TituloBloco, Vazio } from "@/components/central/Pecas";
import { obterDb } from "@/db";
import { PERFIS } from "@/lib/perfis";
import { fracaoDoMes, presenca, primeiroNome, quando, ritmo, rotuloDaTela } from "@/lib/central";
import { hoje, mesAtual, nomeDoMes } from "@/lib/datas";
import { formatarReais } from "@/lib/dinheiro";
import { criarMeta, criarNota, excluirNota, fixarNota } from "@/lib/servidor/acoes-central";
import { atividadeRecente, empresasDaCentral, listarEquipe, metasDoMes, notasRecentes } from "@/lib/servidor/central";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pessoa = (await listarEquipe(obterDb())).find((p) => p.id === id);
  return { title: pessoa ? primeiroNome(pessoa.nome) : "Equipe" };
}

export default async function AreaDaPessoa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = obterDb();
  const agora = new Date();
  const mes = mesAtual(agora);
  const fracao = fracaoDoMes(mes, Number(hoje(agora).slice(8, 10)));
  const equipe = await listarEquipe(db);
  const i = equipe.findIndex((p) => p.id === id);
  if (i < 0) notFound();
  const p = equipe[i];
  const [metas, clientes, todasEmpresas, notas, atividade] = await Promise.all([
    metasDoMes(db, mes, id),
    empresasDaCentral(db, mes, id),
    empresasDaCentral(db, mes),
    notasRecentes(db, { sobreUsuarioId: id, limite: 12 }),
    atividadeRecente(db, { usuarioId: id, limite: 10 }),
  ]);
  const st = presenca(p.vistoEm, agora);
  const onde = st.estado === "online" ? rotuloDaTela(p.ondeEsta, (eid) => todasEmpresas.find((e) => e.id === eid)?.nome) : null;
  const nome = primeiroNome(p.nome);
  const atrasadas = metas.filter((m) => ritmo(m, fracao) === "atras").length;
  const pessoas = equipe.map((x) => ({ id: x.id, nome: x.nome }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4">
        <Avatar nome={p.nome} posicao={i} tamanho={56} />
        <div className="min-w-0 flex-1">
          <h1 className="font-titulo text-2xl font-bold tracking-tight">{p.nome}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[15px] text-suave">
            <Ponto estado={st.estado} />
            <span>{onde ? `online, ${onde}` : st.texto}</span>
            <span className="text-meta">·</span>
            <span>
              {metas.length ? `${metas.length} ${metas.length === 1 ? "meta" : "metas"} em ${nomeDoMes(mes).split(" ")[0]}` : "sem metas neste mês"}
              {atrasadas ? `, ${atrasadas} atrás do ritmo` : ""}
            </span>
            <span className="text-meta">·</span>
            <span>{clientes.length} {clientes.length === 1 ? "cliente" : "clientes"}</span>
          </p>
        </div>
        <Gaveta rotulo={`Meta para ${nome}`} titulo={`Nova meta de ${nome}`} principal>
          <FormMeta acao={criarMeta} equipe={pessoas} pessoaId={id} />
        </Gaveta>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <section className="cartao" aria-labelledby="t-metas">
            <TituloBloco acao={<span className="text-[13px] text-meta">a marca fina é hoje no mês</span>}>
              <span id="t-metas">Metas de {nomeDoMes(mes).split(" ")[0]}</span>
            </TituloBloco>
            <ListaMetas metas={metas} fracao={fracao} vazio={`${nome} ainda não tem meta neste mês.`} editar />
          </section>

          <section className="cartao" aria-labelledby="t-clientes">
            <TituloBloco acao={<Link href="/admin/empresas" className="text-[13px] text-suave hover:text-texto">Distribuir clientes ›</Link>}>
              <span id="t-clientes">Clientes de {nome}</span>
            </TituloBloco>
            {clientes.length === 0 ? (
              <Vazio>Nenhum cliente com {nome}. Em Clientes, escolha o responsável de cada empresa.</Vazio>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left text-meta">
                  <tr>
                    <th className="pb-2 font-medium">Empresa</th>
                    <th className="pb-2 text-right font-medium">Vendido no mês</th>
                    <th className="pb-2 text-right font-medium">A conferir</th>
                    <th className="pb-2 text-right font-medium">Cliente entrou</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => (
                    <tr key={c.id} className="border-t border-superficie-2">
                      <td className="py-2.5">
                        <Link href={`/admin/empresas/${c.id}`} className="font-semibold hover:underline">{c.nome}</Link>
                        <span className="block text-meta">{PERFIS[c.perfil].nome}</span>
                      </td>
                      <td className="numero py-2.5 text-right">{formatarReais(c.vendasMes)}</td>
                      <td className="numero py-2.5 text-right">{c.aConferir || <span className="text-meta">0</span>}</td>
                      <td className="py-2.5 text-right text-suave">{c.ultimoAcesso ? quando(c.ultimoAcesso, agora) : <span className="text-meta">nunca</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-fez">
            <TituloBloco>
              <span id="t-fez">O que {nome} fez</span>
            </TituloBloco>
            {atividade.length === 0 ? (
              <Vazio>Nada registrado ainda.</Vazio>
            ) : (
              <Linhas
                itens={atividade.map((a) => ({ id: a.id, quem: a.quem, posicao: i, cliente: false, ator: a.ator, acao: a.acao, dados: a.dados, empresa: a.empresa, quando: quando(a.criadoEm, agora) }))}
              />
            )}
          </section>
        </div>

        <section className="cartao h-fit" aria-labelledby="t-notas">
          <TituloBloco>
            <span id="t-notas">Anotações na área de {nome}</span>
          </TituloBloco>
          <FormNota acao={criarNota} equipe={pessoas} sobreUsuarioId={id} empresas={clientes.map((c) => ({ id: c.id, nome: c.nome }))} />
          <ul className="mt-4 space-y-4">
            {notas.length === 0 && <li className="text-[13px] text-meta">Nenhuma anotação ainda.</li>}
            {notas.map((n) => (
              <li key={n.id} className="text-[13px]">
                <p className="whitespace-pre-line">{n.fixada && <span className="mr-1 text-destaque-texto">●</span>}{n.texto}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-meta">
                  <span>{n.autor ? primeiroNome(n.autor) : "Alguém"} · {quando(n.criadoEm, agora)}{n.empresa ? ` · ${n.empresa}` : ""}</span>
                  <BotaoLinha acao={fixarNota.bind(null, n.id, !n.fixada)} rotulo={n.fixada ? "Desafixar" : "Fixar"} />
                  <BotaoLinha acao={excluirNota.bind(null, n.id)} rotulo="Excluir" confirmar="Excluir esta anotação?" />
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
