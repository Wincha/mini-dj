import { useState, useEffect } from "react";
import HorizontalSlider from "./HorizontalSlider";
import VerticalSlider from "./VerticalSlider";
import VUBar from "./VUBar";
import Knob from "./Knob";

export default function Mixer({ engine, eq, setEq, vol, onVolChange }) {
  const [cross, setCross] = useState(0.5);
  const [autoGain, setAutoGain] = useState({ A: false, B: false });

  useEffect(() => {
    const timer = setInterval(() => {
      ["A", "B"].forEach((side) => {
        if (!autoGain[side]) return;

        const rms = engine.getRMS(side);
        const currentGain = eq[side].gain;

        // Objetivo RMS aproximado
        const target = 0.22;
        const error = target - rms;

        // Ajuste leve si hay diferencia notable
        if (Math.abs(error) > 0.02) {
          const deltaDb = error * 20; // ajuste proporcional
          const newGain = Math.max(
            -24,
            Math.min(12, currentGain + deltaDb * 0.1)
          );
          setEq(side, { ...eq[side], gain: newGain });
        }
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [autoGain, eq, engine, setEq]);

  useEffect(() => {
    engine.setCrossfader(cross);
  }, [engine, cross]);

  return (
    <div
      className={`rounded-2xl border border-neutral-400 bg-neutral-900/70 p-5 shadow-xl relative overflow-hidden`}
    >
      <div className="flex flex-row gap-2 justify-between m-4">
        <div className="flex flex-row items-center justify-between gap-3 m-6 h-auto">
          <div className="flex flex-col gap-3">
            <Knob
              label="Gain"
              min={-24}
              max={+12}
              step={0.5}
              value={eq.A.gain}
              onChange={(e) =>
                setEq("A", { ...eq.A, gain: Number(e.target.value) })
              }
            />
            <button
              onClick={() => setAutoGain((prev) => ({ ...prev, A: !prev.A }))}
              className={`mt-1 px-2 py-0.5 text-[10px] rounded ${
                autoGain.A
                  ? "bg-emerald-500/30 text-emerald-300 border border-emerald-600"
                  : "bg-neutral-800 text-neutral-400 border border-neutral-700"
              }`}
            >
              Auto
            </button>
            <Knob
              label="High"
              min={-12}
              max={+12}
              step={0.5}
              value={eq.A.high}
              onChange={(e) =>
                setEq("A", { ...eq.A, high: Number(e.target.value) })
              }
            />
            <Knob
              label="Mid"
              min={-12}
              max={+12}
              step={0.5}
              value={eq.A.mid}
              onChange={(e) =>
                setEq("A", { ...eq.A, mid: Number(e.target.value) })
              }
            />
            <Knob
              label="Low"
              min={-12}
              max={+12}
              step={0.5}
              value={eq.A.low}
              onChange={(e) =>
                setEq("A", { ...eq.A, low: Number(e.target.value) })
              }
            />
          </div>
          <div className="flex flex-row h-1/1 gap-6 ml-6">
            <VerticalSlider
              min={0}
              max={1}
              step={0.01}
              value={vol.A}
              onChange={(e) => onVolChange("A", Number(e.target.value))}
              className="h-auto gap-2"
            />
            <VUBar engine={engine} side={"A"} />
          </div>
        </div>
        <div className="flex flex-row items-center justify-between gap-3 m-6 h-auto">
          <div className="flex flex-row h-1/1 gap-6 mr-6">
            <VUBar engine={engine} side={"B"} />
            <VerticalSlider
              min={0}
              max={1}
              step={0.01}
              value={vol.B}
              onChange={(e) => onVolChange("B", Number(e.target.value))}
              className="h-auto gap-2"
            />
          </div>
          <div className="flex flex-col gap-3">
            <Knob
              label="Gain"
              min={-24}
              max={+12}
              step={0.5}
              value={eq.B.gain}
              onChange={(e) =>
                setEq("B", { ...eq.B, gain: Number(e.target.value) })
              }
            />
            <button
              onClick={() => setAutoGain((prev) => ({ ...prev, B: !prev.B }))}
              className={`mt-1 px-2 py-0.5 text-[10px] rounded ${
                autoGain.B
                  ? "bg-emerald-500/30 text-emerald-300 border border-emerald-600"
                  : "bg-neutral-800 text-neutral-400 border border-neutral-700"
              }`}
            >
              Auto
            </button>
            <Knob
              label="High"
              min={-12}
              max={+12}
              step={0.5}
              value={eq.B.high}
              onChange={(e) =>
                setEq("B", { ...eq.B, high: Number(e.target.value) })
              }
            />
            <Knob
              label="Mid"
              min={-12}
              max={+12}
              step={0.5}
              value={eq.B.mid}
              onChange={(e) =>
                setEq("B", { ...eq.B, mid: Number(e.target.value) })
              }
            />
            <Knob
              label="Low"
              min={-12}
              max={+12}
              step={0.5}
              value={eq.B.low}
              onChange={(e) =>
                setEq("B", { ...eq.B, low: Number(e.target.value) })
              }
            />
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl w-[auto]">
        <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
          <span>A</span>
          <span>Crossfader</span>
          <span>B</span>
        </div>
        <HorizontalSlider
          min={0}
          max={1}
          step={0.001}
          value={cross}
          onChange={(e) => setCross(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
