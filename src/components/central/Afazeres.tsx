"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { Erro } from "@/components/Campos";
import type { EstadoForm } from "@/lib/estado-form";

type Acao = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;
type Opcao = { id: string; nome: string };

/** Caixinha de concluir: marca na hora e o servidor confirma em seguida. */
export function CaixaFeito({ acao, feito, titulo, desabilitado = false }: { acao: (feito: boolean) => Promise<void>; feito: boolean; titulo: string; desabilitado?: boolean }) {
  const [pendente, iniciar] = useTransition();
  return (
    <input
      type="checkbox"
      defaultChecked={feito}
      disabled={pendente || desabilitado}
      title={desabilitado ? "Só quem é dono da tarefa (ou um sócio) pode marcar" : undefined}
      aria-label={feito ? `Reabrir: ${titulo}` : `Concluir: ${titulo}`}
      onChange={(e) => {
        const marcado = e.target.checked;
        iniciar(() => acao(marcado));
      }}
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--destaque)] disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/** Tarefa nova em uma linha: o que, de quem, de qual cliente e até quando. */
export function FormAfazer({ acao, equipe, empresas, responsavelId, empresaId }: { acao: Acao; equipe: Opcao[]; empresas: Opcao[]; responsavelId?: string; empresaId?: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const campo = ref.current?.querySelector<HTMLInputElement>("input[name=titulo]");
    if (estado.ok && campo) campo.value = "";
  }, [estado]);
  const v = estado.valores ?? {};
  return (
    <form ref={ref} action={enviar} className="space-y-2">
      <input name="titulo" required maxLength={140} aria-label="Tarefa" placeholder="Nova tarefa…" className="campo" />
      <div className="flex flex-wrap items-center gap-2">
        {responsavelId ? (
          <input type="hidden" name="responsavelId" value={responsavelId} />
        ) : (
          <select name="responsavelId" aria-label="De quem" defaultValue={v.responsavelId ?? ""} className="campo !min-h-8 !w-auto !py-1 text-[13px]">
            <option value="">Sem dono</option>
            {equipe.map((p) => (
              <option key={p.id} value={p.id}>{p.nome.split(" ")[0]}</option>
            ))}
          </select>
        )}
        {empresaId ? (
          <input type="hidden" name="empresaId" value={empresaId} />
        ) : (
          empresas.length > 0 && (
            <select name="empresaId" aria-label="Cliente" defaultValue={v.empresaId ?? ""} className="campo !min-h-8 !w-auto max-w-40 !py-1 text-[13px]">
              <option value="">Sem cliente</option>
              {empresas.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          )
        )}
        <input type="date" name="prazo" aria-label="Prazo" className="campo !min-h-8 !w-auto !py-1 text-[13px]" />
        <button className="btn-central ml-auto !min-h-8" disabled={pendente}>{pendente ? "…" : "Criar"}</button>
      </div>
      <Erro msg={estado.erros?.titulo ?? estado.erros?.prazo} />
    </form>
  );
}
