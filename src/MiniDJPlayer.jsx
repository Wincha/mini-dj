import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "./audio/engine";
import { quickAnalyzeTrack } from "./audio/analyzeTrack";
import { readTrackMetadata } from "./audio/metadata";
import {
  loadStoredTracks,
  storeTrack,
  removeStoredTrack,
} from "./lib/trackStore";
import Deck from "./components/Deck";
import CentralMeters from "./components/CentralMeters";
import Mixer from "./components/Mixer";
import TrackList from "./components/TrackList";
import HeadphoneCue from "./components/HeadphoneCue";
import ConfigDialog from "./components/ConfigDialog";
import { useI18n } from "./i18n/context";
import { buildWavePalette, resolveWaveColors } from "./lib/waveColors";

const PITCH_RANGES = [8, 16, 50];
const CONFIG_KEY = "mini-dj-config";

export default function MiniDJMixer() {
  const { t } = useI18n();
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

  // Sync continuo por deck + master sync global
  const [syncOn, setSyncOn] = useState({ A: false, B: false });
  const [masterSyncOn, setMasterSyncOn] = useState(false);
  const [masterBpm, setMasterBpm] = useState(128);

  // Rango y key lock por deck
  const [rangeA, setRangeA] = useState(8);
  const [rangeB, setRangeB] = useState(8);
  const [keyLockA, setKeyLockA] = useState(false);
  const [keyLockB, setKeyLockB] = useState(false);

  const [deckAutoGain, setDeckAutoGain] = useState({ A: 0, B: 0 });

  // Lista de canciones (crate) y pista cargada en cada deck
  const [tracks, setTracks] = useState([]);
  const [deckTracks, setDeckTracks] = useState({ A: null, B: null });
  const deckTracksRef = useRef(deckTracks);
  useEffect(() => {
    deckTracksRef.current = deckTracks;
  }, [deckTracks]);

  // Onda + beats por deck (para el panel de beat-match)
  const [deckAnalysis, setDeckAnalysis] = useState({ A: null, B: null });

  // Tonalidad y estado de reproducción por deck: con esto la lista sabe con
  // qué pista comparar las compatibilidades armónicas
  const [deckKeys, setDeckKeys] = useState({ A: null, B: null });
  const [playing, setPlaying] = useState({ A: false, B: false });
  const [lastStarted, setLastStarted] = useState("A");

  // Deck activo: recibe los atajos de teclado
  const [activeDeck, setActiveDeck] = useState("A");
  const deckRefs = useRef({ A: null, B: null });
  const setDeckRefA = useCallback((api) => {
    deckRefs.current.A = api;
  }, []);
  const setDeckRefB = useCallback((api) => {
    deckRefs.current.B = api;
  }, []);
  const audioElsRef = useRef({ A: null, B: null });

  // Salidas dedicadas por deck (modo mezcla externa)
  const deckOutARef = useRef(null);
  const deckOutBRef = useRef(null);

  // Configuración persistente (salidas de audio, modo de análisis)
  const [config, setConfig] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch {
      return {};
    }
  });
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      // almacenamiento no disponible
    }
  }, [config]);

  // Colas de análisis en segundo plano para la lista: las etiquetas van por
  // su lado porque son casi instantáneas (no hay que decodificar el audio),
  // mientras que BPM + tonalidad sí necesitan el decode completo.
  const analysisBusyRef = useRef(false);
  const metaBusyRef = useRef(false);

  useEffect(() => {
    engine.setMaster(master);
  }, [engine, master]);

  useEffect(() => {
    engine.setDeckVolume("A", volA);
  }, [engine, volA]);
  useEffect(() => {
    engine.setDeckVolume("B", volB);
  }, [engine, volB]);

  // === Aplicar salidas de audio de la config ===
  useEffect(() => {
    if (typeof engine.ctx.setSinkId !== "function") return;
    engine.setMasterSink(config.masterOut || "").catch((err) => {
      console.error("Master setSinkId failed", err);
    });
  }, [engine, config.masterOut]);

  const applyDeckOutput = useCallback(
    (side, deviceId, elRef) => {
      const el = elRef.current;
      if (deviceId) {
        engine.setDeckOutput(side, true);
        if (el) {
          if (!el.srcObject) el.srcObject = engine.getDeckStream(side);
          el.setSinkId?.(deviceId).catch((err) =>
            console.error(`Deck ${side} setSinkId failed`, err)
          );
          el.play().catch(() => {});
        }
      } else {
        engine.setDeckOutput(side, false);
        el?.pause();
      }
    },
    [engine]
  );

  useEffect(() => {
    applyDeckOutput("A", config.deckAOut, deckOutARef);
  }, [applyDeckOutput, config.deckAOut]);
  useEffect(() => {
    applyDeckOutput("B", config.deckBOut, deckOutBRef);
  }, [applyDeckOutput, config.deckBOut]);

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

  // Analizar en segundo plano las canciones a las que les falte BPM o
  // tonalidad: muy despacio para no laguear (espera 5s + momento de
  // inactividad del navegador, de una en una).
  // `analyzed` evita rehacer el trabajo en bucle cuando una pista no da
  // tonalidad (p. ej. percusión pura), y hace que las que ya estaban
  // guardadas de antes con BPM pero sin key se analicen una vez más.
  useEffect(() => {
    if ((config.analysisMode || "auto") !== "auto") return;
    if (analysisBusyRef.current) return;
    const pending = tracks.find(
      (t) =>
        !t.analyzed &&
        (t.bpm == null || t.musicalKey == null) &&
        !t.analyzeFailed
    );
    if (!pending) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      analysisBusyRef.current = true;
      quickAnalyzeTrack(pending.file)
        .then(({ bpm, gridAnchor, duration, musicalKey }) => {
          setTracks((prev) =>
            prev.map((t) => {
              if (t.id !== pending.id) return t;
              // Un ajuste manual de rejilla nunca lo pisa el análisis de fondo
              const updated = t.gridManual
                ? { ...t, duration, musicalKey, analyzed: true }
                : { ...t, bpm, gridAnchor, duration, musicalKey, analyzed: true };
              storeTrack(updated);
              return updated;
            })
          );
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
        });
    };

    const timerId = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(run, { timeout: 15000 });
      } else {
        run();
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [tracks, config.analysisMode]);

  // Etiquetas ID3 + miniatura de carátula. Igual que el BPM, respeta el modo
  // de análisis: en "solo al cargar en un deck" no se toca nada aquí.
  useEffect(() => {
    if ((config.analysisMode || "auto") !== "auto") return;
    if (metaBusyRef.current) return;
    const pending = tracks.find((t) => !t.metaRead);
    if (!pending) return;

    metaBusyRef.current = true;
    readTrackMetadata(pending.file)
      .then((meta) => {
        setTracks((prev) =>
          prev.map((t) => {
            if (t.id !== pending.id) return t;
            const updated = { ...t, ...meta, metaRead: true };
            storeTrack(updated);
            return updated;
          })
        );
      })
      .finally(() => {
        metaBusyRef.current = false;
      });
  }, [tracks, config.analysisMode]);

  const onAttachEl = useCallback(
    (which, el) => {
      audioElsRef.current[which] = el;
      engine.attachMediaElement(which, el);
    },
    [engine]
  );

  const onVolChange = useCallback((which, v) => {
    if (which === "A") setVolA(v);
    else setVolB(v);
  }, []);

  // El Mixer aplica el EQ efectivo al grafo (incluye los kills de banda)
  const setEq = useCallback((which, vals) => {
    if (which === "A") setEqA(vals);
    else setEqB(vals);
  }, []);

  const setPitchRange = useCallback((which, r) => {
    if (which === "A") setRangeA(r);
    else setRangeB(r);
  }, []);

  const setKeyLock = useCallback((which, val) => {
    if (which === "A") setKeyLockA(val);
    else setKeyLockB(val);
  }, []);

  const setPitchPct = useCallback((which, v) => {
    if (which === "A") setPitchPctA(v);
    else setPitchPctB(v);
  }, []);

  // Rejilla de un deck (detectada o ajustada a mano): alimenta el SYNC y, si
  // la pista vino de la lista, se guarda para no perder el ajuste al recargar
  const onBpmDetected = useCallback((side, bpm, grid) => {
    setBpms((prev) => (prev[side] === bpm ? prev : { ...prev, [side]: bpm }));
    if (!bpm) return;
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;
    const dur = audioElsRef.current[side]?.duration;
    const anchor = Number.isFinite(grid?.anchor) ? grid.anchor : null;
    const manual = Boolean(grid?.manual);
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== loaded.id) return t;
        if (
          t.bpm === bpm &&
          t.gridAnchor === anchor &&
          Boolean(t.gridManual) === manual &&
          t.duration != null
        ) {
          return t;
        }
        const updated = {
          ...t,
          bpm,
          gridAnchor: anchor,
          gridManual: manual,
          duration: Number.isFinite(dur) && dur > 0 ? dur : t.duration,
        };
        storeTrack(updated);
        return updated;
      })
    );
  }, []);

  // Datos que llegan del deck (etiquetas al cargar, tonalidad al analizar):
  // se reflejan en la lista y se persisten para no repetir el trabajo
  const onTrackMeta = useCallback((side, data) => {
    if ("musicalKey" in data) {
      setDeckKeys((prev) =>
        prev[side] === data.musicalKey ? prev : { ...prev, [side]: data.musicalKey }
      );
    }
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;

    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== loaded.id) return t;
        const updated = { ...t };
        let changed = false;
        if (data.musicalKey && !t.musicalKey) {
          updated.musicalKey = data.musicalKey;
          changed = true;
        }
        if ("artist" in data && !t.metaRead) {
          updated.artist = data.artist;
          updated.title = data.title;
          updated.album = data.album;
          updated.artwork = data.artwork;
          updated.metaRead = true;
          changed = true;
        }
        if (!changed) return t;
        storeTrack(updated);
        return updated;
      })
    );
  }, []);

  const onPlayingChange = useCallback((side, isPlaying) => {
    setPlaying((prev) => (prev[side] === isPlaying ? prev : { ...prev, [side]: isPlaying }));
    if (isPlaying) setLastStarted(side);
  }, []);

  const onAnalysis = useCallback((side, data) => {
    setDeckAnalysis((prev) => ({
      ...prev,
      [side]: { ...prev[side], ...data },
    }));
  }, []);

  // Marcar en la lista que la pista ya se pinchó en ese deck
  const onPlayed = useCallback((side) => {
    const loaded = deckTracksRef.current[side];
    if (!loaded) return;
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== loaded.id) return t;
        if (t.playedOn?.[side]) return t;
        const updated = {
          ...t,
          playedOn: { ...(t.playedOn || {}), [side]: true },
        };
        storeTrack(updated);
        return updated;
      })
    );
  }, []);

  // SYNC continuo: alterna el modo sync del deck
  const onSync = useCallback((side) => {
    setSyncOn((prev) => ({ ...prev, [side]: !prev[side] }));
  }, []);

  const onAutoGainComputed = useCallback((side, gainDb) => {
    setDeckAutoGain((prev) => ({ ...prev, [side]: gainDb }));
  }, []);

  const onToggleMasterSync = () => {
    setMasterSyncOn((prev) => {
      const next = !prev;
      if (next) {
        // Al activarlo, parte del BPM efectivo actual de un deck si lo hay
        const effA = bpms.A ? bpms.A * (1 + pitchPctA / 100) : null;
        const effB = bpms.B ? bpms.B * (1 + pitchPctB / 100) : null;
        const init = effA ?? effB;
        if (init) setMasterBpm(Math.round(init));
      }
      return next;
    });
  };

  // Motor de sync: mientras un deck tenga SYNC, su pitch se ajusta solo al
  // objetivo (master BPM o BPM efectivo del otro deck)
  useEffect(() => {
    ["A", "B"].forEach((side) => {
      if (!syncOn[side]) return;
      const own = bpms[side];
      if (!own) return;

      let targetBpm;
      if (masterSyncOn) {
        targetBpm = masterBpm;
      } else {
        const other = side === "A" ? "B" : "A";
        if (!bpms[other]) return;
        const otherPitch = other === "A" ? pitchPctA : pitchPctB;
        targetBpm = bpms[other] * (1 + otherPitch / 100);
      }
      if (!targetBpm) return;

      let pitch = (targetBpm / own - 1) * 100;
      const currentRange = side === "A" ? rangeA : rangeB;
      let range = currentRange;
      if (Math.abs(pitch) > range) {
        range =
          PITCH_RANGES.find((r) => r >= Math.abs(pitch)) ??
          PITCH_RANGES[PITCH_RANGES.length - 1];
      }
      pitch = Math.max(-range, Math.min(range, pitch));

      const cur = side === "A" ? pitchPctA : pitchPctB;
      if (range !== currentRange) setPitchRange(side, range);
      if (Math.abs(pitch - cur) > 0.005) setPitchPct(side, pitch);
    });
  }, [
    syncOn,
    masterSyncOn,
    masterBpm,
    bpms,
    pitchPctA,
    pitchPctB,
    rangeA,
    rangeB,
    setPitchPct,
    setPitchRange,
  ]);

  const onAddTracks = useCallback((files) => {
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
            gridAnchor: null,
            gridManual: false,
            duration: null,
            playedOn: {},
            analyzed: false,
            artist: null,
            title: null,
            album: null,
            artwork: null,
            metaRead: false,
            musicalKey: null,
          };
          next.push(track);
          storeTrack(track);
        }
      }
      return next;
    });
  }, []);

  const onLoadToDeck = useCallback((side, track) => {
    setDeckTracks((prev) => ({
      ...prev,
      [side]: { ...track, loadToken: (prev[side]?.loadToken || 0) + 1 },
    }));
  }, []);

  const onRemoveTrack = useCallback((id) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    removeStoredTrack(id);
  }, []);

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

  const syncLabel = (side) =>
    masterSyncOn ? "MST" : side === "A" ? "B" : "A";
  const canSyncFor = (side) => {
    const other = side === "A" ? "B" : "A";
    return Boolean(bpms[side] && (masterSyncOn || bpms[other]));
  };

  // Tonalidad de referencia para la lista: la del deck que esté sonando (si
  // suenan los dos, la del último que arrancó)
  const referenceKey = useMemo(() => {
    const order = lastStarted === "B" ? ["B", "A"] : ["A", "B"];
    for (const side of order) {
      if (playing[side] && deckKeys[side]) return deckKeys[side];
    }
    return null;
  }, [playing, deckKeys, lastStarted]);

  // Paleta de la onda: se reconstruye solo al cambiar de preset o de color
  const wavePalette = useMemo(
    () => buildWavePalette(resolveWaveColors(config)),
    [config]
  );

  const eqPair = useMemo(() => ({ A: eqA, B: eqB }), [eqA, eqB]);
  const volPair = useMemo(() => ({ A: volA, B: volB }), [volA, volB]);

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 p-3 sm:p-6">
      <div className="mx-auto grid gap-4 sm:gap-6">
        {/* Cabecera: título + REC | beat match | master + master sync */}
        <CentralMeters
          engine={engine}
          master={master}
          setMaster={setMaster}
          analysis={deckAnalysis}
          audioElsRef={audioElsRef}
          masterSyncOn={masterSyncOn}
          onToggleMasterSync={onToggleMasterSync}
          masterBpm={masterBpm}
          setMasterBpm={setMasterBpm}
          onOpenConfig={() => setShowConfig(true)}
        />

        {/* Decks */}
        <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 [&>*]:min-w-0">
          <Deck
            ref={setDeckRefA}
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
            canSync={canSyncFor("A")}
            syncActive={syncOn.A}
            syncLabel={syncLabel("A")}
            onPlayed={onPlayed}
            onPlayingChange={onPlayingChange}
            onTrackMeta={onTrackMeta}
            wavePalette={wavePalette}
            externalTrack={deckTracks.A}
            isActive={activeDeck === "A"}
            onActivate={setActiveDeck}
            onAutoGainComputed={onAutoGainComputed}
          />
          <Mixer
            engine={engine}
            eq={eqPair}
            setEq={setEq}
            vol={volPair}
            onVolChange={onVolChange}
            deckAutoGain={deckAutoGain}
          />
          <Deck
            ref={setDeckRefB}
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
            canSync={canSyncFor("B")}
            syncActive={syncOn.B}
            syncLabel={syncLabel("B")}
            onPlayed={onPlayed}
            onPlayingChange={onPlayingChange}
            onTrackMeta={onTrackMeta}
            wavePalette={wavePalette}
            externalTrack={deckTracks.B}
            isActive={activeDeck === "B"}
            onActivate={setActiveDeck}
            onAutoGainComputed={onAutoGainComputed}
          />
        </div>

        {/* Pre-escucha */}
        <HeadphoneCue engine={engine} cueDeviceId={config.cueOut} />

        {/* Lista de canciones */}
        <TrackList
          tracks={tracks}
          deckTracks={deckTracks}
          onAddTracks={onAddTracks}
          onLoadToDeck={onLoadToDeck}
          onRemoveTrack={onRemoveTrack}
          referenceKey={referenceKey}
          showArtwork={config.showArtwork !== false}
          showKey={config.showKey !== false}
          onToggleArtwork={(v) =>
            setConfig((prev) => ({ ...prev, showArtwork: v }))
          }
        />

        {/* Atajos */}
        <p className="text-[10px] text-neutral-600 text-center">
          {t("shortcuts")}
        </p>
      </div>

      {/* Salidas dedicadas por deck (modo mezcla externa) */}
      <audio ref={deckOutARef} className="hidden" />
      <audio ref={deckOutBRef} className="hidden" />

      <ConfigDialog
        open={showConfig}
        onClose={() => setShowConfig(false)}
        config={config}
        onConfigChange={setConfig}
      />
    </div>
  );
}
