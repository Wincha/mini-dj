import { memo, useEffect, useRef } from "react";
import { useI18n } from "../i18n/context";
import { structureAt } from "../audio/structure";
import { createSmoothTime } from "../lib/smoothTime";

// === Indicador de estructura (esquina inferior derecha de la onda) ===
//
//     ♪ ▼32 ▲80  ·  12/16     en ritmo, el bajón entra dentro de 32
//     ○ ▲16      ·   8/16     en un bajón, el ritmo vuelve dentro de 16
//     ♪ ▪240     ·   4/16     no queda ningún cambio: 240 para el final
//
//   ♪ = suena el ritmo · ○ = estamos en un bajón
//   ▼ n = quedan n para que caiga el ritmo
//   ▲ n = quedan n para que entre el ritmo
//   ▪ n = ya no hay más cambios; n para que acabe la pista
//
// Lo de la última línea no es un adorno: medido sobre pistas de verdad, un
// tercio se pasa el último minuto —y alguna hasta dos minutos y medio— sin un
// solo bajón. Ahí el indicador se quedaba en blanco y parecía averiado.
//
// Por qué NO es estado de React: esto cambia a cada kick (varias veces por
// segundo) y colgarlo del estado re-renderizaría el deck entero. Aquí hay un
// bucle propio que lee el playhead interpolado (el mismo que usa la onda) y
// solo escribe en el DOM cuando la cuenta cambia de verdad: en un beat normal
// no toca nada.

// Cada cuánto se mira el reloj. A 128 BPM un kick dura 469 ms y a 220 BPM,
// 273 ms: con 100 ms el número baja a tiempo y el retraso no se nota, y
// mirarlo más a menudo solo gasta CPU (medido: bajar de 500 a 60 ms costaba
// medio punto con los dos decks sonando).
//
// Es un TEMPORIZADOR, no requestAnimationFrame: esto solo escribe texto, no
// necesita ir en sincronía con el frame, y un rAF más por deck obliga al
// navegador a producir frames aunque no haya nada que pintar (medido: unos dos
// puntos de CPU con los dos decks sonando).
const POLL_MS = 100;

const kicksToBars = (n) => Math.ceil(n / 4);

