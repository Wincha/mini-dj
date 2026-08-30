// Colores de los hot cues: el índice es la ranura del pad, así que ampliar el
// número de cues es alargar esta lista (MAX_HOT_CUES sale de aquí).
// Se evitan el rojo de la rejilla de beats y el naranja del CUE para que en la
// onda no se confundan con ellos.
export const HOT_CUE_COLORS = [
  "#38bdf8", // 1 · azul cielo
  "#c084fc", // 2 · violeta
  "#facc15", // 3 · amarillo
  "#34d399", // 4 · verde
  "#f472b6", // 5 · rosa
  "#a3e635", // 6 · lima
  "#2dd4bf", // 7 · turquesa
  "#fda4af", // 8 · salmón
];

export const MAX_HOT_CUES = HOT_CUE_COLORS.length;

// Etiqueta de un cue o de un loop guardado: corta a propósito, para que quepa
// en el pad y en la onda sin descolocar nada.
export const CUE_NAME_MAX = 10;

// Tope de loops guardados por pista
export const MAX_SAVED_LOOPS = 8;

// === Pitch ===
// Rangos del fader de pitch (± %) y cuánto estira el pitch bend. Los dos se
// eligen en ⚙ Configuración y valen para los dos decks. El rango es el de
// PARTIDA: el sync puede ensancharlo solo si necesita más recorrido.
export const PITCH_RANGES = [8, 16, 50];
export const BEND_RANGES = [0.5, 1, 2, 4, 8];
export const DEFAULT_PITCH_RANGE = 8;
export const DEFAULT_BEND_RANGE = 4;
