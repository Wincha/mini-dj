// Medición de nivel para los VU: escala en dBFS, balística de mesa y
// detección de saturación. Sin dependencias de React: lo usa el canvas del
// VUBar, pero vale para cualquier consumidor.

// Rango visible del medidor. 0 dBFS es el techo digital: por encima el
// convertidor recorta, así que ahí es donde va la zona roja.
export const METER_MIN_DB = -42;
export const METER_MAX_DB = 0;

// Marcas de la escala, como en el panel de una mesa
export const METER_TICKS_DB = [-3, -6, -12, -18, -24, -30, -36];
// Marcas con número en el medidor horizontal (solo cifras: no dependen del idioma)
export const METER_LABELS_DB = [0, -6, -12, -24, -42];

// Zonas de color: verde hasta -12, ámbar hasta -3, rojo pegado al techo
export const ZONE_AMBER_DB = -12;
export const ZONE_RED_DB = -3;

export const METER_COLORS = {
  green: "#34d399",
  amber: "#fbbf24",
  red: "#ef4444",
};

// Muestra que ya cuenta como saturación (≈ −0,04 dBFS)
const CLIP_SAMPLE = 0.995;
const CLIP_HOLD_MS = 1500; // el aviso de saturación se queda un rato

// Balística de medidor de programa (PPM), como la de una mesa: la barra
// sube al momento con el pico de la señal y baja a ritmo constante.
// El testigo retiene el MÁXIMO DE LA PROPIA BARRA, no otra medida distinta:
// si la barra midiera el nivel eficaz y el testigo el pico de muestra, la
// diferencia entre ambos (el factor de cresta, 8–14 dB en música) dejaría
// el testigo clavado cuatro o cinco segmentos por encima de la barra —un
// hueco permanente— en vez de marcar los transitorios, que es su trabajo.
const BAR_RELEASE_DB_PER_SEC = 20;
const PEAK_HOLD_MS = 1200;
const PEAK_RELEASE_DB_PER_SEC = 12;

// dB → fracción 0..1 del recorrido del medidor (lineal en dB, como los LED
// de una mesa: cada segmento vale los mismos dB)
export function dbToFraction(db) {
  const f = (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

export function colorForDb(db) {
  if (db >= ZONE_RED_DB) return METER_COLORS.red;
  if (db >= ZONE_AMBER_DB) return METER_COLORS.amber;
  return METER_COLORS.green;
}

// Crea un lector con estado propio sobre un AnalyserNode. Devuelve una
// función read(nowMs) → { db, peakDb, clip }, todo en dBFS de pico.
// El búfer se reserva una sola vez: leer 30 veces por segundo sin reservar
// nada es lo que mantiene el coste plano.
export function createLevelMeter(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  let barDb = METER_MIN_DB;
  let peakDb = METER_MIN_DB;
  let peakHoldUntil = 0;
  let clipUntil = 0;
  let lastMs = 0;

  return function read(nowMs) {
    analyser.getFloatTimeDomainData(buf);

    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const sampleDb = peak > 0 ? 20 * Math.log10(peak) : METER_MIN_DB;

    // dt real: si la pestaña se queda dormida no queremos una caída enorme
    const dt = lastMs ? Math.min(0.25, (nowMs - lastMs) / 1000) : 0;
    lastMs = nowMs;

    // Barra: sube al momento, baja a ritmo constante
    barDb =
      sampleDb >= barDb
        ? sampleDb
        : Math.max(sampleDb, barDb - BAR_RELEASE_DB_PER_SEC * dt);
    if (!(barDb > METER_MIN_DB)) barDb = METER_MIN_DB;

    // Testigo: el máximo de la barra. En régimen se queda pegado a lo alto
    // de la barra y solo se despega mientras esta baja tras un transitorio.
    if (barDb >= peakDb) {
      peakDb = barDb;
      peakHoldUntil = nowMs + PEAK_HOLD_MS;
    } else if (nowMs > peakHoldUntil) {
      peakDb = Math.max(barDb, peakDb - PEAK_RELEASE_DB_PER_SEC * dt);
    }
    if (!(peakDb > METER_MIN_DB)) peakDb = METER_MIN_DB;

    if (peak >= CLIP_SAMPLE) clipUntil = nowMs + CLIP_HOLD_MS;

    return { db: barDb, peakDb, clip: nowMs < clipUntil };
  };
}
