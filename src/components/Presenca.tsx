"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Avisa o servidor que esta aba está aberta (e em qual tela), a cada minuto enquanto visível. */
export function Presenca() {
  const caminho = usePathname();
  useEffect(() => {
    const avisar = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/presenca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caminho }),
        keepalive: true,
      }).catch(() => {});
    };
    avisar();
    const relogio = setInterval(avisar, 60_000);
    document.addEventListener("visibilitychange", avisar);
    return () => {
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", avisar);
    };
  }, [caminho]);
  return null;
}
