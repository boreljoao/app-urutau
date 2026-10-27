"use client";

import { MotionConfig, motion } from "motion/react";

/**
 * Barra de uma meta. A marca fina é o "hoje": quanto do mês já passou. Barra que passa da marca
 * está no ritmo; a que fica antes está atrás. A mesma marca aparece em todas as barras da tela.
 * Com "reduzir movimento" ligado no sistema, o MotionConfig mostra a barra pronta, sem crescer.
 */
export function BarraMeta({ pct, hoje, atrasada, atraso = 0 }: { pct: number; hoje: number; atrasada: boolean; atraso?: number }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-1.5 w-full rounded-full bg-superficie-2" role="presentation">
        <motion.div
          className="absolute inset-y-0 left-0 origin-left rounded-full"
          style={{ width: `${pct}%`, background: "var(--destaque)", opacity: atrasada ? 0.55 : 1 }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, delay: 0.15 + atraso, ease: [0.22, 1, 0.36, 1] }}
        />
        <span className="absolute -inset-y-1 w-px bg-texto/70" style={{ left: `${Math.min(99.5, hoje * 100)}%` }} />
      </div>
    </MotionConfig>
  );
}

/**
 * Entrada das colunas da equipe, uma depois da outra. Em CSS (classe .entrada), e não em JavaScript:
 * se o script atrasar, a coluna aparece do mesmo jeito.
 */
export function Entrada({ children, ordem = 0, className = "" }: { children: React.ReactNode; ordem?: number; className?: string }) {
  return (
    <div className={`entrada ${className}`} style={{ animationDelay: `${ordem * 70}ms` }}>
      {children}
    </div>
  );
}
