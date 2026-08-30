// === El cristal de los aparatos ===
//
// La pantalla del deck, el medidor de nivel y la ventana de la onda son lo
// mismo por dentro: un hueco oscuro con luz cayendo desde arriba, sombra abajo
// y el canto marcado. Estaba escrito tres veces con tres juegos de números
// parecidos; aquí está una sola vez, y así los tres aparatos se ven igual.
//
// Va en CSS a propósito, NO pintado en el lienzo: el navegador lo compone una
// vez, mientras que rellenar el degradado en cada frame costaba 11 puntos de
// CPU con los dos decks sonando.

/** El reflejo: luz arriba, sombra abajo. */
export const GLASS_SHEEN =
  "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 42%, rgba(0,0,0,0.32))";

/** El hueco: sombra dentro y el canto de arriba iluminado. */
export const GLASS_WELL =
  "inset 0 2px 6px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.05)";

/**
 * Estilo de un aparato entero: su fondo, el reflejo y el hueco.
 * @param background color de fondo del aparato
 */
export const glassPanel = (background) => ({
  backgroundColor: background,
  backgroundImage: GLASS_SHEEN,
  boxShadow: `${GLASS_WELL}, 0 1px 0 rgba(255,255,255,0.05)`,
});

/**
 * Estilo del cristal SUELTO, para ponerlo por encima de algo ya pintado (un
 * lienzo, por ejemplo) en una capa aparte.
 */
export const glassOverlay = ({ well = true } = {}) => ({
  backgroundImage: GLASS_SHEEN,
  boxShadow: well ? GLASS_WELL : undefined,
});
