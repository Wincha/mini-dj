// Paletas de la onda coloreada por bandas (graves / medios / agudos).
//
// El truco para que dibujar siga siendo barato: el análisis no guarda tres
// energías por muestra, sino un ÍNDICE de paleta ya cuantizado (Uint8Array).
// Al pintar, WaveformCanvas agrupa los píxeles por índice y hace como mucho
// PALETTE_SIZE rellenos por frame en vez de uno por píxel.
//
// El índice NO depende de la paleta: cambiar de preset recolorea al vuelo, sin
// volver a analizar nada.

// Niveles de cuantización por banda (graves y agudos; los medios salen de
// restar). 6 niveles → 36 entradas de paleta: suficiente para que no se vea
// escalonado y pocas suficientes para no disparar los cambios de estado del
// canvas.
const LEVELS = 6;
export const PALETTE_LEVELS = LEVELS;
export const PALETTE_SIZE = LEVELS * LEVELS;

// Verde plano de siempre: se usa cuando una pista no tiene datos de bandas
// (por ejemplo si el análisis falló) para no dejar la onda sin dibujar.
export const WAVE_FLAT_COLOR = "#22c55e";

// Presets. Los de marca imitan el aspecto de esos programas, no son sus
// valores oficiales: `brand` es solo el nombre que se muestra, sin traducir.
export const WAVE_PRESETS = [
  // El de casa: naranja bombo/bajo, verde cuerpo, azul hats
  { id: "minidj", brand: null, low: "#f97316", mid: "#22c55e", high: "#38bdf8" },
  // Serato tira de RGB puro por banda
  {
    id: "serato",
    brand: "Serato",
    low: "#ef4444",
    mid: "#22c55e",
    high: "#3b82f6",
  },
  // Traktor, aire "Ultraviolet"
  {
    id: "traktor",
    brand: "Traktor",
    low: "#4338ca",
    mid: "#c026d3",
    high: "#67e8f9",
  },
  // rekordbox RGB: graves azules, medios naranjas, agudos casi blancos
  {
    id: "rekordbox",
    brand: "rekordbox",
    low: "#2563eb",
    mid: "#f97316",
    high: "#e2e8f0",
  },
  // Monocromo: el verde plano de las versiones anteriores
  {
    id: "mono",
    brand: null,
    low: WAVE_FLAT_COLOR,
    mid: WAVE_FLAT_COLOR,
    high: WAVE_FLAT_COLOR,
  },
];

export const DEFAULT_WAVE_COLORS = WAVE_PRESETS[0];

/** Colores efectivos a partir de la configuración guardada. */
export function resolveWaveColors(config = {}) {
  if (config.wavePreset === "custom") {
    const custom = config.waveCustom || {};
    return {
      low: custom.low || DEFAULT_WAVE_COLORS.low,
      mid: custom.mid || DEFAULT_WAVE_COLORS.mid,
      high: custom.high || DEFAULT_WAVE_COLORS.high,
    };
  }
  const preset =
    WAVE_PRESETS.find((p) => p.id === config.wavePreset) || DEFAULT_WAVE_COLORS;
  return { low: preset.low, mid: preset.mid, high: preset.high };
}

function toRgb(hex) {
  const h = String(hex || "").replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
}

// Exponente de dominancia: mezclar las tres bases en proporción lineal daba
// tonos apagados en casi todo el rango útil (la mezcla típica de una pista
// está cerca del centro). Elevando las proporciones antes de mezclar, la banda
// que manda se lleva el tono y la onda se lee de un vistazo.
const DOMINANCE = 2.2;

function mix(bases, low, mid, high) {
  const w = [low, mid, high].map((v) => Math.pow(Math.max(0, v), DOMINANCE));
  const sum = w[0] + w[1] + w[2] || 1;
  const raw = [0, 1, 2].map(
    (i) => (bases[0][i] * w[0] + bases[1][i] * w[1] + bases[2][i] * w[2]) / sum
  );
  // Realce de saturación: sin él las mezclas equilibradas tiran a gris sucio
  const mean = (raw[0] + raw[1] + raw[2]) / 3;
  const boosted = raw.map((v) =>
    Math.max(0, Math.min(255, Math.round(mean + (v - mean) * 1.45)))
  );
  return `#${boosted.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Construir la paleta son 36 mezclas, pero se pide en cada render del diálogo
// de configuración (vista previa incluida): con una caché sale gratis.
const paletteCache = new Map();

/** Paleta indexada para unos colores de banda: palette[bandIndex] → color CSS. */
export function buildWavePalette(colors = DEFAULT_WAVE_COLORS) {
  const key = `${colors.low}|${colors.mid}|${colors.high}`;
  const cached = paletteCache.get(key);
  if (cached) return cached;

  const bases = [toRgb(colors.low), toRgb(colors.mid), toRgb(colors.high)];
  const out = new Array(PALETTE_SIZE);
  const step = 1 / (LEVELS - 1);
  for (let ql = 0; ql < LEVELS; ql++) {
    for (let qh = 0; qh < LEVELS; qh++) {
      let low = ql * step;
      let high = qh * step;
      const sum = low + high;
      // Las combinaciones imposibles (graves + agudos > 1) se normalizan en
      // vez de dejarse sin color: así el índice es siempre válido.
      if (sum > 1) {
        low /= sum;
        high /= sum;
      }
      out[ql * LEVELS + qh] = mix(bases, low, Math.max(0, 1 - low - high), high);
    }
  }

  // Tope de tamaño: arrastrando el selector de color se generan muchísimas
  // combinaciones y no hace falta guardarlas todas
  if (paletteCache.size > 24) paletteCache.clear();
  paletteCache.set(key, out);
  return out;
}

/** Paleta por defecto, para quien no reciba una por props. */
export const WAVE_PALETTE = buildWavePalette(DEFAULT_WAVE_COLORS);

/** Energías de banda (no normalizadas) → índice de paleta. */
export function bandColorIndex(lowRms, midRms, highRms) {
  const total = lowRms + midRms + highRms;
  if (!(total > 0)) return 0;
  const max = LEVELS - 1;
  let ql = Math.round((lowRms / total) * max);
  let qh = Math.round((highRms / total) * max);
  if (ql + qh > max) {
    // Reparto proporcional al recortar, para no perder siempre los agudos
    const over = ql + qh - max;
    const cutH = Math.round((over * qh) / (ql + qh));
    qh -= cutH;
    ql -= over - cutH;
  }
  return Math.max(0, Math.min(max, ql)) * LEVELS + Math.max(0, Math.min(max, qh));
}
