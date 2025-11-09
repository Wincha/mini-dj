export default function HorizontalSlider({
  min = 0,
  max = 1,
  step = 0.01,
  value,
  onChange,
  className = "",
  height = undefined, // alto en px
  width = undefined, // ancho en px
  disabled = false,
  inverted = false,
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      disabled={disabled}
      style={{
        writingMode: "horizontal-tb",
        width: `${width}px`,
        height: `${height}px`,
        WebkitAppearance: "slider-horizontal",
        transform: inverted ? "scaleX(-1)" : "none",
      }}
      className={`w-full accent-white cursor-pointer ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      } ${className}`}
    />
  );
}

{
  /* <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={0.01}
          value={Number.isFinite(current) ? current : 0}
          onChange={(e) => seek(e.target.value)}
          className="w-full accent-white"
          disabled={!objectUrl}
        /> */
}
