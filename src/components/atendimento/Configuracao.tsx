"use client";

import { useActionState, useRef } from "react";
import { Campo, Erro } from "@/components/Campos";
import type { EstadoForm } from "@/lib/estado-form";

type AcaoForm = (e: EstadoForm, fd: FormData) => Promise<EstadoForm>;

export interface AgenteInicial {
  nome: string;
  tom: string;
  conhecimento: string;
  quandoChamarHumano: string;
  modo: "automatico" | "aprovacao" | "desligado";
  modelo: string;
}

export interface OpcaoModelo {
  id: string;
  nome: string;
  descricao: string;
  /** Estimativa do mês já formatada (IA + Meta). */
  custo: string;
}

const MODOS = [
  { id: "aprovacao", nome: "Com aprovação", desc: "O agente escreve e alguém da loja aprova antes de enviar. Bom para começar." },
  { id: "automatico", nome: "Automático", desc: "O agente responde sozinho na hora, 24 horas por dia." },
  { id: "desligado", nome: "Pausado", desc: "As mensagens chegam e ficam guardadas, mas ninguém responde automaticamente." },
] as const;

function Opcao({ nome, valor, marcado, titulo, desc, extra }: { nome: string; valor: string; marcado: boolean; titulo: string; desc: string; extra?: string }) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-xl border border-borda bg-superficie-2 p-3 has-[:checked]:border-destaque has-[:checked]:ring-2 has-[:checked]:ring-destaque/30">
      <input type="radio" name={nome} value={valor} defaultChecked={marcado} className="mt-1 accent-[var(--destaque)]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{titulo}</span>
          {extra && <span className="numero shrink-0 text-sm font-semibold">{extra}</span>}
        </span>
        <span className="block text-sm text-suave">{desc}</span>
      </span>
    </label>
  );
}

export function FormAgente({ acao, inicial, modelos, modeloDeTexto }: { acao: AcaoForm; inicial: AgenteInicial; modelos: OpcaoModelo[]; modeloDeTexto: string }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  const v = { ...inicial, ...estado.valores } as AgenteInicial;
  const conhecimento = useRef<HTMLTextAreaElement>(null);
  return (
    <form action={enviar} className="space-y-5">
      <fieldset disabled={pendente} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo rotulo="Nome do atendente" nome="nome" erro={e.nome} dica="Como ele se apresenta: Bia, Atendimento Tauá…">
            <input id="nome" name="nome" required maxLength={60} defaultValue={v.nome} className="campo" />
          </Campo>
          <Campo rotulo="Jeito de falar" nome="tom" erro={e.tom} dica="Ex.: simpático e direto, trata por você">
            <input id="tom" name="tom" maxLength={300} defaultValue={v.tom} className="campo" />
          </Campo>
        </div>
        <div>
          <div className="mb-1.5 flex items-end justify-between gap-2">
            <label htmlFor="conhecimento" className="rotulo !mb-0">O que ele precisa saber da loja</label>
            <button
              type="button"
              className="text-sm font-medium underline"
              onClick={() => {
                const el = conhecimento.current;
                if (el && (!el.value.trim() || window.confirm("Trocar o texto atual pelo modelo?"))) el.value = modeloDeTexto;
              }}
            >
              Usar um modelo
            </button>
          </div>
          <textarea
            ref={conhecimento}
            id="conhecimento"
            name="conhecimento"
            rows={12}
            maxLength={20000}
            defaultValue={v.conhecimento}
            className="campo font-mono text-sm leading-relaxed"
            placeholder="Produtos e preços, horários, endereço, entrega, formas de pagamento, trocas…"
          />
          <p className="mt-1 text-xs text-suave">É a única fonte do agente: o que não estiver aqui, ele não inventa — chama alguém da loja.</p>
          <Erro msg={e.conhecimento} />
        </div>
        <Campo rotulo="Quando chamar alguém da loja" nome="quandoChamarHumano" erro={e.quandoChamarHumano}>
          <textarea
            id="quandoChamarHumano"
            name="quandoChamarHumano"
            rows={3}
            maxLength={2000}
            defaultValue={v.quandoChamarHumano}
            className="campo"
            placeholder="Ex.: reclamação, troca, pedido acima de R$ 500, cliente pedindo desconto"
          />
        </Campo>
        <fieldset className="space-y-2">
          <legend className="rotulo">Como ele responde</legend>
          {MODOS.map((m) => (
            <Opcao key={m.id} nome="modo" valor={m.id} marcado={v.modo === m.id} titulo={m.nome} desc={m.desc} />
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="rotulo">Inteligência (custo estimado para 300 conversas no mês)</legend>
          {modelos.map((m) => (
            <Opcao key={m.id} nome="modelo" valor={m.id} marcado={v.modelo === m.id} titulo={m.nome} desc={m.descricao} extra={m.custo} />
          ))}
        </fieldset>
        <Erro msg={e._} />
        {estado.ok && <p role="status" className="text-sm font-medium text-positivo">{estado.ok}</p>}
        <button className="btn-principal w-full">{pendente ? "Salvando…" : "Salvar atendente"}</button>
      </fieldset>
    </form>
  );
}

export function FormConexao({ acao, phoneNumberId, temToken }: { acao: AcaoForm; phoneNumberId: string; temToken: boolean }) {
  const [estado, enviar, pendente] = useActionState(acao, {});
  const e = estado.erros ?? {};
  return (
    <form action={enviar} className="space-y-4" autoComplete="off">
      <fieldset disabled={pendente} className="space-y-4">
        <Campo rotulo="Phone number ID" nome="phoneNumberId" erro={e.phoneNumberId} dica="No painel da Meta: WhatsApp › Configuração da API.">
          <input id="phoneNumberId" name="phoneNumberId" inputMode="numeric" defaultValue={estado.valores?.phoneNumberId ?? phoneNumberId} className="campo" />
        </Campo>
        <Campo
          rotulo={temToken ? "Novo token de acesso (deixe vazio para manter)" : "Token de acesso permanente"}
          nome="token"
          erro={e.token}
          dica="Token de um usuário do sistema da Meta. Fica cifrado no banco e nunca aparece de novo."
        >
          <input id="token" name="token" type="password" autoComplete="new-password" spellCheck={false} className="campo" />
        </Campo>
        <Erro msg={e._} />
        {estado.ok && <p role="status" className="text-sm font-medium text-positivo">{estado.ok}</p>}
        <button className="btn-principal w-full">{pendente ? "Testando com a Meta…" : temToken ? "Atualizar conexão" : "Conectar e testar"}</button>
      </fieldset>
    </form>
  );
}
