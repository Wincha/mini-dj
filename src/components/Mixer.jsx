import { memo, useState, useEffect } from "react";
import Fader from "./Fader";
import VUBar from "./VUBar";
import Knob from "./Knob";
import { useI18n } from "../i18n/context";
import { GLOSS, PRESS, SKIN } from "./PadButton";

const KILL_DB = -40; // atenuación de banda en modo kill

function EqColumn({
  t,
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
  const band = (labelKey, key) => (
    <Knob
      size={44}
      title={t("eqTitle")}
      label={t(labelKey)}
      min={-12}
      max={+12}
      step={0.5}
      value={eq[key]}
      onChange={(e) => setEq(side, { ...eq, [key]: Number(e.target.value) })}
      killed={kills[key]}
      killLabel={t("kill")}
      onContextMenu={(e) => {
        e.preventDefault();
        toggleKill(side, key);
      }}
      resetValue={0}
    />
  );

  return (
    <div className="flex flex-col gap-2 items-center shrink-0">
      <Knob
        size={44}
        title={t("gainTitle")}
        label={t("gain")}
        min={-24}
        max={+12}
        step={0.5}
        value={eq.gain}
        onChange={(e) => setEq(side, { ...eq, gain: Number(e.target.value) })}
        onContextMenu={(e) => {
          e.preventDefault();
          setEq(side, { ...eq, gain: 0 });
        }}
        resetValue={0}
      />
      <button
        onClick={() => toggleAutoGain(side)}
        className={`px-2 py-1 rounded text-xs border w-16 text-center ${GLOSS} ${PRESS} ${
          autoGainEnabled
            ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-black border-emerald-400"
            : `text-neutral-200 ${SKIN}`
        }`}
      >
        {t("auto")}
      </button>
      {band("high", "high")}
      {band("mid", "mid")}
      {band("low", "low")}
      <Knob
        size={44}
        title={t("filterTitle")}
        label={t("filter")}
        min={-1}
        max={1}
        step={0.01}
        value={filt}
        onChange={(e) => onFilt(side, Number(e.target.value))}
        onContextMenu={(e) => {
          e.preventDefault();
          onFilt(side, 0);
        }}
        resetValue={0}
        format={(v) =>
          Math.abs(v) < 0.05
            ? t("filterOff")
            : (v < 0 ? "LPF " : "HPF ") + Math.round(Math.abs(v) * 100) + "%"
        }
      />
    </div>
  );
}

function Mixer({
  engine,
  eq,
  setEq,
  vol,
  onVolChange,
  deckAutoGain,
  vuMode,
}) {
  const { t } = useI18n();
  const [cross, setCross] = useState(0.5);
  // Auto-gain activo por defecto: nivela las pistas al cargarlas
  const [autoGainEnabled, setAutoGainEnabled] = useState({
    A: true,
    B: true,
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
            t={t}
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
            <Fader
              orientation="vertical"
              min={0}
              max={1}
              step={0.01}
              value={vol.A}
              onChange={(e) => onVolChange("A", Number(e.target.value))}
              ticks={11}
              accent="#22d3ee"
              resetValue={1}
              title={t("volumeTitle", { side: "A" })}
              ariaLabel={t("volumeTitle", { side: "A" })}
            />
            <VUBar engine={engine} side={"A"} mode={vuMode} />
          </div>
        </div>
        <div className="flex flex-row items-center gap-3 sm:gap-4">
          <div className="flex flex-row self-stretch gap-3 sm:gap-6">
            <VUBar engine={engine} side={"B"} mode={vuMode} />
            <Fader
              orientation="vertical"
              min={0}
              max={1}
              step={0.01}
              value={vol.B}
              onChange={(e) => onVolChange("B", Number(e.target.value))}
              ticks={11}
              accent="#e879f9"
              resetValue={1}
              title={t("volumeTitle", { side: "B" })}
              ariaLabel={t("volumeTitle", { side: "B" })}
            />
          </div>
          <EqColumn
            t={t}
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
          <span>{t("crossfader")}</span>
          <span>B</span>
        </div>
        <Fader
          min={0}
          max={1}
          step={0.001}
          value={cross}
          onChange={(e) => setCross(Number(e.target.value))}
          fill="center"
          ticks={5}
          thickness={26}
          resetValue={0.5}
          title={t("crossfaderTitle")}
          ariaLabel={t("crossfader")}
        />
      </div>
    </div>
  );
}

export default memo(Mixer);
