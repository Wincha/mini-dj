import { memo, useEffect, useRef } from "react";
import { HOT_CUE_COLORS } from "../lib/constants";
import { createSmoothTime } from "../lib/smoothTime";

function WaveformCanvas({
  waveData,
  beats,
  cuePoint,
  hotCues,
  loopIn,
  loopOut,
  loopOn,
  audioRef,
  zoom,
  scroll,
  follow,
  onSeek,
  onDragSeek,
  onNudge,
  onNudgeEnd,
  onWheelZoom,
}) {
  const canvasRef = useRef(null);
  const smoothTimeRef = useRef(null);
  if (!smoothTimeRef.current) smoothTimeRef.current = createSmoothTime();

  // Zoom con la rueda del ratón (listener nativo: React registra wheel como
  // pasivo y no dejaría hacer preventDefault del scroll de la página)
  const wheelCbRef = useRef(onWheelZoom);
  wheelCbRef.current = onWheelZoom;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      wheelCbRef.current?.(e.deltaY < 0 ? 1 : -1);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // Estado del arrastre (no necesita re-render)
  const dragRef = useRef({
    active: false,
    moved: false,
    mode: null, // "seek" (pausa) | "nudge" (play)
    startX: 0,
    lastX: 0,
    startTime: 0,
    nudgeSmooth: 0,
    idleTimer: null,
  });

  useEffect(() => {
    let frameId;
    const canvas = canvasRef.current;
    if (!canvas || !waveData || !waveData.length) return;

    const ctx = canvas.getContext("2d");

    let lastDraw = 0;
    const drawFrame = (now) => {
      // ~30 fps y nada con la pestaña oculta: ahorra CPU
      if (document.hidden || now - lastDraw < 33) {
        frameId = requestAnimationFrame(drawFrame);
        return;
      }
      lastDraw = now;
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

      // Datos del audio (para follow y cursor)
      const audioEl = audioRef?.current || null;
      const dur = audioEl?.duration || 0;
      const cur = smoothTimeRef.current(audioEl); // playhead interpolado
      const curFrac = dur > 0 ? cur / dur : 0; // 0..1

      // Ventana visible (en "muestras")
      const visible = Math.max(1, Math.floor(total / zoom));
      const windowFrac = visible / total; // fracción del tema que cabe en el canvas

      let leftFrac; // 0..1, inicio de la ventana
      let rightFrac; // 0..1, fin de la ventana
      let start; // índice float en waveData donde empieza la ventana

      if (follow && dur > 0) {
        // SEGUR FOLLOW: el playhead va a ~1/3 de la ventana
        const cursorFracInWindow = 1 / 3;

        // Queremos: curFrac ≈ leftFrac + cursorFracInWindow * windowFrac
        let desiredLeft = curFrac - cursorFracInWindow * windowFrac;

        // Clamps para inicio/fin de la pista
        if (desiredLeft < 0) desiredLeft = 0;
        if (desiredLeft > 1 - windowFrac) desiredLeft = 1 - windowFrac;

        leftFrac = desiredLeft;
        rightFrac = leftFrac + windowFrac;
        start = leftFrac * total;
      } else {
        // MODO MANUAL: usamos el scroll que viene de React
        const maxStart = Math.max(0, total - visible);
        start = maxStart > 0 ? scroll * maxStart : 0;
        leftFrac = start / total;
        rightFrac = (start + visible) / total;
      }

      // Fondo
      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, w, h);

      // Waveform visible: un único path en vez de un fillRect por píxel
      ctx.fillStyle = "#22c55e";
      const samplesPerPixel = visible / w;
      const wave = new Path2D();
      for (let x = 0; x < w; x++) {
        const idx = Math.floor(start + x * samplesPerPixel);
        const v = waveData[idx] || 0;
        wave.rect(x, (1 - v) * h * 0.5, 1, v * h);
      }
      ctx.fill(wave);

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

      // Región de loop (verde translúcido)
      if (dur > 0 && loopIn != null && loopOut != null) {
        const inFrac = loopIn / dur;
        const outFrac = loopOut / dur;
        if (outFrac >= leftFrac && inFrac <= rightFrac) {
          const x1 = Math.max(
            0,
            ((inFrac - leftFrac) / (rightFrac - leftFrac)) * w
          );
          const x2 = Math.min(
            w,
            ((outFrac - leftFrac) / (rightFrac - leftFrac)) * w
          );
          ctx.fillStyle = loopOn
            ? "rgba(16,185,129,0.22)"
            : "rgba(16,185,129,0.10)";
          ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
          ctx.fillStyle = "rgba(16,185,129,0.9)";
          ctx.fillRect(x1, 0, 2, h);
          ctx.fillRect(x2 - 2, 0, 2, h);
        }
      }

      // Hot cues (líneas de color con número)
      if (dur > 0 && hotCues) {
        for (let i = 0; i < hotCues.length; i++) {
          const t = hotCues[i];
          if (t == null) continue;
          const frac = t / dur;
          if (frac < leftFrac || frac > rightFrac) continue;
          const x = ((frac - leftFrac) / (rightFrac - leftFrac)) * w;
          ctx.fillStyle = HOT_CUE_COLORS[i] || "#fff";
          ctx.fillRect(x - 1, 0, 2, h);
          ctx.fillRect(x, h - 11, 10, 11);
          ctx.fillStyle = "#000";
          ctx.font = "bold 9px sans-serif";
          ctx.fillText(String(i + 1), x + 3, h - 2);
        }
      }

      // Marcador de CUE (naranja)
      if (dur > 0 && Number.isFinite(cuePoint) && cuePoint > 0) {
        const cueFrac = cuePoint / dur;
        if (cueFrac >= leftFrac && cueFrac <= rightFrac) {
          const localFrac = (cueFrac - leftFrac) / (rightFrac - leftFrac);
          const x = localFrac * w;
          ctx.fillStyle = "rgba(251,146,60,0.95)"; // orange-400
          ctx.fillRect(x - 1, 0, 2, h);
          // pequeña bandera arriba
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x + 7, 5);
          ctx.lineTo(x, 10);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Cursor de reproducción (mismo cálculo en ambos modos)
      if (dur > 0) {
        if (curFrac >= leftFrac && curFrac <= rightFrac) {
          const localFrac = (curFrac - leftFrac) / (rightFrac - leftFrac);
          const cursorX = Math.max(0, Math.min(w, localFrac * w));
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fillRect(cursorX - 1, 0, 2, h);
        }
      }

      frameId = requestAnimationFrame(drawFrame);
    };

    frameId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(frameId);
  }, [
    waveData,
    beats,
    cuePoint,
    hotCues,
    loopIn,
    loopOut,
    loopOn,
    zoom,
    scroll,
    follow,
    audioRef,
  ]);

  // Ventana visible actual (mismo cálculo que drawFrame) para convertir px ↔ tiempo
  const getWindow = (audioEl) => {
    const total = waveData.length;
    const visible = Math.max(1, Math.floor(total / zoom));
    const windowFrac = visible / total;
    let leftFrac;
    let rightFrac;

    const dur = audioEl.duration || 0;
    if (follow && dur > 0) {
      const curFrac = (audioEl.currentTime || 0) / dur;
      let desiredLeft = curFrac - (1 / 3) * windowFrac;
      if (desiredLeft < 0) desiredLeft = 0;
      if (desiredLeft > 1 - windowFrac) desiredLeft = 1 - windowFrac;
      leftFrac = desiredLeft;
      rightFrac = leftFrac + windowFrac;
    } else {
      const maxStart = Math.max(0, total - visible);
      const start = maxStart > 0 ? scroll * maxStart : 0;
      leftFrac = start / total;
      rightFrac = (start + visible) / total;
    }
    return { leftFrac, rightFrac, windowFrac };
  };

  const clickSeek = (clientX) => {
    const canvas = canvasRef.current;
    const audioEl = audioRef?.current;
    if (!canvas || !audioEl || !(audioEl.duration > 0)) return;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const x = clientX - rect.left;

    const { leftFrac, rightFrac } = getWindow(audioEl);
    const fracInView = x / w;
    const globalFrac = leftFrac + fracInView * (rightFrac - leftFrac);
    const t = globalFrac * audioEl.duration;

    if (onSeek) onSeek(t);
  };

  const onPointerDown = (e) => {
    const canvas = canvasRef.current;
    const audioEl = audioRef?.current;
    if (!canvas || !audioEl || !waveData || !waveData.length) return;
    if (!(audioEl.duration > 0)) return;

    canvas.setPointerCapture(e.pointerId);
    const d = dragRef.current;
    d.active = true;
    d.moved = false;
    d.mode = audioEl.paused ? "seek" : "nudge";
    d.startX = e.clientX;
    d.lastX = e.clientX;
    d.startTime = audioEl.currentTime || 0;
    d.nudgeSmooth = 0;
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.active) return;
    const canvas = canvasRef.current;
    const audioEl = audioRef?.current;
    if (!canvas || !audioEl) return;

    const dxTotal = e.clientX - d.startX;
    const dx = e.clientX - d.lastX;
    d.lastX = e.clientX;

    if (!d.moved && Math.abs(dxTotal) < 4) return; // aún puede ser un click
    d.moved = true;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const dur = audioEl.duration || 0;
    const { windowFrac } = getWindow(audioEl);
    const secondsPerPixel = (dur * windowFrac) / w;

    if (d.mode === "seek") {
      // Empujar la onda: mover la pista bajo la línea de reproducción
      const t = Math.max(
        0,
        Math.min(dur - 0.01, d.startTime - dxTotal * secondsPerPixel)
      );
      if (onDragSeek) onDragSeek(t);
    } else {
      // Nudge en play: velocidad del gesto → bend temporal
      const raw = -dx * 0.3; // arrastrar hacia la izq = acelerar
      d.nudgeSmooth = d.nudgeSmooth * 0.6 + raw * 0.4;
      if (onNudge) onNudge(d.nudgeSmooth);

      // Sin movimiento durante un rato → soltar el nudge
      if (d.idleTimer) clearTimeout(d.idleTimer);
      d.idleTimer = setTimeout(() => {
        d.nudgeSmooth = 0;
        if (onNudgeEnd) onNudgeEnd();
      }, 150);
    }
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    if (d.idleTimer) {
      clearTimeout(d.idleTimer);
      d.idleTimer = null;
    }

    if (!d.moved) {
      // Sin arrastre: comportamiento de click normal
      clickSeek(e.clientX);
    } else if (d.mode === "nudge" && onNudgeEnd) {
      onNudgeEnd();
    }
    d.mode = null;
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-20 bg-neutral-800 rounded-lg cursor-pointer select-none"
      style={{ touchAction: "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

export default memo(WaveformCanvas);
