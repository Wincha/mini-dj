import React, { useEffect, useMemo, useState } from "react";
import { AudioEngine } from "./audio/engine";
import Deck from "./components/Deck";
import CentralMeters from "./components/CentralMeters";

export default function MiniDJMixer() {
  const engine = useMemo(() => new AudioEngine(), []);

  const [master, setMaster] = useState(1);
  const [volA, setVolA] = useState(1);
  const [volB, setVolB] = useState(1);
  const [eqA, setEqA] = useState({ gain: 0, high: 0, mid: 0, low: 0 });
  const [eqB, setEqB] = useState({ gain: 0, high: 0, mid: 0, low: 0 });

  // Centralizamos pitch para futuro SYNC
  const [pitchPctA, setPitchPctA] = useState(0);
  const [pitchPctB, setPitchPctB] = useState(0);

  // Rango y key lock por deck
  const [rangeA, setRangeA] = useState(8);
  const [rangeB, setRangeB] = useState(8);
  const [keyLockA, setKeyLockA] = useState(false);
  const [keyLockB, setKeyLockB] = useState(false);

  useEffect(() => {
    // C = fuerte solo en master
    engine.setMasterAutoLevel(true, {
      targetRMS: 0.22, // puedes ajustar 0.20–0.25
      upRate: 0.008,
      downRate: 0.03,
      tickMs: 50,
      minGain: 0.25,
      maxGain: 2.0,
    });
    return () => engine.setMasterAutoLevel(false);
  }, [engine]);

  useEffect(() => {
    engine.setMaster(master);
  }, [engine, master]);

  useEffect(() => {
    engine.setDeckVolume("A", volA);
  }, [engine, volA]);
  useEffect(() => {
    engine.setDeckVolume("B", volB);
  }, [engine, volB]);

  const onAttachEl = (which, el) => engine.attachMediaElement(which, el);

  const onVolChange = (which, v) => {
    if (which === "A") setVolA(v);
    else setVolB(v);
    engine.setDeckVolume(which, v);
  };

  const setEq = (which, vals) => {
    if (which === "A") setEqA(vals);
    else setEqB(vals);
    engine.setDeckEQ(which, vals); // ← aplica en el grafo
  };

  const setPitchRange = (which, r) => {
    if (which === "A") setRangeA(r);
    else setRangeB(r);
  };

  const setKeyLock = (which, val) => {
    if (which === "A") setKeyLockA(val);
    else setKeyLockB(val); /* TODO: activar time-stretch cuando ON */
  };

  const setPitchPct = (which, v) => {
    if (which === "A") setPitchPctA(v);
    else setPitchPctB(v);
  };

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 p-6">
      <div className="max-w-6xl mx-auto grid gap-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Mini DJ Mixer
            </h1>
            <p className="text-sm text-neutral-400">
              by Dj Wincha (Under construction)
            </p>
          </div>
        </header>

        {/* Panel central: VU y master */}
        <CentralMeters engine={engine} master={master} setMaster={setMaster} />

        {/* Decks */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Deck
            title="Deck A"
            colorClass="from-cyan-500/20 to-transparent"
            engine={engine}
            side="A"
            vol={volA}
            onVolChange={onVolChange}
            eq={eqA}
            setEq={setEq}
            pitchPct={pitchPctA}
            setPitchPct={setPitchPct}
            pitchRange={rangeA}
            setPitchRange={setPitchRange}
            keyLock={keyLockA}
            setKeyLock={setKeyLock}
            onAttachEl={onAttachEl}
          />
          <Deck
            title="Deck B"
            colorClass="from-fuchsia-500/20 to-transparent"
            engine={engine}
            side="B"
            vol={volB}
            onVolChange={onVolChange}
            eq={eqB}
            setEq={setEq}
            pitchPct={pitchPctB}
            setPitchPct={setPitchPct}
            pitchRange={rangeB}
            setPitchRange={setPitchRange}
            keyLock={keyLockB}
            setKeyLock={setKeyLock}
            onAttachEl={onAttachEl}
          />
        </div>
      </div>
    </div>
  );
}
