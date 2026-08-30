// === Estructura de la pista: tramos con ritmo y tramos sin ritmo ===
//
// La idea es la que usa cualquier DJ mirando la onda: donde hay golpe de
// graves en cada beat, hay ritmo; donde deja de haberlo, es un bajón; cuando
// vuelve, es el subidón. Aquí eso se hace beat a beat sobre la REJILLA REAL de
// la pista (la detectada o la que haya ajustado el usuario a mano), no sobre
// una cuadrícula inventada.
//
// De dónde salen los datos: `analyzeWaveform` (src/audio/utils.js) ya recorre
// el buffer una vez y calcula la energía de graves por muestra para colorear
// la onda. Se reutiliza tal cual: aquí NO se vuelve a tocar el audio.
//
// Todo lo de este módulo son funciones puras. Se calcula una vez al cargar la
// pista y el resultado se guarda por pista; durante la reproducción solo se
// consulta (`structureAt`), que es una búsqueda binaria y cuatro restas.

// Tamaños de frase que se ofrecen. 16 kicks (4 compases) es lo normal en
// electrónica; 32 en tramos largos y 4/8 para música más picada.
export const PHRASE_SIZES = [4, 8, 16, 32];
export const DEFAULT_PHRASE_SIZE = 16;

// Un tramo más corto que esto no se considera un cambio de estructura, sino
// un hueco del propio ritmo (un beat sin bombo, un break de caja de un
// compás). Sin este mínimo la pista salía troceada en cuarenta tramos.
const MIN_SECTION_BEATS = 8;

// Ventana donde se busca el golpe de cada beat, en fracción de beat: un poco
// antes (la rejilla puede ir unos ms adelantada) y hasta un tercio de beat
// después, que es lo que dura el ataque de un bombo.
const KICK_WINDOW_BEFORE = 0.18;
const KICK_WINDOW_AFTER = 0.34;

// Umbral de "aquí hay kick", en fracción de la fuerza de referencia de la
// pista (el percentil 85 de todos los beats). Un bombo suave de un tramo
// flojo entra; un bajo sostenido sin golpe, no.
const KICK_THRESHOLD = 0.3;

// Al refinar un límite se comparan estos beats de antes con estos de después.
// Cuatro (un compás) es lo que mejor separa el cambio de verdad del último
// coletazo de bajo que deja el bombo al apagarse.
const EDGE_WINDOW = 4;

// Cuánto se puede desviar un cambio de una línea de frase y seguir contando
// como que cuadra con ella, en kicks.
const PHRASE_FIT_TOLERANCE = 2;

// Para dar la estructura por buena hace falta que la separación entre los
// beats con kick y los que no sea de verdad, no ruido: al menos esta
// proporción de beats con ritmo y como mucho esta otra.
const MIN_KICK_RATIO = 0.15;
const MAX_KICK_RATIO = 0.97;

/** Percentil de un array (copia y ordena; se llama una vez por pista). */
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

/**
 * Fuerza del golpe de graves en cada beat de la rejilla.
 *
 * Se mide el ASCENSO de la energía de graves (no su nivel): un bajo sostenido
 * de un bajón tiene mucho nivel y ningún ataque, y así no se cuela como kick.
 *
 * @param bandLow energía de graves por muestra (analyzeWaveform)
 * @param rate    muestras por segundo de bandLow
 * @param beats   tiempos de beat, en segundos
 * @returns Float32Array con la fuerza cruda de cada beat
 */
export function kickStrengths({ bandLow, rate, beats }) {
  const out = new Float32Array(beats?.length || 0);
  if (!bandLow?.length || !(rate > 0) || !beats?.length) return out;

  const n = bandLow.length;
  // Ascenso de la energía de graves entre muestras consecutivas
  const flux = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const d = bandLow[i] - bandLow[i - 1];
    flux[i] = d > 0 ? d : 0;
  }

  const beat = beats.length > 1 ? beats[1] - beats[0] : 0.5;
  const before = Math.max(1, Math.round(beat * KICK_WINDOW_BEFORE * rate));
  const after = Math.max(1, Math.round(beat * KICK_WINDOW_AFTER * rate));

  for (let b = 0; b < beats.length; b++) {
    const center = Math.round(beats[b] * rate);
    const from = Math.max(1, center - before);
    const to = Math.min(n, center + after + 1);
    let max = 0;
    for (let i = from; i < to; i++) if (flux[i] > max) max = flux[i];
    out[b] = max;
  }
  return out;
}

