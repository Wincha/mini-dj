import { memo } from "react";

// === Lectura de una pantalla ===
//
// Un mismo componente para los dos modos en los que la app enseña cifras:
//
//   mode="rounded"   las letras de siempre
//   mode="seg7"      siete segmentos: cifras, el menos y el punto
//   mode="seg14"     catorce segmentos: también letras y signos
//   mode="dot"       matriz de 5 x 7 puntos
//
// En una pantalla de verdad cada casilla está SOLDADA: es de siete, de catorce
// o de puntos para siempre, y no cambia porque cambie lo que se escribe. Por
// eso hay `pattern`: la lista de tipos de casilla del panel, decidida una vez.
// El `mode` solo manda donde no hay patrón (el título, por ejemplo).
//
// Los segmentos se dibujan con SVG generado aquí, sin traer ninguna fuente.
// Cada carácter ocupa EXACTAMENTE `1ch` de ancho, que es lo que mide un dígito
// con `tabular-nums` en el modo normal, y `1em` de alto. Así cambiar de modo
// no mueve ni un píxel: el hueco es el mismo en los dos.
//
// El tamaño, el color y el brillo vienen de fuera, así que sirve igual para el
// tiempo enorme del deck que para un porcentaje diminuto.

// Lienzo de un carácter. Las coordenadas de abajo están en esta caja.
const W = 100;
const H = 160;
// Media anchura de las barras. Ni tan finas que se pierdan a este tamaño ni
// tan gordas que los huecos entre segmentos desaparezcan: con T = 11 las
// cifras se veían como un bloque y no como siete barras.
const T = 9;

// Barra horizontal con las puntas en pico, de x1 a x2 a la altura y
const bar = (x1, x2, y) =>
  `M${x1} ${y}L${x1 + T} ${y - T}H${x2 - T}L${x2} ${y}L${x2 - T} ${y + T}H${x1 + T}Z`;

// Barra vertical, de y1 a y2 en la columna x
const col = (x, y1, y2) =>
  `M${x} ${y1}L${x + T} ${y1 + T}V${y2 - T}L${x} ${y2}L${x - T} ${y2 - T}V${y1 + T}Z`;

// Diagonal: un paralelogramo con los extremos horizontales
const dia = (x1, y1, x2, y2, w = 12) =>
  `M${x1 - w} ${y1}H${x1 + w}L${x2 + w} ${y2}H${x2 - w}Z`;

// Los catorce segmentos, con los nombres de siempre
const SEG = {
  A: bar(24, 76, 16),
  D: bar(24, 76, 144),
  G1: bar(24, 47, 80),
  G2: bar(53, 76, 80),
  // En un siete segmentos la del medio es una barra entera, no dos mitades:
  // con G1 + G2 el signo menos salía partido por la mitad.
  //
  // Y va con las puntas RECTAS, no en pico como las demás: a 8 px de casilla
  // la barra mide dos píxeles de alto, y las puntas en pico se comen medio
  // píxel por cada lado — el menos parecía cortado.
  G: `M20 ${80 - T}H80V${80 + T}H20Z`,
  F: col(17, 24, 72),
  E: col(17, 88, 136),
  B: col(83, 24, 72),
  C: col(83, 88, 136),
  I: col(50, 24, 70),
  L: col(50, 90, 136),
  H: dia(26, 28, 42, 64),
  J: dia(74, 28, 58, 64),
  K: dia(26, 132, 42, 96),
  M: dia(74, 132, 58, 96),
};

// Punto redondo en (cx, cy)
const dot = (cx, cy, r = 12) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

// El punto, los dos puntos y el tanto por ciento no son segmentos: son
// dibujos aparte que ocupan su propia casilla.
const DOT_LOW = dot(50, 138);
const DOT_HIGH = dot(50, 54);
const DOT_MID = dot(50, 106);
// El % lleva su barra inclinada y los dos puntitos EN LAS ESQUINAS. Con los
// puntos centrados, como estaban, la barra se los comía y solo se veía una
// rayita suelta.
const PERCENT = dia(30, 142, 70, 18, 10) + dot(26, 40, 14) + dot(74, 120, 14);

// Signos que NO son de segmentos: van dibujados y su casilla se queda limpia
// (sin la maraña de segmentos apagados detrás, que se los comía).
const PUNCT = {
  ".": DOT_LOW,
  ",": DOT_LOW,
  "·": DOT_MID,
  "•": DOT_MID,
  ":": DOT_HIGH + DOT_MID,
  "%": PERCENT,
};

