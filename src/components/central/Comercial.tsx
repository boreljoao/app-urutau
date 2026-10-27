"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Campo, Erro } from "@/components/Campos";
import type { EtapaLead, StatusProposta } from "@/db/schema";
import type { EstadoForm } from "@/lib/estado-form";

/** Formulários e controles do Comercial da Central. */

type Acao = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;
type Opcao = { id: string; nome: string };

const ABAS = [
  { href: "/admin/comercial", rotulo: "Painel", exato: true },
  { href: "/admin/comercial/leads", rotulo: "Leads" },
  { href: "/admin/comercial/propostas", rotulo: "Propostas" },
  { href: "/admin/comercial/prospeccao", rotulo: "Prospecção" },
  { href: "/admin/comercial/chat", rotulo: "Chat do site" },
  { href: "/admin/comercial/site", rotulo: "Site" },
];

export function AbasComercial() {
  const caminho = usePathname();
  return (
    <nav aria-label="Comercial" className="flex gap-1 overflow-x-auto">
      {ABAS.map((a) => {
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

function Fichas({ nome, opcoes, marcados = [] }: { nome: string; opcoes: readonly { id: string; nome: string }[]; marcados?: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => (
        <label key={o.id} className="cursor-pointer">
          <input type="checkbox" name={nome} value={o.id} defaultChecked={marcados.includes(o.id)} className="peer sr-only" />
          <span className="inline-block rounded-full bg-superficie-2 px-3 py-1 text-[12px] text-suave transition-colors peer-checked:bg-texto peer-checked:font-semibold peer-checked:text-fundo peer-focus-visible:ring-2 peer-focus-visible:ring-texto">
            {o.nome}
          </span>
        </label>
      ))}
    </div>
  );
}

export interface ValoresLead {
  nome?: string;
  contato?: string | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  instagram?: string | null;
  categoria?: string | null;
  cidade?: string | null;
  origem?: string;
  responsavelId?: string | null;
  valorEstimado?: string;
  proximoContato?: string | null;
  observacao?: string | null;
  interesses?: string[];
}

export function FormLead({
  acao,
  equipe,
  origens,
  servicos,
  inicial = {},
  rotulo = "Criar lead",
}: {
  acao: Acao;
  equipe: Opcao[];
  origens: Opcao[];
  servicos: readonly { id: string; nome: string }[];
  inicial?: ValoresLead;
  rotulo?: string;
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const v = { ...inicial, ...(estado.valores ?? {}) } as Record<string, string | null | undefined>;
  return (
    <form action={enviar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Empresa ou nome" nome="nome" erro={e.nome}>
          <input id="nome" name="nome" required defaultValue={v.nome ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="Pessoa de contato" nome="contato">
          <input id="contato" name="contato" defaultValue={v.contato ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="Telefone / WhatsApp" nome="telefone" erro={e.telefone}>
          <input id="telefone" name="telefone" inputMode="tel" defaultValue={v.telefone ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="E-mail" nome="email" erro={e.email}>
          <input id="email" name="email" type="email" defaultValue={v.email ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="Ramo" nome="categoria">
          <input id="categoria" name="categoria" placeholder="Ex.: provedor de internet" defaultValue={v.categoria ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="Cidade" nome="cidade">
          <input id="cidade" name="cidade" defaultValue={v.cidade ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="Site" nome="site">
          <input id="site" name="site" defaultValue={v.site ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="Instagram" nome="instagram">
          <input id="instagram" name="instagram" placeholder="@" defaultValue={v.instagram ?? ""} className="campo" />
        </Campo>
        <Campo rotulo="Chegou por" nome="origem">
          <select id="origem" name="origem" defaultValue={v.origem ?? "ligacao"} className="campo">
            {origens.map((o) => (
              <option key={o.id} value={o.id}>{o.nome}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Responsável" nome="responsavelId">
          <select id="responsavelId" name="responsavelId" defaultValue={v.responsavelId ?? ""} className="campo">
            <option value="">{inicial.nome ? "Ninguém" : "Eu mesmo"}</option>
            {equipe.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Valor estimado (por mês)" nome="valorEstimado" erro={e.valorEstimado}>
          <input id="valorEstimado" name="valorEstimado" inputMode="decimal" placeholder="R$" defaultValue={v.valorEstimado ?? ""} className="campo numero" />
        </Campo>
        <Campo rotulo="Próximo contato" nome="proximoContato" erro={e.proximoContato}>
          <input id="proximoContato" name="proximoContato" type="date" defaultValue={v.proximoContato ?? ""} className="campo" />
        </Campo>
      </div>
      <div>
        <p className="rotulo">Interesse em</p>
        <Fichas nome="interesses" opcoes={servicos} marcados={inicial.interesses} />
      </div>
      <Campo rotulo="Observação" nome="observacao">
        <textarea id="observacao" name="observacao" rows={2} defaultValue={v.observacao ?? ""} className="campo" />
      </Campo>
      <Erro msg={e._} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
      <button className="btn-central" disabled={pendente}>{pendente ? "Salvando…" : rotulo}</button>
    </form>
  );
}

/** "Liguei / mandei WhatsApp / reunião": o registro do dia a dia com o lead. */
export function FormInteracao({ acao, etapas, etapaAtual }: { acao: Acao; etapas: { id: EtapaLead; nome: string }[]; etapaAtual: EtapaLead }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) ref.current?.reset();
  }, [estado]);
  const tipos = [
    { id: "ligacao", nome: "Liguei" },
    { id: "whatsapp", nome: "WhatsApp" },
    { id: "reuniao", nome: "Reunião" },
    { id: "email", nome: "E-mail" },
    { id: "visita", nome: "Visita" },
    { id: "nota", nome: "Só anotar" },
  ];
  return (
    <form ref={ref} action={enviar} className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo de contato">
        {tipos.map((t, i) => (
          <label key={t.id} className="cursor-pointer">
            <input type="radio" name="tipo" value={t.id} defaultChecked={i === 0} className="peer sr-only" />
            <span className="inline-block rounded-full bg-superficie-2 px-3 py-1 text-[12px] text-suave peer-checked:bg-texto peer-checked:font-semibold peer-checked:text-fundo peer-focus-visible:ring-2 peer-focus-visible:ring-texto">
              {t.nome}
            </span>
          </label>
        ))}
      </div>
      <label className="sr-only" htmlFor="texto-interacao">Como foi</label>
      <textarea id="texto-interacao" name="texto" rows={3} maxLength={4000} placeholder="Como foi? O que ficou combinado?" className="campo" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12px] text-meta">
          Retornar em
          <input type="date" name="proximoContato" className="campo mt-1 !min-h-8 !py-1 text-[13px]" />
        </label>
        <label className="text-[12px] text-meta">
          Mover para
          <select name="etapa" defaultValue="" className="campo mt-1 !min-h-8 !py-1 text-[13px]">
            <option value="">Continua em {etapas.find((e) => e.id === etapaAtual)?.nome}</option>
            {etapas
              .filter((e) => e.id !== etapaAtual)
              .map((e) => (
                <option key={e.id} value={e.id}>{e.nome}</option>
              ))}
          </select>
        </label>
        <button className="btn-central ml-auto" disabled={pendente}>{pendente ? "…" : "Registrar"}</button>
      </div>
      <Erro msg={estado.erros?.texto ?? estado.erros?._} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
    </form>
  );
}

/** Troca de etapa direto na lista ou no topo do lead. */
export function SeletorEtapa({ acao, atual, etapas, nome }: { acao: (fd: FormData) => Promise<void>; atual: EtapaLead; etapas: { id: EtapaLead; nome: string }[]; nome: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <select
      aria-label={`Etapa de ${nome}`}
      defaultValue={atual}
      disabled={pendente}
      onChange={(ev) => {
        const fd = new FormData();
        fd.set("etapa", ev.target.value);
        if (ev.target.value === "perdido") {
          const motivo = window.prompt("Por que perdemos este lead? (opcional)") ?? "";
          fd.set("motivo", motivo);
        }
        iniciar(() => acao(fd));
      }}
      className="campo !min-h-8 !w-auto !py-1 text-[13px]"
    >
      {etapas.map((e) => (
        <option key={e.id} value={e.id}>{e.nome}</option>
      ))}
    </select>
  );
}

export function FormProposta({ acao, servicos, leadId, leads }: { acao: Acao; servicos: readonly { id: string; nome: string }[]; leadId?: string; leads?: Opcao[] }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) ref.current?.reset();
  }, [estado]);
  const e = estado.erros ?? {};
  return (
    <form ref={ref} action={enviar} className="space-y-3">
      {leadId ? (
        <input type="hidden" name="leadId" value={leadId} />
      ) : (
        <Campo rotulo="Para qual lead" nome="leadId">
          <select id="leadId" name="leadId" defaultValue="" className="campo">
            <option value="">Sem lead</option>
            {leads?.map((l) => (
              <option key={l.id} value={l.id}>{l.nome}</option>
            ))}
          </select>
        </Campo>
      )}
      <Campo rotulo="Proposta" nome="titulo" erro={e.titulo}>
        <input id="titulo" name="titulo" required placeholder="Ex.: Site + atendente no WhatsApp" className="campo" />
      </Campo>
      <div>
        <p className="rotulo">O que entra</p>
        <Fichas nome="servicos" opcoes={servicos} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Por mês" nome="mensal" erro={e.mensal}>
          <input id="mensal" name="mensal" inputMode="decimal" placeholder="R$" className="campo numero" />
        </Campo>
        <Campo rotulo="Entrada / projeto" nome="unico" erro={e.unico}>
          <input id="unico" name="unico" inputMode="decimal" placeholder="R$" className="campo numero" />
        </Campo>
      </div>
      <Campo rotulo="Válida até" nome="validade" erro={e.validade}>
        <input id="validade" name="validade" type="date" className="campo" />
      </Campo>
      <Campo rotulo="Detalhes" nome="observacao">
        <textarea id="observacao" name="observacao" rows={2} className="campo" />
      </Campo>
      <Erro msg={e._} />
      {estado.ok && <p role="status" className="text-[13px] text-positivo">{estado.ok}</p>}
      <button className="btn-central" disabled={pendente}>{pendente ? "Salvando…" : "Criar proposta"}</button>
    </form>
  );
}

/** Os botões do próximo passo da proposta (rascunho → enviada → aceita/recusada). */
export function AcoesProposta({ acao, status }: { acao: (s: StatusProposta) => Promise<void>; status: StatusProposta }) {
  const [pendente, iniciar] = useTransition();
  const botao = (s: StatusProposta, rotulo: string, principal = false) => (
    <button type="button" disabled={pendente} onClick={() => iniciar(() => acao(s))} className={`${principal ? "btn-central" : "btn-leve"} !min-h-7 !px-3 !text-[12px]`}>
      {rotulo}
    </button>
  );
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {status === "rascunho" && botao("enviada", "Marcar enviada", true)}
      {status === "enviada" && (
        <>
          {botao("aceita", "Aceitou", true)}
          {botao("recusada", "Recusou")}
        </>
      )}
      {(status === "aceita" || status === "recusada") && botao("enviada", "Reabrir")}
    </span>
  );
}

export function FormImportar({ acao, equipe }: { acao: Acao; equipe: Opcao[] }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const [colar, setColar] = useState(false);
  const e = estado.erros ?? {};
  return (
    <form action={enviar} className="space-y-3">
      <Campo rotulo="Nome do lote" nome="lote" erro={e.lote} dica="O que foi buscado e onde: fica fácil achar depois">
        <input id="lote" name="lote" required maxLength={80} placeholder="Ex.: provedores em Niterói" defaultValue={estado.valores?.lote} className="campo" />
      </Campo>
      {colar ? (
        <Campo rotulo="Conteúdo do CSV" nome="colado" erro={e.arquivo}>
          <textarea id="colado" name="colado" rows={6} className="campo font-mono text-[12px]" placeholder="title,phone,emails,website,..." />
        </Campo>
      ) : (
        <Campo rotulo="Arquivo CSV do robô" nome="arquivo" erro={e.arquivo}>
          <input id="arquivo" name="arquivo" type="file" accept=".csv,text/csv" className="campo file:mr-3 file:rounded-full file:border-0 file:bg-texto file:px-3 file:py-1 file:text-[12px] file:font-semibold file:text-fundo" />
        </Campo>
      )}
      <button type="button" onClick={() => setColar((c) => !c)} className="text-[12px] text-meta underline-offset-2 hover:text-texto hover:underline">
        {colar ? "Escolher arquivo" : "Prefiro colar o conteúdo"}
      </button>
      <Campo rotulo="Quem vai trabalhar este lote" nome="responsavelId">
        <select id="responsavelId" name="responsavelId" defaultValue="" className="campo">
          <option value="">Ninguém por enquanto</option>
          {equipe.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
      </Campo>
      {estado.ok && <p role="status" className="rounded-lg bg-aviso-fundo p-3 text-[13px]">{estado.ok}</p>}
      <button className="btn-central" disabled={pendente}>{pendente ? "Importando…" : "Importar"}</button>
    </form>
  );
}
