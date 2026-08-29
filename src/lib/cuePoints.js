// Forma de los hot cues y de los loops guardados, y cómo se guardan.
//
// En disco (IndexedDB) se usa una lista COMPACTA: solo lo que el usuario ha
// puesto, cada entrada con su ranura. Una pista con dos cues ocupa dos objetos
// pequeños, no ocho huecos vacíos, y subir el número de cues no obliga a
// migrar nada de lo ya guardado.
//
//   hotCues:    [{ i: 0, t: 12.5, name: "drop" }, …]
//   savedLoops: [{ id, start, end, name, beats }, …]
//   activeLoop: { start, end, beats } | null
//
// En el deck se trabaja con un array de RANURAS de tamaño fijo (con null en
// las vacías), que es lo que dibujan los pads y la onda.

import { CUE_NAME_MAX, MAX_HOT_CUES, MAX_SAVED_LOOPS } from "./constants";

const isTime = (v) => Number.isFinite(v) && v >= 0;

/** Etiqueta de usuario: texto plano, sin saltos y con el largo acotado. */
export function sanitizeName(name) {
  if (typeof name !== "string") return "";
  return name.replace(/\s+/g, " ").trim().slice(0, CUE_NAME_MAX);
}

/** Lista compacta de hot cues, validada, ordenada por ranura y sin repetidos. */
export function sanitizeHotCues(list, size = MAX_HOT_CUES) {
  if (!Array.isArray(list)) return [];
  const porRanura = new Map();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const i = Number(raw.i);
    const t = Number(raw.t);
    if (!Number.isInteger(i) || i < 0 || i >= size) continue;
    if (!isTime(t)) continue;
    porRanura.set(i, { i, t, name: sanitizeName(raw.name) });
  }
  return [...porRanura.values()].sort((a, b) => a.i - b.i);
}

/** Lista compacta → array de ranuras (null en las vacías) para el deck. */
export function hotCuesToSlots(list, size = MAX_HOT_CUES) {
  const slots = new Array(size).fill(null);
  for (const cue of sanitizeHotCues(list, size)) {
    slots[cue.i] = { t: cue.t, name: cue.name };
  }
  return slots;
}

/** Array de ranuras del deck → lista compacta para guardar. */
export function slotsToHotCues(slots) {
  if (!Array.isArray(slots)) return [];
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    const cue = slots[i];
    if (!cue || !isTime(cue.t)) continue;
    out.push({ i, t: cue.t, name: sanitizeName(cue.name) });
  }
  return out;
}

/** Ranuras vacías: el estado de partida de un deck sin pista. */
export function emptyHotCues(size = MAX_HOT_CUES) {
  return new Array(size).fill(null);
}

/** Región de loop válida (start < end) o null. */
export function sanitizeLoopRegion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const start = Number(raw.start);
  const end = Number(raw.end);
  if (!isTime(start) || !isTime(end) || end <= start) return null;
  const beats = Number(raw.beats);
  return {
    start,
    end,
    beats: Number.isFinite(beats) && beats > 0 ? beats : null,
  };
}

/** Loops guardados de una pista, validados y con el tope aplicado. */
export function sanitizeSavedLoops(list, max = MAX_SAVED_LOOPS) {
  if (!Array.isArray(list)) return [];
  // Los identificadores que YA vienen puestos se apartan antes de generar
  // ninguno: si no, un loop sin id podría llevarse el de otro que viene
  // detrás en la misma lista.
  const reservados = list
    .filter((r) => r && typeof r.id === "string" && r.id)
    .map((r) => ({ id: r.id }));
  const out = [];
  for (const raw of list) {
    const region = sanitizeLoopRegion(raw);
    if (!region) continue;
    out.push({
      id:
        typeof raw.id === "string" && raw.id
          ? raw.id
          : nextLoopId([...reservados, ...out]),
      ...region,
      name: sanitizeName(raw.name),
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Identificador local de un loop guardado (solo tiene que ser único aquí). */
export function nextLoopId(existing = []) {
  const usados = new Set(existing.map((l) => l?.id));
  let n = existing.length + 1;
  while (usados.has(`loop-${n}`)) n++;
  return `loop-${n}`;
}

/** ¿Han cambiado los cues/loops respecto a lo que ya hay guardado? */
export function sameCueData(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
