"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Campo, Erro } from "@/components/Campos";
import type { EstadoForm } from "@/lib/estado-form";

/** Formulários da Central Urutau. As ações chegam prontas do servidor (server actions). */

type Acao = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;
type Pessoa = { id: string; nome: string };

function Ok({ estado }: { estado: EstadoForm }) {
  return (
    <>
      <Erro msg={estado.erros?._} />
      {estado.ok && (
        <p role="status" className="text-[13px] text-positivo">
          {estado.ok}
        </p>
      )}
    </>
  );
}

/** Botão que abre um formulário num diálogo nativo (Esc fecha, foco preso dentro). */
export function Gaveta({ rotulo, titulo, children, principal = false }: { rotulo: string; titulo: string; children: React.ReactNode; principal?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={principal ? "btn-central" : "btn-leve"} onClick={() => ref.current?.showModal()}>
        {rotulo}
      </button>
      <dialog ref={ref} className="central m-auto w-[min(440px,calc(100vw-32px))] rounded-2xl bg-superficie p-0 text-texto">
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-titulo text-lg font-bold">{titulo}</h2>
            <button type="button" aria-label="Fechar" className="btn-leve !min-h-8 !px-3" onClick={() => ref.current?.close()}>
              ✕
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}

export function FormMeta({ acao, equipe, pessoaId }: { acao: Acao; equipe: Pessoa[]; pessoaId?: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const [tipo, setTipo] = useState("quantidade");
  const e = estado.erros ?? {};
  const v = estado.valores ?? {};
  return (
    <form action={enviar} className="space-y-3">
      <Campo rotulo="De quem" nome="usuarioId" erro={e.usuarioId}>
        <select id="usuarioId" name="usuarioId" defaultValue={v.usuarioId ?? pessoaId ?? ""} required className="campo">
          <option value="" disabled>Escolha</option>
          {equipe.map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Meta" nome="titulo" erro={e.titulo} dica="Ex.: Fechar 3 clientes novos, Postar 12 vezes">
        <input id="titulo" name="titulo" required maxLength={80} defaultValue={v.titulo} className="campo" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Medida" nome="tipo">
          <select id="tipo" name="tipo" value={tipo} onChange={(ev) => setTipo(ev.target.value)} className="campo">
            <option value="quantidade">Quantidade</option>
            <option value="valor">Dinheiro (R$)</option>
          </select>
        </Campo>
        <Campo rotulo="Alvo do mês" nome="alvo" erro={e.alvo}>
          <input id="alvo" name="alvo" required inputMode="decimal" placeholder={tipo === "valor" ? "10.000,00" : "3"} defaultValue={v.alvo} className="campo numero" />
        </Campo>
      </div>
      <Ok estado={estado} />
      <button className="btn-central w-full" disabled={pendente}>{pendente ? "Salvando…" : "Criar meta"}</button>
    </form>
  );
}

/** "+ quanto avançou" na linha da meta. Um valor com "-" na frente corrige para baixo. */
export function FormAvanco({ acao, valor }: { acao: Acao; valor: boolean }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) ref.current?.reset();
  }, [estado]);
  return (
    <form ref={ref} action={enviar} className="flex items-center gap-2">
      <input
        name="quanto"
        aria-label="Quanto avançou"
        required
        inputMode="decimal"
        placeholder={valor ? "+ R$" : "+ 1"}
        aria-invalid={!!estado.erros?.quanto}
        className="campo numero !min-h-8 w-24 !py-1"
      />
      <button className="btn-leve !min-h-8" disabled={pendente}>{pendente ? "…" : "Somar"}</button>
      {estado.erros?.quanto && <span role="alert" className="text-[12px] text-negativo">{estado.erros.quanto}</span>}
    </form>
  );
}

