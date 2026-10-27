import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoRedefinirSenha, FormModulos, FormPessoaAdmin } from "@/components/Admin";
import { FormAfazer } from "@/components/central/Afazeres";
import { BotaoLinha, FormNota, FormResponsavel } from "@/components/central/Formularios";
import { Linhas } from "@/components/central/Linhas";
import { ListaAfazeres } from "@/components/central/Listas";
import { Ponto, TituloBloco, Vazio } from "@/components/central/Pecas";
import { GraficoMeses } from "@/components/GraficoMeses";
import { obterDb } from "@/db";
import { presenca, primeiroNome, quando, rotuloDaTela } from "@/lib/central";
import { formatarData, hoje, mesAtual, nomeDoMes } from "@/lib/datas";
import { formatarPcm, formatarReais } from "@/lib/dinheiro";
import { PERFIS } from "@/lib/perfis";
import { NOME_PAPEL } from "@/lib/permissoes";
import { ROTULO_ORIGEM_VENDA } from "@/lib/rotulos";
import { adicionarPessoaAdmin, redefinirSenhaAdmin, salvarModulos } from "@/lib/servidor/acoes-admin";
import { criarAfazer, criarNota, definirResponsavel, excluirNota, fixarNota } from "@/lib/servidor/acoes-central";
import { obterEmpresaAdmin } from "@/lib/servidor/admin";
import { atividadeRecente, detalhesDoCliente, listarAfazeres, listarEquipe, notasRecentes } from "@/lib/servidor/central";
import { contarParaConferir } from "@/lib/servidor/conferencia";
import { carregarPainel } from "@/lib/servidor/painel";

export const metadata = { title: "Cliente" };
export const dynamic = "force-dynamic";

