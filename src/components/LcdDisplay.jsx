import { memo, useLayoutEffect, useRef, useState } from "react";
import Marquee from "./Marquee";
import Readout, { DOT_H, DOT_W } from "./Readout";
import { glassPanel } from "../lib/glass";

// === La pantalla del deck ===
//
// Todo lo que antes eran etiquetas sueltas repartidas por la tarjeta (tiempo,
// duración, BPM, tonalidad, pitch, bend) reagrupado en una sola pantalla, con
// aire de LCD de mesa: cristal oscuro con relieve, cifras de siete segmentos y
// rótulos diminutos encima de cada dato.
//
// Todas las cifras van en cajas de ancho FIJO y con `tabular-nums`: pasar de
// 9 a 10 kicks, o de 99 a 100 BPM, no puede mover nada de sitio.

// El "cristal": verde muy oscuro con luz arriba y sombra abajo. Es CSS
// estático, no cuesta nada por frame.
// Paso de casilla, en PÍXELES ENTEROS. Es lo que hace que el panel parezca
// montado: todas del mismo tamaño, una pegada a la otra, sin huecos raros ni
// solapamientos. Con anchos fraccionarios (1ch) el navegador se comía la
// última columna de algunos dígitos.
const CELDA = 8; // cifras pequeñas
const CELDA_GRANDE = 13; // el tiempo y el BPM efectivo

// === El montaje del panel ===
//
// En una pantalla de verdad cada casilla va SOLDADA: es de siete segmentos, de
// catorce o de puntos, y sigue siéndolo escriba lo que escriba. Aquí está ese
// montaje, casilla a casilla. Nada de decidirlo por el carácter que toque:
// entonces el "+" del cue convertiría su casilla en una de catorce y el panel
// cambiaría de forma solo, que es justo lo que no puede pasar.
//
// Siete donde solo van cifras (que es lo barato y lo que mejor se lee), y
// catorce donde hace falta un signo o una letra.
const s7 = (n) => Array(n).fill("seg7");
const s14 = (n) => Array(n).fill("seg14");

// Las tres últimas de los tiempos son para las pistas de más de una hora
// (h:mm:ss): la pantalla enseña seis casillas, pero si hace falta enseñar la
// hora las que se añaden ya saben de qué tipo son.
const PAT = {
  // RESTANTE / TRANSCURRIDO: 3 de 7, los ":" de 14, 2 de 7
  time: [...s7(3), "seg14", ...s7(2), "seg14", ...s7(2)],
  // CUE: igual, pero el primero es el signo (+ o −) y eso pide catorce
  cue: ["seg14", ...s7(2), "seg14", ...s7(2), "seg14", ...s7(2)],
  // TOTAL: 2 de 7, los ":" de 14, 2 de 7
  total: [...s7(2), "seg14", ...s7(2), "seg14", ...s7(2)],
  // BPM de la pista y BPM efectivo: 3 de 7
  bpm: s7(3),
  // Tonalidad: letras, todas de catorce
  key: s14(8),
  // Pitch y bend: signo, cifras, punto y % — todas de catorce
  pitch: s14(7),
  bend: s14(6),
};

// El cristal es el mismo que el del medidor y el de la onda (src/lib/glass.js)
const GLASS = glassPanel("#0a0f0d");

// Color de los puntos APAGADOS del título. El mismo para las dos líneas: los
// puntos de una pantalla se ven igual estén donde estén, y con el color de
// cada línea la de abajo se quedaba a oscuras y parecía media pantalla.
const REJILLA = "#e2e8f0";

// El texto que no es cifra (el título) también tira algo de luz
const glow = (color) => ({ color, textShadow: `0 0 6px ${color}55` });

// Ancho aproximado de un rótulo a 7 px en mayúsculas, para que el hueco de su
// campo no se le quede corto. Se estima en vez de medirlo porque medir en el
// DOM obligaría a meter el rótulo en el flujo, y ahí sumaría ancho AL LADO de
// la cifra en vez de encima.
function anchoRotulo(label) {
  const txt = String(label ?? "");
  let ancho = 0;
  for (const ch of txt) ancho += ch.codePointAt(0) > 0x2e80 ? 7.5 : 4.9;
  return Math.ceil(ancho);
}

