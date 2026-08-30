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
import { glassOverlay } from "../lib/glass";

const SEGMENT_DB = 2; // un LED cada 2 dB → 21 segmentos en todo el recorrido
const FRAME_MS = 33; // 30 fps, el mismo tope que los canvas de onda

// Fondo del carril
const RAIL_BG = "#0b0b0b";
// Lámpara apagada: se tiene que ver que ESTÁ, con su color de fábrica, pero
// sin luz. Es lo que hace que la escalera se lea entera aunque no suene nada.
const OFF_ALPHA = 0.22;

// === Cómo se pinta ===
//
// Dos capas fijas por tamaño y modo: la de APAGADO (el aparato entero sin dar
// luz) y la de ENCENDIDO (todo encendido, con su brillo). Cada frame solo se
// vuelca la de apagado y el trozo de la de encendido hasta donde llegue el
// nivel. El brillo de verdad —degradados dentro de cada lámpara y halos— es
// caro de pintar; hacerlo treinta veces por segundo en cuatro medidores no se
// puede, hacerlo UNA vez al cambiar de tamaño sí.

const lienzo = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

// Rectángulo redondeado, con apaño para los contextos que no lo traen
const caja = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
};

// El eje del medidor: en vertical se llena de abajo arriba, en horizontal de
// izquierda a derecha. `a`/`b` van sobre ese eje, `grosor` es lo ancho.
const rectEje = (vertical, w, h, a, b, margen) =>
  vertical
    ? [margen, h - b, w - 2 * margen, b - a]
    : [a, margen, b - a, h - 2 * margen];

// Cuántas lámparas y dónde empieza cada una. Los bordes salen de redondear la
// MISMA frontera para las dos lámparas contiguas: así la separación es
// idéntica en toda la tira.
const LAMPARAS = Math.round((METER_MAX_DB - METER_MIN_DB) / SEGMENT_DB);
const borde = (i, span) => Math.round((i * span) / LAMPARAS);

/**
 * Las dos capas del medidor, apagada y encendida, para un tamaño y un modo.
 */
