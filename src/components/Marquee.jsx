import { useCallback, useLayoutEffect, useRef, useState } from "react";

// === Texto que pasa de largo ===
//
// Si el texto cabe, no pasa nada: se pinta y ya. Si no cabe, se desliza en
// bucle (marquesina). La velocidad se elige en ⚙ Configuración; a 0 se queda
// quieto y se corta con puntos suspensivos.
//
// El movimiento lo hace una animación CSS, no un temporizador: la compone el
// navegador y no gasta nada del hilo principal. Lo único que hace JavaScript
// es medir el texto —cuando cambia el texto o el ancho— para que la velocidad
// sea la misma con un título corto que con uno larguísimo.

// Hueco entre las dos copias mientras pasa de largo. Múltiplo de la casilla de
// la matriz de puntos (15 px), para que el texto encendido siga cayendo sobre
// la rejilla apagada de la pantalla.
const HUECO = 30;

export default function Marquee({
  text,
  speed = 30,
  className = "",
  title,
  // Cómo se pinta el texto. Por defecto tal cual; el LCD del deck lo usa para
  // pasarlo por `Readout` y sacarlo con segmentos.
  render,
}) {
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const copiaRef = useRef(null);
  const [paso, setPaso] = useState({ seconds: 0, shift: 0 }); // 0 = quieto

  const medir = useCallback(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    if (!(speed > 0)) {
      setPaso({ seconds: 0, shift: 0 });
      return;
    }
    // Lo que ocupa el texto UNA vez: quieto, lo que se sale del hueco
    // (scrollWidth); en marcha, lo que mide la primera copia. Antes se cogía
    // el interior entero y se dividía por dos copias que no siempre estaban:
    // un título que no cabía se quedaba quieto hasta que medía el doble que
    // su hueco.
    const ancho = copiaRef.current
      ? copiaRef.current.getBoundingClientRect().width
      : inner.scrollWidth;
    const cabe = ancho <= box.clientWidth + 1;
    // Una vuelta = una copia más su hueco: así la segunda cae justo donde
    // estaba la primera
    const shift = ancho + HUECO;
    setPaso(cabe ? { seconds: 0, shift: 0 } : { seconds: shift / speed, shift });
  }, [speed]);

  useLayoutEffect(() => {
    medir();
    const box = boxRef.current;
    if (!box || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(medir);
    ro.observe(box);
    return () => ro.disconnect();
  }, [medir, text]);

  const moviendo = paso.seconds > 0;
  const pinta = render || ((t) => t);

  return (
    <div
      ref={boxRef}
      className={`overflow-hidden ${className}`}
      title={title ?? text}
    >
      <div
        ref={innerRef}
        className={moviendo ? "flex w-max" : "truncate"}
        style={
          moviendo
            ? {
                animation: `minidj-marquee ${paso.seconds}s linear infinite`,
                "--minidj-marquee-shift": `${paso.shift}px`,
                gap: `${HUECO}px`,
              }
            : undefined
        }
      >
        {moviendo ? (
          <>
            <span ref={copiaRef}>{pinta(text)}</span>
            <span aria-hidden>{pinta(text)}</span>
          </>
        ) : (
          pinta(text)
        )}
      </div>
    </div>
  );
}
