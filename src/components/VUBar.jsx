import { useState, useEffect, useRef } from "react";

export default function VUBar({
  engine,
  side,
  direction = "vertical",
  headroom = 1.6,
}) {
  // arriba con otros hooks
  const peakRef = useRef(0);
  const peakTimeRef = useRef(0);
  const [peak, setPeak] = useState(0);

  // parámetros del peak (ajústalos a tu gusto)
  const peakHoldMs = 280; // tiempo que “se queda” en el pico
  const peakDecayPerSec = 0.9; // cuánto baja por segundo tras el hold (0.9 ≈ rápido)
  const attackAlpha = 0.7; // subida
  const releaseAlpha = 0.7; // bajada

  const [lvl, setLvl] = useState(0);
  const smoothRef = useRef(0); // valor suavizado para “balística”

  useEffect(() => {
    let timer;

    const tick = () => {
      if (!engine) return;

      const rmsA = engine.getRMS("A") || 0;
      const rmsB = engine.getRMS("B") || 0;

      const raw =
        side === "Both"
          ? Math.sqrt((rmsA * rmsA + rmsB * rmsB) / 2)
          : side === "A"
          ? rmsA
          : rmsB;

      const next = Math.min(1, raw);

      // suavizado tipo VU (ataque vs release)
      const smooth = smoothRef.current;
      const alpha = next > smooth ? attackAlpha : releaseAlpha;
      const newLvl = smooth + (next - smooth) * alpha;
      smoothRef.current = newLvl;
      setLvl(newLvl);

      // ---- Peak hold + decay rápido y realista
      const now = performance.now();

      // si alcanzamos nuevo pico (con pequeño margen), fijamos y reiniciamos hold
      if (newLvl >= peakRef.current - 0.002) {
        peakRef.current = newLvl;
        peakTimeRef.current = now;
      } else {
        // si pasó el hold, empezamos a decaer rápido
        const since = now - peakTimeRef.current;
        if (since > peakHoldMs) {
          const dt = (since - peakHoldMs) / 1000; // segundos desde fin del hold
          const dec = peakDecayPerSec * dt;
          const nextPeak = Math.max(newLvl, peakRef.current - dec);
          peakRef.current = nextPeak;
        }
      }
      setPeak(peakRef.current);
    };

    timer = setInterval(tick, 33); // ~30 fps
    return () => clearInterval(timer);
  }, [engine, side]);

  const HEADROOM = headroom; // ya lo usas
  const pct = Math.max(0, Math.min(100, lvl * 100 * HEADROOM));
  const peakPct = Math.max(0, Math.min(100, peak * 100 * HEADROOM));

  return direction === "vertical" ? (
    <div className="relative w-3 bg-neutral-800 rounded overflow-hidden">
      {/* barra verde */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-emerald-400 transition-[height] duration-50 ease-out"
        style={{ height: `${pct}%` }}
      />
      {/* línea de peak (roja) */}
      {peakPct > 1 && (
        <div
          className="absolute left-0 right-0"
          style={{
            bottom: `${peakPct}%`,
            height: "2px",
            background: "rgba(239, 68, 68, 0.95)", // red-500
          }}
        />
      )}
    </div>
  ) : (
    /* horizontal abajo */
    <div className="relative h-3 bg-neutral-800 rounded overflow-hidden">
      {/* barra verde */}
      <div
        className="absolute top-0 bottom-0 left-0 bg-emerald-400 transition-[width] duration-50 ease-out"
        style={{ width: `${pct}%` }}
      />
      {/* línea de peak (roja) */}
      {peakPct > 1 && (
        <div
          className="absolute top-0 bottom-0"
          style={{
            left: `${peakPct}%`,
            width: "2px",
            background: "rgba(239, 68, 68, 0.95)",
          }}
        />
      )}
    </div>
  );
}
