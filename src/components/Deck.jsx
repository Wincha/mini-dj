import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
} from "react";
import VerticalSlider from "./VerticalSlider";
import HorizontalSlider from "./HorizontalSlider";
import WaveformCanvas from "./WaveformCanvas";
import { HOT_CUE_COLORS } from "../lib/constants";
import { analyzeTrackLoudness, BeatDetect } from "../audio/utils";

export default function Deck({
  colorClass,
  engine,
  side,
  pitchPct,
  setPitchPct,
  pitchRange,
  setPitchRange,
  keyLock,
  setKeyLock,
  onAttachEl,
  onAutoGainComputed,
  onBpmDetected,
  onAnalysis,
  onSync,
  canSync,
  externalTrack,
  isActive,
  onActivate,
  ref,
}) {
  const pitchRafRef = useRef(null);
  const audioRef = useRef(null);
  const beatDetectorRef = useRef(null);
  const bpmDisplayRef = useRef(null);

  // === Forma de onda / análisis ===
  const [waveData, setWaveData] = useState(null);
  const [beats, setBeats] = useState([]);
  const [bpm, setBpm] = useState(null);

  const [zoom, setZoom] = useState(64);
  const [scroll, setScroll] = useState(0);
  const [follow, setFollow] = useState(true);
  const [isBeatDetectorReady, setBeatDetectorReady] = useState(false);

  const [fileName, setFileName] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  // CUE: posición de arranque. Se fija al posicionar la pista en pausa,
  // o automáticamente al inicio del sonido / primer beat detectado
  const [cuePoint, setCuePoint] = useState(0);
  const cueManualRef = useRef(false);

  // Hot cues (3 por deck) y loop
  const [hotCues, setHotCues] = useState([null, null, null]);
  const [loopIn, setLoopIn] = useState(null);
  const [loopOut, setLoopOut] = useState(null);
  const [loopOn, setLoopOn] = useState(false);

  // Fase de análisis para feedback en UI: null | "wave" | "bpm"
  const [analyzing, setAnalyzing] = useState(null);

  const [bendPct, setBendPct] = useState(0);
  const bendHoldRef = useRef(false);
  const bendRafRef = useRef(null);

  const [reverseAdvancedTime, setReverseAdvancedTime] = useState(true);

  const livePitch = useMemo(() => pitchPct + bendPct, [pitchPct, bendPct]);

  // BPM efectivo (corriendo) = BPM base × factor de tempo
  const runningBpm = useMemo(() => {
    if (!bpm) return null;
    const factor = 1 + (pitchPct + bendPct) / 100;
    return bpm * factor;
  }, [bpm, pitchPct, bendPct]);

  const updateBpm = (value) => {
    setBpm(value);
    if (typeof onBpmDetected === "function") onBpmDetected(side, value);
  };

  const getFilenameWithoutExtension = () => {
    return fileName?.substring(0, fileName?.lastIndexOf(".")) || "Sin Archivo";
  };

  const calcDuration = (time) => {
    if (!Number.isFinite(time)) return "00:00";

    const totalSeconds = Math.max(0, Math.floor(time));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (val) => String(val).padStart(2, "0");

    return hours > 0
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  };

  // === Waveform + loudness (L+R → mono, resolución adaptativa) ===
  async function extractWaveform(file, sourceUrl) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);

    const ch0 = audioBuffer.getChannelData(0);
    const hasStereo = audioBuffer.numberOfChannels > 1;
    const ch1 = hasStereo ? audioBuffer.getChannelData(1) : null;

    const duration = audioBuffer.duration;
    const targetPerSecond = 80;
    let samples = Math.floor(duration * targetPerSecond);
    samples = Math.max(4000, Math.min(samples, 40000));

    const len = ch0.length;
    const blockSize = Math.max(1, Math.floor(len / samples));
    const peaks = [];

    for (let i = 0; i < samples; i++) {
      const start = i * blockSize;
      if (start >= len) break;
      const end = i === samples - 1 ? len : Math.min(len, start + blockSize);

      let acc = 0;
      let count = 0;

      for (let j = start; j < end; j++) {
        const l = ch0[j];
        const r = ch1 ? ch1[j] : l;
        const mono = (l + r) * 0.5;
        acc += Math.abs(mono);
        count++;
      }

      peaks.push(count ? acc / count : 0);
    }

    const max = Math.max(...peaks) || 1;
    const norm = peaks.map((v) => v / max);
    setWaveData(norm);
    if (typeof onAnalysis === "function") {
      onAnalysis(side, { waveData: norm, duration });
    }

    // Auto-cue provisional: inicio del sonido (primer bloque no silencioso)
    const onsetIdx = norm.findIndex((v) => v > 0.05);
    if (onsetIdx > -1) {
      const onsetTime = (onsetIdx / norm.length) * duration;
      applyAutoCue(onsetTime);
    }

    // Loudness con mediana
    const { db: medianDb } = analyzeTrackLoudness(audioBuffer);
    const targetDb = -8;
    let gainDb = targetDb - medianDb;

    const MIN_GAIN_DB = -12;
    const MAX_GAIN_DB = +9;
    gainDb = Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));

    if (typeof onAutoGainComputed === "function") {
      onAutoGainComputed(side, gainDb);
    }
    if (sourceUrl) {
      setAnalyzing("bpm");
      detectBeats({
        url: sourceUrl,
        duration,
        trackName: file?.name || "track",
      });
    } else {
      setAnalyzing(null);
    }
  }

  // Auto-cue: solo si el usuario no ha fijado un cue manual.
  // Si el deck está parado, colocamos también la pista en el cue.
  const applyAutoCue = (t) => {
    if (cueManualRef.current) return;
    setCuePoint(t);
    const el = audioRef.current;
    if (el && el.paused) {
      el.currentTime = t;
      setCurrent(t);
    }
  };

  // === BPM avanzado + detección de beats ===
  async function detectBeats({ url, duration: trackDuration, trackName }) {
    const detector = beatDetectorRef.current;
    if (!detector || !url) {
      setBeats([]);
      updateBpm(null);
      setAnalyzing(null);
      return;
    }

    try {
      const info = await detector.getBeatInfo({
        url,
        name: trackName,
      });

      const resolvedBpm = info?.bpm;
      if (!resolvedBpm) {
        updateBpm(null);
        setBeats([]);
        return;
      }

      const normalizedBpm = Math.round(resolvedBpm);
      updateBpm(normalizedBpm);

      if (Number.isFinite(trackDuration) && trackDuration > 0) {
        const beatInterval = 60 / resolvedBpm;
        const beatStart = Number.isFinite(info?.firstBar)
          ? Math.max(0, info.firstBar)
          : Number.isFinite(info?.offset)
          ? Math.max(0, info.offset)
          : 0;
        const beatsArr = [];
        for (let t = beatStart; t < trackDuration; t += beatInterval) {
          beatsArr.push(t);
        }
        setBeats(beatsArr);
        if (typeof onAnalysis === "function") {
          onAnalysis(side, { beats: beatsArr });
        }
        // Auto-cue definitivo: primer beat detectado
        applyAutoCue(beatStart);
      } else {
        setBeats([]);
      }
    } catch (err) {
      console.error("Beat detection failed", err);
      setBeats([]);
      updateBpm(null);
    } finally {
      setAnalyzing(null);
    }
  }

  // Instancia única del detector de beats (solo en cliente)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (beatDetectorRef.current) {
      setBeatDetectorReady(true);
      return;
    }
    try {
      beatDetectorRef.current = new BeatDetect({
        sampleRate: engine?.ctx?.sampleRate || 44100,
      });
      setBeatDetectorReady(true);
    } catch (err) {
      console.error("Unable to init BeatDetect", err);
    }
  }, [engine]);

  // Soporte de TAP BPM manual sobre el display
  useEffect(() => {
    const detector = beatDetectorRef.current;
    const element = bpmDisplayRef.current;
    if (!isBeatDetectorReady || !detector || !element) return;

    const cleanup = detector.tapBpm({
      element,
      precision: 1,
      callback: (value) => {
        if (value === "--") return;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          updateBpm(numeric);
        }
      },
    });

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBeatDetectorReady]);

  // conectar el mediaElement al engine + listeners básicos del <audio>
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    onAttachEl(side, el);

    const onTimeUpdate = () => setCurrent(el.currentTime || 0);
    const onLoadedMetadata = () => setDuration(el.duration || 0);
    const onEnded = () => setIsPlaying(false);

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    el.addEventListener("ended", onEnded);

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
      el.removeEventListener("ended", onEnded);
    };
  }, [onAttachEl, side]);

  // Key lock: preservesPitch=true mantiene el tono al cambiar el tempo;
  // false = modo vinilo (el pitch cambia el tono)
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.preservesPitch = !!keyLock;
  }, [keyLock]);

  // limpiar URL de archivo
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );

  const loadTrack = (f) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    setObjectUrl(url);
    setFileName(f.name);
    setWaveData(null);
    setBeats([]);
    setCuePoint(0);
    setHotCues([null, null, null]);
    setLoopIn(null);
    setLoopOut(null);
    setLoopOn(false);
    cueManualRef.current = false;
    setAnalyzing("wave");
    if (typeof onAnalysis === "function") {
      onAnalysis(side, { waveData: null, beats: [], duration: 0 });
    }

    extractWaveform(f, url).catch((err) => {
      console.error("Track analysis failed", err);
      setAnalyzing(null);
    });

    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    el.load();
    el.preservesPitch = !!keyLock;
    setIsPlaying(false);
    setCurrent(0);
    setDuration(0);
    setScroll(0);
    setFollow(true);
  };

  const loadTrackRef = useRef(loadTrack);
  loadTrackRef.current = loadTrack;

  // Carga desde la lista de canciones (crate)
  useEffect(() => {
    if (!externalTrack?.file) return;
    loadTrackRef.current(externalTrack.file);
  }, [externalTrack?.loadToken, externalTrack?.file]);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    loadTrack(f);
  };

  const onLoaded = () => {
    const el = audioRef.current;
    if (!el) return;
    setDuration(el.duration || 0);
  };

  const play = async () => {
    await engine?.resume();
    const el = audioRef.current;
    if (!el) return;
    try {
      await el.play();
      setIsPlaying(true);
    } catch (e) {
      console.error(e);
    }
  };

  const pause = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setIsPlaying(false);
  };

  // STOP vuelve al punto CUE (0 si no hay cue)
  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = cuePoint;
    setCurrent(cuePoint);
    setIsPlaying(false);
  };

  // Posicionar la pista en pausa fija el CUE en ese punto
  const setCueIfPaused = (t) => {
    const el = audioRef.current;
    if (!el || !el.paused) return;
    cueManualRef.current = true;
    setCuePoint(t);
  };

  const seek = (v) => {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(v);
    el.currentTime = t;
    setCurrent(t);
    setCueIfPaused(t);
  };

  // Arrastre de la onda en pausa: empujar la pista hasta la línea de reproducción
  const onDragSeek = (t) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = t;
    setCurrent(t);
    setFollow(true);
    setCueIfPaused(t);
  };

  // Arrastre de la onda en play: nudge temporal tipo pitch bend
  const NUDGE_MAX = 6;
  const onNudge = (pct) => {
    bendHoldRef.current = true;
    if (bendRafRef.current) cancelAnimationFrame(bendRafRef.current);
    setBendPct(Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, pct)));
  };

  // === Hot cues ===
  const triggerHotCue = (i) => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const t = hotCues[i];
    if (t == null) {
      const next = [...hotCues];
      next[i] = el.currentTime || 0;
      setHotCues(next);
    } else {
      el.currentTime = t;
      setCurrent(t);
    }
  };

  const clearHotCue = (i) => {
    setHotCues((prev) => {
      const next = [...prev];
      next[i] = null;
      return next;
    });
  };

  // === Loop ===
  const setLoopInNow = () => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    setLoopIn(el.currentTime || 0);
    setLoopOut(null);
    setLoopOn(false);
  };

  const setLoopOutNow = () => {
    const el = audioRef.current;
    if (!el || loopIn == null) return;
    const t = el.currentTime || 0;
    if (t <= loopIn + 0.05) return;
    setLoopOut(t);
    setLoopOn(true);
  };

  const toggleLoop = () => {
    if (loopIn != null && loopOut != null) setLoopOn((v) => !v);
  };

  // Loop automático de N beats anclado al beat anterior más cercano
  const autoLoop = (nBeats) => {
    const el = audioRef.current;
    if (!el || !bpm || !objectUrl) return;
    const cur = el.currentTime || 0;
    let start = cur;
    for (let i = beats.length - 1; i >= 0; i--) {
      if (beats[i] <= cur) {
        start = beats[i];
        break;
      }
    }
    const end = start + nBeats * (60 / bpm);
    if (duration && end > duration) return;
    setLoopIn(start);
    setLoopOut(end);
    setLoopOn(true);
  };

  // Forzar el loop mientras suena
  useEffect(() => {
    if (!loopOn || loopIn == null || loopOut == null) return;
    let id;
    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused && el.currentTime >= loopOut) {
        el.currentTime = loopIn;
        setCurrent(loopIn);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [loopOn, loopIn, loopOut]);

  // API imperativa para atajos de teclado (MiniDJPlayer)
  useImperativeHandle(ref, () => ({
    playPause: () => (isPlaying ? pause() : play()),
    cueStop: stop,
    hotCue: triggerHotCue,
    loopIn: setLoopInNow,
    loopOut: setLoopOutNow,
    loopToggle: toggleLoop,
    nudgeStart: (sign) => startBend(sign),
    nudgeEnd: () => releaseBend(),
  }));

  // Pitch / tempo suave
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const target = 1 + (pitchPct + bendPct) / 100;

    if (pitchRafRef.current) cancelAnimationFrame(pitchRafRef.current);

    const DURATION_MS = 120;
    const startRate = el.playbackRate || 1;
    const start = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const k = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      el.playbackRate = startRate + (target - startRate) * k;

      if (t < 1) {
        pitchRafRef.current = requestAnimationFrame(step);
      } else {
        pitchRafRef.current = null;
        el.playbackRate = target;
      }
    };

    pitchRafRef.current = requestAnimationFrame(step);
    return () => {
      if (pitchRafRef.current) cancelAnimationFrame(pitchRafRef.current);
      pitchRafRef.current = null;
    };
  }, [pitchPct, bendPct]);

  const onPitchChange = (val) => {
    const v = Math.max(-pitchRange, Math.min(pitchRange, Number(val)));
    setPitchPct(side, v);
  };

  const onRangeChange = (e) => {
    const r = Number(e.target.value);
    setPitchRange(side, r);
    setPitchPct(side, Math.max(-r, Math.min(r, pitchPct)));
  };

  const BEND_MAX = 2.0;
  const BEND_RELEASE_MS = 120;

  function startBend(sign) {
    bendHoldRef.current = true;
    if (bendRafRef.current) cancelAnimationFrame(bendRafRef.current);
    setBendPct(sign * BEND_MAX);
  }

  function releaseBend() {
    bendHoldRef.current = false;
    const start = performance.now();
    const startVal = bendPct;

    const step = (now) => {
      const t = Math.min(1, (now - start) / BEND_RELEASE_MS);
      const k = 1 - t;
      const v = startVal * k;
      setBendPct(v);
      if (t < 1 && !bendHoldRef.current) {
        bendRafRef.current = requestAnimationFrame(step);
      } else if (!bendHoldRef.current) {
        setBendPct(0);
      }
    };
    bendRafRef.current = requestAnimationFrame(step);
  }

  return (
    <div
      onPointerDown={() => onActivate?.(side)}
      className={`rounded-2xl border bg-neutral-900/70 p-4 sm:p-5 shadow-xl relative overflow-hidden ${
        isActive ? "border-sky-500/60 ring-1 ring-sky-500/40" : "border-neutral-800"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${colorClass}`}
      />
      <div className="relative grid gap-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight shrink-0">
            {`Deck ${side}`}
            {isActive && (
              <span
                className="ml-2 text-[9px] align-middle text-sky-400 border border-sky-500/40 rounded px-1 py-0.5"
                title="Deck activo: recibe los atajos de teclado"
              >
                TECLADO
              </span>
            )}
          </h2>
          <span className="text-xs text-neutral-400 truncate min-w-0">
            {getFilenameWithoutExtension()}
          </span>
        </header>
        {/* Archivo */}
        <label className="flex items-center gap-3 min-w-0">
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac"
            onChange={onFile}
            className="block w-full min-w-0 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-neutral-200 file:text-neutral-900 hover:file:bg-white/90 cursor-pointer"
          />
        </label>
        {/* Content */}
        <div className="flex flex-row gap-2 w-full">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {/* Tiempo + BPM */}
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <h5
                  className="tracking-tight cursor-pointer"
                  onClick={() =>
                    setReverseAdvancedTime(
                      (prevReverseTime) => !prevReverseTime
                    )
                  }
                >
                  {reverseAdvancedTime
                    ? `-${calcDuration(duration - current)}`
                    : calcDuration(current)}
                </h5>
                {objectUrl && (
                  <span
                    className="text-[10px] text-orange-400"
                    title="Punto CUE: se fija al posicionar la pista en pausa; Stop vuelve aquí"
                  >
                    CUE {calcDuration(cuePoint)}
                  </span>
                )}
              </div>
              <div className="text-right text-xs text-neutral-400 leading-tight">
                <div>{calcDuration(duration)}</div>
                <div
                  ref={bpmDisplayRef}
                  className="cursor-pointer select-none"
                  title="Haz click para tap BPM manualmente"
                >
                  {runningBpm
                    ? `${runningBpm.toFixed(1)} BPM`
                    : bpm
                    ? `${bpm} BPM`
                    : "BPM --"}
                </div>
              </div>
            </div>
            {/* Seek global */}
            <HorizontalSlider
              min={0}
              max={Math.max(1, Math.floor(duration))}
              step={0.01}
              value={Number.isFinite(current) ? current : 0}
              onChange={(e) => seek(e.target.value)}
              disabled={!objectUrl}
            />
            {/* Forma de onda */}
            <div className="relative w-full pb-7">
              <WaveformCanvas
                waveData={waveData}
                beats={beats}
                cuePoint={cuePoint}
                hotCues={hotCues}
                loopIn={loopIn}
                loopOut={loopOut}
                loopOn={loopOn}
                audioRef={audioRef}
                zoom={zoom}
                scroll={scroll}
                follow={follow}
                onSeek={(t) => {
                  const el = audioRef.current;
                  if (!el) return;
                  el.currentTime = t;
                  setCurrent(t);
                  setFollow(false);
                  setCueIfPaused(t);
                }}
                onDragSeek={onDragSeek}
                onNudge={onNudge}
                onNudgeEnd={releaseBend}
              />
              {/* Feedback de análisis */}
              {analyzing === "wave" && (
                <div className="absolute inset-x-0 top-0 h-20 flex items-center justify-center rounded-lg bg-neutral-900/70 pointer-events-none">
                  <span className="text-xs text-neutral-300 animate-pulse">
                    ⏳ Analizando pista…
                  </span>
                </div>
              )}
              {analyzing === "bpm" && (
                <div className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none">
                  <span className="px-2 py-0.5 rounded bg-neutral-900/80 text-[10px] text-neutral-300 animate-pulse">
                    ⏳ Detectando BPM…
                  </span>
                </div>
              )}
              {/* Zoom */}
              <div className="absolute right-2 top-1 flex gap-2 text-xs text-neutral-400">
                <button
                  onClick={() => setZoom((z) => Math.min(z * 2, 256))}
                  className="px-2 py-0.5 bg-neutral-700 rounded hover:bg-neutral-600"
                >
                  🔍+
                </button>
                <button
                  onClick={() => setZoom((z) => Math.max(z / 2, 1))}
                  className="px-2 py-0.5 bg-neutral-700 rounded hover:bg-neutral-600"
                >
                  🔍−
                </button>
              </div>
              {/* Seguir */}
              <div className="absolute left-2 top-1">
                {!follow && (
                  <button
                    onClick={() => setFollow(true)}
                    className="px-2 py-0.5 text-[10px] bg-neutral-700 text-neutral-300 rounded hover:bg-neutral-600"
                    title="Volver a seguir la reproducción"
                  >
                    🔁 Seguir
                  </button>
                )}
              </div>
              {/* Scroll manual */}
              {zoom > 1 && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={scroll}
                  onChange={(e) => {
                    setScroll(Number(e.target.value));
                    setFollow(false);
                  }}
                  className="absolute bottom-1 left-2 right-2 w-[calc(100%-1rem)] accent-white"
                />
              )}
            </div>
            {/* Transporte */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {!isPlaying ? (
                <button
                  onClick={play}
                  disabled={!objectUrl}
                  className="px-4 py-2 rounded-2xl bg-emerald-500 text-black font-semibold disabled:opacity-50"
                >
                  ▶︎ Play
                </button>
              ) : (
                <button
                  onClick={pause}
                  className="px-4 py-2 rounded-2xl bg-yellow-400 text-black font-semibold"
                >
                  ❚❚ Pausa
                </button>
              )}
              <button
                onClick={stop}
                disabled={!objectUrl}
                className="px-4 py-2 rounded-2xl bg-neutral-200 text-black font-semibold disabled:opacity-50"
                title="Para y vuelve al punto CUE"
              >
                ■ Stop
              </button>
              <button
                onClick={() => onSync?.(side)}
                disabled={!canSync || !bpm}
                className="px-3 py-2 rounded-2xl bg-sky-500/80 text-black font-semibold disabled:opacity-40"
                title="Iguala el BPM efectivo de este deck al del otro deck"
              >
                SYNC
              </button>
              <button
                onClick={() => setKeyLock(side, !keyLock)}
                disabled={!objectUrl}
                className={`px-3 py-2 rounded-2xl text-xs font-semibold border disabled:opacity-40 ${
                  keyLock
                    ? "bg-sky-400 text-black border-sky-300"
                    : "bg-neutral-800 text-neutral-200 border-neutral-700"
                }`}
                title="Key lock: mantiene el tono al cambiar el tempo (OFF = modo vinilo)"
              >
                🔒 Key
              </button>
              <div className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
                <span>Rango</span>
                <select
                  value={pitchRange}
                  onChange={onRangeChange}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1"
                >
                  <option value={8}>±8%</option>
                  <option value={16}>±16%</option>
                  <option value={50}>±50%</option>
                </select>
              </div>
            </div>
            {/* Hot cues + Loop */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <div className="flex items-center gap-1">
                {hotCues.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => triggerHotCue(i)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      clearHotCue(i);
                    }}
                    disabled={!objectUrl}
                    className="w-7 h-7 rounded-lg border font-bold disabled:opacity-40"
                    style={
                      t != null
                        ? {
                            backgroundColor: HOT_CUE_COLORS[i],
                            borderColor: HOT_CUE_COLORS[i],
                            color: "#000",
                          }
                        : {
                            backgroundColor: "rgb(38 38 38)",
                            borderColor: "rgb(64 64 64)",
                            color: "rgb(163 163 163)",
                          }
                    }
                    title={
                      t != null
                        ? `Hot cue ${i + 1}: saltar a ${calcDuration(t)} (click dcho borra)`
                        : `Hot cue ${i + 1}: fijar en la posición actual`
                    }
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-neutral-500 mr-1">Loop</span>
                <button
                  onClick={setLoopInNow}
                  disabled={!objectUrl}
                  className={`px-2 py-1 rounded-lg border disabled:opacity-40 ${
                    loopIn != null
                      ? "bg-sky-500/30 border-sky-500/50 text-sky-300"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300"
                  }`}
                  title="Marca el inicio del loop en la posición actual"
                >
                  IN
                </button>
                <button
                  onClick={setLoopOutNow}
                  disabled={!objectUrl || loopIn == null}
                  className={`px-2 py-1 rounded-lg border disabled:opacity-40 ${
                    loopOut != null
                      ? "bg-sky-500/30 border-sky-500/50 text-sky-300"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300"
                  }`}
                  title="Marca el final del loop y lo activa"
                >
                  OUT
                </button>
                <button
                  onClick={() => autoLoop(4)}
                  disabled={!objectUrl || !bpm}
                  className="px-2 py-1 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 disabled:opacity-40"
                  title="Loop automático de 4 beats desde el beat anterior"
                >
                  4
                </button>
                <button
                  onClick={() => autoLoop(8)}
                  disabled={!objectUrl || !bpm}
                  className="px-2 py-1 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 disabled:opacity-40"
                  title="Loop automático de 8 beats desde el beat anterior"
                >
                  8
                </button>
                <button
                  onClick={toggleLoop}
                  disabled={loopIn == null || loopOut == null}
                  className={`px-2 py-1 rounded-lg border font-semibold disabled:opacity-40 ${
                    loopOn
                      ? "bg-emerald-500 border-emerald-400 text-black"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300"
                  }`}
                  title="Activa/desactiva el loop marcado"
                >
                  ⟳
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-20 shrink-0 items-center">
            {/* Pitch + Bend */}
            <div className="flex flex-col items-center">
              <span className="text-xs text-neutral-400">
                Pitch: {livePitch.toFixed(2)}%
              </span>
              <span className="text-[10px] text-sky-300">
                bend {bendPct > 0 ? "+" : ""}
                {bendPct.toFixed(2)}%
                {keyLock && " · 🔒"}
              </span>
              <VerticalSlider
                min={-pitchRange}
                max={pitchRange}
                step={0.01}
                value={pitchPct}
                onChange={(e) => onPitchChange(e.target.value)}
                height={150}
                width={20}
                inverted={true}
              />
            </div>
            <div className="flex items-center justify-center gap-1">
              <button
                onMouseDown={() => startBend(-1)}
                onMouseUp={releaseBend}
                onMouseLeave={releaseBend}
                onTouchStart={() => startBend(-1)}
                onTouchEnd={releaseBend}
                className="px-2.5 py-1 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs"
                title="Bend − (más lento mientras mantienes)"
              >
                −
              </button>
              <button
                onMouseDown={() => startBend(+1)}
                onMouseUp={releaseBend}
                onMouseLeave={releaseBend}
                onTouchStart={() => startBend(+1)}
                onTouchEnd={releaseBend}
                className="px-2.5 py-1 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs"
                title="Bend + (más rápido mientras mantienes)"
              >
                +
              </button>
            </div>
          </div>
        </div>
        <audio
          ref={audioRef}
          onLoadedMetadata={onLoaded}
          className="hidden"
          preload="metadata"
          crossOrigin="anonymous"
        />
      </div>
    </div>
  );
}