function construirCapas(w, h, vertical, mode, dpr) {
  const span = vertical ? h : w;
  const thick = vertical ? w : h;
  const off = lienzo(w, h);
  const on = lienzo(w, h);
  const co = off.getContext("2d");
  const cn = on.getContext("2d");

  // El carril: negro con un punto de relieve, el hueco donde va el aparato
  co.fillStyle = RAIL_BG;
  co.fillRect(0, 0, w, h);

  if (mode === "led") {
    const hueco = Math.max(1, Math.round(dpr));
    const margen = Math.max(1, Math.round(thick * 0.14));
    const radio = Math.max(1, Math.round(Math.min(2.5 * dpr, thick / 4)));

    for (let i = 0; i < LAMPARAS; i++) {
      const color = colorForDb(METER_MIN_DB + i * SEGMENT_DB);
      const a = borde(i, span);
      const b = Math.max(a + 1, borde(i + 1, span) - hueco);
      const r = rectEje(vertical, w, h, a, b, margen);

      // Apagada: el cuerpo oscuro de la lámpara y su color de fábrica sin luz
      co.fillStyle = "#151515";
      caja(co, ...r, radio);
      co.fill();
      co.globalAlpha = OFF_ALPHA;
      co.fillStyle = color;
      caja(co, ...r, radio);
      co.fill();
      co.globalAlpha = 1;

      // Encendida: primero el halo, flojo y a media tinta —una bombilla de
      // panel no ilumina la mesa—, y encima la lámpara a tope
      cn.save();
      cn.globalAlpha = 0.45;
      cn.shadowColor = color;
      cn.shadowBlur = Math.max(2, Math.round(2 * dpr));
      cn.fillStyle = color;
      caja(cn, ...r, radio);
      cn.fill();
      cn.restore();
      cn.fillStyle = color;
      caja(cn, ...r, radio);
      cn.fill();

      const [rx, ry, rw, rh] = r;
      const brillo = vertical
        ? cn.createLinearGradient(rx, 0, rx + rw, 0)
        : cn.createLinearGradient(0, ry, 0, ry + rh);
      // El punto de luz va ESTRECHO y en el centro: barriendo toda la
      // lámpara con blanco salía lechosa en vez de encendida
      brillo.addColorStop(0, "rgba(255,255,255,0)");
      brillo.addColorStop(0.3, "rgba(255,255,255,0)");
      brillo.addColorStop(0.45, "rgba(255,255,255,0.55)");
      brillo.addColorStop(0.55, "rgba(255,255,255,0.55)");
      brillo.addColorStop(0.7, "rgba(255,255,255,0)");
      brillo.addColorStop(1, "rgba(255,255,255,0)");
      cn.fillStyle = brillo;
      caja(cn, ...r, radio);
      cn.fill();
    }
    return { off, on };
  }

  // === Barra continua: un tubo de neón ===
  const margen = Math.max(1, Math.round(thick * 0.1));
  const radio = Math.max(1, Math.round((thick - 2 * margen) / 2));
  const tubo = rectEje(vertical, w, h, 0, span, margen);

  // Apagado: el cristal del tubo, con su reflejo
  const cristal = vertical
    ? co.createLinearGradient(0, 0, w, 0)
    : co.createLinearGradient(0, 0, 0, h);
  cristal.addColorStop(0, "#0d0d0d");
  cristal.addColorStop(0.45, "#1e1e1e");
  cristal.addColorStop(1, "#0a0a0a");
  co.fillStyle = cristal;
  caja(co, ...tubo, radio);
  co.fill();

  // Encendido: el gas, con el color de cada zona a lo largo…
  const largo = vertical
    ? cn.createLinearGradient(0, h, 0, 0)
    : cn.createLinearGradient(0, 0, w, 0);
  const fAmber = dbToFraction(ZONE_AMBER_DB);
  const fRed = dbToFraction(ZONE_RED_DB);
  largo.addColorStop(0, METER_COLORS.green);
  largo.addColorStop(Math.max(0, fAmber - 0.001), METER_COLORS.green);
  largo.addColorStop(fAmber, METER_COLORS.amber);
  largo.addColorStop(Math.max(0, fRed - 0.001), METER_COLORS.amber);
  largo.addColorStop(fRed, METER_COLORS.red);
  largo.addColorStop(1, METER_COLORS.red);

  // …y el halo, por zonas, para que el resplandor sea del color que toca
  const zonas = [
    [0, fAmber, METER_COLORS.green],
    [fAmber, fRed, METER_COLORS.amber],
    [fRed, 1, METER_COLORS.red],
  ];
  for (const [desde, hasta, color] of zonas) {
    if (hasta <= desde) continue;
    cn.save();
    const corte = rectEje(vertical, w, h, desde * span, hasta * span, 0);
    cn.beginPath();
    cn.rect(...corte);
    cn.clip();
    cn.shadowColor = color;
    cn.shadowBlur = Math.max(4, Math.round(6 * dpr));
    cn.fillStyle = largo;
    caja(cn, ...tubo, radio);
    cn.fill();
    cn.fill();
    cn.restore();
  }

  // El alma del tubo: la línea central, casi blanca, que es lo que distingue
  // un neón de una barra de color plano
  const alma = vertical
    ? cn.createLinearGradient(0, 0, w, 0)
    : cn.createLinearGradient(0, 0, 0, h);
  alma.addColorStop(0, "rgba(255,255,255,0)");
  alma.addColorStop(0.3, "rgba(255,255,255,0)");
  alma.addColorStop(0.43, "rgba(255,255,255,0.7)");
  alma.addColorStop(0.57, "rgba(255,255,255,0.7)");
  alma.addColorStop(0.7, "rgba(255,255,255,0)");
  alma.addColorStop(1, "rgba(255,255,255,0)");
  cn.fillStyle = alma;
  caja(cn, ...tubo, radio);
  cn.fill();

  return { off, on };
}

