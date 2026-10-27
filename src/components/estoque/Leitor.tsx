"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Leitura de código de barras pela câmera do celular (BarcodeDetector, no Chrome do Android e no
 * Safari recente). Leitor USB não precisa disto: ele "digita" o código e aperta Enter no campo.
 */

interface DetectorDeCodigo {
  detect(fonte: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: { new (opcoes?: { formats?: string[] }): DetectorDeCodigo; getSupportedFormats?: () => Promise<string[]> };
  }
}

export function cameraDisponivel() {
  return typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

/** Só sabe depois de montar: no servidor não há câmera, e o HTML precisa ser igual dos dois lados. */
export function useCameraDisponivel() {
  const [tem, setTem] = useState(false);
  useEffect(() => setTem(cameraDisponivel()), []);
  return tem;
}

let audio: AudioContext | null = null;

/** O bipe de caixa de supermercado, sem arquivo de som. */
export function bipe(erro = false) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = erro ? 220 : 1_760;
    o.type = erro ? "square" : "sine";
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (erro ? 0.25 : 0.09));
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (erro ? 0.25 : 0.1));
    navigator.vibrate?.(erro ? [60, 40, 60] : 30);
  } catch {
    // sem áudio (aba sem interação ainda): segue sem som
  }
}

export function LeitorCamera({ onLer, onFechar }: { onLer: (codigo: string) => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string>();
  useEffect(() => {
    let parar = false;
    let stream: MediaStream | null = null;
    let ultimo = "";
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!video.current || parar) return;
        video.current.srcObject = stream;
        await video.current.play();
        const detector = new window.BarcodeDetector!({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
        const ler = async () => {
          if (parar || !video.current) return;
          try {
            const [achado] = await detector.detect(video.current);
            if (achado?.rawValue && achado.rawValue !== ultimo) {
              ultimo = achado.rawValue;
              onLer(achado.rawValue);
              // libera o mesmo código de novo depois de 1,5 s (dois itens iguais seguidos)
              setTimeout(() => (ultimo = ""), 1_500);
            }
          } catch {
            // quadro ainda sem imagem
          }
          setTimeout(ler, 180);
        };
        ler();
      } catch {
        setErro("Não deu para abrir a câmera. Verifique a permissão do navegador.");
      }
    })();
    return () => {
      parar = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onLer]);
  return (
    <div role="dialog" aria-label="Ler código pela câmera" className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-2xl bg-black">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-destaque/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        <div aria-hidden className="pointer-events-none absolute inset-x-10 top-1/2 h-px -translate-y-1/2 bg-negativo/80" />
      </div>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-white/80">{erro ?? "Aponte para o código de barras. Cada leitura entra no carrinho com um bipe."}</p>
      <button type="button" onClick={onFechar} className="btn-principal mx-auto mt-4 w-full max-w-md">Pronto</button>
    </div>
  );
}
