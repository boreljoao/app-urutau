"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { EtapaLead } from "@/db/schema";

export interface PontoMapa {
  id: string;
  nome: string;
  etapa: EtapaLead;
  categoria: string | null;
  telefone: string | null;
  nota: number | null;
  latitude: number | null;
  longitude: number | null;
}

/** Cor do ponto pela etapa: cinza ainda não trabalhado, amarelo em conversa, verde fechou, vermelho apagado perdeu. */
const COR: Record<EtapaLead, string> = {
  novo: "#8c91a6",
  contatado: "#f5c518",
  diagnostico: "#f5c518",
  proposta: "#f5c518",
  negociacao: "#f5c518",
  ganho: "#6ee7a8",
  perdido: "#ff8a80",
};

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Mapa dos leads com coordenadas (OpenStreetMap, sem chave de API; escurecido no CSS da Central).
 * Cada ponto abre um balão com o nome e o link para o lead.
 */
export function MapaLeads({ pontos, altura = 420, nomesEtapa }: { pontos: PontoMapa[]; altura?: number; nomesEtapa: Record<EtapaLead, string> }) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let mapa: import("leaflet").Map | undefined;
    let cancelado = false;
    import("leaflet").then((L) => {
      if (cancelado || !caixa.current) return;
      mapa = L.map(caixa.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(mapa);
      const comCoord = pontos.filter((p) => p.latitude != null && p.longitude != null);
      for (const p of comCoord) {
        L.circleMarker([p.latitude!, p.longitude!], { radius: 6, color: "#0b0f1d", weight: 1.5, fillColor: COR[p.etapa], fillOpacity: p.etapa === "perdido" ? 0.5 : 0.95 })
          .bindPopup(
            `<strong>${escapar(p.nome)}</strong><br>${escapar(p.categoria ?? "")}${p.nota != null ? ` · ★ ${p.nota.toLocaleString("pt-BR")}` : ""}<br>${escapar(nomesEtapa[p.etapa])}${p.telefone ? ` · ${escapar(p.telefone)}` : ""}<br><a href="/admin/comercial/leads/${p.id}">Abrir lead ›</a>`,
          )
          .addTo(mapa);
      }
      if (comCoord.length) mapa.fitBounds(L.latLngBounds(comCoord.map((p) => [p.latitude!, p.longitude!] as [number, number])).pad(0.15), { maxZoom: 14 });
      else mapa.setView([-22.92, -42.82], 11); // Maricá, RJ
    });
    return () => {
      cancelado = true;
      mapa?.remove();
    };
  }, [pontos, nomesEtapa]);
  return <div ref={caixa} className="mapa-central w-full overflow-hidden rounded-lg" style={{ height: altura }} role="region" aria-label="Mapa dos leads" />;
}
