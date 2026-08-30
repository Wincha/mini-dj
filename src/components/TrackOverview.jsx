import { memo, useEffect, useRef } from "react";
import { HOT_CUE_COLORS } from "../lib/constants";
import { PALETTE_LEVELS, WAVE_PALETTE } from "../lib/waveColors";

// === Resumen de la pista (la tira fina de debajo de la onda) ===
//
// La pista ENTERA de un vistazo: la onda con sus colores de banda, los tramos
// sin ritmo sombreados, una marca donde se va y donde vuelve el kick, los hot
// cues y el loop. Sirve además para moverse: se pulsa (o se arrastra) y la
// pista salta ahí.
//
// Por qué es barato: lo que no cambia —la onda, los tramos, la rejilla— se
// pinta UNA vez en un lienzo aparte y luego cada refresco es un `drawImage`
// más cuatro rectángulos (el cursor, la ventana visible y poco más). Y se
// refresca 10 veces por segundo, no 30: en una tira de 600 px una pista de
// cinco minutos mueve el cursor 2 px por segundo, así que no se nota.
const REFRESH_MS = 100;

// Alto en píxeles CSS. El mismo que los botones de zoom, para que la caja
// quede cuadrada por abajo.
export const OVERVIEW_HEIGHT = 28;

function TrackOverview({
  waveData,
  bandIndex,
  palette = WAVE_PALETTE,
  beats,
  structure,
  cuePoint,
  hotCues,
  loopIn,
  loopOut,
  audioRef,
  duration,
  // Ventana que se está viendo en la onda grande. Es un ref que escribe la
  // onda en cada frame ({ from, to } en 0..1): así el marco sigue al zoom y
  // al scroll sin re-renderizar nada.
  windowRef,
  onSeek,
  title,
}) {
  const canvasRef = useRef(null);
  // Lienzo con lo que no cambia; se vuelve a pintar solo si cambian los datos
  const cacheRef = useRef(null);
  const cacheKeyRef = useRef("");
  const dragRef = useRef(false);
  // Lo que lee el bucle sin re-registrarlo en cada render
  const liveRef = useRef({});
  liveRef.current = { duration, cuePoint, hotCues, loopIn, loopOut };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let timer = null;

    // === Capa fija: onda + tramos + rejilla ===
    const pintarCache = (w, h) => {
      let cache = cacheRef.current;
      if (!cache) {
        cache = cacheRef.current = document.createElement("canvas");
      }
      cache.width = w;
      cache.height = h;
      const ctx = cache.getContext("2d");

      ctx.fillStyle = "#0b0b0b";
      ctx.fillRect(0, 0, w, h);
      if (!waveData?.length) return;

      const total = waveData.length;
      const porPixel = total / w;
      const colored = bandIndex && bandIndex.length === total;
      const mitad = h / 2;

      // Los tramos SIN ritmo, sombreados: es lo que da la forma del tema de
      // un vistazo (intro, bajón, subidón)
      if (structure?.confident && duration > 0) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        for (const s of structure.sections) {
          if (s.kick) continue;
          const x1 = (s.start / duration) * w;
          const x2 = (s.end / duration) * w;
          ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
        }
      }

      // Onda: una columna por píxel, agrupando por color como en la onda
      // grande (un relleno por entrada de paleta, no uno por píxel)
      const columnas = new Map();
      for (let x = 0; x < w; x++) {
        const desde = Math.floor(x * porPixel);
        const hasta = Math.min(total, Math.floor((x + 1) * porPixel));
        let pico = 0;
        let sumaLow = 0;
        let sumaHigh = 0;
        let n = 0;
        for (let i = desde; i < hasta; i++) {
          const a = waveData[i];
          if (a > pico) pico = a;
          if (colored) {
            const ci = bandIndex[i];
            sumaLow += (ci / PALETTE_LEVELS) | 0;
            sumaHigh += ci % PALETTE_LEVELS;
          }
          n++;
        }
        if (!n) continue;
        const ci = colored
          ? Math.round(sumaLow / n) * PALETTE_LEVELS + Math.round(sumaHigh / n)
          : 0;
        let lista = columnas.get(ci);
        if (!lista) columnas.set(ci, (lista = []));
        lista.push(x, pico);
      }
      for (const [ci, lista] of columnas) {
        ctx.fillStyle = palette[ci] || palette[0];
        for (let k = 0; k < lista.length; k += 2) {
          const alto = Math.max(1, lista[k + 1] * (h - 2));
          ctx.fillRect(lista[k], mitad - alto / 2, 1, alto);
        }
      }

      // Dónde se va el kick y dónde vuelve. A esta escala la rejilla entera
      // sería una mancha roja, así que se marcan los CAMBIOS, que es lo que
      // se mira en un resumen.
      if (structure?.confident && duration > 0) {
        for (let i = 1; i < structure.sections.length; i++) {
          const s = structure.sections[i];
          const x = Math.round((s.start / duration) * w) + 0.5;
          ctx.strokeStyle = s.kick
            ? "rgba(52,211,153,0.9)" // vuelve el ritmo
            : "rgba(239,68,68,0.9)"; // se va
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }

      // Rejilla de beats, con la misma regla que la onda grande: por debajo
      // de 4 px por beat no se pinta, que a esta escala solo sería ruido
      if (beats?.length > 1 && duration > 0) {
        const px = ((beats[1] - beats[0]) / duration) * w;
        if (px >= 4) {
          ctx.strokeStyle = "rgba(239,68,68,0.45)";
          ctx.beginPath();
          for (const tBeat of beats) {
            const x = Math.round((tBeat / duration) * w) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
          }
          ctx.stroke();
        }
      }

      // Relieve de pantalla: luz arriba y sombra abajo
      const brillo = ctx.createLinearGradient(0, 0, 0, h);
      brillo.addColorStop(0, "rgba(255,255,255,0.10)");
      brillo.addColorStop(0.45, "rgba(255,255,255,0)");
      brillo.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = brillo;
      ctx.fillRect(0, 0, w, h);
    };

    const dibujar = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        cacheKeyRef.current = "";
      }

      // ¿Hay que rehacer la capa fija?
      const clave = `${w}x${h}|${waveData?.length || 0}|${beats?.length || 0}|${
        structure?.sections?.length || 0
      }|${duration}|${palette[0]}`;
      if (clave !== cacheKeyRef.current) {
        cacheKeyRef.current = clave;
        pintarCache(w, h);
      }

      const ctx = canvas.getContext("2d");
      ctx.drawImage(cacheRef.current, 0, 0);

      const st = liveRef.current;
      const el = audioRef?.current || null;
      const dur = st.duration || el?.duration || 0;
      if (!dur) return;
      const aX = (t) => (t / dur) * w;

      // Loop marcado
      if (st.loopIn != null && st.loopOut != null) {
        const x1 = aX(st.loopIn);
        const x2 = aX(st.loopOut);
        ctx.fillStyle = "rgba(16,185,129,0.28)";
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
      }

      // Hot cues: una marquita de su color, arriba
      if (st.hotCues) {
        for (let i = 0; i < st.hotCues.length; i++) {
          const cue = st.hotCues[i];
          if (!cue || !Number.isFinite(cue.t)) continue;
          ctx.fillStyle = HOT_CUE_COLORS[i] || "#fff";
          ctx.fillRect(Math.round(aX(cue.t)), 0, 2, Math.round(h * 0.4));
        }
      }

      // Punto CUE
      if (Number.isFinite(st.cuePoint) && st.cuePoint > 0) {
        ctx.fillStyle = "rgba(251,146,60,0.95)";
        ctx.fillRect(Math.round(aX(st.cuePoint)), 0, 2, h);
      }

      // Ventana que se ve ampliada en la onda de arriba
      const ventana = windowRef?.current;
      if (ventana && ventana.to > ventana.from && ventana.to - ventana.from < 0.999) {
        const x1 = ventana.from * w;
        const x2 = ventana.to * w;
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.fillRect(x1, 0, Math.max(2, x2 - x1), h);
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          Math.round(x1) + 0.5,
          0.5,
          Math.max(2, Math.round(x2 - x1) - 1),
          h - 1
        );
      }

      // Cursor de reproducción
      const cur = el?.currentTime || 0;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(Math.round(aX(cur)) - 1, 0, 2, h);
    };

    dibujar();
    timer = setInterval(() => {
      if (!document.hidden) dibujar();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [waveData, bandIndex, palette, beats, structure, duration, audioRef, windowRef]);

  // Moverse por la pista: pulsar o arrastrar lleva el playhead ahí
  const seekEn = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas || !onSeek) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / (rect.width || 1)));
    onSeek(frac);
  };

  return (
    <canvas
      ref={canvasRef}
      title={title}
      className="w-full cursor-pointer select-none rounded-md"
      style={{ height: OVERVIEW_HEIGHT, touchAction: "none" }}
      onPointerDown={(e) => {
        dragRef.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        seekEn(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragRef.current) seekEn(e.clientX);
      }}
      onPointerUp={(e) => {
        dragRef.current = false;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        dragRef.current = false;
      }}
    />
  );
}

export default memo(TrackOverview);
