import { memo, useEffect, useRef } from "react";
import { useI18n } from "../i18n/context";

// Panel de beat-match: las dos ondas alrededor de su playhead (línea central).
// Con los BPM igualados y los beats alineados, las marcas rojas coinciden.
const WINDOW_SECONDS = 4;

function BeatMatchPanel({ analysis, audioElsRef }) {
  const { t } = useI18n();
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let frameId;

    const laneColors = { A: "#22d3ee", B: "#e879f9" };

    const drawLane = (side, y0, laneH, w) => {
      const data = analysis?.[side];
      const el = audioElsRef?.current?.[side];
      const dur = el?.duration || 0;

      if (!data?.waveData?.length || !dur) {
        ctx.fillStyle = "rgba(163,163,163,0.35)";
        ctx.font = "10px sans-serif";
        ctx.fillText(t("deckNoTrack", { side }), 6, y0 + laneH / 2 + 3);
        return;
      }

      const cur = el.currentTime || 0;
      const tStart = cur - WINDOW_SECONDS / 2;
      const tEnd = cur + WINDOW_SECONDS / 2;
      const wave = data.waveData;
      const len = wave.length;

      ctx.fillStyle = laneColors[side];
      for (let x = 0; x < w; x++) {
        const t = tStart + ((tEnd - tStart) * x) / w;
        if (t < 0 || t > dur) continue;
        const idx = Math.min(len - 1, Math.floor((t / dur) * len));
        const v = wave[idx] || 0;
        const hh = Math.max(1, v * laneH);
        ctx.fillRect(x, y0 + (laneH - hh) / 2, 1, hh);
      }

      // Beats de la ventana
      if (data.beats?.length) {
        ctx.strokeStyle = "rgba(239,68,68,0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const t of data.beats) {
          if (t < tStart || t > tEnd) continue;
          const x = ((t - tStart) / (tEnd - tStart)) * w;
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y0 + laneH);
        }
        ctx.stroke();
      }
    };

    let lastDraw = 0;
    const drawFrame = (now) => {
      // ~30 fps y nada si la pestaña está oculta: ahorra CPU
      if (document.hidden || now - lastDraw < 33) {
        frameId = requestAnimationFrame(drawFrame);
        return;
      }
      lastDraw = now;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width || 300);
      const h = Math.max(1, rect.height || 72);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, w, h);

      const laneH = h / 2 - 4;
      drawLane("A", 2, laneH, w);
      drawLane("B", h / 2 + 2, laneH, w);

      // Línea central = playhead de ambos decks
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(w / 2 - 1, 0, 2, h);

      frameId = requestAnimationFrame(drawFrame);
    };

    frameId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(frameId);
  }, [analysis, audioElsRef, t]);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-3 shadow-xl">
      <div className="text-xs text-neutral-400 mb-1" title={t("beatMatchTitle")}>
        {t("beatMatch")}
      </div>
      <canvas ref={canvasRef} className="w-full h-20 bg-neutral-800 rounded-lg" />
    </div>
  );
}

export default memo(BeatMatchPanel);