function StructureIndicator({
  structure,
  beats,
  audioRef,
  phraseSize,
  phraseOffset,
  unit = "kicks",
  warnAmber = 16,
  warnRed = 4,
}) {
  const { t } = useI18n();
  const boxRef = useRef(null);
  const stateRef = useRef(null);
  const firstSymRef = useRef(null);
  const firstNumRef = useRef(null);
  const secondSymRef = useRef(null);
  const secondNumRef = useRef(null);
  const phraseRef = useRef(null);
  const smoothRef = useRef(null);
  if (!smoothRef.current) smoothRef.current = createSmoothTime();

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !beats?.length) return;

    let lastKey = "";

    // Cifras de ancho fijo: siempre tres huecos, aunque el número tenga uno.
    const num = (n) => (n == null ? "" : String(n));

    const paint = (info) => {
      const inKick = info.inKick;
      // Primero el cambio que viene; después el siguiente de la cadena
      const firstUp = !inKick; // ▲ cuando estamos en el bajón
      const first = info.toChange;
      const second = info.toNext;
      // Sin cambios por delante se cuenta lo que queda de pista
      const alFinal = first == null && info.toEnd != null;
      const cuenta = first != null ? first : alFinal ? info.toEnd : null;
      const conv = unit === "bars" ? kicksToBars : (n) => n;

      stateRef.current.textContent = inKick ? "♪" : "○";
      stateRef.current.className = `w-3 text-center ${
        inKick ? "text-emerald-400" : "text-sky-300"
      }`;

      // Sin más cambios por delante, los huecos se quedan en blanco (el ancho
      // no cambia) en vez de enseñar un guion suelto
      firstSymRef.current.textContent =
        first != null ? (firstUp ? "▲" : "▼") : alFinal ? "▪" : "";
      firstNumRef.current.textContent = cuenta == null ? "" : num(conv(cuenta));
      // El aviso va por KICKS reales, no por la unidad elegida: los umbrales
      // de la configuración están en kicks.
      const alarm =
        cuenta == null ? "" : cuenta <= warnRed ? "red" : cuenta <= warnAmber ? "amber" : "";
      firstNumRef.current.className = `w-7 text-right ${
        alarm === "red"
          ? "text-red-400 font-bold"
          : alarm === "amber"
          ? "text-amber-300 font-bold"
          : "text-neutral-200"
      }`;

      secondSymRef.current.textContent =
        second == null ? "" : firstUp ? "▼" : "▲";
      secondNumRef.current.textContent = second == null ? "" : num(conv(second));

      phraseRef.current.textContent =
        unit === "bars"
          ? `${kicksToBars(info.phrasePos)}/${Math.max(1, info.phraseSize / 4)}`
          : `${info.phrasePos}/${info.phraseSize}`;

      // Tooltip: lo mismo pero con palabras. Siempre en kicks, con los
      // compases al lado cuando la cuenta es exacta, que es como se dice.
      const partes = [inKick ? t("structureTipInKick") : t("structureTipInBreak")];
      if (first != null) {
        const exacto = first % 4 === 0;
        const clave = inKick
          ? exacto
            ? "structureTipDropBars"
            : "structureTipDrop"
          : exacto
          ? "structureTipRiseBars"
          : "structureTipRise";
        partes.push(t(clave, { n: first, bars: first / 4 }));
        if (second != null) {
          partes.push(
            inKick
              ? t("structureTipRiseAfter", { n: second })
              : t("structureTipDropAfter", { n: second })
          );
        }
      } else {
        partes.push(t("structureTipNoChanges"));
        if (info.toEnd != null) partes.push(t("structureTipToEnd", { n: info.toEnd }));
      }
      partes.push(
        t("structureTipPhrase", { pos: info.phrasePos, size: info.phraseSize })
      );
      box.title = partes.join(" ");
    };

    const tick = () => {
      if (document.hidden) return;

      const el = audioRef?.current || null;
      const info = structureAt({
        structure,
        beats,
        time: smoothRef.current(el),
        phraseSize,
        phraseOffset,
      });
      if (!info) {
        if (lastKey !== "-") {
          lastKey = "-";
          box.style.visibility = "hidden";
        }
        return;
      }
      // Firma de lo que se ve: si no ha cambiado, no se toca el DOM
      const key = `${info.inKick}|${info.toChange}|${info.toNext}|${info.toEnd}|${info.phrasePos}`;
      if (key === lastKey) return;
      lastKey = key;
      box.style.visibility = "visible";
      paint(info);
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [structure, beats, audioRef, phraseSize, phraseOffset, unit, warnAmber, warnRed, t]);

  if (!beats?.length) return null;

  return (
    <div
      ref={boxRef}
      data-testid="structure-indicator"
      // Esquina inferior derecha de la onda, a las mismas distancias que los
      // botones de zoom de arriba (right-2). El contenedor mide justo lo que
      // el lienzo, así que bottom-1.5 lo deja pegado al borde de abajo.
      //
      // Ancho FIJO: pasar de 4 a 128, o de ritmo a bajón, no mueve la caja.
      className="pointer-events-auto absolute right-1.5 bottom-1.5 flex items-center gap-1.5 rounded border border-neutral-700/70 bg-neutral-950/85 px-1.5 py-0.5 text-[10px] leading-none text-neutral-300 tabular-nums select-none"
      style={{ visibility: "hidden" }}
    >
      <span ref={stateRef} className="w-3 text-center" />
      {/* Símbolo y número pegados: son una sola cosa (▼32), y cada pareja
          tiene su hueco reservado para que nada baile al cambiar la cuenta */}
      <span className="flex items-center">
        <span ref={firstSymRef} className="w-2.5 text-center text-neutral-400" />
        <span ref={firstNumRef} className="w-7 text-right text-neutral-200" />
      </span>
      <span className="flex items-center text-neutral-500">
        <span ref={secondSymRef} className="w-2.5 text-center" />
        <span ref={secondNumRef} className="w-5 text-right" />
      </span>
      <span className="text-neutral-700">·</span>
      <span ref={phraseRef} className="w-8 text-right text-neutral-400" />
    </div>
  );
}

export default memo(StructureIndicator);
