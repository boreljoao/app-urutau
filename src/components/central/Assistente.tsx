"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { perguntarAoAssistenteAcao } from "@/lib/servidor/acoes-assistente";

interface Fala {
  papel: "equipe" | "assistente";
  texto: string;
  /** Erro do servidor: aparece na tela, mas não volta para a IA. */
  erro?: boolean;
}

const GUARDADO = "urutau-assistente";

/** Links do painel citados pelo assistente viram links de verdade; o resto fica como texto. */
function ComLinks({ texto }: { texto: string }) {
  const partes = texto.split(/(\/admin\/[A-Za-z0-9/_-]+)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith("/admin/") ? (
          <Link key={i} href={p} className="underline decoration-destaque underline-offset-2">
            abrir
          </Link>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function Assistente({ sugestoes }: { sugestoes: string[] }) {
  const [falas, setFalas] = useState<Fala[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, iniciar] = useTransition();
  const fim = useRef<HTMLDivElement>(null);

  // A conversa sobrevive a um recarregar, só neste navegador.
  useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(GUARDADO);
      if (salvo) setFalas(JSON.parse(salvo));
    } catch {
      // sem armazenamento: começa do zero
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(GUARDADO, JSON.stringify(falas));
    } catch {
      // ignora
    }
    fim.current?.scrollIntoView({ block: "end" });
  }, [falas]);

  const perguntar = (t: string) => {
    const pergunta = t.trim();
    if (!pergunta || pensando) return;
    const nova = [...falas, { papel: "equipe" as const, texto: pergunta }];
    setFalas(nova);
    setTexto("");
    iniciar(async () => {
      const r = await perguntarAoAssistenteAcao(nova.filter((f) => !f.erro).map(({ papel, texto }) => ({ papel, texto })));
      setFalas((atual) => [...atual, "erro" in r ? { papel: "assistente", texto: r.erro, erro: true } : { papel: "assistente", texto: r.texto }]);
    });
  };

  return (
    <div className="space-y-3">
      <div className="min-h-80 space-y-3 rounded-2xl border border-borda bg-fundo p-3 sm:p-4" aria-live="polite">
        {falas.length === 0 ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-suave">Pergunte sobre leads, o chat do site, o que os visitantes querem, ou peça uma mensagem de abordagem.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {sugestoes.map((s) => (
                <button key={s} type="button" className="rounded-full border border-borda px-3 py-1.5 text-sm hover:bg-superficie-2" onClick={() => perguntar(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          falas.map((f, i) => (
            <div key={i} className={f.papel === "equipe" ? "flex justify-end" : "flex"}>
              <p
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${
                  f.papel === "equipe" ? "rounded-br-md bg-superficie-2" : f.erro ? "rounded-bl-md border border-negativo bg-negativo-fundo" : "rounded-bl-md bg-superficie"
                }`}
              >
                {f.papel === "assistente" ? <ComLinks texto={f.texto} /> : f.texto}
              </p>
            </div>
          ))
        )}
        {pensando && (
          <p className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-superficie px-3.5 py-2.5 text-suave">
            <span className="sr-only">O assistente está pensando</span>
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s] motion-reduce:animate-none" />
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s] motion-reduce:animate-none" />
            <span aria-hidden className="h-1.5 w-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none" />
          </p>
        )}
        <div ref={fim} aria-hidden />
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          perguntar(texto);
        }}
      >
        <label htmlFor="pergunta" className="sr-only">
          Pergunta
        </label>
        <textarea
          id="pergunta"
          rows={2}
          maxLength={6000}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              perguntar(texto);
            }
          }}
          placeholder="Pergunte ao assistente (Enter envia, Shift+Enter quebra a linha)"
          className="min-h-12 flex-1 resize-none rounded-xl bg-superficie-2 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-destaque/40"
        />
        <button className="btn-principal !min-h-12 !px-4" disabled={pensando || !texto.trim()}>
          {pensando ? "…" : "Perguntar"}
        </button>
        {falas.length > 0 && (
          <button type="button" className="btn-secundario !min-h-12 !px-3 text-sm" disabled={pensando} onClick={() => setFalas([])}>
            Nova conversa
          </button>
        )}
      </form>
    </div>
  );
}