// Qué segmentos enciende cada carácter. Lo que no esté aquí sale en blanco.
const FONT = {
  "0": "ABCDEF",
  "1": "BC",
  "2": "ABDEG1G2",
  "3": "ABCDG1G2",
  "4": "BCFG1G2",
  "5": "ACDFG1G2",
  "6": "ACDEFG1G2",
  "7": "ABC",
  "8": "ABCDEFG1G2",
  "9": "ABCDFG1G2",
  A: "ABCEFG1G2",
  B: "ABCDG2IL",
  C: "ADEF",
  D: "ABCDIL",
  E: "ADEFG1G2",
  F: "AEFG1",
  G: "ACDEFG2",
  H: "BCEFG1G2",
  I: "ADIL",
  J: "BCDE",
  K: "EFG1JM",
  L: "DEF",
  M: "BCEFHJ",
  N: "BCEFHM",
  O: "ABCDEF",
  P: "ABEFG1G2",
  Q: "ABCDEFM",
  R: "ABEFG1G2M",
  S: "ACDFG1G2",
  T: "AIL",
  U: "BCDEF",
  V: "EFJK",
  W: "BCEFKM",
  X: "HJKM",
  Y: "HJL",
  Z: "ADJK",
  "-": "G1G2",
  "−": "G1G2",
  "–": "G1G2",
  "+": "G1G2IL",
  "/": "JK",
  "\\": "HM",
  "%": "JK",
  "?": "ABG2L",
  "—": "G1G2",
};

// Nombres de segmento de una cadena tipo "ABG1G2" (G1 y G2 llevan número)
const parseSegs = (spec) => spec.match(/G[12]|[A-Z]/g) || [];

// Los caracteres se repiten mucho: su trazo se calcula una vez y se guarda
const cache = new Map();

function glyph(ch, kind) {
  const clave = kind === "seg7" ? `7${ch}` : ch;
  if (cache.has(clave)) return cache.get(clave);
  let on = "";
  const dots = PUNCT[ch] || "";
  if (!dots) {
    const spec = FONT[ch] || FONT[ch.toUpperCase()];
    if (spec) {
      let segs = parseSegs(spec);
      if (kind === "seg7") {
        // Las dos mitades del medio son una sola barra, y sin repetirla
        segs = [...new Set(segs.map((n) => (n === "G1" || n === "G2" ? "G" : n)))];
        segs = segs.filter((n) => SEG7.has(n));
      }
      on = segs.map((n) => SEG[n]).join("");
    }
  }
  // `seg` siempre: hasta la casilla de los ":" es una casilla montada, con sus
  // segmentos apagados detrás. Es lo que hace que el panel parezca real.
  const out = { on, dots, seg: true };
  cache.set(clave, out);
  return out;
}

// "segments" era el nombre viejo de los catorce
const normaliza = (mode) => (mode === "segments" ? "seg14" : mode);

// Los siete segmentos de toda la vida: el marco y los dos del medio, sin las
// diagonales ni los verticales del centro
const SEG7 = new Set(["A", "B", "C", "D", "E", "F", "G"]);

// Todos los segmentos, para pintar de fondo los que están apagados
const ALL = Object.values(SEG).join("");
const ALL7 = Object.entries(SEG)
  .filter(([k]) => SEG7.has(k))
  .map(([, v]) => v)
  .join("");

