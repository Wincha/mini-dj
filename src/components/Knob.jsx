import React, { useMemo } from "react";

export default function Knob({
  min = -12,
  max = 12,
  step = 0.1,
  value,
  onChange,
  label,
}) {
  const pct = (value - min) / (max - min); // 0..1
  const deg = useMemo(() => -135 + pct * 270, [pct]); // [-135°, +135°]

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div className="relative w-14 h-14 rounded-full bg-neutral-800 border border-neutral-700 shadow-inner overflow-hidden">
        {/* Cara con SVG para una aguja precisa */}
        <svg viewBox="0 0 56 56" className="absolute inset-0">
          {/* fondo interno */}
          <circle cx="28" cy="28" r="26" fill="rgb(23 23 23)" /> {/* neutral-900 */}
          {/* aguja: anclada en el centro, rotada alrededor de (28,28) */}
          <g transform={`rotate(${deg} 28 28)`}>
            {/* línea desde el centro hacia arriba (antes de rotar) */}
            <line
              x1="28" y1="28" x2="28" y2="8"
              stroke="rgb(212 212 212)"       /* neutral-300 */
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
      {label && <span className="text-xs text-neutral-400">{label}</span>}
      <span className="text-[10px] text-neutral-500">{value.toFixed(1)} dB</span>
    </div>
  );
}
