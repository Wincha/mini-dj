export default function VerticalSlider({
  label = undefined,
  min = 0,
  max = 1,
  step = 0.01,
  value,
  onChange,
  className = "",
  height = undefined, // alto en px
  width = 24, // ancho en px
  disabled = false,
  inverted = false,
}) {
  return (
    <>
      {label && (<span className="text-xs text-neutral-400">{label}</span>)}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={{
          writingMode: "vertical-rl",
          ...(width ? { width: `${width}px` } : {}),
          ...(height ? { height: `${height}px` } : {}),
          WebkitAppearance: "slider-vertical",
          transform: !inverted ? "scaleY(-1)" : "none",
        }}
        className={`accent-white cursor-pointer ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        } ${className}`}
      />
    </>
  );
}