// === Matriz de puntos (5 x 7) ===
//
// Los segmentos, por gruesos que sean, son barras largas y finas: a tamaño de
// título se emborronan. Una matriz son cuadraditos, que es lo que mejor
// aguanta hacerse pequeño. Cada glifo son siete filas de cinco.
const DOT_FONT = {
  "0": "01110/10001/10011/10101/11001/10001/01110",
  "1": "00100/01100/00100/00100/00100/00100/01110",
  "2": "01110/10001/00001/00010/00100/01000/11111",
  "3": "11111/00010/00100/00010/00001/10001/01110",
  "4": "00010/00110/01010/10010/11111/00010/00010",
  "5": "11111/10000/11110/00001/00001/10001/01110",
  "6": "00110/01000/10000/11110/10001/10001/01110",
  "7": "11111/00001/00010/00100/01000/01000/01000",
  "8": "01110/10001/10001/01110/10001/10001/01110",
  "9": "01110/10001/10001/01111/00001/00010/01100",
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01110/10001/10000/10000/10000/10001/01110",
  D: "11100/10010/10001/10001/10001/10010/11100",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01110/10001/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "01110/00100/00100/00100/00100/00100/01110",
  J: "00111/00010/00010/00010/00010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/11001/10101/10011/10011/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/11011/10001",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
  "-": "00000/00000/00000/01110/00000/00000/00000",
  "−": "00000/00000/00000/01110/00000/00000/00000",
  "+": "00000/00100/00100/11111/00100/00100/00000",
  "/": "00001/00010/00010/00100/01000/01000/10000",
  "\\": "10000/01000/01000/00100/00010/00010/00001",
  "%": "11000/11001/00010/00100/01000/10011/00011",
  ".": "00000/00000/00000/00000/00000/01100/01100",
  ",": "00000/00000/00000/00000/00000/00100/01000",
  "·": "00000/00000/00000/01100/01100/00000/00000",
  "•": "00000/00000/00000/01100/01100/00000/00000",
  ":": "00000/01100/01100/00000/01100/01100/00000",
  "(": "00010/00100/01000/01000/01000/00100/00010",
  ")": "01000/00100/00010/00010/00010/00100/01000",
  "!": "00100/00100/00100/00100/00100/00000/00100",
  "?": "01110/10001/00001/00010/00100/00000/00100",
  "&": "01100/10010/10100/01000/10101/10010/01101",
  "'": "00100/00100/00000/00000/00000/00000/00000",
  "#": "01010/01010/11111/01010/11111/01010/01010",
  "*": "00000/10101/01110/11111/01110/10101/00000",
  "=": "00000/00000/11111/00000/11111/00000/00000",
  "_": "00000/00000/00000/00000/00000/00000/11111",
};

// La matriz NO se escala: se mide en píxeles enteros y se pinta tal cual.
// Estirar un lienzo de 5 x 7 hasta el hueco que hubiera dejaba cada punto a
// píxel y medio —de ahí que se viera emborronada y con los caracteres de
// tamaños distintos—. Aquí el punto mide un píxel, con otro de aire, y la
// casilla sale de ahí: 15 x 21 px clavados, quepan los que quepan. Con puntos
// de un solo píxel la letra se deshace: no se llega a ver el trazo.
const PUNTO = 2; // lado del punto
const PASO = 3; // de un punto al siguiente
export const DOT_W = 5 * PASO; // ancho de casilla, en píxeles
export const DOT_H = 7 * PASO; // alto de casilla, en píxeles
const punto = (c, f) => `M${c * PASO} ${f * PASO}h${PUNTO}v${PUNTO}h-${PUNTO}Z`;

// Todos los puntos, para el fondo de los apagados
const DOT_ALL = (() => {
  let d = "";
  for (let f = 0; f < 7; f++) for (let c = 0; c < 5; c++) d += punto(c, f);
  return d;
})();

const cacheDot = new Map();

function dotGlyph(ch) {
  if (cacheDot.has(ch)) return cacheDot.get(ch);
  const spec = DOT_FONT[ch] || DOT_FONT[ch.toUpperCase()];
  let d = "";
  if (spec) {
    spec.split("/").forEach((fila, f) => {
      for (let c = 0; c < 5; c++) if (fila[c] === "1") d += punto(c, f);
    });
  }
  cacheDot.set(ch, d);
  return d;
}

const Char = memo(function Char({ ch, color, dim, width, kind }) {
  if (kind === "dot") {
    const d = dotGlyph(ch);
    return (
      <svg
        viewBox={`0 0 ${DOT_W} ${DOT_H}`}
        // Tamaño FIJO y el mismo que el lienzo: un punto del dibujo es un
        // píxel de la pantalla, ni medio más. Nada de estirar.
        width={DOT_W}
        height={DOT_H}
        style={{ width: DOT_W, height: DOT_H, display: "block", flex: "none" }}
        // Sin suavizado: un punto suavizado es una mancha gris. Con los bordes
        // pegados al píxel, la matriz se ve nítida.
        shapeRendering="crispEdges"
        aria-hidden
      >
        {dim > 0 && <path d={DOT_ALL} fill={color} opacity={dim} />}
        {d && <path d={d} fill={color} />}
      </svg>
    );
  }
  // La casilla es del tipo que sea y no cambia por lo que le toque pintar: si
  // en una de siete cae algo que no sabe hacer, enciende lo que puede. Antes
  // se pasaba a catorce, y bastaba una raya de "sin BPM" para que el hueco de
  // los BPM se viera de catorce segmentos.
  const { on, dots, seg } = glyph(ch, kind);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      // Ancho de un dígito y alto de una línea: el mismo hueco que ocuparía
      // el texto normal, para que cambiar de modo no descuadre nada
      style={{ width: width || "1ch", height: "1em", display: "block" }}
      preserveAspectRatio="none"
      aria-hidden
    >
      {seg && dim > 0 && (
        <path d={kind === "seg7" ? ALL7 : ALL} fill={color} opacity={dim} />
      )}
      {(on || dots) && <path d={on + dots} fill={color} />}
    </svg>
  );
});

