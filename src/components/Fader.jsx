import { useMemo } from "react";
import { useI18n } from "../i18n/context";

/**
 * Fader reutilizable con aspecto de mesa de mezclas.
 *
 * - orientation: "horizontal" | "vertical"
 * - variant: "fader" (cabezal rectangular con línea central) | "native"
 * - fill: "start" (se ilumina desde el mínimo), "center" (desde el centro,
 *   útil para pitch/crossfader) o "none"
 * - ticks: número de marcas de escala a pintar en el carril (0 = ninguna)
 * - invert: máximo abajo/izquierda (pitch estilo Technics)
 * - resetValue: valor al que vuelve con click derecho (posición inicial)
 *
 * Por dentro sigue siendo un <input type="range">: mantiene teclado,
 * accesibilidad y el arrastre nativo; solo se dibuja encima.
 */
export default function Fader({
  min = 0,
  max = 1,
  step = 0.01,
  value = 0,
  onChange,
  orientation = "horizontal",
  variant = "fader",
  fill = "start",
  ticks = 0,
  invert = false,
  disabled = false,
  length,              // px (número) o valor CSS ("100%"); vertical por defecto se estira
  thickness = 22,      // grosor del cabezal (ancho en vertical, alto en horizontal)
  railThickness = 6,   // grosor del carril
  accent = "#f5f5f5",  // color de la parte activa
  className = "",
  title,
  ariaLabel,
  resetValue, // click derecho → vuelve aquí
}) {
  const { t } = useI18n();
  const vertical = orientation === "vertical";
  const hasReset = resetValue !== undefined && typeof onChange === "function";
  const fullTitle = [title, hasReset ? t("resetHint") : null]
    .filter(Boolean)
    .join(" · ");
  const onContextMenu = hasReset
    ? (e) => {
        e.preventDefault();
        onChange({ target: { value: resetValue } });
      }
    : undefined;
  const range = max - min || 1;
  const pct = Math.max(0, Math.min(1, (value - min) / range));
  // Fracción hacia el extremo "alto" según la orientación visual
  const visualPct = invert ? 1 - pct : pct;

  const tickList = useMemo(
    () =>
      ticks > 1
        ? Array.from({ length: ticks }, (_, i) => i / (ticks - 1))
        : [],
    [ticks]
  );

  if (variant === "native") {
    return (
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        onContextMenu={onContextMenu}
        disabled={disabled}
        title={fullTitle || undefined}
        aria-label={ariaLabel}
        style={
          vertical
            ? {
                writingMode: "vertical-lr",
                direction: "rtl",
                width: `${thickness}px`,
                ...(length ? { height: `${length}px` } : {}),
                transform: invert ? "scaleY(-1)" : "none",
              }
            : { ...(length ? { width: length } : {}) }
        }
        className={`accent-white cursor-pointer ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        } ${className}`}
      />
    );
  }

  // Geometría del carril y del cabezal
  const headLong = 12; // largo del cabezal en el eje de recorrido
  const headWide = thickness;
  const cssLen = (v, fallback) =>
    v == null ? fallback : typeof v === "number" ? `${v}px` : v;
  const containerStyle = vertical
    ? { width: `${Math.max(headWide, 24)}px`, height: cssLen(length, "100%") }
    : { width: cssLen(length, "100%"), height: `${Math.max(headWide, 24)}px` };

  // Tramo activo del carril
  const fillStyle = () => {
    if (fill === "none") return null;
    const from = fill === "center" ? 0.5 : 0;
    const lo = Math.min(from, visualPct);
    const hi = Math.max(from, visualPct);
    return vertical
      ? { bottom: `${lo * 100}%`, height: `${(hi - lo) * 100}%`, left: 0, right: 0 }
      : { left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, top: 0, bottom: 0 };
  };
  const filled = fillStyle();

  // El cabezal se mueve dentro del recorrido dejando su propio largo libre
  const headPos = `calc(${visualPct * 100}% - ${visualPct * headLong}px)`;

  return (
    <div
      className={`relative select-none ${disabled ? "opacity-50" : ""} ${className}`}
      style={containerStyle}
      title={fullTitle || undefined}
      onContextMenu={onContextMenu}
    >
      {/* Carril de fondo (apagado) */}
      <div
        className="absolute rounded-full bg-neutral-800 border border-neutral-700/70"
        style={
          vertical
            ? {
                width: `${railThickness}px`,
                left: "50%",
                transform: "translateX(-50%)",
                top: 0,
                bottom: 0,
              }
            : {
                height: `${railThickness}px`,
                top: "50%",
                transform: "translateY(-50%)",
                left: 0,
                right: 0,
              }
        }
      >
        {/* Marcas de escala */}
        {tickList.map((f, i) => (
          <div
            key={i}
            className="absolute bg-neutral-600/70"
            style={
              vertical
                ? { bottom: `${f * 100}%`, height: "1px", left: "-4px", right: "-4px" }
                : { left: `${f * 100}%`, width: "1px", top: "-4px", bottom: "-4px" }
            }
          />
        ))}
        {/* Tramo recorrido (iluminado) */}
        {filled && (
          <div
            className="absolute rounded-full"
            style={{
              ...filled,
              background: accent,
              boxShadow: `0 0 6px ${accent}55`,
            }}
          />
        )}
      </div>

      {/* Cabezal tipo mesa de mezclas: rectángulo con línea central */}
      <div
        className="absolute pointer-events-none rounded-[3px] border border-neutral-500 bg-gradient-to-b from-neutral-200 to-neutral-400 shadow-md"
        style={
          vertical
            ? {
                height: `${headLong}px`,
                width: `${headWide}px`,
                left: "50%",
                marginLeft: `-${headWide / 2}px`,
                bottom: headPos,
              }
            : {
                width: `${headLong}px`,
                height: `${headWide}px`,
                top: "50%",
                marginTop: `-${headWide / 2}px`,
                left: headPos,
              }
        }
      >
        <div
          className="absolute bg-neutral-700"
          style={
            vertical
              ? { left: 1, right: 1, top: "50%", height: "2px", marginTop: "-1px" }
              : { top: 1, bottom: 1, left: "50%", width: "2px", marginLeft: "-1px" }
          }
        />
      </div>

      {/* Input real por encima: arrastre, teclado y accesibilidad */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        style={
          vertical
            ? {
                writingMode: "vertical-lr",
                direction: "rtl",
                transform: invert ? "scaleY(-1)" : "none",
              }
            : { transform: invert ? "scaleX(-1)" : "none" }
        }
      />
    </div>
  );
}