export function FormNota({ acao, equipe, sobreUsuarioId, empresas = [], empresaId }: { acao: Acao; equipe: Pessoa[]; sobreUsuarioId?: string; empresas?: Pessoa[]; empresaId?: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) ref.current?.reset();
  }, [estado]);
  return (
    <form ref={ref} action={enviar} className="space-y-2">
      <label className="sr-only" htmlFor={`texto-${sobreUsuarioId ?? empresaId ?? "geral"}`}>Anotação</label>
      <textarea
        id={`texto-${sobreUsuarioId ?? empresaId ?? "geral"}`}
        name="texto"
        required
        maxLength={2000}
        rows={2}
        placeholder="Anotar algo para a equipe…"
        className="campo resize-y"
      />
      <div className="flex flex-wrap items-center gap-2">
        {sobreUsuarioId ? (
          <input type="hidden" name="sobreUsuarioId" value={sobreUsuarioId} />
        ) : (
          <select name="sobreUsuarioId" aria-label="Na área de" defaultValue="" className="campo !min-h-8 !w-auto !py-1 text-[13px]">
            <option value="">Para todos</option>
            {equipe.map((p) => (
              <option key={p.id} value={p.id}>Área de {p.nome.split(" ")[0]}</option>
            ))}
          </select>
        )}
        {empresaId && <input type="hidden" name="empresaId" value={empresaId} />}
        {!empresaId && empresas.length > 0 && (
          <select name="empresaId" aria-label="Sobre o cliente" defaultValue="" className="campo !min-h-8 !w-auto !py-1 text-[13px]">
            <option value="">Sem cliente</option>
            {empresas.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-[13px] text-suave">
          <input type="checkbox" name="fixada" className="h-4 w-4 accent-[var(--texto)]" /> Fixar
        </label>
        <button className="btn-central ml-auto !min-h-8" disabled={pendente}>{pendente ? "…" : "Anotar"}</button>
      </div>
      <Erro msg={estado.erros?.texto} />
    </form>
  );
}

/** Botãozinho de linha (fixar, excluir) que chama uma ação sem formulário. */
export function BotaoLinha({ acao, rotulo, confirmar }: { acao: () => Promise<void>; rotulo: string; confirmar?: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendente}
      onClick={() => {
        if (confirmar && !window.confirm(confirmar)) return;
        iniciar(() => acao());
      }}
      className="text-[12px] text-meta underline-offset-2 hover:text-texto hover:underline disabled:opacity-50"
    >
      {pendente ? "…" : rotulo}
    </button>
  );
}

export function FormPessoaEquipe({ acao }: { acao: Acao }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const v = estado.valores ?? {};
  return (
    <form action={enviar} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome" nome="nome" erro={e.nome}>
          <input id="nome" name="nome" required defaultValue={v.nome} className="campo" />
        </Campo>
        <Campo rotulo="E-mail de login" nome="email" erro={e.email}>
          <input id="email" name="email" type="email" required defaultValue={v.email} className="campo" />
        </Campo>
      </div>
      <Erro msg={e._} />
      {estado.ok && (
        <p role="status" className="select-all rounded-lg bg-aviso-fundo p-3 text-[13px]">
          {estado.ok}
        </p>
      )}
      <button className="btn-central" disabled={pendente}>{pendente ? "Criando…" : "Pôr na equipe"}</button>
    </form>
  );
}

export function FormResponsavel({ acao, equipe, atual, empresa }: { acao: (fd: FormData) => Promise<void>; equipe: Pessoa[]; atual: string | null; empresa: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <select
      aria-label={`Responsável por ${empresa}`}
      defaultValue={atual ?? ""}
      disabled={pendente}
      onChange={(ev) => {
        const fd = new FormData();
        fd.set("responsavelId", ev.target.value);
        iniciar(() => acao(fd));
      }}
      className="campo !min-h-8 !w-auto !py-1 text-[13px]"
    >
      <option value="">Ninguém</option>
      {equipe.map((p) => (
        <option key={p.id} value={p.id}>{p.nome.split(" ")[0]}</option>
      ))}
    </select>
  );
}

export function FormDadosConta({ acao, nome, email }: { acao: Acao; nome: string; email: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  return (
    <form action={enviar} className="space-y-3">
      <Campo rotulo="Nome" nome="nome" erro={e.nome}>
        <input id="nome" name="nome" required defaultValue={estado.valores?.nome ?? nome} className="campo" />
      </Campo>
      <Campo rotulo="E-mail de login" nome="email" erro={e.email}>
        <input id="email" name="email" type="email" required defaultValue={estado.valores?.email ?? email} className="campo" />
      </Campo>
      <Ok estado={estado} />
      <button className="btn-leve" disabled={pendente}>{pendente ? "Salvando…" : "Salvar dados"}</button>
    </form>
  );
}

export function FormSenha({ acao }: { acao: Acao }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  return (
    <form action={enviar} className="space-y-3">
      <Campo rotulo="Senha atual" nome="atual" erro={e.atual}>
        <input id="atual" name="atual" type="password" autoComplete="current-password" required className="campo" />
      </Campo>
      <Campo rotulo="Senha nova" nome="nova" erro={e.nova} dica="Pelo menos 8 caracteres">
        <input id="nova" name="nova" type="password" autoComplete="new-password" required minLength={8} className="campo" />
      </Campo>
      <Campo rotulo="Repita a senha nova" nome="repetir" erro={e.repetir}>
        <input id="repetir" name="repetir" type="password" autoComplete="new-password" required className="campo" />
      </Campo>
      <Ok estado={estado} />
      <button className="btn-central" disabled={pendente}>{pendente ? "Trocando…" : "Trocar senha"}</button>
    </form>
  );
}

/** Sócio ou equipe, trocado direto na lista (só os sócios veem este seletor). */
export function SeletorPapel({ acao, atual, nome }: { acao: (fd: FormData) => Promise<void>; atual: "socio" | "equipe"; nome: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <select
      aria-label={`Papel de ${nome}`}
      defaultValue={atual}
      disabled={pendente}
      onChange={(ev) => {
        const fd = new FormData();
        fd.set("papel", ev.target.value);
        iniciar(() => acao(fd));
      }}
      className="campo !min-h-8 !w-auto !py-1 text-[13px]"
    >
      <option value="socio">Sócio</option>
      <option value="equipe">Equipe</option>
    </select>
  );
}