/**
 * Una lectura de pantalla.
 *
 * @param text   lo que se escribe
 * @param mode   cómo se pinta:
 *                 "rounded"  letras normales
 *                 "seg7"     siete segmentos (solo cifras, el clásico)
 *                 "seg14"    catorce segmentos, también letras
 *                 "dot"      matriz de 5x7 puntos: la que mejor se lee
 *                            pequeña, para el título
 * @param color  color del texto o de los segmentos encendidos
 * @param size   clase de tamaño (text-xl, text-[11px]…): manda en los dos
 *               modos, porque los segmentos miden 1ch × 1em
 * @param dim    opacidad de los segmentos apagados (0 no los pinta: es lo que
 *               usa el título, que lleva su propia rejilla debajo y pintarlos
 *               otra vez encima los dejaba más brillantes justo donde hay
 *               letras)
 * @param glow   si el texto tira luz, como un display retroiluminado
 * @param cellWidth ancho de casilla en píxeles ENTEROS. Sin esto cada casilla
 *               mide 1ch, que suele ser fraccionario, y al colocarlas una tras
 *               otra los huecos entre ellas caen unas veces en un píxel y
 *               otras en dos: se ven rayas negras a intervalos irregulares.
 * @param pattern tipos de casilla del panel, uno por posición
 *               (["seg7","seg7","seg14"…]). Manda sobre `mode`: es el montaje
 *               fijo de la pantalla, no depende de lo que se escriba.
 * @param pad    de qué lado quedan las casillas de sobra: "end" (el texto
 *               empieza a la izquierda, como el título) o "start" (el texto se
 *               apoya a la derecha, como cualquier cifra de un display)
 * @param cells  mínimo de casillas a pintar. Con esto la línea se rellena de
 *               casillas apagadas hasta el ancho que se le diga, como un
 *               display de verdad: se ven todas y solo encienden las que
 *               tocan. Sin él, solo se pintan las letras.
 */
function Readout({
  text,
  mode = "rounded",
  color = "#a3e635",
  size = "text-sm",
  dim = 0.11,
  glow = true,
  cells = 0,
  cellWidth = 0,
  pattern = null,
  pad = "end",
  className = "",
}) {
  const chars = String(text ?? "");
  const base = normaliza(mode);
  // Casillas vacías que quedan delante cuando la cifra se apoya a la derecha
  const hueco = pad === "start" ? Math.max(0, cells - chars.length) : 0;

  if (base === "rounded" || !base) {
    return (
      // La misma estructura que el modo de segmentos —un inline-flex con un
      // hijo de 1em de alto— para que la caja mida EXACTAMENTE lo mismo en los
      // dos. Con un <span> pelado, el hueco que el tipo de letra reserva para
      // las colas hacía el LCD 8 px más alto en este modo.
      <span
        className={`${size} inline-flex items-end align-baseline leading-none font-semibold tabular-nums tracking-tight ${className}`}
        style={{ color, textShadow: glow ? `0 0 6px ${color}55` : undefined }}
      >
        <span className="block" style={{ height: "1em" }}>
          {chars}
        </span>
      </span>
    );
  }

  return (
    <span
      className={`${size} inline-flex items-end align-baseline leading-none ${className}`}
      style={{ filter: glow ? `drop-shadow(0 0 3px ${color}66)` : undefined }}
    >
      {/* El texto de verdad, para lectores de pantalla y para copiarlo */}
      <span className="sr-only">{chars}</span>
      {/* Una casilla por carácter y, si se pide, más casillas vacías hasta
          completar la línea: los espacios también son casillas, que en un
          display están ahí aunque no enciendan */}
      {Array.from({ length: Math.max(chars.length, cells) }, (_, i) => (
        <Char
          key={i}
          ch={(chars[i - hueco] || " ").toUpperCase()}
          color={color}
          dim={dim}
          width={cellWidth ? `${cellWidth}px` : 0}
          kind={pattern?.[i] || base}
        />
      ))}
    </span>
  );
}

export default memo(Readout);
