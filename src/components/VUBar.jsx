import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/context";
import {
  createLevelMeter,
  colorForDb,
  dbToFraction,
  METER_COLORS,
  METER_LABELS_DB,
  METER_MAX_DB,
  METER_MIN_DB,
  METER_TICKS_DB,
  ZONE_AMBER_DB,
  ZONE_RED_DB,
} from "../audio/levelMeter";

const SEGMENT_DB = 2; // un LED cada 2 dB → 21 segmentos en todo el recorrido
const FRAME_MS = 33; // 30 fps, el mismo tope que los canvas de onda

// Fondo del carril y del LED apagado
const RAIL_BG = "#262626"; // neutral-800
// LED apagado: lo bastante visible para que la escalera se lea entera y el
// tramo entre la barra y el testigo de pico no parezca un hueco
const OFF_ALPHA = 0.3;

// Pinta el medidor entero. Función pura sobre el contexto 2D: no toca el DOM
// ni el estado de React, por eso el refresco no provoca ningún render.
function drawMeter(ctx, w, h, vertical, mode, level, dpr) {
  const span = vertical ? h : w;
  const thick = vertical ? w : h;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = RAIL_BG;
  ctx.fillRect(0, 0, w, h);

  // Coloca un rectángulo a lo largo del eje del medidor: en vertical se
  // llena de abajo arriba, en horizontal de izquierda a derecha.
  // Los bordes se cuadran a píxel entero: con coordenadas fraccionarias el
  // canvas antialiasa los cantos y los LED salen borrosos y desalineados.
  const blockAt = (from, to) => {
    const a = Math.round(Math.min(from, to));
    const b = Math.round(Math.max(from, to));
    const len = Math.max(b > a ? b - a : to !== from ? 1 : 0, 0);
    if (len <= 0) return;
    if (vertical) ctx.fillRect(0, h - a - len, thick, len);
    else ctx.fillRect(a, 0, len, thick);
  };

  if (mode === "led") {
    const count = Math.round((METER_MAX_DB - METER_MIN_DB) / SEGMENT_DB);
    const gap = Math.max(1, Math.round(dpr));
    // Los bordes salen de redondear la MISMA frontera para los dos LED
    // contiguos: así la separación es idéntica en toda la tira (si se
    // redondease cada segmento por su cuenta, los huecos bailarían 1 px)
    const edge = (i) => Math.round((i * span) / count);
    const peakSeg = Math.min(
      count - 1,
      Math.floor((level.peakDb - METER_MIN_DB) / SEGMENT_DB)
    );
    for (let i = 0; i < count; i++) {
      const lowDb = METER_MIN_DB + i * SEGMENT_DB;
      const lit = level.db > lowDb;
      const isPeak = level.peakDb > METER_MIN_DB && i === peakSeg;
      const from = edge(i);
      const to = Math.max(from + 1, edge(i + 1) - gap);
      ctx.globalAlpha = lit || isPeak ? 1 : OFF_ALPHA;
      ctx.fillStyle = colorForDb(lowDb);
      blockAt(from, to);
      if (isPeak) {
        // El testigo de pico se distingue del resto aclarándolo
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = "#ffffff";
        blockAt(from, to);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    // Barra continua con las mismas zonas de color que los LED
    const grad = vertical
      ? ctx.createLinearGradient(0, h, 0, 0)
      : ctx.createLinearGradient(0, 0, w, 0);
    const fAmber = dbToFraction(ZONE_AMBER_DB);
    const fRed = dbToFraction(ZONE_RED_DB);
    grad.addColorStop(0, METER_COLORS.green);
    grad.addColorStop(Math.max(0, fAmber - 0.001), METER_COLORS.green);
    grad.addColorStop(fAmber, METER_COLORS.amber);
    grad.addColorStop(Math.max(0, fRed - 0.001), METER_COLORS.amber);
    grad.addColorStop(fRed, METER_COLORS.red);
    grad.addColorStop(1, METER_COLORS.red);
    ctx.fillStyle = grad;
    blockAt(0, dbToFraction(level.db) * span);

    // Marcas de la escala: separadores finos en los dB de referencia
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    for (const db of METER_TICKS_DB) {
      const at = dbToFraction(db) * span;
      blockAt(at, at + Math.max(1, Math.round(dpr)));
    }

    // Testigo de pico
    if (level.peakDb > METER_MIN_DB) {
      const at = dbToFraction(level.peakDb) * span;
      const markLen = Math.max(2, Math.round(2 * dpr));
      ctx.fillStyle = colorForDb(level.peakDb);
      blockAt(Math.min(span - markLen, at), Math.min(span, at + markLen));
    }
  }

  // Aviso de saturación: bloque rojo fijo en el techo del medidor, se vea
  // donde se vea la barra, y se queda encendido un rato tras el pico
  if (level.clip) {
    const capLen = Math.max(3, Math.round(4 * dpr));
    ctx.fillStyle = "#ff2d2d";
    blockAt(span - capLen, span);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    blockAt(span - capLen - Math.max(1, Math.round(dpr)), span - capLen);
  }
}

export default function VUBar({
  engine,
  side,
  direction = "vertical",
  mode = "continuous",
  showScale = false,
}) {
  const { t } = useI18n();
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  // El modo se lee dentro del bucle de dibujo: cambiarlo no reinicia el
  // medidor ni pierde el pico retenido
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const vertical = direction === "vertical";

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || typeof engine?.getMeterAnalyser !== "function") {
      return;
    }
    const analyser = engine.getMeterAnalyser(
      side === "A" ? "A" : side === "B" ? "B" : "master"
    );
    const read = createLevelMeter(analyser);
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    let w = 1;
    let h = 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const nw = Math.max(1, Math.round(r.width * dpr));
      const nh = Math.max(1, Math.round(r.height * dpr));
      if (nw !== canvas.width) canvas.width = nw;
      if (nh !== canvas.height) canvas.height = nh;
      w = canvas.width;
      h = canvas.height;
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const tick = () => {
      const level = read(performance.now());
      drawMeter(ctx, w, h, vertical, modeRef.current, level, dpr);
    };
    tick();
    const timer = setInterval(tick, FRAME_MS);

    return () => {
      clearInterval(timer);
      ro.disconnect();
    };
  }, [engine, side, vertical]);

  const title = vertical ? t("vuChannelTitle") : t("vuMasterTitle");

  return (
    <div className={vertical ? "flex flex-col" : "flex flex-col gap-0.5"}>
      <div
        ref={wrapRef}
        title={title}
        aria-label={title}
        className={`relative rounded overflow-hidden bg-neutral-800 ${
          vertical ? "w-3 flex-1" : "h-3 w-full"
        }`}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      {/* Escala numérica del master. Solo cifras: no cambia de ancho al
          cambiar de idioma ni de modo de visualización. */}
      {showScale && !vertical && (
        <div className="relative h-3 text-[8px] text-neutral-500 tabular-nums select-none">
          {METER_LABELS_DB.map((db) => {
            const f = dbToFraction(db);
            return (
              <span
                key={db}
                className="absolute top-0 whitespace-nowrap"
                style={{
                  left: `${f * 100}%`,
                  transform:
                    f <= 0.01
                      ? "none"
                      : f >= 0.99
                      ? "translateX(-100%)"
                      : "translateX(-50%)",
                }}
              >
                {db}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
