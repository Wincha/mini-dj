// === Botón de mesa ===
//
// El único botón de las cajas de herramientas del deck: hot cues, rejilla,
// jump, loop, roll, estructura… Antes cada caja tenía su variante suelta y
// cada una medía de una manera; ahora todas salen de aquí, así que cambiar el
// tamaño o el aspecto es tocar un sitio.
//
// Dos comportamientos:
//   - PULSADOR: se pulsa y ya (‹ › « », ÷2, ×2, TAP…).
//   - TESTIGO (`led`): además lleva una luz dentro, apagada o encendida, y al
//     encenderse el botón coge el color y se enciende con un halo, como el
//     testigo de una mesa de verdad. Es lo que llevan quantize, el loop, el
//     key lock, los hot cues puestos y el roll que está sonando.
//
// Dentro se pinta lo que haga falta (el número del cue, ÷2, TAP, − y +…) y,
// opcionalmente, una segunda línea diminuta (`sub`) para la etiqueta de un
// cue. Esa línea se reserva SIEMPRE aunque venga vacía: ponerle nombre a un
// cue, o cambiar de idioma, no puede mover nada de sitio.

// Anchos fijos por tamaño. Nada de anchos automáticos: en esta fila cualquier
// botón que crezca al cambiar de estado o de idioma descoloca la caja entera.
const SIZES = {
  xs: "w-6 h-7", // ‹ › « », ÷2, ×2, ⟳ …
  sm: "w-7 h-7", // Q, jump, loop on/off
  md: "w-8 h-7", // IN / OUT, roll
  cue: "w-9 h-8", // hot cue: número + etiqueta
  text: "h-7 px-2", // TAP… el ancho lo pone el texto
  // Fila de transporte (play, stop, sync, key): todos del mismo alto. Va como
  // tamaño y no como clase suelta porque en Tailwind 4 el "!" de important va
  // al FINAL (h-10!), y un "!h-10" heredado de la v3 se cae sin avisar.
  transport: "h-10 px-4",
};

// Verde de la casa cuando no se pide otro color
const DEFAULT_COLOR = "#34d399";

// El relieve: línea de luz arriba y sombra debajo. Se exporta porque los
// botones grandes del transporte (Play, Stop) lo comparten sin ser PadButton.
export const GLOSS =
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_1px_2px_rgba(0,0,0,0.45)]";

// El hundido al pulsar, que va siempre con el relieve
export const PRESS = "active:translate-y-px active:shadow-none";

// El material de un botón apagado: gris con degradado, y más claro al pasar
// por encima. Lo comparten los botones que NO son PadButton (REC, ⚙, PFL,
// Auto, los de la lista) para que todos parezcan del mismo aparato.
export const SKIN =
  "border-neutral-700 bg-gradient-to-b from-neutral-700 to-neutral-800 hover:from-neutral-600 hover:to-neutral-700";

export default function PadButton({
  size = "xs",
  // El redondeo va como prop, no en className: si llegan dos clases de radio
  // (la base y la de fuera) gana la que Tailwind ponga después en la hoja, no
  // la que se escribe, y salían botones con radios distintos sin querer.
  radius = "rounded-lg",
  // "none" quita el fondo y el borde de serie y deja que los ponga quien lo
  // usa (Play y Stop, que van en su color). Sin esto, las clases de color de
  // fuera y las de dentro se pisan y gana la que Tailwind ordene después.
  skin = "default",
  active = false,
  led = false,
  color = DEFAULT_COLOR,
  sub,
  // Clases del envoltorio del contenido. Por defecto una línea recortada,
  // pero hay botones (el Play, que superpone play y pausa para reservar el
  // ancho de los dos) que necesitan colocar su contenido a su manera.
  contentClass = "px-0.5 max-w-full truncate",
  className = "",
  children,
  ...rest
}) {
  // Encendido: fondo teñido, borde y texto del color, y halo alrededor. Los
  // sufijos hexadecimales son la opacidad (2e ≈ 18 %, 55 ≈ 33 %).
  //
  // El brillo (ese punto de luz de arriba y la sombra de abajo) va tanto
  // apagado como encendido: son botones físicos, no rectángulos planos.
  const style = active
    ? {
        backgroundColor: `${color}2e`,
        backgroundImage:
          "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0) 55%, rgba(0,0,0,0.18))",
        borderColor: color,
        color,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 1px ${color}55, 0 0 9px ${color}66`,
      }
    : undefined;

  return (
    <button
      {...rest}
      style={style}
      className={`relative grid content-center justify-items-center overflow-hidden shrink-0 border text-[11px] font-bold leading-none disabled:opacity-40 ${radius} ${
        SIZES[size] || SIZES.xs
      } ${
        active || skin === "none"
          ? `enabled:hover:brightness-110 ${skin === "none" ? GLOSS : ""}`
          : `text-neutral-300 ${SKIN} ${GLOSS}`
      } ${PRESS} ${className}`}
    >
      {led && (
        // Testigo: apagado es un punto oscuro, encendido tiene halo propio.
        // Va en una esquina y no ocupa flujo, así que no empuja al contenido.
        <span
          aria-hidden
          // Metido un poco hacia dentro: pegado al borde se comía con la
          // curva de la esquina y no se veía bien
          className="absolute right-1 top-1 h-1 w-1 rounded-full"
          style={{
            backgroundColor: active ? color : "#3f3f46",
            boxShadow: active ? `0 0 4px ${color}` : "none",
          }}
        />
      )}
      <span className={contentClass}>{children}</span>
      {sub !== undefined && (
        <span className="px-0.5 max-w-full truncate text-[7px] font-normal opacity-80">
          {sub || " "}
        </span>
      )}
    </button>
  );
}
