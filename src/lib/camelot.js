// Tonalidades y rueda Camelot.
// Sin dependencias del DOM ni de audio: lo usan tanto el detector de key
// (src/audio/keyDetect.js) como la lista de canciones para pintar las
// compatibilidades armónicas.

// Nombres de nota preferidos por convención DJ (los que usan Rekordbox y
// Mixed In Key): sostenidos salvo donde el bemol es el nombre habitual.
export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

// Camelot: para las mayores (modo "maj") el número avanza por quintas desde
// C = 8B; las menores comparten número con su relativa mayor (Am = 8A).
// Índice = pitch class (0 = C … 11 = B).
const MAJOR_NUMBERS = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_NUMBERS = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

/** Número Camelot (1..12) de una tonalidad. */
export function camelotNumber(pitchClass, mode) {
  const pc = ((pitchClass % 12) + 12) % 12;
  return mode === "min" ? MINOR_NUMBERS[pc] : MAJOR_NUMBERS[pc];
}

/** Código Camelot completo, p. ej. "8A". */
export function camelotCode(pitchClass, mode) {
  if (pitchClass == null || !mode) return null;
  return `${camelotNumber(pitchClass, mode)}${mode === "min" ? "A" : "B"}`;
}

/** Nombre musical, p. ej. "Am" o "C". */
export function keyName(pitchClass, mode) {
  if (pitchClass == null || !mode) return null;
  const pc = ((pitchClass % 12) + 12) % 12;
  return mode === "min" ? `${NOTE_NAMES[pc]}m` : NOTE_NAMES[pc];
}

/** Etiqueta compacta para la UI: "Am / 8A". */
export function keyLabel(pitchClass, mode) {
  const name = keyName(pitchClass, mode);
  const code = camelotCode(pitchClass, mode);
  return name && code ? `${name} / ${code}` : null;
}

/** Orden estable para ordenar la lista: número Camelot y luego A antes que B. */
export function camelotSortIndex(pitchClass, mode) {
  if (pitchClass == null || !mode) return Number.POSITIVE_INFINITY;
  return camelotNumber(pitchClass, mode) * 2 + (mode === "min" ? 0 : 1);
}

/** Relación armónica entre dos tonalidades, tal y como se usa mezclando:
 *  - "same": misma tonalidad
 *  - "compatible": vecina en la rueda (±1 del mismo tipo) o relativa (A↔B)
 *  - null: sin relación (o falta alguna de las dos) */
export function harmonicRelation(a, b) {
  if (!a || !b) return null;
  if (a.pitchClass == null || b.pitchClass == null || !a.mode || !b.mode) {
    return null;
  }
  if (a.pitchClass === b.pitchClass && a.mode === b.mode) return "same";

  const na = camelotNumber(a.pitchClass, a.mode);
  const nb = camelotNumber(b.pitchClass, b.mode);
  // Relativa mayor/menor: mismo número, distinta letra
  if (na === nb) return "compatible";
  // Vecinas en la rueda: mismo modo y números contiguos (12 y 1 son vecinos)
  if (a.mode === b.mode) {
    const diff = Math.abs(na - nb);
    if (diff === 1 || diff === 11) return "compatible";
  }
  return null;
}
