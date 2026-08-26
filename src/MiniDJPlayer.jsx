import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioEngine } from "./audio/engine";
import Deck from "./components/Deck";
import CentralMeters from "./components/CentralMeters";
import Mixer from "./components/Mixer";
import TrackList from "./components/TrackList";

const PITCH_RANGES = [8, 16, 50];

export default function MiniDJMixer() {
  const engine = useMemo(() => new AudioEngine(), []);

  const [master, setMaster] = useState(1);
  const [volA, setVolA] = useState(1);
  const [volB, setVolB] = useState(1);
  const [eqA, setEqA] = useState({ gain: 0, high: 0, mid: 0, low: 0 });
  const [eqB, setEqB] = useState({ gain: 0, high: 0, mid: 0, low: 0 });

  // Centralizamos pitch y BPM para SYNC
  const [pitchPctA, setPitchPctA] = useState(0);
  const [pitchPctB, setPitchPctB] = useState(0);
  const [bpms, setBpms] = useState({ A: null, B: null });

  // Rango y key lock por deck
  const [rangeA, setRangeA] = useState(8);
  const [rangeB, setRangeB] = useState(8);
  const [keyLockA, setKeyLockA] = useState(false);
  const [keyLockB, setKeyLockB] = useState(false);

  const [deckAutoGain, setDeckAutoGain] = useState({ A: 0, B: 0 });

  // Lista de canciones (crate) y pista cargada en cada deck
  const [tracks, setTracks] = useState([]);
  const [deckTracks, setDeckTracks] = useState({ A: null, B: null });

  useEffect(() => {
    engine.setMasterAutoLevel(true);
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

  const onAttachEl = useCallback(
    (which, el) => engine.attachMediaElement(which, el),
    [engine]
  );

  const onVolChange = (which, v) => {
    if (which === "A") setVolA(v);
    else setVolB(v);
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

  const onBpmDetected = useCallback((side, bpm) => {
    setBpms((prev) => ({ ...prev, [side]: bpm }));
  }, []);

  // SYNC: iguala el BPM efectivo de este deck al del otro ajustando el pitch
  const onSync = (side) => {
    const other = side === "A" ? "B" : "A";
    const ownBpm = bpms[side];
    const otherBpm = bpms[other];
    if (!ownBpm || !otherBpm) return;

    const otherPitch = other === "A" ? pitchPctA : pitchPctB;
    const targetBpm = otherBpm * (1 + otherPitch / 100);
    let pitch = (targetBpm / ownBpm - 1) * 100;

    // Ampliamos el rango si el pitch necesario no cabe en el actual
    const currentRange = side === "A" ? rangeA : rangeB;
    let range = currentRange;
    if (Math.abs(pitch) > range) {
      range =
        PITCH_RANGES.find((r) => r >= Math.abs(pitch)) ??
        PITCH_RANGES[PITCH_RANGES.length - 1];
    }
    pitch = Math.max(-range, Math.min(range, pitch));

    setPitchRange(side, range);
    setPitchPct(side, pitch);
  };

  const onAddTracks = (files) => {
    setTracks((prev) => {
      const next = [...prev];
      for (const file of files) {
        const exists = next.some(
          (t) => t.name === file.name && t.size === file.size
        );
        if (!exists) {
          next.push({
            id: `${file.name}-${file.size}-${file.lastModified}`,
            name: file.name,
            size: file.size,
            file,
          });
        }
      }
      return next;
    });
  };

  const onLoadToDeck = (side, track) => {
    setDeckTracks((prev) => ({
      ...prev,
      [side]: { ...track, loadToken: (prev[side]?.loadToken || 0) + 1 },
    }));
  };

  const onRemoveTrack = (id) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
  };

  const canSync = Boolean(bpms.A && bpms.B);

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 p-3 sm:p-6">
      <div className="mx-auto grid gap-4 sm:gap-6">
        {/* Panel central */}
        <CentralMeters engine={engine} master={master} setMaster={setMaster} />

        {/* Decks */}
        <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
          <Deck
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
            onBpmDetected={onBpmDetected}
            onSync={onSync}
            canSync={canSync}
            externalTrack={deckTracks.A}
            onAutoGainComputed={(side, gainDb) =>
              setDeckAutoGain((prev) => ({ ...prev, [side]: gainDb }))
            }
          />
          <Mixer
            engine={engine}
            eq={{ A: eqA, B: eqB }}
            setEq={setEq}
            vol={{ A: volA, B: volB }}
            onVolChange={onVolChange}
            deckAutoGain={deckAutoGain}
          />
          <Deck
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
            onBpmDetected={onBpmDetected}
            onSync={onSync}
            canSync={canSync}
            externalTrack={deckTracks.B}
            onAutoGainComputed={(side, gainDb) =>
              setDeckAutoGain((prev) => ({ ...prev, [side]: gainDb }))
            }
          />
        </div>

        {/* Lista de canciones */}
        <TrackList
          tracks={tracks}
          deckTracks={deckTracks}
          onAddTracks={onAddTracks}
          onLoadToDeck={onLoadToDeck}
          onRemoveTrack={onRemoveTrack}
        />
      </div>
    </div>
  );
}
