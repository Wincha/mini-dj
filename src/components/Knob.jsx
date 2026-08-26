import { useMemo } from "react";

export default function Knob({
  min = -12,
  max = 12,
  step = 0.1,
  value,
  onChange,
  label,
  size = 56, // diámetro en px
  format, // (value) => texto; por defecto "x.x dB"
  killed = false, // banda muerta (kill de EQ): aguja y texto en rojo
  onContextMenu,
  resetValue, // doble click = volver a este valor
}) {
  const pct = (value - min) / (max - min); // 0..1
  const deg = useMemo(() => -135 + pct * 270, [pct]); // [-135°, +135°]

  return (
    <div
      className="flex flex-col items-center gap-0.5 select-none"
      onContextMenu={onContextMenu}
      onDoubleClick={
        resetValue !== undefined
          ? () => onChange({ target: { value: resetValue } })
          : undefined
      }
    >
      <div
        className="relative rounded-full bg-neutral-800 border border-neutral-700 shadow-inner overflow-hidden"
        style={{ width: size, height: size }}
      >
        {/* Cara con SVG para una aguja precisa */}
        <svg viewBox="0 0 56 56" className="absolute inset-0">
          {/* fondo interno */}
          <circle cx="28" cy="28" r="26" fill="rgb(23 23 23)" /> {/* neutral-900 */}
          {/* aguja: anclada en el centro, rotada alrededor de (28,28) */}
          <g transform={`rotate(${deg} 28 28)`}>
            {/* línea desde el centro hacia arriba (antes de rotar) */}
            <line
              x1="28" y1="28" x2="28" y2="8"
              stroke={killed ? "rgb(248 113 113)" : "rgb(212 212 212)"}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        </svg>

        {/* input invisible encima para capturar drag/click */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </div>

      {/* Label y valor */}
      {label && (
        <span
          className={`text-xs ${killed ? "text-red-400" : "text-neutral-400"}`}
        >
          {label}
        </span>
      )}
      <span
        className={`text-[10px] ${killed ? "text-red-400 font-bold" : "text-neutral-500"}`}
      >
        {killed ? "KILL" : format ? format(value) : `${value?.toFixed(1)} dB`}
      </span>
    </div>
  );
}
