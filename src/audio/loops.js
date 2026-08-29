// Aritmética de loops: todo lo que hay que calcular para montar, mover,
// redimensionar y salir de un loop. Son funciones PURAS (no tocan el <audio>
// ni el estado de React) para poder probarlas sin navegador ni tarjeta de
// sonido.
//
// Convenio: los tiempos son SIEMPRE tiempo de pista en segundos. El pitch no
// entra en ninguna cuenta de este archivo — cambia la velocidad de
// reproducción, no dónde están las cosas dentro del tema.

// Longitudes del loop roll, en beats
export const ROLL_SIZES = [1 / 8, 1 / 4, 1 / 2, 1, 2, 4];

// Longitudes de los loops automáticos, en beats
export const AUTO_LOOP_SIZES = [4, 8, 16];

// Límites al doblar y partir la longitud
export const LOOP_MIN_BEATS = 1 / 32;
export const LOOP_MAX_BEATS = 64;

// Un loop sin rejilla (IN/OUT a mano) no se puede medir en beats: se le
// aplican estos topes en segundos.
export const LOOP_MIN_SECONDS = 0.02;

/** Duración de un beat en segundos, o null si no hay BPM. */
export function beatSeconds(bpm) {
  return bpm > 0 ? 60 / bpm : null;
}

/** Índice del primer beat >= time (búsqueda binaria sobre la rejilla). */
function lowerBound(beats, time) {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Beat más cercano de la rejilla. Sin rejilla devuelve el tiempo tal cual. */
export function nearestBeat(beats, time) {
  if (!beats || !beats.length || !Number.isFinite(time)) return time;
  const i = lowerBound(beats, time);
  const after = beats[i];
  const before = beats[i - 1];
  if (after == null) return before;
  if (before == null) return after;
  return after - time < time - before ? after : before;
}

/** Último beat <= time (el que ya ha sonado). Sin rejilla, el tiempo tal cual. */
export function previousBeat(beats, time) {
  if (!beats || !beats.length || !Number.isFinite(time)) return time;
  const i = lowerBound(beats, time + 1e-9);
  return i > 0 ? beats[i - 1] : beats[0];
}

/**
 * Inicio de la subdivisión de tamaño `step` que contiene a `time`, contando
 * desde `anchor`. Es lo que hace que un roll de 1/8 caiga en la corchea de la
 * rejilla y no donde pillara el dedo.
 */
export function subdivisionStart(anchor, step, time) {
  if (!(step > 0) || !Number.isFinite(time)) return time;
  const base = Number.isFinite(anchor) ? anchor : 0;
  // Un pelín de margen: si el playhead está justo encima de la marca, cuenta
  // como que ya está dentro de esa subdivisión y no de la anterior.
  const k = Math.floor((time - base) / step + 1e-9);
  return base + k * step;
}

/**
 * Loop automático de N beats: empieza en el beat anterior de la rejilla real
 * de la pista (la ajustada a mano incluida) y dura N beats exactos.
 * Devuelve null si no cabe entera dentro de la pista.
 */
export function autoLoop({ bpm, beats, time, lengthBeats, duration }) {
  const beat = beatSeconds(bpm);
  if (!beat || !(lengthBeats > 0)) return null;
  const start = previousBeat(beats, time);
  if (!Number.isFinite(start)) return null;
  const end = start + lengthBeats * beat;
  if (duration > 0 && end > duration) return null;
  return { start, end, beats: lengthBeats };
}

/**
 * Región de un loop roll. Con quantize, el inicio se imanta a la subdivisión
 * de su propio tamaño; sin quantize arranca donde esté el playhead.
 */
export function rollLoop({
  bpm,
  gridAnchor,
  time,
  lengthBeats,
  quantize,
  duration,
}) {
  const beat = beatSeconds(bpm);
  if (!beat || !(lengthBeats > 0) || !Number.isFinite(time)) return null;
  const len = lengthBeats * beat;
  const start =
    quantize && Number.isFinite(gridAnchor)
      ? subdivisionStart(gridAnchor, len, time)
      : time;
  if (start < 0) return null;
  const end = start + len;
  if (duration > 0 && end > duration) return null;
  return { start, end, beats: lengthBeats };
}

/**
 * Desplaza el loop una longitud entera hacia delante (dir = +1) o hacia atrás
 * (dir = −1), sin cambiarle el tamaño. Si no cabe, no se mueve (null).
 */
export function moveLoop({ start, end, dir, duration }) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  const len = end - start;
  const delta = Math.sign(dir || 0) * len;
  if (!delta) return null;
  const next = start + delta;
  if (next < 0) return null;
  if (duration > 0 && next + len > duration) return null;
  return { start: next, end: next + len };
}

/**
 * Dobla (factor 2) o parte (factor 0,5) la longitud del loop manteniendo el
 * punto de entrada. Con rejilla, la longitud se lleva en BEATS para que el
 * resultado siga cuadrando con ella; sin rejilla se trabaja en segundos.
 */
export function resizeLoop({ start, end, factor, bpm, lengthBeats, duration }) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  if (!(factor > 0)) return null;
  const beat = beatSeconds(bpm);

  if (beat && lengthBeats > 0) {
    const nextBeats = lengthBeats * factor;
    if (nextBeats < LOOP_MIN_BEATS || nextBeats > LOOP_MAX_BEATS) return null;
    const nextEnd = start + nextBeats * beat;
    if (duration > 0 && nextEnd > duration) return null;
    return { start, end: nextEnd, beats: nextBeats };
  }

  const len = (end - start) * factor;
  if (len < LOOP_MIN_SECONDS) return null;
  const nextEnd = start + len;
  if (duration > 0 && nextEnd > duration) return null;
  return { start, end: nextEnd, beats: null };
}

/**
 * Dónde continúa la reproducción al soltar un loop roll.
 *
 * Mientras el roll está puesto la pista repite el mismo trozo, así que la
 * posición real se queda atrás. Cada vuelta completa vale una longitud de
 * loop: si el bucle ha dado `wraps` vueltas y el playhead está en `current`,
 * la pista "habría llegado" a current + wraps × longitud. Así al soltar se
 * sigue donde tocaba, no donde quedó el bucle.
 */
export function rollExitTime({ current, wraps, loopLength, duration }) {
  if (!Number.isFinite(current)) return 0;
  const n = Math.max(0, Math.floor(wraps || 0));
  const len = loopLength > 0 ? loopLength : 0;
  const exit = current + n * len;
  if (duration > 0) return Math.min(exit, Math.max(0, duration - 0.01));
  return exit;
}

/**
 * Punto de entrada al dar la vuelta, ARRASTRANDO el retraso del aviso.
 *
 * El salto nunca llega exactamente en el instante del OUT: cuando salta ya nos
 * hemos pasado unos milisegundos. Si se entrara siempre en el IN clavado, ese
 * retraso se acumularía y el loop perdería la fase. Metiendo el sobrante
 * dentro del bucle, la longitud sonando sigue siendo exacta.
 */
export function wrapTime({ current, start, end }) {
  const len = end - start;
  if (!(len > 0)) return start;
  const over = current - end;
  if (!(over > 0)) return start;
  return start + (over % len);
}

/** Etiqueta corta de una longitud en beats: 0.125 → "1/8", 4 → "4". */
export function beatsLabel(beats) {
  if (!(beats > 0)) return "—";
  if (beats >= 1) {
    return Number.isInteger(beats) ? String(beats) : beats.toFixed(2);
  }
  const denom = Math.round(1 / beats);
  return `1/${denom}`;
}