// Pinta el medidor entero volcando las dos capas. No toca el DOM ni el estado
// de React, por eso el refresco no provoca ningún render.
function drawMeter(ctx, w, h, vertical, mode, level, dpr, capas) {
  const span = vertical ? h : w;

  // Vuelca el trozo [a, b] del eje desde la capa que se le diga
  const volcar = (capa, a, b) => {
    const x0 = Math.max(0, Math.min(span, Math.round(a)));
    const x1 = Math.max(0, Math.min(span, Math.round(b)));
    if (x1 <= x0) return;
    if (vertical) ctx.drawImage(capa, 0, h - x1, w, x1 - x0, 0, h - x1, w, x1 - x0);
    else ctx.drawImage(capa, x0, 0, x1 - x0, h, x0, 0, x1 - x0, h);
  };

  ctx.clearRect(0, 0, w, h);
  volcar(capas.off, 0, span);

  if (mode === "led") {
    // Se encienden lámparas ENTERAS: el corte cae en el hueco entre dos, así
    // que no se ve el tajo
    let encendidas = 0;
    while (
      encendidas < LAMPARAS &&
      level.db > METER_MIN_DB + encendidas * SEGMENT_DB
    ) {
      encendidas++;
    }
    volcar(capas.on, 0, borde(encendidas, span));

    // Testigo de pico: la lámpara donde se quedó el máximo
    if (level.peakDb > METER_MIN_DB) {
      const i = Math.min(
        LAMPARAS - 1,
        Math.floor((level.peakDb - METER_MIN_DB) / SEGMENT_DB)
      );
      if (i >= encendidas) volcar(capas.on, borde(i, span), borde(i + 1, span));
    }
  } else {
    volcar(capas.on, 0, dbToFraction(level.db) * span);

    // Marcas de la escala: rayas finas grabadas en el tubo
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    const grosorMarca = Math.max(1, Math.round(dpr));
    for (const db of METER_TICKS_DB) {
      const at = dbToFraction(db) * span;
      const r = rectEje(vertical, w, h, at, at + grosorMarca, 0);
      ctx.fillRect(...r);
    }

    // Testigo de pico: un trocito de tubo encendido allá donde se quedó
    if (level.peakDb > METER_MIN_DB) {
      const at = dbToFraction(level.peakDb) * span;
      const largoMarca = Math.max(2, Math.round(2 * dpr));
      volcar(capas.on, at - largoMarca, at);
    }
  }

  // Aviso de saturación: bloque rojo fijo en el techo del medidor, se vea
  // donde se vea la barra, y se queda encendido un rato tras el pico
  if (level.clip) {
    const capLen = Math.max(3, Math.round(4 * dpr));
    ctx.save();
    ctx.shadowColor = "#ff2d2d";
    ctx.shadowBlur = Math.max(3, Math.round(4 * dpr));
    ctx.fillStyle = "#ff2d2d";
    ctx.fillRect(...rectEje(vertical, w, h, span - capLen, span, 0));
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(
      ...rectEje(vertical, w, h, span - capLen - Math.max(1, Math.round(dpr)), span - capLen, 0)
    );
  }
}

// El cristal del medidor, el mismo que el de la pantalla y el de la onda
const CRISTAL = glassOverlay();

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

    // Las capas se rehacen solo al cambiar de tamaño o de modo
    let capas = null;
    let clave = "";

    const tick = () => {
      const mode = modeRef.current;
      const nueva = `${w}|${h}|${mode}`;
      if (nueva !== clave) {
        capas = construirCapas(w, h, vertical, mode, dpr);
        clave = nueva;
      }
      const level = read(performance.now());
      drawMeter(ctx, w, h, vertical, mode, level, dpr, capas);
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
        className={`relative rounded overflow-hidden ${
          vertical ? "w-3 flex-1" : "h-3 w-full"
        }`}
        style={{ backgroundColor: RAIL_BG }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {/* El cristal de delante: sombra dentro y una pizca de luz arriba. Va
            en CSS, no pintado en el lienzo: se compone una vez y no cuesta
            nada por frame. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded"
          style={CRISTAL}
        />
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
