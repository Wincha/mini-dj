import React, { useEffect, useRef } from "react";

export default function WaveformCanvas({
  waveData,
  beats,
  audioRef, // << referencia al <audio>
  zoom = 1, // factor de zoom
  scroll = 0, // 0..1
  onSeek, // callback(tSeconds) para click
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveData || !waveData.length) return;

    const ctx = canvas.getContext("2d");
    let frameId;

    const drawFrame = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width || 600);
      const h = Math.max(1, rect.height || 80);

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const total = waveData.length;
      if (!total) {
        frameId = requestAnimationFrame(drawFrame);
        return;
      }

      // Ventana visible según zoom + scroll
      const visible = Math.max(1, Math.floor(total / zoom));
      const maxStart = Math.max(0, total - visible);
      const start = maxStart > 0 ? scroll * maxStart : 0; // índice flotante
      const leftFrac = start / total;
      const rightFrac = (start + visible) / total;

      // Fondo
      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, w, h);

      // Waveform visible
      ctx.fillStyle = "#22c55e";
      const samplesPerPixel = visible / w;

      for (let x = 0; x < w; x++) {
        const idxFloat = start + x * samplesPerPixel;
        const idx = Math.floor(idxFloat);
        const v = waveData[idx] || 0;
        const y = (1 - v) * h * 0.5;
        const hh = v * h;
        ctx.fillRect(x, y, 1, hh);
      }

      // Datos “vivos” del audio
      const audioEl = audioRef?.current || null;
      const dur = audioEl?.duration || 0;

      // Beats
      if (beats && beats.length && dur > 0) {
        ctx.strokeStyle = "rgba(239,68,68,0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const t of beats) {
          const frac = t / dur; // 0..1 global
          if (frac >= leftFrac && frac <= rightFrac) {
            const localFrac = (frac - leftFrac) / (rightFrac - leftFrac);
            const x = localFrac * w;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
          }
        }
        ctx.stroke();
      }

      // Cursor de reproducción FIJO en el centro del canvas
      if (dur > 0) {
        const cursorX = w / 2;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(cursorX - 1, 0, 2, h);
      }

      frameId = requestAnimationFrame(drawFrame);
    };

    frameId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(frameId);
  }, [waveData, beats, audioRef, zoom, scroll]);

  const handleClick = (e) => {
    const canvas = canvasRef.current;
    const audioEl = audioRef?.current || null;
    if (
      !canvas ||
      !audioEl ||
      !audioEl.duration ||
      !waveData ||
      !waveData.length
    )
      return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width || 1;

    const total = waveData.length;
    const visible = Math.max(1, Math.floor(total / zoom));
    const maxStart = Math.max(0, total - visible);
    const start = maxStart > 0 ? scroll * maxStart : 0;
    const leftFrac = start / total;
    const rightFrac = (start + visible) / total;

    const fracInView = x / w; // 0..1
    const globalFrac = leftFrac + fracInView * (rightFrac - leftFrac);
    const t = globalFrac * audioEl.duration;

    audioEl.currentTime = t;
    onSeek?.(t);
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-20 bg-neutral-800 rounded-lg cursor-pointer"
      onClick={handleClick}
    />
  );
}
