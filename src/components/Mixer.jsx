import { useState, useEffect } from "react";
import HorizontalSlider from "./HorizontalSlider";
import VerticalSlider from "./VerticalSlider";
import VUBar from "./VUBar";
import Knob from "./Knob";

const KILL_DB = -40; // atenuación de banda en modo kill

function EqColumn({
  side,
  eq,
  setEq,
  kills,
  toggleKill,
  filt,
  onFilt,
  autoGainEnabled,
  toggleAutoGain,
}) {
  const band = (label, key) => (
    <Knob
      size={44}
      label={label}
      min={-12}
      max={+12}
      step={0.5}
      value={eq[key]}
      onChange={(e) => setEq(side, { ...eq, [key]: Number(e.target.value) })}
      killed={kills[key]}
      onContextMenu={(e) => {
        e.preventDefault();
        toggleKill(side, key);
      }}
      resetValue={0}
    />
  );

  return (
    <div
      className="flex flex-col gap-2"
      title="EQ: click derecho = kill de banda · doble click = a cero"
    >
      <Knob
        size={44}
        label="Gain"
        min={-24}
        max={+12}
        step={0.5}
        value={eq.gain}
        onChange={(e) => setEq(side, { ...eq, gain: Number(e.target.value) })}
        resetValue={0}
      />
      <button
        onClick={() => toggleAutoGain(side)}
        className={`px-2 py-1 rounded text-xs border ${
          autoGainEnabled
            ? "bg-emerald-500 text-black border-emerald-400"
            : "bg-neutral-800 text-neutral-200 border-neutral-700"
        }`}
      >
        Auto
      </button>
      {band("High", "high")}
      {band("Mid", "mid")}
      {band("Low", "low")}
      <Knob
        size={44}
        label="Filter"
        min={-1}
        max={1}
        step={0.01}
        value={filt}
        onChange={(e) => onFilt(side, Number(e.target.value))}
        resetValue={0}
        format={(v) =>
          Math.abs(v) < 0.05
            ? "OFF"
            : (v < 0 ? "LPF " : "HPF ") + Math.round(Math.abs(v) * 100) + "%"
        }
      />
    </div>
  );
}

export default function Mixer({
  engine,
  eq,
  setEq,
  vol,
  onVolChange,
  deckAutoGain,
}) {
  const [cross, setCross] = useState(0.5);
  const [autoGainEnabled, setAutoGainEnabled] = useState({
    A: false,
    B: false,
  });
  // Kills de EQ y filtro DJ por deck
  const [kills, setKills] = useState({
    A: { low: false, mid: false, high: false },
    B: { low: false, mid: false, high: false },
  });
  const [filt, setFilt] = useState({ A: 0, B: 0 });

  useEffect(() => {
    engine.setCrossfader(cross);
  }, [engine, cross]);

  // Aplica el EQ efectivo (con kills) al grafo; corre tras el setEq del padre
  useEffect(() => {
    ["A", "B"].forEach((side) => {
      const k = kills[side];
      const e = eq[side];
      engine.setDeckEQ(side, {
        gain: e.gain,
        low: k.low ? KILL_DB : e.low,
        mid: k.mid ? KILL_DB : e.mid,
        high: k.high ? KILL_DB : e.high,
      });
    });
  }, [engine, eq, kills]);

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

  const toggleKill = (side, band) => {
    setKills((prev) => ({
      ...prev,
      [side]: { ...prev[side], [band]: !prev[side][band] },
    }));
  };

  const onFilt = (side, v) => {
    setFilt((prev) => ({ ...prev, [side]: v }));
    engine.setDeckFilter(side, v);
  };

  return (
    <div
      className={`rounded-2xl border border-neutral-400 bg-neutral-900/70 p-4 sm:p-5 shadow-xl relative overflow-hidden order-last lg:order-none`}
    >
      <div className="flex flex-row flex-wrap gap-4 justify-between mb-4">
        <div className="flex flex-row items-center gap-3 sm:gap-4">
          <EqColumn
            side="A"
            eq={eq.A}
            setEq={setEq}
            kills={kills.A}
            toggleKill={toggleKill}
            filt={filt.A}
            onFilt={onFilt}
            autoGainEnabled={autoGainEnabled.A}
            toggleAutoGain={toggleAutoGain}
          />
          <div className="flex flex-row self-stretch gap-3 sm:gap-6">
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
        <div className="flex flex-row items-center gap-3 sm:gap-4">
          <div className="flex flex-row self-stretch gap-3 sm:gap-6">
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
          <EqColumn
            side="B"
            eq={eq.B}
            setEq={setEq}
            kills={kills.B}
            toggleKill={toggleKill}
            filt={filt.B}
            onFilt={onFilt}
            autoGainEnabled={autoGainEnabled.B}
            toggleAutoGain={toggleAutoGain}
          />
        </div>
      </div>
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-4 shadow-xl">
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