/**
 * Une los tramos demasiado cortos con sus vecinos. Devuelve el mismo array de
 * banderas ya limpio: sin esto, un beat suelto sin bombo partía la pista.
 */
function smoothRuns(flags, minRun) {
  if (flags.length <= minRun) return flags;
  const runs = [];
  let start = 0;
  for (let i = 1; i <= flags.length; i++) {
    if (i === flags.length || flags[i] !== flags[start]) {
      runs.push({ start, end: i, value: flags[start] });
      start = i;
    }
  }

  // Se absorbe siempre el tramo corto MÁS corto, y se repite: así una racha
  // de tramos cortos acaba en uno solo en vez de en un patrón alterno.
  for (;;) {
    if (runs.length < 2) break;
    let worst = -1;
    for (let i = 0; i < runs.length; i++) {
      const len = runs[i].end - runs[i].start;
      if (len >= minRun) continue;
      if (worst < 0 || len < runs[worst].end - runs[worst].start) worst = i;
    }
    if (worst < 0) break;
    // Se funde con el vecino más largo (si solo hay uno, con ese)
    const prev = worst > 0 ? runs[worst - 1] : null;
    const next = worst < runs.length - 1 ? runs[worst + 1] : null;
    const prevLen = prev ? prev.end - prev.start : -1;
    const nextLen = next ? next.end - next.start : -1;
    const into = prevLen >= nextLen ? worst - 1 : worst + 1;
    runs[into].start = Math.min(runs[into].start, runs[worst].start);
    runs[into].end = Math.max(runs[into].end, runs[worst].end);
    runs.splice(worst, 1);
    // Los vecinos del hueco pueden haber quedado con el mismo valor: se juntan
    for (let i = runs.length - 1; i > 0; i--) {
      if (runs[i].value === runs[i - 1].value) {
        runs[i - 1].end = runs[i].end;
        runs.splice(i, 1);
      }
    }
  }

  const out = new Uint8Array(flags.length);
  for (const r of runs) out.fill(r.value, r.start, r.end);
  return out;
}

/**
 * Afina un límite al beat EXACTO en el que cambia la música.
 *
 * El umbral y el mínimo de tramo dan un límite aproximado: la cola de graves
 * que deja el bombo al apagarse mantiene la cuenta un par de beats de más. Aquí
 * se busca, en el entorno del límite, el beat donde el salto de fuerza entre el
 * compás de antes y el de después es mayor. Es lo que hace que la cuenta atrás
 * llegue a cero justo cuando cambia la música y no tres kicks tarde.
 *
 * Devuelve el beat afinado y lo marcado del cambio (sirve de peso para cuadrar
 * la frase).
 */
function refineEdge(strengths, at, toKick, search) {
  const W = EDGE_WINDOW;
  let best = at;
  let bestGap = -Infinity;
  const mean = (from, to) => {
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, from); i < Math.min(strengths.length, to); i++) {
      sum += strengths[i];
      n++;
    }
    return n ? sum / n : 0;
  };
  for (let b = at - search; b <= at + search; b++) {
    if (b <= 0 || b >= strengths.length) continue;
    const before = mean(b - W, b);
    const after = mean(b, b + W);
    const gap = toKick ? after - before : before - after;
    if (gap > bestGap) {
      bestGap = gap;
      best = b;
    }
  }
  return { beat: best, weight: Math.max(0, bestGap) };
}

/**
 * Desplazamiento de frase que mejor cuadra con los cambios detectados.
 *
 * En electrónica es normal que la intro corra la estructura 4, 8 o 16 kicks,
 * así que no se da por hecho que la frase empieza en el primer beat: se prueba
 * cada desplazamiento posible y gana el que deja los cambios más pegados a un
 * límite de frase.
 *
 * Los cambios pesan distinto: un subidón (vuelve el ritmo) marca la frase
 * mucho mejor que un bajón, porque es el punto al que un DJ cuenta.
 *
 * @param boundaries [{beat, weight}] o índices sueltos de beat (sin el 0)
 * @param phraseSize tamaño de frase en kicks
 */
