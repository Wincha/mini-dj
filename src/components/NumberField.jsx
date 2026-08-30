import { useEffect, useRef } from "react";

// === Campo numérico que se ajusta arrastrando ===
//
// Escribir el número a mano sigue funcionando (es un <input>), pero lo normal
// es no querer teclear: se pulsa encima y se arrastra ARRIBA para subir y
// abajo para bajar, o se gira la rueda del ratón. Va despacio a propósito
// —varios píxeles por unidad— porque con el BPM del master pasarse de tres
// golpe es liarla en medio de una mezcla.
//
// Con Shift va aún más fino, para rematar el último punto.

// Píxeles de arrastre por cada paso. Cuanto más alto, más despacio.
const PX_POR_PASO = 7;
const PX_POR_PASO_FINO = 28; // con Shift

export default function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
  title,
  className = "",
  ariaLabel,
}) {
  const inputRef = useRef(null);
  // El arrastre no necesita re-render: vive en un ref
  const dragRef = useRef({ active: false, startY: 0, startValue: 0, moved: false });
  // Los callbacks los lee el listener nativo de la rueda, que se registra una
  // sola vez; con refs no hay que volver a montarlo en cada render.
  const stateRef = useRef({ value, min, max, step, onChange });
  stateRef.current = { value, min, max, step, onChange };

  const clamp = (v) => {
    let out = v;
    if (Number.isFinite(min)) out = Math.max(min, out);
    if (Number.isFinite(max)) out = Math.min(max, out);
    return out;
  };

  // Rueda del ratón: listener nativo porque React la registra como pasiva y
  // no dejaría cortar el scroll de la página.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const st = stateRef.current;
      const paso = e.shiftKey ? st.step / 5 : st.step;
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Number((st.value + dir * paso).toFixed(4));
      st.onChange(clampCon(next, st));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    const d = dragRef.current;
    d.active = true;
    d.moved = false;
    d.startY = e.clientY;
    d.startValue = value;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.active) return;
    // Arriba sube, abajo baja (el eje Y de la pantalla va al revés)
    const dy = d.startY - e.clientY;
    const porPaso = e.shiftKey ? PX_POR_PASO_FINO : PX_POR_PASO;
    const pasos = Math.round(dy / porPaso);
    if (!d.moved) {
      if (!pasos) return; // aún puede ser un click para escribir
      d.moved = true;
      // Al empezar a arrastrar, fuera el foco: si no, el cursor de texto se
      // queda parpadeando dentro y se selecciona el número
      inputRef.current?.blur();
    }
    e.preventDefault();
    const next = Number((d.startValue + pasos * step).toFixed(4));
    onChange(clamp(next));
  };

  const endDrag = (e) => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // Sin arrastre, se comporta como un campo normal: el click deja escribir
    if (!d.moved) inputRef.current?.focus();
  };

  return (
    <input
      ref={inputRef}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(clamp(v));
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title={title}
      aria-label={ariaLabel}
      className={`cursor-ns-resize select-none bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-center tabular-nums text-neutral-200 ${className}`}
    />
  );
}

// Igual que clamp, pero con los límites que trae el estado del ref
function clampCon(v, { min, max }) {
  let out = v;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}