export default async function ClienteNaCentral({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = obterDb();
  const dados = /^[0-9a-f-]{36}$/i.test(id) ? await obterEmpresaAdmin(db, id) : null;
  if (!dados) notFound();
  const { empresa, modulos } = dados;
  const agora = new Date();
  const hojeData = hoje(agora);
  const mes = mesAtual(agora);
  const [painel, detalhes, notas, tarefas, atividade, equipe, aConferir] = await Promise.all([
    carregarPainel(db, empresa, mes, hojeData),
    detalhesDoCliente(db, id),
    notasRecentes(db, { empresaId: id, limite: 10 }),
    listarAfazeres(db, { empresaId: id }),
    atividadeRecente(db, { empresaId: id, limite: 10 }),
    listarEquipe(db),
    contarParaConferir(db, id),
  ]);
  const r = painel.resumo;
  const posicao = new Map(equipe.map((p, i) => [p.id, i]));
  const pessoas = equipe.map((p) => ({ id: p.id, nome: p.nome }));
  const nomeMes = nomeDoMes(mes).split(" ")[0];
  const quemDoCliente = detalhes.membros.filter((m) => !posicao.has(m.usuarioId));
  const ultimoAcesso = quemDoCliente.map((m) => m.vistoEm).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-3">
        <div className="min-w-0">
          <p className="mb-1 text-[13px]">
            <Link href="/admin/empresas" className="text-meta hover:text-texto">‹ Clientes</Link>
          </p>
          <h1 className="font-titulo text-2xl font-bold tracking-tight">{empresa.nome}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-suave">
            <span>{PERFIS[empresa.perfil].nome}</span>
            <span className="text-meta">·</span>
            <span>{[empresa.cidade, empresa.uf].filter(Boolean).join("/") || "sem cidade"}</span>
            <span className="text-meta">·</span>
            <span>cliente desde {empresa.criadoEm.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</span>
            <span className="text-meta">·</span>
            <span>{ultimoAcesso ? `entrou no app ${quando(ultimoAcesso, agora)}` : "ainda não entrou no app"}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-meta">Responsável</span>
          <FormResponsavel acao={definirResponsavel.bind(null, empresa.id)} equipe={pessoas} atual={empresa.responsavelId} empresa={empresa.nome} />
          <Link href={`/e/${empresa.id}/ajustes`} className="btn-leve">Dados</Link>
          <Link href={`/e/${empresa.id}/painel`} className="btn-central">Abrir o app</Link>
        </div>
      </header>

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <section className="cartao" aria-labelledby="t-mes">
            <TituloBloco acao={<span className="text-[13px] text-meta">até hoje</span>}>
              <span id="t-mes">{nomeDoMes(mes).charAt(0).toUpperCase() + nomeDoMes(mes).slice(1)}</span>
            </TituloBloco>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Numero rotulo="Faturamento" valor={formatarReais(r.faturamento)} destaque />
              <Numero rotulo="Despesas" valor={formatarReais(r.despesas + r.impostos)} linha={r.impostosDisponiveis ? `${formatarReais(r.impostos)} de impostos` : undefined} />
              <Numero
                rotulo="Lucro"
                valor={formatarReais(r.lucro)}
                linha={r.margem != null ? `margem de ${formatarPcm(r.margem, 1)}` : "sem faturamento"}
                tom={r.lucro < 0 ? "negativo" : undefined}
              />
              <Numero rotulo="Caixa do mês" valor={formatarReais(r.caixa.saldo)} linha={`${formatarReais(r.caixa.entradas)} entraram`} tom={r.caixa.saldo < 0 ? "negativo" : undefined} />
              <Numero rotulo="A conferir" valor={String(aConferir)} linha={aConferir ? "vendas esperando o dono" : "tudo conferido"} tom={aConferir ? "negativo" : undefined} />
              <Numero rotulo="Clientes cadastrados" valor={String(detalhes.clientesCadastrados)} linha={painel.dividas.quantidade ? `${formatarReais(painel.dividas.saldo)} em dívidas` : "sem dívidas"} />
            </dl>
            {painel.fontes.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-[13px] font-semibold">De onde veio o dinheiro em {nomeMes}</p>
                <ul className="space-y-2">
                  {painel.fontes.map((f) => (
                    <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-[13px]">
                      <span className="truncate">{f.nome}</span>
                      <span className="numero text-suave">
                        {formatarReais(f.valor)} <span className="text-meta">· {formatarPcm(f.participacao, 0)}</span>
                      </span>
                      <span className="col-span-2 block h-1.5 rounded-full bg-superficie-2">
                        <span className="block h-1.5 rounded-full bg-destaque" style={{ width: `${f.participacao / 1000}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <GraficoMeses dados={painel.grafico} />

          <section className="cartao" aria-labelledby="t-vendas">
            <TituloBloco acao={<Link href={`/e/${empresa.id}/vendas`} className="text-[13px] text-suave hover:text-texto">Todas as vendas ›</Link>}>
              <span id="t-vendas">Últimas vendas</span>
            </TituloBloco>
            {detalhes.ultimasVendas.length === 0 ? (
              <Vazio>Nenhuma venda lançada ainda.</Vazio>
            ) : (
              <table className="w-full text-[13px]">
                <tbody>
                  {detalhes.ultimasVendas.map((v) => (
                    <tr key={v.id} className="border-t border-superficie-2 first:border-0">
                      <td className="w-16 py-2.5 text-meta">{formatarData(v.data).slice(0, 5)}</td>
                      <td className="py-2.5 pr-3">
                        <span className="block truncate">{v.descricao || v.fonte}</span>
                        <span className="text-meta">
                          {v.fonte} · {ROTULO_ORIGEM_VENDA[v.origem]}
                          {!v.conferidoEm && <span className="text-negativo"> · a conferir</span>}
                        </span>
                      </td>
                      <td className="numero py-2.5 text-right">{formatarReais(v.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="cartao" aria-labelledby="t-aconteceu">
            <TituloBloco>
              <span id="t-aconteceu">O que aconteceu em {empresa.nome}</span>
            </TituloBloco>
            {atividade.length === 0 ? (
              <Vazio>Nada registrado ainda.</Vazio>
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
                  empresa: null,
                  quando: quando(a.criadoEm, agora),
                }))}
              />
            )}
          </section>
        </div>

        <div className="space-y-3">
          <section className="cartao" aria-labelledby="t-pessoas">
            <TituloBloco>
              <span id="t-pessoas">Quem usa o app</span>
            </TituloBloco>
            {quemDoCliente.length === 0 ? (
              <Vazio>Ninguém do cliente tem acesso ainda.</Vazio>
            ) : (
              <ul className="space-y-3">
                {quemDoCliente.map((m) => {
                  const st = presenca(m.vistoEm, agora);
                  const onde = st.estado === "online" ? rotuloDaTela(m.ondeEsta, () => empresa.nome) : null;
                  return (
                    <li key={m.usuarioId} className="text-[13px]">
                      <p className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-semibold">{m.nome}</span>
                        <span className="shrink-0 text-meta">{NOME_PAPEL[m.papel]}</span>
                      </p>
                      <p className="flex items-center gap-1.5 text-suave">
                        <Ponto estado={st.estado} /> <span className="truncate">{onde ?? st.texto}</span>
                      </p>
                      <p className="truncate text-meta">{m.email}</p>
                      <BotaoRedefinirSenha acao={redefinirSenhaAdmin.bind(null, empresa.id, m.usuarioId)} nome={m.nome} />
                    </li>
                  );
                })}
              </ul>
            )}
            <details className="mt-4">
              <summary className="cursor-pointer text-[13px] font-semibold text-suave hover:text-texto">+ Dar acesso a alguém</summary>
              <div className="mt-3">
                <FormPessoaAdmin acao={adicionarPessoaAdmin.bind(null, empresa.id)} />
              </div>
            </details>
          </section>

          <section className="cartao" aria-labelledby="t-tarefas">
            <TituloBloco>
              <span id="t-tarefas">Tarefas deste cliente</span>
            </TituloBloco>
            <FormAfazer acao={criarAfazer} equipe={pessoas} empresas={[]} empresaId={empresa.id} />
            <div className="mt-4">
              <ListaAfazeres itens={tarefas} hoje={hojeData} posicao={posicao} vazio="Nenhuma tarefa aberta para este cliente." />
            </div>
          </section>

          <section className="cartao" aria-labelledby="t-notas">
            <TituloBloco>
              <span id="t-notas">Anotações</span>
            </TituloBloco>
            <FormNota acao={criarNota} equipe={pessoas} empresaId={empresa.id} />
            <ul className="mt-4 space-y-4">
              {notas.length === 0 && <li className="text-[13px] text-meta">Nenhuma anotação sobre {empresa.nome}.</li>}
              {notas.map((n) => (
                <li key={n.id} className="text-[13px]">
                  <p className="whitespace-pre-line">{n.fixada && <span className="mr-1 text-destaque-texto">●</span>}{n.texto}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-meta">
                    <span>{n.autor ? primeiroNome(n.autor) : "Alguém"} · {quando(n.criadoEm, agora)}</span>
                    <BotaoLinha acao={fixarNota.bind(null, n.id, !n.fixada)} rotulo={n.fixada ? "Desafixar" : "Fixar"} />
                    <BotaoLinha acao={excluirNota.bind(null, n.id)} rotulo="Excluir" confirmar="Excluir esta anotação?" />
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="cartao" aria-labelledby="t-modulos">
            <TituloBloco>
              <span id="t-modulos">Módulos ligados</span>
            </TituloBloco>
            <FormModulos acao={salvarModulos.bind(null, empresa.id)} ligados={[...modulos]} />
          </section>
        </div>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, linha, tom, destaque = false }: { rotulo: string; valor: string; linha?: string; tom?: "negativo"; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[12px] text-meta">{rotulo}</dt>
      <dd className={`numero mt-0.5 truncate text-[22px] font-bold leading-8 ${destaque ? "text-destaque-texto" : tom === "negativo" ? "text-negativo" : ""}`}>{valor}</dd>
      {linha && <dd className="truncate text-[12px] text-suave">{linha}</dd>}
    </div>
  );
}
