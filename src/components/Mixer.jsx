import { useState, useEffect } from "react";
import HorizontalSlider from "./HorizontalSlider";
import VerticalSlider from "./VerticalSlider";
import VUBar from "./VUBar";
import Knob from "./Knob";

export default function Mixer({ engine, eq, setEq, vol, onVolChange, deckAutoGain }) {
  const [cross, setCross] = useState(0.5);
  const [autoGainEnabled, setAutoGainEnabled] = useState({
    A: false,
    B: false,
  });

  useEffect(() => {
    engine.setCrossfader(cross);
  }, [engine, cross]);

  useEffect(() => {
    ["A", "B"].forEach((side) => {
      if (!autoGainEnabled[side]) return;
      const gainDb = deckAutoGain[side];
      if (gainDb == null) return;
      if (eq[side].gain === gainDb) return;
      setEq(side, { ...eq[side], gain: gainDb });
    });
  }, [autoGainEnabled, deckAutoGain, eq, setEq]);

  function toggleAutoGain(side) {
    setAutoGainEnabled((prev) => {
      const next = !prev[side];

      if (next) {
        const gainDb = deckAutoGain[side];
        if (gainDb != null) {
          setEq(side, { ...eq[side], gain: gainDb });
        }
      }

      return { ...prev, [side]: next };
    });
  }

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
              onClick={() => toggleAutoGain("A")}
              className={`px-2 py-1 rounded text-xs border ${
                autoGainEnabled.A
                  ? "bg-emerald-500 text-black border-emerald-400"
                  : "bg-neutral-800 text-neutral-200 border-neutral-700"
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
              onClick={() => toggleAutoGain("B")}
              className={`px-2 py-1 rounded text-xs border ${
                autoGainEnabled.B
                  ? "bg-emerald-500 text-black border-emerald-400"
                  : "bg-neutral-800 text-neutral-200 border-neutral-700"
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
