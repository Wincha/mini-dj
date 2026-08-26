import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "./audio/engine";
import { quickAnalyzeTrack } from "./audio/analyzeTrack";
import {
  loadStoredTracks,
  storeTrack,
  removeStoredTrack,
} from "./lib/trackStore";
import Deck from "./components/Deck";
import CentralMeters from "./components/CentralMeters";
import Mixer from "./components/Mixer";
import TrackList from "./components/TrackList";
import BeatMatchPanel from "./components/BeatMatchPanel";
import HeadphoneCue from "./components/HeadphoneCue";

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

  // Onda + beats por deck (para el panel de beat-match)
  const [deckAnalysis, setDeckAnalysis] = useState({ A: null, B: null });

  // Deck activo: recibe los atajos de teclado
  const [activeDeck, setActiveDeck] = useState("A");
  const deckRefs = useRef({ A: null, B: null });
  const audioElsRef = useRef({ A: null, B: null });

  // Cola de análisis en segundo plano para la lista
  const analysisBusyRef = useRef(false);

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

  // Cargar la lista guardada (IndexedDB) al arrancar
  useEffect(() => {
    let cancelled = false;
    loadStoredTracks().then((stored) => {
      if (!cancelled && stored.length) {
        setTracks((prev) => {
          const known = new Set(prev.map((t) => t.id));
          return [...prev, ...stored.filter((t) => !known.has(t.id))];
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Analizar en segundo plano (una a una) las canciones sin BPM
  useEffect(() => {
    if (analysisBusyRef.current) return;
    const pending = tracks.find((t) => t.bpm == null && !t.analyzeFailed);
    if (!pending) return;

    analysisBusyRef.current = true;
    quickAnalyzeTrack(pending.file)
      .then(({ bpm, duration }) => {
        setTracks((prev) =>
          prev.map((t) => (t.id === pending.id ? { ...t, bpm, duration } : t))
        );
        storeTrack({ ...pending, bpm, duration });
      })
      .catch((err) => {
        console.error(`Analysis failed for ${pending.name}`, err);
        // Solo en memoria: al recargar se reintenta
        setTracks((prev) =>
          prev.map((t) =>
            t.id === pending.id ? { ...t, analyzeFailed: true } : t
          )
        );
      })
      .finally(() => {
        analysisBusyRef.current = false;
        // Dispara otra pasada para el siguiente pendiente
        setTracks((prev) => [...prev]);
      });
  }, [tracks]);

  const onAttachEl = useCallback(
    (which, el) => {
      audioElsRef.current[which] = el;
      engine.attachMediaElement(which, el);
    },
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
    else setKeyLockB(val);
  };

  const setPitchPct = (which, v) => {
    if (which === "A") setPitchPctA(v);
    else setPitchPctB(v);
  };

  const onBpmDetected = useCallback((side, bpm) => {
    setBpms((prev) => ({ ...prev, [side]: bpm }));
  }, []);

  const onAnalysis = useCallback((side, data) => {
    setDeckAnalysis((prev) => ({
      ...prev,
      [side]: { ...prev[side], ...data },
    }));
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
          const track = {
            id: `${file.name}-${file.size}-${file.lastModified}`,
            name: file.name,
            size: file.size,
            file,
            bpm: null,
            duration: null,
          };
          next.push(track);
          storeTrack(track);
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
    removeStoredTrack(id);
  };

  // === Atajos de teclado (actúan sobre el deck activo) ===
  useEffect(() => {
    const isTyping = (e) => {
      const tag = e.target?.tagName;
      return (
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        e.target?.isContentEditable
      );
    };

    const onKeyDown = (e) => {
      if (isTyping(e)) return;
      const api = deckRefs.current[activeDeck];

      switch (e.code) {
        case "KeyQ":
          setActiveDeck("A");
          return;
        case "KeyP":
          setActiveDeck("B");
          return;
        default:
          break;
      }

      if (!api) return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (!e.repeat) api.playPause();
          break;
        case "KeyC":
          if (!e.repeat) api.cueStop();
          break;
        case "Digit1":
        case "Digit2":
        case "Digit3":
          if (!e.repeat) api.hotCue(Number(e.code.slice(-1)) - 1);
          break;
        case "KeyI":
          if (!e.repeat) api.loopIn();
          break;
        case "KeyO":
          if (!e.repeat) api.loopOut();
          break;
        case "KeyL":
          if (!e.repeat) api.loopToggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (!e.repeat) api.nudgeStart(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (!e.repeat) api.nudgeStart(+1);
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e) => {
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        deckRefs.current[activeDeck]?.nudgeEnd();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [activeDeck]);

  const canSync = Boolean(bpms.A && bpms.B);

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 p-3 sm:p-6">
      <div className="mx-auto grid gap-4 sm:gap-6">
        {/* Panel central */}
        <CentralMeters engine={engine} master={master} setMaster={setMaster} />

        {/* Decks */}
        <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
          <Deck
            ref={(api) => {
              deckRefs.current.A = api;
            }}
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
            onAnalysis={onAnalysis}
            onSync={onSync}
            canSync={canSync}
            externalTrack={deckTracks.A}
            isActive={activeDeck === "A"}
            onActivate={setActiveDeck}
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
            ref={(api) => {
              deckRefs.current.B = api;
            }}
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
            onAnalysis={onAnalysis}
            onSync={onSync}
            canSync={canSync}
            externalTrack={deckTracks.B}
            isActive={activeDeck === "B"}
            onActivate={setActiveDeck}
            onAutoGainComputed={(side, gainDb) =>
              setDeckAutoGain((prev) => ({ ...prev, [side]: gainDb }))
            }
          />
        </div>

        {/* Beat match + pre-escucha */}
        <div className="grid lg:grid-cols-2 gap-4 sm:gap-6">
          <BeatMatchPanel analysis={deckAnalysis} audioElsRef={audioElsRef} />
          <HeadphoneCue engine={engine} />
        </div>

        {/* Lista de canciones */}
        <TrackList
          tracks={tracks}
          deckTracks={deckTracks}
          onAddTracks={onAddTracks}
          onLoadToDeck={onLoadToDeck}
          onRemoveTrack={onRemoveTrack}
        />

        {/* Atajos */}
        <p className="text-[10px] text-neutral-600 text-center">
          Teclado (deck activo: Q=A, P=B o click en el deck) — Espacio:
          play/pausa · C: cue/stop · 1-3: hot cues · I/O: loop in/out · L:
          loop on/off · ←/→: nudge
        </p>
      </div>
    </div>
  );
}
