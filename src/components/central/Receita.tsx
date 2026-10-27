"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { Campo, Erro } from "@/components/Campos";
import type { EstadoForm } from "@/lib/estado-form";

/** Formulários e controles da Receita e dos Clientes da Urutau. */

type Acao = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;
type Opcao = { id: string; nome: string };
type Servico = { id: string; nome: string };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
/** "1.234,56" → reais (número) só para a prévia na tela; o servidor relê com precisão. */
function reais(txt: string): number {
  const s = txt.replace(/[R$\s]/g, "");
  if (!s) return 0;
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function Abas({ abas }: { abas: { href: string; rotulo: string; exato?: boolean }[] }) {
  const caminho = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {abas.map((a) => {
        const ativo = a.exato ? caminho === a.href : caminho.startsWith(a.href);
        return (
          <Link
            key={a.href}
            href={a.href}
            aria-current={ativo ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${ativo ? "bg-superficie-2 text-texto" : "text-suave hover:text-texto"}`}
          >
            {a.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}

export interface LinhaServico {
  servico: string;
  descricao: string;
  recorrencia: "mensal" | "unico";
  valor: string;
  custo: string;
  executorId: string;
  abriuMao: boolean;
  inicio: string;
}

const linhaVazia = (servico = "trafego"): LinhaServico => ({ servico, descricao: "", recorrencia: "mensal", valor: "", custo: "", executorId: "", abriuMao: false, inicio: "" });

/**
 * As linhas de serviço do contrato. Mostra na hora o total por mês, o valor por dia (âncora)
 * e quanto cada pessoa leva pela regra atual. Vai para o servidor num campo `itens` (JSON).
 */
export function LinhasDeServico({
  servicos,
  equipe,
  socios,
  regras,
  trouxePcm,
  quemTrouxe,
  inicial,
  mostrarInicio = false,
}: {
  servicos: Servico[];
  equipe: Opcao[];
  socios: string[];
  regras: Record<string, number>;
  trouxePcm: number;
  quemTrouxe?: string;
  inicial?: LinhaServico[];
  mostrarInicio?: boolean;
}) {
  const [linhas, setLinhas] = useState<LinhaServico[]>(inicial?.length ? inicial : [linhaVazia()]);
  const mudar = (i: number, campo: Partial<LinhaServico>) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...campo } : l)));
  const mensal = linhas.filter((l) => l.recorrencia === "mensal").reduce((s, l) => s + reais(l.valor), 0);
  const unico = linhas.filter((l) => l.recorrencia === "unico").reduce((s, l) => s + reais(l.valor), 0);
  const custo = linhas.reduce((s, l) => s + reais(l.custo), 0);
  return (
    <div className="space-y-3">
      <input type="hidden" name="itens" value={JSON.stringify(linhas)} />
      {linhas.map((l, i) => {
        const pcm = l.executorId ? (regras[l.servico] ?? 0) : 0;
        const socio = socios.includes(l.executorId);
        return (
          <fieldset key={i} className="space-y-2 rounded-xl bg-superficie-2/60 p-3">
            <legend className="sr-only">Serviço {i + 1}</legend>
            <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr]">
              <select aria-label="Serviço" value={l.servico} onChange={(e) => mudar(i, { servico: e.target.value })} className="campo">
                {servicos.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
              <select aria-label="Cobrança" value={l.recorrencia} onChange={(e) => mudar(i, { recorrencia: e.target.value as "mensal" | "unico" })} className="campo">
                <option value="mensal">Por mês</option>
                <option value="unico">Projeto único</option>
              </select>
              <input aria-label="Valor" inputMode="decimal" placeholder="Valor R$" value={l.valor} onChange={(e) => mudar(i, { valor: e.target.value })} className="campo numero" />
              <input aria-label="Custo para a Urutau" inputMode="decimal" placeholder="Nosso custo R$" value={l.custo} onChange={(e) => mudar(i, { custo: e.target.value })} className="campo numero" />
            </div>
            <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr]">
              <input aria-label="Descrição" placeholder="O que entra (ex.: 12 reels/mês, gestão Meta Ads)" value={l.descricao} onChange={(e) => mudar(i, { descricao: e.target.value })} className="campo" />
              <select aria-label="Quem executa" value={l.executorId} onChange={(e) => mudar(i, { executorId: e.target.value, abriuMao: false })} className="campo">
                <option value="">Executor: ninguém (fica no bolo)</option>
                {equipe.map((p) => (
                  <option key={p.id} value={p.id}>Executa: {p.nome}</option>
                ))}
              </select>
              {mostrarInicio ? (
                <input aria-label="Começa em" type="month" value={l.inicio} onChange={(e) => mudar(i, { inicio: e.target.value })} className="campo" />
              ) : (
                <span />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-meta">
              {l.executorId ? (
                <span>
                  Executor leva {(l.abriuMao ? 0 : pcm / 1000).toLocaleString("pt-BR")}%
                  {reais(l.valor) && !l.abriuMao ? ` = ${brl.format((reais(l.valor) * pcm) / 100_000)}${l.recorrencia === "mensal" ? "/mês" : ""}` : ""}
                  {quemTrouxe && quemTrouxe === l.executorId ? ` + ${trouxePcm / 1000}% por ter trazido` : ""}
                </span>
              ) : (
                <span>Sem executor: a parte de execução fica no bolo</span>
              )}
              {socio && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={l.abriuMao} onChange={(e) => mudar(i, { abriuMao: e.target.checked })} className="h-4 w-4 accent-[var(--texto)]" />
                  abrir mão da comissão de execução
                </label>
              )}
              {linhas.length > 1 && (
                <button type="button" onClick={() => setLinhas((ls) => ls.filter((_, j) => j !== i))} className="ml-auto text-meta hover:text-negativo">
                  Remover
                </button>
              )}
            </div>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setLinhas((ls) => [...ls, linhaVazia("post")])} className="btn-leve">+ Outro serviço</button>
        <p className="numero text-[13px] text-suave">
          {mensal > 0 && (
            <>
              <span className="text-texto">{brl.format(mensal)}/mês</span> · {brl.format(mensal / 30)}/dia
            </>
          )}
          {unico > 0 && <> {mensal > 0 ? "+" : ""} {brl.format(unico)} de projeto</>}
          {custo > 0 && <span className="text-meta"> · custo {brl.format(custo)}</span>}
        </p>
      </div>
    </div>
  );
}

function CamposContrato({ e, v }: { e: Record<string, string>; v: Record<string, string | undefined> }) {
  const [multa, setMulta] = useState(v.multaTipo ?? "nenhuma");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Campo rotulo="Primeiro mês cobrado" nome="inicio" erro={e.inicio}>
        <input id="inicio" name="inicio" type="month" required defaultValue={v.inicio} className="campo" />
      </Campo>
      <Campo rotulo="Duração (meses)" nome="meses" erro={e.meses} dica="Vazio = sem prazo">
        <input id="meses" name="meses" inputMode="numeric" defaultValue={v.meses} placeholder="12" className="campo numero" />
      </Campo>
      <Campo rotulo="Dia do vencimento" nome="diaVencimento" erro={e.diaVencimento}>
        <input id="diaVencimento" name="diaVencimento" type="number" min={1} max={28} defaultValue={v.diaVencimento ?? "10"} className="campo numero" />
      </Campo>
      <Campo rotulo="Desconto (%)" nome="desconto" erro={e.desconto}>
        <input id="desconto" name="desconto" inputMode="decimal" defaultValue={v.desconto} placeholder="0" className="campo numero" />
      </Campo>
      <Campo rotulo="Desconto nos primeiros (meses)" nome="descontoMeses" erro={e.descontoMeses} dica="Vazio = o contrato todo">
        <input id="descontoMeses" name="descontoMeses" inputMode="numeric" defaultValue={v.descontoMeses} className="campo numero" />
      </Campo>
      <Campo rotulo="Multa de rescisão" nome="multaTipo">
        <select id="multaTipo" name="multaTipo" value={multa} onChange={(ev) => setMulta(ev.target.value)} className="campo">
          <option value="nenhuma">Sem multa</option>
          <option value="valor">Valor fixo (R$)</option>
          <option value="percentual_restante">% do que falta do contrato</option>
        </select>
      </Campo>
      {multa !== "nenhuma" && (
        <Campo rotulo={multa === "valor" ? "Multa (R$)" : "Multa (% do restante)"} nome="multaValor" erro={e.multaValor}>
          <input id="multaValor" name="multaValor" inputMode="decimal" defaultValue={v.multaValor} className="campo numero" />
        </Campo>
      )}
    </div>
  );
}

export interface DadosFormCliente {
  servicos: Servico[];
  equipe: Opcao[];
  socios: string[];
  empresas: Opcao[];
  regras: Record<string, number>;
  trouxePcm: number;
}

/** Cadastro completo do cliente da Urutau: dados, contrato e serviços, numa tela só. */
export function FormClienteUrutau({ acao, dados, inicial = {}, leadId, servicosIniciais }: { acao: Acao; dados: DadosFormCliente; inicial?: Record<string, string>; leadId?: string; servicosIniciais?: LinhaServico[] }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const v = { ...inicial, ...(estado.valores ?? {}) };
  const [quemTrouxe, setQuemTrouxe] = useState(v.quemTrouxeId ?? "");
  return (
    <form action={enviar} className="space-y-6">
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      <section className="cartao space-y-3" aria-labelledby="t-cli">
        <h2 id="t-cli" className="font-titulo text-[15px] font-bold">Cliente</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Nome do cliente / empresa" nome="nome" erro={e.nome}>
            <input id="nome" name="nome" required defaultValue={v.nome} className="campo" />
          </Campo>
          <Campo rotulo="Pessoa de contato" nome="contato">
            <input id="contato" name="contato" defaultValue={v.contato} className="campo" />
          </Campo>
          <Campo rotulo="Ramo" nome="ramo">
            <input id="ramo" name="ramo" defaultValue={v.ramo} placeholder="Ex.: clínica, provedor, loja" className="campo" />
          </Campo>
          <Campo rotulo="Telefone / WhatsApp" nome="telefone">
            <input id="telefone" name="telefone" inputMode="tel" defaultValue={v.telefone} className="campo" />
          </Campo>
          <Campo rotulo="E-mail" nome="email" erro={e.email}>
            <input id="email" name="email" type="email" defaultValue={v.email} className="campo" />
          </Campo>
          <Campo rotulo="CPF / CNPJ" nome="documento">
            <input id="documento" name="documento" defaultValue={v.documento} className="campo" />
          </Campo>
          <Campo rotulo="Cidade" nome="cidade">
            <input id="cidade" name="cidade" defaultValue={v.cidade} className="campo" />
          </Campo>
          <Campo rotulo="Quem trouxe" nome="quemTrouxeId" dica={`Leva ${dados.trouxePcm / 1000}% de tudo que o cliente pagar. Ninguém = fica no bolo.`}>
            <select id="quemTrouxeId" name="quemTrouxeId" value={quemTrouxe} onChange={(ev) => setQuemTrouxe(ev.target.value)} className="campo">
              <option value="">Ninguém (veio sozinho)</option>
              {dados.equipe.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Usa o sistema como" nome="empresaId" erro={e.empresaId} dica="Liga às vendas dele no app">
            <select id="empresaId" name="empresaId" defaultValue={v.empresaId ?? ""} className="campo">
              <option value="">Não usa o sistema</option>
              {dados.empresas.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Faturamento mensal dele (se não usa o sistema)" nome="faturamentoInformado" erro={e.faturamentoInformado}>
            <input id="faturamentoInformado" name="faturamentoInformado" inputMode="decimal" placeholder="R$" defaultValue={v.faturamentoInformado} className="campo numero" />
          </Campo>
        </div>
        <Campo rotulo="Observação" nome="observacao">
          <textarea id="observacao" name="observacao" rows={2} defaultValue={v.observacao} className="campo" />
        </Campo>
      </section>

      <section className="cartao space-y-3" aria-labelledby="t-contrato">
        <h2 id="t-contrato" className="font-titulo text-[15px] font-bold">Contrato</h2>
        <CamposContrato e={e} v={v} />
      </section>

      <section className="cartao space-y-3" aria-labelledby="t-servicos">
        <h2 id="t-servicos" className="font-titulo text-[15px] font-bold">O que a Urutau faz para ele</h2>
        <LinhasDeServico servicos={dados.servicos} equipe={dados.equipe} socios={dados.socios} regras={dados.regras} trouxePcm={dados.trouxePcm} quemTrouxe={quemTrouxe} inicial={servicosIniciais} mostrarInicio />
      </section>

      <Erro msg={e._} />
      <button className="btn-central" disabled={pendente}>{pendente ? "Salvando…" : "Cadastrar cliente"}</button>
    </form>
  );
}

/** Dados do cliente (sem contrato), para editar depois. */
export function FormDadosClienteUrutau({ acao, dados, inicial }: { acao: Acao; dados: DadosFormCliente; inicial: Record<string, string> }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const v = { ...inicial, ...(estado.valores ?? {}) };
  return (
    <form action={enviar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome" nome="nome" erro={e.nome}>
          <input id="nome" name="nome" required defaultValue={v.nome} className="campo" />
        </Campo>
        <Campo rotulo="Contato" nome="contato">
          <input id="contato" name="contato" defaultValue={v.contato} className="campo" />
        </Campo>
        <Campo rotulo="Telefone" nome="telefone">
          <input id="telefone" name="telefone" defaultValue={v.telefone} className="campo" />
        </Campo>
        <Campo rotulo="E-mail" nome="email" erro={e.email}>
          <input id="email" name="email" type="email" defaultValue={v.email} className="campo" />
        </Campo>
        <Campo rotulo="Ramo" nome="ramo">
          <input id="ramo" name="ramo" defaultValue={v.ramo} className="campo" />
        </Campo>
        <Campo rotulo="Cidade" nome="cidade">
          <input id="cidade" name="cidade" defaultValue={v.cidade} className="campo" />
        </Campo>
        <Campo rotulo="CPF / CNPJ" nome="documento">
          <input id="documento" name="documento" defaultValue={v.documento} className="campo" />
        </Campo>
        <Campo rotulo="Quem trouxe" nome="quemTrouxeId" dica="Muda só as comissões de pagamentos futuros">
          <select id="quemTrouxeId" name="quemTrouxeId" defaultValue={v.quemTrouxeId ?? ""} className="campo">
            <option value="">Ninguém (veio sozinho)</option>
            {dados.equipe.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Usa o sistema como" nome="empresaId" erro={e.empresaId}>
          <select id="empresaId" name="empresaId" defaultValue={v.empresaId ?? ""} className="campo">
            <option value="">Não usa o sistema</option>
            {dados.empresas.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Faturamento mensal dele" nome="faturamentoInformado" erro={e.faturamentoInformado}>
          <input id="faturamentoInformado" name="faturamentoInformado" inputMode="decimal" defaultValue={v.faturamentoInformado} className="campo numero" />
        </Campo>
      </div>
      <Campo rotulo="Observação" nome="observacao">
        <textarea id="observacao" name="observacao" rows={2} defaultValue={v.observacao} className="campo" />
      </Campo>
      <Erro msg={e._} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
      <button className="btn-central" disabled={pendente}>{pendente ? "Salvando…" : "Salvar"}</button>
    </form>
  );
}

/** Novo contrato (renovação) ou serviço a mais num contrato existente. */
export function FormContratoOuServico({ acao, dados, quemTrouxe, comContrato }: { acao: Acao; dados: DadosFormCliente; quemTrouxe?: string; comContrato: boolean }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const [chave, setChave] = useState(0);
  // Limpa as linhas só depois de salvar; com erro, o que foi digitado fica.
  useEffect(() => {
    if (estado.ok) setChave((k) => k + 1);
  }, [estado]);
  const e = estado.erros ?? {};
  return (
    <form action={enviar} className="space-y-3">
      {comContrato && <CamposContrato e={e} v={estado.valores ?? {}} />}
      <LinhasDeServico key={chave} servicos={dados.servicos} equipe={dados.equipe} socios={dados.socios} regras={dados.regras} trouxePcm={dados.trouxePcm} quemTrouxe={quemTrouxe} mostrarInicio />
      <Erro msg={e._} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
      <button className="btn-central" disabled={pendente}>{pendente ? "Salvando…" : comContrato ? "Criar contrato" : "Acrescentar"}</button>
    </form>
  );
}

/** "Pagou": data e, se for parcial, quanto. */
export function FormPagamento({ acao, valor, hoje }: { acao: Acao; valor: string; hoje: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  if (estado.ok) return <span className="text-[12px] text-positivo">pago ✓</span>;
  return (
    <form action={enviar} className="flex flex-wrap items-center justify-end gap-1.5">
      <input name="pagoEm" type="date" required defaultValue={hoje} aria-label="Data do pagamento" className="campo !min-h-7 !w-auto !py-0.5 text-[12px]" />
      <input name="valor" inputMode="decimal" placeholder={valor} aria-label="Valor pago (vazio = total)" className="campo numero !min-h-7 !w-24 !py-0.5 text-[12px]" />
      <button className="btn-central !min-h-7 !px-3 !text-[12px]" disabled={pendente}>{pendente ? "…" : "Pagou"}</button>
      {(e._ || e.valor || e.pagoEm) && <span role="alert" className="w-full text-right text-[12px] text-negativo">{e._ ?? e.valor ?? e.pagoEm}</span>}
    </form>
  );
}

/** Botão que chama uma ação e mostra o erro dela, se houver. */
export function BotaoComErro({ acao, rotulo, confirmar }: { acao: () => Promise<{ erro?: string } | void>; rotulo: string; confirmar?: string }) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string>();
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pendente}
        onClick={() => {
          if (confirmar && !window.confirm(confirmar)) return;
          iniciar(async () => {
            const r = await acao();
            setErro(r && "erro" in r ? r.erro : undefined);
          });
        }}
        className="text-[12px] text-meta underline-offset-2 hover:text-texto hover:underline disabled:opacity-50"
      >
        {pendente ? "…" : rotulo}
      </button>
      {erro && <span role="alert" className="max-w-56 text-right text-[12px] text-negativo">{erro}</span>}
    </span>
  );
}

/** Mês + botão (encerrar serviço, encerrar custo): um formulário pequeno. */
export function FormMes({ acao, nome, rotulo, padrao, confirmar }: { acao: (fd: FormData) => Promise<void>; nome: string; rotulo: string; padrao: string; confirmar?: string }) {
  const [aberto, setAberto] = useState(false);
  const [pendente, iniciar] = useTransition();
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className="text-[12px] text-meta underline-offset-2 hover:text-texto hover:underline">
        {rotulo}
      </button>
    );
  return (
    <form
      action={(fd) => {
        if (confirmar && !window.confirm(confirmar)) return;
        iniciar(async () => {
          await acao(fd);
          setAberto(false);
        });
      }}
      className="flex items-center gap-1.5"
    >
      <input name={nome} type="month" required defaultValue={padrao} aria-label="Último mês" className="campo !min-h-7 !w-auto !py-0.5 text-[12px]" />
      <button className="btn-leve !min-h-7 !px-3 !text-[12px]" disabled={pendente}>{pendente ? "…" : "Ok"}</button>
    </form>
  );
}

export function FormEncerrarContrato({ acao, padrao }: { acao: Acao; padrao: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  return (
    <form action={enviar} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[12px] text-meta">
          Último mês cobrado
          <input name="ultimoMes" type="month" required defaultValue={padrao} className="campo mt-1" />
        </label>
        <label className="text-[12px] text-meta">
          Como acabou
          <select name="status" defaultValue="cancelado" className="campo mt-1">
            <option value="cancelado">Cancelou antes do prazo</option>
            <option value="encerrado">Terminou o prazo</option>
          </select>
        </label>
        <label className="text-[12px] text-meta">
          Motivo
          <input name="motivo" className="campo mt-1" placeholder="Opcional" />
        </label>
      </div>
      <Erro msg={estado.erros?._ ?? estado.erros?.ultimoMes} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
      <button className="btn-leve" disabled={pendente}>{pendente ? "…" : "Encerrar contrato"}</button>
    </form>
  );
}

export function FormCusto({ acao, clientes, hojeMes }: { acao: Acao; clientes: Opcao[]; hojeMes: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const v = estado.valores ?? {};
  return (
    <form action={enviar} className="space-y-3">
      <Campo rotulo="Descrição" nome="descricao" erro={e.descricao}>
        <input id="descricao" name="descricao" required defaultValue={v.descricao} placeholder="Ex.: DAS do MEI, Canva, freelancer de edição" className="campo" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Categoria" nome="categoria">
          <select id="categoria" name="categoria" defaultValue={v.categoria ?? "ferramenta"} className="campo">
            <option value="ferramenta">Ferramenta / assinatura</option>
            <option value="freelancer">Freelancer</option>
            <option value="imposto">Imposto (DAS)</option>
            <option value="marketing">Marketing da Urutau</option>
            <option value="estrutura">Estrutura</option>
            <option value="outro">Outro</option>
          </select>
        </Campo>
        <Campo rotulo="Valor" nome="valor" erro={e.valor}>
          <input id="valor" name="valor" required inputMode="decimal" defaultValue={v.valor} placeholder="R$" className="campo numero" />
        </Campo>
        <Campo rotulo="Cobrança" nome="recorrencia">
          <select id="recorrencia" name="recorrencia" defaultValue={v.recorrencia ?? "mensal"} className="campo">
            <option value="mensal">Todo mês</option>
            <option value="unico">Uma vez</option>
          </select>
        </Campo>
        <Campo rotulo="A partir de" nome="inicio" erro={e.inicio}>
          <input id="inicio" name="inicio" type="month" required defaultValue={v.inicio ?? hojeMes} className="campo" />
        </Campo>
      </div>
      <Campo rotulo="De um cliente específico (opcional)" nome="clienteId">
        <select id="clienteId" name="clienteId" defaultValue={v.clienteId ?? ""} className="campo">
          <option value="">Da empresa toda</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </Campo>
      <Erro msg={e._ ?? e.fim} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
      <button className="btn-central" disabled={pendente}>{pendente ? "…" : "Lançar custo"}</button>
    </form>
  );
}

export function FormRegras({ acao, servicos, regras, parametros, socios }: { acao: Acao; servicos: Servico[]; regras: Record<string, number>; parametros: { trouxePcm: number; caixaPcm: number; diferencaPcm: number; socioMaiorId: string | null }; socios: Opcao[] }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const pct = (pcm: number) => (pcm / 1000).toLocaleString("pt-BR");
  const exemplo = useMemo(() => {
    const sobra = 100 - 30 - parametros.trouxePcm / 1000;
    const dif = parametros.diferencaPcm / 1000;
    return { sobra, maior: (sobra + dif) / 2, menor: (sobra - dif) / 2 };
  }, [parametros]);
  return (
    <form action={enviar} className="space-y-5">
      <section className="cartao space-y-3">
        <h2 className="font-titulo text-[15px] font-bold">Comissão de quem executa</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {servicos.map((s) => (
            <Campo key={s.id} rotulo={s.nome} nome={`regra_${s.id}`} erro={e[`regra_${s.id}`]}>
              <input id={`regra_${s.id}`} name={`regra_${s.id}`} inputMode="decimal" defaultValue={pct(regras[s.id] ?? 0)} className="campo numero" />
            </Campo>
          ))}
        </div>
      </section>
      <section className="cartao space-y-3">
        <h2 className="font-titulo text-[15px] font-bold">Divisão</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Quem trouxe o cliente (%)" nome="trouxe" erro={e.trouxe}>
            <input id="trouxe" name="trouxe" inputMode="decimal" defaultValue={pct(parametros.trouxePcm)} className="campo numero" />
          </Campo>
          <Campo rotulo="Reserva de caixa (% da receita)" nome="caixa" erro={e.caixa} dica="Sugestão, não obrigatório">
            <input id="caixa" name="caixa" inputMode="decimal" defaultValue={pct(parametros.caixaPcm)} className="campo numero" />
          </Campo>
          <Campo rotulo="Diferença entre os sócios (pontos)" nome="diferenca" erro={e.diferenca}>
            <input id="diferenca" name="diferenca" inputMode="decimal" defaultValue={pct(parametros.diferencaPcm)} className="campo numero" />
          </Campo>
          <Campo rotulo="Sócio que leva a diferença" nome="socioMaiorId" erro={e.socioMaiorId}>
            <select id="socioMaiorId" name="socioMaiorId" defaultValue={parametros.socioMaiorId ?? ""} className="campo">
              <option value="">Ainda não definido (divide igual)</option>
              {socios.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
          </Campo>
        </div>
        <p className="text-[13px] text-suave">
          Exemplo com a regra salva: site de R$ 1.000 feito por alguém da equipe, trazido por outra pessoa → sobram {exemplo.sobra.toLocaleString("pt-BR")}% →{" "}
          {exemplo.maior.toLocaleString("pt-BR")}% e {exemplo.menor.toLocaleString("pt-BR")}% para os sócios (antes de custos e caixa).
        </p>
      </section>
      <Erro msg={e._} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
      <button className="btn-central" disabled={pendente}>{pendente ? "Salvando…" : "Salvar regras"}</button>
    </form>
  );
}
