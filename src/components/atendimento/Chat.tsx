"use client";

import { useActionState, useEffect, useOptimistic, useRef } from "react";
import { Erro } from "@/components/Campos";
import type { EstadoForm } from "@/lib/estado-form";
import { Bolhas, type MensagemNaTela } from "./Bolhas";

type AcaoForm = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;

/** Ctrl/⌘ + Enter envia; Enter sozinho quebra a linha (no celular o teclado não tem atalho). */
function enviarComAtalho(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
}

/** Mantém o fim da conversa à vista quando chega mensagem nova. */
export function RolarParaFim({ marca }: { marca: string | number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [marca]);
  return <div ref={ref} aria-hidden />;
}

export function Responder({ acao, aviso, placeholder = "Escreva para o cliente" }: { acao: AcaoForm; aviso?: string; placeholder?: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);
  return (
    <form ref={form} action={enviar} className="rounded-2xl border border-borda bg-superficie p-2 shadow-lg">
      {aviso && <p className="px-2 pb-2 text-xs text-suave">{aviso}</p>}
      <div className="flex items-end gap-2">
        <label htmlFor="texto" className="sr-only">Mensagem</label>
        <textarea
          id="texto"
          name="texto"
          rows={2}
          required
          maxLength={4000}
          defaultValue={estado.valores?.texto}
          placeholder={placeholder}
          onKeyDown={enviarComAtalho}
          className="min-h-12 flex-1 resize-none rounded-xl bg-superficie-2 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-destaque/40"
        />
        <button className="btn-principal !min-h-12 !px-4" disabled={pendente} aria-label="Enviar">
          {pendente ? "…" : "Enviar"}
        </button>
      </div>
      <Erro msg={estado.erros?.texto ?? estado.erros?._} />
    </form>
  );
}

/** Modo aprovação: o agente escreveu, alguém da loja revisa, edita se quiser e envia. */
export function Rascunho({
  texto,
  acoes,
  aprovar,
  descartar,
}: {
  texto: string;
  acoes: { nome: string; resumo: string }[];
  aprovar: AcaoForm;
  descartar: () => Promise<void>;
}) {
  const [estado, enviar, pendente] = useActionState(aprovar, {});
  return (
    <form action={enviar} className="aviso space-y-2 !p-3">
      <p className="text-sm font-semibold">O agente sugeriu esta resposta</p>
      {acoes.length > 0 && <p className="text-xs text-suave">{acoes.map((a) => a.resumo).join(" · ")}</p>}
      <label htmlFor="rascunho" className="sr-only">Resposta sugerida</label>
      <textarea id="rascunho" name="texto" rows={4} defaultValue={estado.valores?.texto ?? texto} onKeyDown={enviarComAtalho} className="campo resize-y" />
      <div className="flex gap-2">
        <button className="btn-principal flex-1" disabled={pendente}>{pendente ? "Enviando…" : "Aprovar e enviar"}</button>
        <button type="button" className="btn-secundario" disabled={pendente} onClick={() => descartar()}>Descartar</button>
      </div>
      <Erro msg={estado.erros?._} />
    </form>
  );
}

/** O simulador: escreve como cliente e vê o agente responder na hora, sem WhatsApp. */
export function ConversaDeTeste({ mensagens, acao, sugestoes }: { mensagens: MensagemNaTela[]; acao: AcaoForm; sugestoes: string[] }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const [lista, mostrar] = useOptimistic(mensagens, (atual, texto: string) => [
    ...atual,
    { id: `local-${atual.length}`, autor: "cliente" as const, texto, status: "recebida", criadoEm: new Date() },
  ]);
  const form = useRef<HTMLFormElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);
  const mandar = (fd: FormData) => {
    const texto = String(fd.get("texto") ?? "").trim();
    if (texto) mostrar(texto);
    enviar(fd);
  };
  return (
    <div className="space-y-3">
      <div className="min-h-64 rounded-2xl border border-borda bg-fundo p-3">
        {lista.length === 0 ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-suave">Escreva como se fosse um cliente chegando no WhatsApp da loja.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {sugestoes.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full border border-borda px-3 py-1.5 text-sm"
                  onClick={() => {
                    if (campo.current) campo.current.value = s;
                    form.current?.requestSubmit();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <Bolhas mensagens={lista} />
        )}
        {pendente && (
          <p className="mt-2 flex w-fit items-center gap-1 rounded-2xl rounded-br-md bg-superficie-2 px-3.5 py-2.5 text-suave" aria-live="polite">
            <span className="sr-only">O agente está escrevendo</span>
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s] motion-reduce:animate-none" />
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s] motion-reduce:animate-none" />
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none" />
          </p>
        )}
        <RolarParaFim marca={lista.length + (pendente ? 1 : 0)} />
      </div>
      <form ref={form} action={mandar} className="flex items-end gap-2">
        <label htmlFor="texto-teste" className="sr-only">Mensagem do cliente</label>
        <textarea
          ref={campo}
          id="texto-teste"
          name="texto"
          rows={2}
          required
          maxLength={2000}
          placeholder="Ex.: oi, vocês entregam hoje?"
          onKeyDown={enviarComAtalho}
          className="campo flex-1 resize-none"
        />
        <button className="btn-principal" disabled={pendente}>Enviar</button>
      </form>
      <Erro msg={estado.erros?.texto ?? estado.erros?._} />
    </div>
  );
}