// Un dato: rótulo diminuto arriba y cifra debajo, en un hueco de ancho fijo.
//
// El rótulo va FUERA del flujo (absolute). Así la fila puede alinear por
// `items-baseline` y todas las cifras se apoyan en la misma raya, midan 11 px
// o 20 px. Alineando por la caja (items-end) las grandes parecían subidas,
// porque su hueco para las colas de las letras es más alto.
function Field({
  label,
  big = false,
  color = "#a3e635",
  size = "text-sm",
  align = "text-right",
  font = "rounded",
  // Casillas que reserva el hueco. En un display de verdad están montadas
  // aunque no enciendan: el sitio de "-00:00" es siempre el mismo, tanto si
  // la pista lleva tres minutos como si lleva treinta segundos.
  cells = 0,
  // Montaje de casillas de este campo (ver PAT). Manda sobre el modo.
  pattern,
  title,
  onClick,
  suffix,
  children,
}) {
  const paso = big ? CELDA_GRANDE : CELDA;
  // El hueco mide lo que ocupan sus casillas… salvo que su rótulo sea más
  // ancho: "TRACK BPM" sobre tres casillas se salía por la izquierda y se
  // comía el rótulo del de al lado.
  // Ancho FIJO, no mínimo: con un mínimo, en modo de letras el texto podía
  // pasarse por medio píxel y el campo salía uno más ancho que en segmentos.
  const width = `${Math.max(cells * paso, anchoRotulo(label))}px`;
  return (
    <div
      className={`relative flex pt-2.5 leading-none ${align} ${
        align === "text-right" ? "justify-end" : ""
      } ${onClick ? "cursor-pointer select-none" : ""}`}
      style={{ width }}
      title={title}
      onClick={onClick}
    >
      <span
        className={`absolute top-0 right-0 whitespace-nowrap text-[7px] uppercase tracking-[0.12em] text-neutral-500 ${
          align === "text-left" ? "left-0" : ""
        }`}
      >
        {label}
      </span>
      <Readout
        text={children}
        mode={font === "rounded" ? "rounded" : "seg14"}
        cells={cells}
        cellWidth={paso}
        pattern={pattern}
        pad="start"
        color={color}
        size={size}
        className={align === "text-right" && font !== "rounded" ? "justify-end" : ""}
      />
      {suffix}
    </div>
  );
}

// La rejilla de casillas del título: LAS QUE QUEPAN.
//
// La casilla de la matriz mide lo que mide (DOT_W x DOT_H, en píxeles
// enteros): no se estira para llenar el hueco. Lo único que hay que saber es
// cuántas caben, y eso es una división. Las dos líneas usan la misma cuenta,
// así que acaban las dos en la misma columna.
function useDotGrid(boxRef, activa) {
  const [cells, setCells] = useState(0);

  useLayoutEffect(() => {
    if (!activa) {
      setCells(0);
      return;
    }
    const box = boxRef.current;
    if (!box) return;
    // Hacia ARRIBA: las casillas no se estiran, así que con la división justa
    // quedaba un trozo de hueco sin rejilla al final de la línea —un pegote
    // negro antes del botón—. Poniendo una de más, la pantalla llega hasta el
    // borde y es el marco el que corta la última, como en un panel de verdad.
    const medir = () => setCells(Math.max(0, Math.ceil(box.clientWidth / DOT_W)));
    medir();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(medir);
    ro.observe(box);
    return () => ro.disconnect();
  }, [activa, boxRef]);

  return cells;
}

// Una línea del título. En modo de segmentos rellena TODO el ancho de
// casillas, encendidas las que tocan y apagadas el resto: así se ve dónde
// están, como en un display de verdad.
function TitleLine({ text, speed, font, color, size, glow = true, className, style, title, cells }) {
  const matriz = font !== "rounded";
  return (
    // La línea va en una caja de alto fijo y con el contenido FUERA del flujo.
    // Las casillas de la matriz miden lo que miden, y si se dejan en el flujo
    // la tarjeta entera se ensancha para que quepan (y de paso se pide otra
    // casilla más, que vuelve a ensancharla). Así no: la caja manda, y dentro
    // caben las que caben.
    <div className={`relative overflow-hidden ${className}`} style={style}>
      {matriz && (
        // La rejilla apagada: está SIEMPRE, y quieta. Es la pantalla, no el
        // texto. Lo que pasa de largo por encima es solo lo que enciende.
        <span className="pointer-events-none absolute inset-0 flex items-center">
          <Readout text="" mode="dot" cells={cells} color={REJILLA} glow={false} />
        </span>
      )}
      <Marquee
        text={text}
        speed={speed}
        title={title}
        className="absolute inset-0 flex items-center"
        render={
          matriz
            ? (txt) => (
                // Sin puntos apagados: la rejilla ya está pintada debajo, y
                // pintarla otra vez encima del texto la dejaba más brillante
                // en el trozo donde hay letras
                <Readout
                  text={txt}
                  mode="dot"
                  color={color}
                  size={size}
                  glow={glow}
                  dim={0}
                />
              )
            : undefined
        }
      />
    </div>
  );
}