export function fitPhraseOffset(boundaries, phraseSize) {
  const size = phraseSize > 0 ? Math.round(phraseSize) : DEFAULT_PHRASE_SIZE;
  if (!boundaries?.length) return 0;
  const marks = boundaries.map((b) =>
    typeof b === "number" ? { beat: b, weight: 1 } : { beat: b.beat, weight: b.weight ?? 1 }
  );

  // Los pesos se normalizan contra su mediana y se topan: un cambio
  // brutalísimo (el bombo entrando desde el silencio de la intro) no puede
  // decidir él solo el encaje de toda la pista.
  const median = percentile(marks.map((m) => m.weight), 0.5) || 1;
  for (const m of marks) m.weight = Math.min(1, m.weight / median);

  // Puntuación por CERCANÍA, no por distancia: un cambio que no cae cerca de
  // ninguna línea de frase suma cero en vez de tirar del resto. Así los
  // cambios que sí cuadran mandan y los sueltos no estorban.
  const tol = Math.max(1, Math.min(PHRASE_FIT_TOLERANCE, size / 4));
  let best = 0;
  let bestScore = -1;
  for (let o = 0; o < size; o++) {
    let score = 0;
    for (const m of marks) {
      const d = ((m.beat - o) % size + size) % size;
      const dist = Math.min(d, size - d);
      if (dist < tol) score += m.weight * (1 - dist / tol);
    }
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

/**
 * Análisis de estructura de una pista.
 *
 * @param bandLow    energía de graves por muestra (analyzeWaveform)
 * @param duration   duración del AUDIO QUE PRODUJO `bandLow`, en segundos. De
 *                   ahí sale su cadencia (bandLow.length / duration), así que
 *                   pasar otra duración parecida (la del <audio> en vez de la
 *                   del buffer) desplaza los tramos.
 * @param beats      rejilla real de la pista (buildBeatGrid)
 * @param phraseSize tamaño de frase en kicks
 *
 * Devuelve `null` si no hay con qué trabajar (sin rejilla o sin graves).
 * Si la pista no tiene estructura clara devuelve un único tramo con ritmo y
 * `confident: false`: el indicador entonces no se inventa ningún cambio.
 */
export function detectStructure({
  bandLow,
  duration,
  beats,
  phraseSize = DEFAULT_PHRASE_SIZE,
} = {}) {
  if (!bandLow?.length || !beats?.length || !(duration > 0)) return null;

  const rate = bandLow.length / duration;
  const strengths = kickStrengths({ bandLow, rate, beats });

  const ref = percentile(strengths, 0.85);
  if (!(ref > 0)) {
    // Pista sin graves con los que trabajar: un solo tramo y a callar
    return {
      sections: [{ start: 0, end: duration, kick: true, startBeat: 0, endBeat: beats.length }],
      phraseSize,
      phraseOffset: 0,
      detectedOffset: 0,
      confident: false,
      manual: false,
    };
  }

  const threshold = ref * KICK_THRESHOLD;
  const raw = new Uint8Array(strengths.length);
  let kicks = 0;
  for (let i = 0; i < strengths.length; i++) {
    raw[i] = strengths[i] >= threshold ? 1 : 0;
    kicks += raw[i];
  }

  const flags = smoothRuns(raw, MIN_SECTION_BEATS);

  // Límites aproximados (donde cambia la bandera) y su versión afinada al
  // beat exacto del cambio.
  const edges = [];
  for (let i = 1; i < flags.length; i++) {
    if (flags[i] !== flags[i - 1]) edges.push({ at: i, toKick: flags[i] === 1 });
  }
  const search = Math.max(2, Math.floor(MIN_SECTION_BEATS / 2));
  const marks = [];
  let last = 0;
  for (const e of edges) {
    const r = refineEdge(strengths, e.at, e.toKick, search);
    // Sin pisar el límite anterior: el afinado mueve como mucho medio tramo
    const beat = Math.max(last + 1, Math.min(flags.length - 1, r.beat));
    last = beat;
    // Un subidón cuadra la frase mucho mejor que un bajón: pesa el doble
    marks.push({ beat, toKick: e.toKick, weight: r.weight * (e.toKick ? 2 : 1) });
  }

  // Tramos, en segundos. El primero arranca en 0 (lo que haya antes del
  // primer beat va con él) y el último llega hasta el final de la pista.
  const sections = [];
  let start = 0;
  let kick = flags[0] === 1;
  for (let i = 0; i <= marks.length; i++) {
    const end = i < marks.length ? marks[i].beat : flags.length;
    sections.push({
      start: start === 0 ? 0 : beats[start],
      end: i < marks.length ? beats[end] : duration,
      kick,
      startBeat: start,
      endBeat: end,
    });
    start = end;
    kick = !kick;
  }

  const phraseOffset = fitPhraseOffset(marks, phraseSize);

  // ¿Hay estructura de verdad? Hace falta al menos un bajón reconocible y que
  // la separación entre "con kick" y "sin kick" no sea un empate.
  const ratio = strengths.length ? kicks / strengths.length : 0;
  const confident =
    sections.length > 1 &&
    sections.some((s) => !s.kick) &&
    ratio >= MIN_KICK_RATIO &&
    ratio <= MAX_KICK_RATIO;

  return {
    sections,
    phraseSize,
    phraseOffset,
    // Lo que dijo el análisis: es a donde vuelve el botón de reset de la caja
    // de estructura si el usuario ha movido la frase a mano.
    detectedOffset: phraseOffset,
    confident,
    manual: false,
  };
}

/**
 * Recoloca el desplazamiento de frase para otro tamaño, sin volver a analizar
 * nada: los límites de los tramos ya están, solo cambia la retícula.
 */
export function refitPhrase(structure, phraseSize) {
  if (!structure?.sections?.length) return structure;
  const size = phraseSize > 0 ? Math.round(phraseSize) : DEFAULT_PHRASE_SIZE;
  if (structure.phraseSize === size) return structure;
  const boundaries = structure.sections
    .slice(1)
    .map((s) => s.startBeat)
    .filter((b) => b > 0);
  const detectedOffset = fitPhraseOffset(boundaries, size);
  return {
    ...structure,
    phraseSize: size,
    detectedOffset,
    // Un desplazamiento puesto a mano se respeta también al cambiar de tamaño:
    // solo se le da la vuelta para que quepa en la frase nueva.
    phraseOffset: structure.manual
      ? shiftPhraseOffset(structure.phraseOffset, 0, size)
      : detectedOffset,
  };
}

/**
 * Vuelve a colgar los tramos de la rejilla actual.
 *
 * Los tramos se guardan en SEGUNDOS, que es lo que no cambia; los índices de
 * beat se recalculan aquí. Así un ajuste de rejilla posterior (o cargar la
 * pista con la rejilla ya guardada) no descuadra la cuenta.
 */
export function alignStructure(structure, beats) {
  if (!structure?.sections?.length || !beats?.length) return structure;
  const index = (time) => {
    const i = nearestBeatIndex(beats, time);
    if (i < 0) return 0;
    // El beat más cercano, no el anterior: el límite se guardó justo encima
    // de un beat y el redondeo del tiempo no debe correrlo uno hacia atrás.
    const next = i + 1;
    if (next < beats.length && beats[next] - time < time - beats[i]) return next;
    return i;
  };
  const sections = structure.sections.map((s, i) => ({
    ...s,
    startBeat: i === 0 ? 0 : index(s.start),
    endBeat: index(s.end),
  }));
  // El último tramo llega hasta el final de la pista
  if (sections.length) sections[sections.length - 1].endBeat = beats.length;
  return { ...structure, sections };
}

/**
 * Deja una estructura venida de IndexedDB en forma utilizable (o null). Se
 * guarda por pista, así que hay que suponer que puede llegar cualquier cosa.
 */
export function sanitizeStructure(raw) {
  if (!raw || !Array.isArray(raw.sections) || !raw.sections.length) return null;
  const sections = raw.sections
    .filter(
      (s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start
    )
    .map((s) => ({
      start: Math.max(0, s.start),
      end: s.end,
      kick: Boolean(s.kick),
      startBeat: Number.isFinite(s.startBeat) ? s.startBeat : 0,
      endBeat: Number.isFinite(s.endBeat) ? s.endBeat : 0,
    }));
  if (!sections.length) return null;
  const phraseSize = PHRASE_SIZES.includes(raw.phraseSize)
    ? raw.phraseSize
    : DEFAULT_PHRASE_SIZE;
  return {
    sections,
    phraseSize,
    phraseOffset: shiftPhraseOffset(raw.phraseOffset, 0, phraseSize),
    detectedOffset: shiftPhraseOffset(raw.detectedOffset, 0, phraseSize),
    confident: Boolean(raw.confident),
    manual: Boolean(raw.manual),
  };
}

/** Mueve el desplazamiento de frase n kicks, dando la vuelta por el tamaño. */
export function shiftPhraseOffset(offset, delta, phraseSize) {
  const size = phraseSize > 0 ? Math.round(phraseSize) : DEFAULT_PHRASE_SIZE;
  const base = Number.isFinite(offset) ? Math.round(offset) : 0;
  return ((base + Math.round(delta)) % size + size) % size;
}

/** Índice del último beat que cae en o antes de `time` (búsqueda binaria). */
export function nearestBeatIndex(beats, time) {
  if (!beats?.length) return -1;
  if (time < beats[0]) return -1;
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Estado de la estructura en un instante: si suena el ritmo, cuántos kicks
 * quedan hasta el próximo cambio, cuántos hasta el siguiente, y por dónde se
 * va dentro de la frase.
 *
 * Esto es lo que consulta el indicador de la onda. Es barato a propósito: una
 * búsqueda binaria sobre la rejilla y unas restas, para poder llamarlo a
 * menudo sin tocar el bucle de dibujado.
 *
 * Devuelve null si no hay nada que enseñar.
 */
export function structureAt({ structure, beats, time, phraseSize, phraseOffset } = {}) {
  if (!beats?.length || !Number.isFinite(time)) return null;
  // Antes del primer beat se cuenta como si ya estuviéramos en él: al cargar
  // una pista el playhead está en 0 y el indicador tiene que decir algo.
  const beatIndex = Math.max(0, nearestBeatIndex(beats, time));

  const size =
    phraseSize > 0
      ? Math.round(phraseSize)
      : structure?.phraseSize || DEFAULT_PHRASE_SIZE;
  const offset = Number.isFinite(phraseOffset)
    ? phraseOffset
    : structure?.phraseOffset || 0;

  const phrasePos = ((beatIndex - offset) % size + size) % size + 1;

  // Kicks que quedan hasta el final de la pista. Es lo que se enseña cuando ya
  // no hay más cambios por delante: la mitad de las pistas se pasan el último
  // minuto (o los tres últimos) sin un solo bajón, y ahí el indicador se
  // quedaba en blanco como si estuviera roto.
  const toEnd = beats.length - 1 - beatIndex > 0 ? beats.length - 1 - beatIndex : null;

  const base = {
    beatIndex,
    phrasePos,
    phraseSize: size,
    inKick: true,
    toChange: null,
    toNext: null,
    toEnd,
  };
  const sections = structure?.confident ? structure.sections : null;
  if (!sections?.length) return base;

  // Tramo actual: el último que empieza en o antes de este beat
  let idx = 0;
  for (let i = 0; i < sections.length; i++) {
    if (time >= sections[i].start) idx = i;
    else break;
  }
  const current = sections[idx];
  const next = sections[idx + 1] || null;
  const after = sections[idx + 2] || null;

  // Cuenta en KICKS de rejilla: los que faltan desde el beat actual hasta el
  // beat donde cambia la música. Llega a 1 en el último kick y el cambio pasa
  // justo después, que es como se cuenta a mano ("…4, 3, 2, 1, ¡ya!").
  const beatsTo = (section) => {
    if (!section) return null;
    const n = section.startBeat - beatIndex;
    return n > 0 ? n : null;
  };

  return {
    ...base,
    inKick: Boolean(current.kick),
    toChange: beatsTo(next),
    toNext: beatsTo(after),
  };
}
