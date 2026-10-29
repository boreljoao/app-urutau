"use client";

import { useActionState, useEffect, useOptimistic, useRef } from "react";
import type { EstadoForm } from "@/lib/estado-form";
import type { MensagemNaTela } from "./Bolhas";
import { RolarParaFim } from "./Chat";

type AcaoForm = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;

const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/**
 * O simulador com a cara do WhatsApp, visto do celular do cliente: ele à direita (verde), a loja à esquerda.
 * Serve para apresentar o atendente a quem ainda não tem o número ligado.
 */
export function CelularWhatsApp({
  nomeLoja,
  mensagens,
  acao,
  sugestoes,
}: {
  nomeLoja: string;
  mensagens: MensagemNaTela[];
  acao: AcaoForm;
  sugestoes: string[];
}) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const [lista, mostrar] = useOptimistic(mensagens, (atual, texto: string) => [
    ...atual,
    { id: `local-${atual.length}`, autor: "cliente" as const, texto, status: "recebida", criadoEm: new Date() },
  ]);
  const form = useRef<HTMLFormElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (estado.ok) form.current?.reset();
  }, [estado]);
  const mandar = (fd: FormData) => {
    const texto = String(fd.get("texto") ?? "").trim();
    if (!texto) return;
    mostrar(texto);
    enviar(fd);
  };
  const visiveis = lista.filter((m) => m.status !== "rascunho" && m.autor !== "sistema");

  return (
    <div className="mx-auto flex h-[min(760px,calc(100svh-7rem))] w-full max-w-[400px] flex-col overflow-hidden rounded-[2.25rem] border-[10px] border-[#111b21] bg-[#efeae2] shadow-2xl dark:bg-[#0b141a]">
      <header className="flex items-center gap-3 bg-[#008069] px-4 py-3 text-white dark:bg-[#202c33]">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/20 font-semibold">
          {nomeLoja.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{nomeLoja}</p>
          <p className="text-xs text-white/80" aria-live="polite">{pendente ? "digitando…" : "online"}</p>
        </div>
      </header>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
        <p className="mx-auto mb-3 w-fit max-w-[90%] rounded-lg bg-[#ffeecd] px-3 py-1.5 text-center text-[12px] text-[#54656f] dark:bg-[#182229] dark:text-[#ffd279]">
          Atendimento automático 24h. Uma pessoa da equipe assume quando precisar.
        </p>
        {visiveis.length === 0 && (
          <div className="flex flex-col items-end gap-2 pt-6">
            <p className="self-center text-sm text-[#54656f] dark:text-[#8696a0]">Toque numa pergunta ou escreva como cliente</p>
            {sugestoes.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded-full border border-[#00a884] bg-white px-3 py-1.5 text-sm text-[#008069] dark:bg-[#202c33] dark:text-[#00a884]"
                onClick={() => {
                  if (campo.current) campo.current.value = s;
                  form.current?.requestSubmit();
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {visiveis.map((m) => {
          const doCliente = m.autor === "cliente";
          return (
            <div key={m.id} className={`flex ${doCliente ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[15px] leading-snug text-[#111b21] shadow-sm dark:text-[#e9edef] ${
                  doCliente ? "rounded-tr-none bg-[#d9fdd3] dark:bg-[#005c4b]" : "rounded-tl-none bg-white dark:bg-[#202c33]"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
                <span className="float-right ml-2 mt-1 flex items-center gap-1 text-[11px] text-[#667781] dark:text-[#8696a0]">
                  {hora.format(m.criadoEm)}
                  {doCliente && <span className="text-[#53bdeb]">✓✓</span>}
                </span>
              </div>
            </div>
          );
        })}
        {pendente && (
          <div className="flex w-fit items-center gap-1 rounded-lg rounded-tl-none bg-white px-3 py-3 shadow-sm dark:bg-[#202c33]">
            <span className="sr-only">O atendente está escrevendo</span>
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.3s] motion-reduce:animate-none" />
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.15s] motion-reduce:animate-none" />
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#8696a0] motion-reduce:animate-none" />
          </div>
        )}
        {(estado.erros?._ || estado.erros?.texto) && (
          <p className="mx-auto w-fit rounded-lg bg-white px-3 py-1.5 text-center text-xs text-negativo dark:bg-[#202c33]">
            {estado.erros?._ ?? estado.erros?.texto}
          </p>
        )}
        <RolarParaFim marca={visiveis.length + (pendente ? 1 : 0)} />
      </div>

      <form ref={form} action={mandar} className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2 dark:bg-[#202c33]">
        <label htmlFor="texto-celular" className="sr-only">Mensagem do cliente</label>
        <input
          ref={campo}
          id="texto-celular"
          name="texto"
          required
          maxLength={2000}
          autoComplete="off"
          placeholder="Mensagem"
          className="min-h-11 flex-1 rounded-full bg-white px-4 text-base text-[#111b21] outline-none dark:bg-[#2a3942] dark:text-[#e9edef]"
        />
        <button
          disabled={pendente}
          aria-label="Enviar"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#00a884] text-white disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
