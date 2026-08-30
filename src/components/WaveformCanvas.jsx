import { memo, useEffect, useRef } from "react";
import { HOT_CUE_COLORS } from "../lib/constants";
import {
  PALETTE_LEVELS,
  PALETTE_SIZE,
  WAVE_PALETTE,
} from "../lib/waveColors";
import { createSmoothTime } from "../lib/smoothTime";

function WaveformCanvas({
  waveData,
  bandIndex,
  palette = WAVE_PALETTE,
  beats,
  cuePoint,
  hotCues,
  loopIn,
  loopOut,
  loopOn,
  loopRolling,
  audioRef,
  endWarnAt = 0,
  // Ref compartido con el resumen de la pista: aquí se escribe la ventana
  // visible (0..1) en cada frame, sin pasar por el estado de React.
  windowRef,
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
  // Preferencia del sistema de movimiento reducido: con ella puesta, el aviso
  // de fin de pista se queda en un borde fijo en vez de parpadear.
  const reducedMotionRef = useRef(false);
  // Un Path2D por color de la paleta, reutilizado entre frames: agrupar los
  // píxeles por color deja el dibujado en <=36 rellenos en vez de uno por píxel
  const bandPathsRef = useRef(new Array(PALETTE_SIZE).fill(null));
  // Tira de onda ya pintada (tres anchos de pantalla) que se va bliteando
  const stripRef = useRef({ canvas: null, key: "", start: 0 });
  if (!smoothTimeRef.current) smoothTimeRef.current = createSmoothTime();

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedMotionRef.current = mq.matches;
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

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
    const total = waveData.length;

    // Pinta un tramo de la onda en el lienzo que se le pase: `from` es el
    // índice (fraccionario) de la primera muestra y `perPx` cuántas muestras
    // entran en cada píxel. Agrupa por color: como mucho PALETTE_SIZE
    // rellenos, nunca uno por píxel.
    const drawWave = (dst, width, height, from, perPx, colored, dur) => {
      dst.fillStyle = "#171717";
      dst.fillRect(0, 0, width, height);

      const paths = bandPathsRef.current;
      if (colored) paths.fill(null);
      const flatWave = colored ? null : new Path2D();

      const addBar = (x, v, ci) => {
        if (!colored) {
          flatWave.rect(x, (1 - v) * height * 0.5, 1, v * height);
          return;
        }
        let path = paths[ci];
        if (!path) path = paths[ci] = new Path2D();
        path.rect(x, (1 - v) * height * 0.5, 1, v * height);
      };

      if (perPx <= 1) {
        for (let x = 0; x < width; x++) {
          const idx = Math.floor(from + x * perPx);
          if (idx < 0 || idx >= total) continue;
          addBar(x, waveData[idx] || 0, colored ? bandIndex[idx] || 0 : 0);
        }
      } else {
        // Cuando cada píxel abarca varias muestras se recorre el tramo
        // entero: la altura es el máximo y el color, la media de las bandas.
        // Muestreando solo una de cada N, el color se enganchaba al patrón
        // del bombo y la pista entera salía naranja.
        for (let x = 0; x < width; x++) {
          const desde = Math.max(0, Math.floor(from + x * perPx));
          const hasta = Math.min(total, Math.floor(from + (x + 1) * perPx));
          let peakV = 0;
          let sumLow = 0;
          let sumHigh = 0;
          let n = 0;
          for (let i = desde; i < hasta; i++) {
            const a = waveData[i];
            if (a > peakV) peakV = a;
            if (colored) {
              const ci = bandIndex[i];
              sumLow += (ci / PALETTE_LEVELS) | 0;
              sumHigh += ci % PALETTE_LEVELS;
            }
            n++;
          }
          if (!n) continue;
          const ci = colored
            ? Math.round(sumLow / n) * PALETTE_LEVELS + Math.round(sumHigh / n)
            : 0;
          addBar(x, peakV, ci);
        }
      }

      if (colored) {
        for (let i = 0; i < PALETTE_SIZE; i++) {
          const path = paths[i];
          if (!path) continue;
          dst.fillStyle = palette[i];
          dst.fill(path);
        }
      } else {
        // Sin datos de bandas: color de medios de la paleta elegida
        dst.fillStyle = palette[0];
        dst.fill(flatWave);
      }

      // Rejilla de beats: va en la tira porque tampoco cambia. A zoom bajo
      // caben más de mil beats en el ancho y la rejilla acaba tapando la onda
      // entera de rojo, así que por debajo de 4 px por beat no se dibuja: a
      // esa escala no sirve para nada.
      if (dur > 0 && beats && beats.length > 1) {
        const beatPx = ((beats[1] - beats[0]) / dur) * total / perPx;
        if (beatPx >= 4) {
          const desde = from * (dur / total);
          const hasta = (from + width * perPx) * (dur / total);
          dst.strokeStyle = "rgba(239,68,68,0.6)";
          dst.lineWidth = 1;
          dst.beginPath();
          for (const tBeat of beats) {
            if (tBeat < desde) continue;
            if (tBeat > hasta) break;
            const x = ((tBeat / dur) * total - from) / perPx;
            dst.moveTo(x, 0);
            dst.lineTo(x, height);
          }
          dst.stroke();
        }
      }
    };

    let lastDraw = 0;
    const drawFrame = (now) => {
      // ~30 fps y nada con la pestaña oculta: ahorra CPU
      if (document.hidden || now - lastDraw < 33) {
        frameId = requestAnimationFrame(drawFrame);
        return;
      }
      lastDraw = now;
      const rect = canvas.getBoundingClientRect();
      // REDONDEADO, y esto importa: `canvas.width` guarda enteros, así que
      // con un ancho fraccionario (el deck no mide un número redondo) la
      // comparación de abajo nunca se cumplía y el lienzo se reasignaba —es
      // decir, se reiniciaba entero— en CADA frame. Costaba más que dibujar.
      const w = Math.max(1, Math.round(rect.width || 600));
      const h = Math.max(1, Math.round(rect.height || 80));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
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

      if (windowRef) {
        windowRef.current.from = leftFrac;
        windowRef.current.to = rightFrac;
      }

      // === Onda ===
      //
      // No se redibuja en cada frame. Se pinta una TIRA de tres anchos de
      // pantalla en un lienzo aparte y cada frame es un `drawImage` del trozo
      // que toca. Siguiendo la reproducción, la ventana tarda segundos en
      // recorrer una pantalla entera, así que la tira se rehace una vez cada
      // varios segundos en vez de treinta veces por segundo.
      //
      // Antes eran hasta 36 rellenos de Path2D por frame y por deck: con los
      // dos decks sonando se comía media CPU.
      const samplesPerPixel = visible / w;
      const colored = bandIndex && bandIndex.length === total;
      const strip = stripRef.current;
      const stripW = w * 3;
      // Clave de lo que hace que la tira deje de valer: datos, colores,
      // tamaño y escala. El desplazamiento no entra: para eso está la tira.
      const stripKey = `${total}|${colored}|${palette[0]}|${palette[35]}|${w}|${h}|${samplesPerPixel}|${dur}|${beats?.length || 0}|${beats?.[0] || 0}`;
      const stripEnd = strip.start + stripW * samplesPerPixel;
      if (
        strip.key !== stripKey ||
        start < strip.start ||
        start + visible > stripEnd
      ) {
        if (!strip.canvas) strip.canvas = document.createElement("canvas");
        if (strip.canvas.width !== stripW || strip.canvas.height !== h) {
          strip.canvas.width = stripW;
          strip.canvas.height = h;
        }
        // La ventana queda centrada en la tira: sirve igual yendo hacia
        // delante que hacia atrás (un seek, un loop)
        strip.start = start - w * samplesPerPixel;
        strip.key = stripKey;
        drawWave(
          strip.canvas.getContext("2d"),
          stripW,
          h,
          strip.start,
          samplesPerPixel,
          colored,
          dur
        );
      }
      ctx.drawImage(
        strip.canvas,
        (start - strip.start) / samplesPerPixel,
        0,
        w,
        h,
        0,
        0,
        w,
        h
      );

      // Región de loop. Verde el loop normal; ámbar mientras hay un loop roll
      // puesto, para distinguir de un vistazo lo momentáneo de lo fijo.
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
          const relleno = loopRolling
            ? "rgba(251,191,36,0.24)"
            : loopOn
            ? "rgba(16,185,129,0.22)"
            : "rgba(16,185,129,0.10)";
          const borde = loopRolling
            ? "rgba(251,191,36,0.95)"
            : "rgba(16,185,129,0.9)";
          ctx.fillStyle = relleno;
          ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
          ctx.fillStyle = borde;
          ctx.fillRect(x1, 0, 2, h);
          ctx.fillRect(x2 - 2, 0, 2, h);
        }
      }

      // Hot cues: línea de color, chapa con el número y, si lo tiene, la
      // etiqueta al lado. La etiqueta se recorta a la mitad del hueco que
      // queda hasta el borde para que no cruce la onda entera.
      if (dur > 0 && hotCues) {
        ctx.textBaseline = "alphabetic";
        for (let i = 0; i < hotCues.length; i++) {
          const cue = hotCues[i];
          if (!cue || !Number.isFinite(cue.t)) continue;
          const frac = cue.t / dur;
          if (frac < leftFrac || frac > rightFrac) continue;
          const x = ((frac - leftFrac) / (rightFrac - leftFrac)) * w;
          const color = HOT_CUE_COLORS[i] || "#fff";
          ctx.fillStyle = color;
          ctx.fillRect(x - 1, 0, 2, h);
          ctx.fillRect(x, h - 11, 10, 11);
          ctx.fillStyle = "#000";
          ctx.font = "bold 9px sans-serif";
          ctx.fillText(String(i + 1), x + 3, h - 2);

          if (cue.name) {
            ctx.font = "9px sans-serif";
            const ancho = Math.min(ctx.measureText(cue.name).width, 64);
            if (x + 12 + ancho + 3 < w) {
              ctx.fillStyle = "rgba(0,0,0,0.55)";
              ctx.fillRect(x + 11, h - 11, ancho + 4, 11);
              ctx.fillStyle = color;
              ctx.save();
              ctx.beginPath();
              ctx.rect(x + 12, h - 11, ancho, 11);
              ctx.clip();
              ctx.fillText(cue.name, x + 13, h - 2);
              ctx.restore();
            }
          }
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

      // Aviso de fin de pista: el borde de la onda late en rojo para que se
      // vea por el rabillo del ojo. Va aquí dentro, en el bucle que ya se
      // refresca a 30 fps, y no toca ningún estado de React.
      //
      // Solo con la pista SONANDO: en pausa o sin pista, nada. El latido se
      // acelera conforme se acaba, y con "movimiento reducido" del sistema se
      // queda quieto.
      if (endWarnAt > 0 && dur > 0 && audioEl && !audioEl.paused) {
        const remain = dur - cur;
        if (remain > 0 && remain <= endWarnAt) {
          const k = 1 - remain / endWarnAt; // 0 al empezar el aviso, 1 al final
          // Un latido por segundo, seno puro: sube y baja con un fundido, sin
          // parpadeos rápidos. Lo que crece conforme se acaba la pista NO es
          // el ritmo (a más frecuencia parecía un fluorescente estropeado),
          // sino el brillo: el mismo latido, cada vez más encendido.
          let pulse; // 0..1
          if (reducedMotionRef.current) {
            pulse = 0.7;
          } else {
            pulse = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2 - Math.PI / 2);
          }
          const alpha = 0.22 + 0.18 * k + (0.5 + 0.1 * k) * pulse;
          // Rojo claro (red-400): sobre el fondo oscuro de la onda se ve
          // mucho mejor que el rojo de la rejilla de beats, y no se confunde
          // con ella. Halo ancho por dentro + borde marcado.
          ctx.strokeStyle = `rgba(248,113,113,${(alpha * 0.2).toFixed(3)})`;
          ctx.lineWidth = 12;
          ctx.strokeRect(6, 6, w - 12, h - 12);
          ctx.strokeStyle = `rgba(248,113,113,${alpha.toFixed(3)})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(2, 2, w - 4, h - 4);
        }
      }

      frameId = requestAnimationFrame(drawFrame);
    };

    frameId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(frameId);
  }, [
    waveData,
    bandIndex,
    palette,
    beats,
    cuePoint,
    hotCues,
    loopIn,
    loopOut,
    loopOn,
    loopRolling,
    endWarnAt,
    windowRef,
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
      className="w-full h-28 bg-neutral-800 rounded-md cursor-pointer select-none"
      style={{ touchAction: "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

export default memo(WaveformCanvas);