function LcdDisplay({
  // Pista cargada
  trackTitle,
  trackInfo,
  marqueeSpeed,
  loadButton,
  // Tiempo
  time, // ya formateado
  timeLabel,
  onToggleTime,
  timeTitle,
  cue, // { text, title } o null
  duration, // ya formateado
  durationLabel,
  // Tempo
  bpm, // BPM base de la pista (el de la rejilla)
  bpmLabel,
  bpmTitle,
  onBpmClick,
  bpmRef,
  runningBpm, // BPM efectivo, con el pitch aplicado
  runningLabel,
  // Tonalidad (opcional)
  musicalKey, // texto ya montado, o null si no se enseña
  keyLabel: keyText,
  keyTitle,
  keyKnown,
  // Pitch
  pitch,
  pitchLabel,
  pitchTitle,
  bend,
  bendLabel,
  keyLock,
  // Cómo se pinta el panel (⚙ Configuración). Son dos ajustes distintos:
  //   font      "rounded" | "lcd"  — las cifras, con el montaje fijo de PAT
  //   titleFont "rounded" | "dot"  — el título, en matriz de 5 x 7
  font = "rounded",
  titleFont = "rounded",
}) {
  const tituloRef = useRef(null);
  // Casillas de los tiempos. Una pista de más de una hora se enseña como
  // h:mm:ss, y para eso el panel necesita tres casillas más. Se decide con la
  // DURACIÓN, que no cambia mientras suena: así el hueco es el mismo con el
  // tiempo transcurrido que con el restante, y nada se mueve ni se solapa.
  const horas = String(duration ?? "").length > 5;
  const celdasTiempo = horas ? 9 : 6;
  const celdasTotal = horas ? 8 : 5;

  // El título va en matriz de puntos: los segmentos, a tamaño de nombre de
  // pista, se emborronan; los cuadraditos no. Las dos líneas comparten la
  // cuenta de casillas, así que acaban en la misma columna.
  const celdasTitulo = useDotGrid(tituloRef, titleFont !== "rounded");

  return (
    <div className="rounded-lg px-2 py-1" style={GLASS} data-testid="lcd">
      {/* Nombre de la pista y su ficha. Si no cabe, pasa de largo (la
          velocidad se elige en ⚙ Configuración). */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-1">
        <div ref={tituloRef} className="min-w-0 flex-1" style={glow("#e2e8f0")}>
          {/* Las dos líneas miden lo mismo en los dos modos: el alto lo manda
              la casilla de la matriz, y las letras normales se meten en ese
              mismo hueco. Cambiar de modo no mueve la pantalla. */}
          <TitleLine
            text={trackTitle}
            speed={marqueeSpeed}
            font={titleFont}
            color="#e2e8f0"
            size="text-[13px]"
            className="text-[13px] font-semibold leading-none"
            style={{ height: DOT_H }}
            title={trackTitle}
            cells={celdasTitulo}
          />
          <TitleLine
            text={trackInfo || "\u00A0"}
            speed={marqueeSpeed}
            font={titleFont}
            color="#737373"
            size="text-[11px]"
            glow={false}
            className="text-[11px] leading-none text-neutral-500"
            style={{ height: DOT_H }}
            title={trackInfo}
            cells={celdasTitulo}
          />
        </div>
        {loadButton}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        {/* Tiempo: lo más grande, es lo que se mira de reojo */}
        <Field
          font={font}
          label={timeLabel}
          cells={celdasTiempo}
          pattern={PAT.time}
          big
          color="#67e8f9"
          size="text-xl"
          align="text-left"
          title={timeTitle}
          onClick={onToggleTime}
        >
          {time}
        </Field>

        {/* CUE: a cuánto estás del punto de partida */}
        {cue && (
          <Field
            font={font}
            label={cue.label}
            cells={celdasTiempo}
            pattern={PAT.cue}
            color="#fb923c"
            size="text-[11px]"
            align="text-left"
            title={cue.title}
          >
            {cue.text}
          </Field>
        )}

        <div className="flex-1" />

        <Field
          label={durationLabel}
          cells={celdasTotal}
          pattern={PAT.total}
          color="#94a3b8"
          size="text-[11px]"
          font={font}
        >
          {duration}
        </Field>

        {musicalKey !== null && (
          <Field
            font={font}
            label={keyText}
            cells={8}
            pattern={PAT.key}
            color={keyKnown ? "#c4b5fd" : "#525252"}
            size="text-[11px]"
            title={keyTitle}
          >
            {musicalKey}
          </Field>
        )}

        {/* BPM base de la pista y BPM al que va de verdad con el pitch */}
        <div ref={bpmRef} onClick={onBpmClick}>
          <Field
            font={font}
            label={bpmLabel}
            cells={3}
            pattern={PAT.bpm}
            big
            color="#94a3b8"
            size="text-xl"
            title={bpmTitle}
            onClick={onBpmClick}
          >
            {bpm}
          </Field>
        </div>
        <Field
          label={runningLabel}
          cells={3}
          pattern={PAT.bpm}
          big
          color="#34d399"
          size="text-xl"
          font={font}
        >
          {runningBpm}
        </Field>

        {/* Pitch y bend: viven aquí para que el fader de al lado sea más largo */}
        <Field
          font={font}
          label={pitchLabel}
          cells={7}
          pattern={PAT.pitch}
          color="#7dd3fc"
          size="text-[11px]"
          title={pitchTitle}
          suffix={
            keyLock ? <span className="ml-0.5 self-end text-[9px]">🔒</span> : null
          }
        >
          {pitch}
        </Field>
        <Field
          label={bendLabel}
          cells={6}
          pattern={PAT.bend}
          color="#7dd3fc"
          size="text-[11px]"
          font={font}
        >
          {bend}
        </Field>
      </div>
    </div>
  );
}

export default memo(LcdDisplay);
