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
import { useI18n } from "../i18n/context";
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
  syncActive,
  syncLabel,
  onPlayed,
  externalTrack,
  isActive,
  onActivate,
  ref,
}) {
  const { t } = useI18n();
  const pitchRafRef = useRef(null);
  const audioRef = useRef(null);
  const beatDetectorRef = useRef(null);
  const bpmDisplayRef = useRef(null);
  const fileInputRef = useRef(null);

  // === Forma de onda / análisis ===
  const [waveData, setWaveData] = useState(null);
  const [beats, setBeats] = useState([]);
  const [bpm, setBpm] = useState(null);

  const [zoom, setZoom] = useState(64);
  const [scroll, setScroll] = useState(0);
  const [follow, setFollow] = useState(true);

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
    return fileName?.substring(0, fileName?.lastIndexOf(".")) || t("noFile");
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
  async function extractWaveform(arrayBuffer, trackName) {
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

    // Loudness de TODA la pista, calculado una sola vez al cargarla:
    // referencia = percentil 90 (la parte con todo el ritmo), nunca se
    // vuelve a mover durante la reproducción
    const { loudDb } = analyzeTrackLoudness(audioBuffer);
    const targetDb = -12; // nivel objetivo para la parte fuerte
    let gainDb = targetDb - loudDb;

    const MIN_GAIN_DB = -12;
    const MAX_GAIN_DB = +6;
    gainDb = Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));

    // Techo de pico: aunque el RMS pida más, no dejamos que los picos
    // pasen de -1 dBFS (es lo que distorsionaba con el auto activado)
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const l = Math.abs(ch0[i]);
      if (l > peak) peak = l;
      if (ch1) {
        const r = Math.abs(ch1[i]);
        if (r > peak) peak = r;
      }
    }
    if (peak > 0) {
      const peakDb = 20 * Math.log10(peak);
      const headroomDb = -1 - peakDb;
      gainDb = Math.min(gainDb, headroomDb);
    }
    gainDb = Math.max(MIN_GAIN_DB, gainDb);

    if (typeof onAutoGainComputed === "function") {
      onAutoGainComputed(side, gainDb);
    }
    setAnalyzing("bpm");
    detectBeats({
      audioBuffer,
      duration,
      trackName: trackName || "track",
    });
  }

  // Auto-cue: solo si el usuario no ha fijado un cue manual.
  // Si el deck está parado, colocamos también la pista en el cue.
  const applyAutoCue = (time) => {
    if (cueManualRef.current) return;
    setCuePoint(time);
    const el = audioRef.current;
    if (el && el.paused) {
      el.currentTime = time;
      setCurrent(time);
    }
  };

  // === BPM avanzado + detección de beats ===
  // Trabaja sobre el AudioBuffer ya decodificado: nada de re-fetch del blob
  // (congelaba la reproducción si dabas al play durante el análisis)
  async function detectBeats({ audioBuffer, duration: trackDuration, trackName }) {
    const detector = beatDetectorRef.current;
    if (!detector || !audioBuffer) {
      setBeats([]);
      updateBpm(null);
      setAnalyzing(null);
      return;
    }

    try {
      const info = await detector.getBeatInfoFromBuffer(audioBuffer, trackName);

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
        for (let time = beatStart; time < trackDuration; time += beatInterval) {
          beatsArr.push(time);
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
    if (beatDetectorRef.current) return;
    try {
      beatDetectorRef.current = new BeatDetect({
        sampleRate: engine?.ctx?.sampleRate || 44100,
      });
    } catch (err) {
      console.error("Unable to init BeatDetect", err);
    }
  }, [engine]);

  // === TAP de rejilla (estilo Traktor) ===
  // Pulsando al ritmo mientras suena: cada tap reancla la rejilla de beats a
  // ese instante, y con 2+ taps se recalcula el BPM. Los taps se guardan en
  // TIEMPO DE PISTA, así el pitch no falsea el cálculo.
  const tapRef = useRef({ taps: [], lastWall: 0 });

  const rebuildGrid = (anchor, interval) => {
    const dur = duration || audioRef.current?.duration || 0;
    if (!(dur > 0) || !(interval > 0)) return;
    // primer beat >= 0 en fase con el ancla
    const start = anchor - Math.floor(anchor / interval) * interval;
    const arr = [];
    for (let time = start; time < dur; time += interval) arr.push(time);
    setBeats(arr);
    if (typeof onAnalysis === "function") onAnalysis(side, { beats: arr });
  };

  const onTapBeat = () => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const now = performance.now();
    const st = tapRef.current;
    // una pausa larga entre taps empieza una secuencia nueva
    if (now - st.lastWall > 2500) st.taps = [];
    st.lastWall = now;
    st.taps.push(el.currentTime || 0);
    if (st.taps.length > 16) st.taps.shift();

    const taps = st.taps;
    const anchor = taps[taps.length - 1];

    let interval = bpm ? 60 / bpm : null;
    if (taps.length >= 2) {
      const ivs = [];
      for (let i = 1; i < taps.length; i++) {
        const d = taps[i] - taps[i - 1];
        if (d > 0.2 && d < 2.5) ivs.push(d); // 24–300 BPM plausibles
      }
      if (ivs.length) {
        ivs.sort((a, b) => a - b);
        const mid = Math.floor(ivs.length / 2);
        interval =
          ivs.length % 2 ? ivs[mid] : (ivs[mid - 1] + ivs[mid]) / 2;
        updateBpm(Math.round((60 / interval) * 10) / 10);
      }
    }
    if (!interval) return; // sin BPM previo y con un solo tap no hay rejilla
    rebuildGrid(anchor, interval);
  };

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

    (async () => {
      // Copia propia de los bytes: si el mismo archivo se carga en los dos
      // decks, dos <audio> leyendo el MISMO File en streaming se atascan
      // (la reproducción se congela); con una copia por deck no
      const arrayBuffer = await f.arrayBuffer();
      const blobCopy = new Blob([arrayBuffer], {
        type: f.type || "audio/mpeg",
      });
      const url = URL.createObjectURL(blobCopy);
      setObjectUrl(url);

      const el = audioRef.current;
      if (el) {
        el.src = url;
        el.load();
        el.preservesPitch = !!keyLock;
      }
      setIsPlaying(false);
      setCurrent(0);
      setDuration(0);
      setScroll(0);
      setFollow(true);

      // decodeAudioData "consume" (detach) el arrayBuffer, por eso la copia
      // del blob se hace antes
      await extractWaveform(arrayBuffer, f.name);
    })().catch((err) => {
      console.error("Track load failed", err);
      setAnalyzing(null);
    });
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
    e.target.value = ""; // permite volver a elegir el mismo archivo
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
      if (typeof onPlayed === "function") onPlayed(side);
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
  const setCueIfPaused = (time) => {
    const el = audioRef.current;
    if (!el || !el.paused) return;
    cueManualRef.current = true;
    setCuePoint(time);
  };

  const seek = (v) => {
    const el = audioRef.current;
    if (!el) return;
    const time = Number(v);
    el.currentTime = time;
    setCurrent(time);
    setCueIfPaused(time);
  };

  // Arrastre de la onda en pausa: empujar la pista hasta la línea de reproducción
  const onDragSeek = (time) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = time;
    setCurrent(time);
    setFollow(true);
    setCueIfPaused(time);
  };

  // Arrastre de la onda en play: nudge temporal tipo pitch bend
  const NUDGE_MAX = 6;
  const onNudge = (pct) => {
    bendHoldRef.current = true;
    if (bendRafRef.current) cancelAnimationFrame(bendRafRef.current);
    setBendPct(Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, pct)));
  };

  // === Quantize: imanta cues/loops/saltos al beat más cercano ===
  const [quantize, setQuantize] = useState(true);
  const snapToGrid = (time) => {
    if (!quantize || !beats.length) return time;
    let best = time;
    let bestD = Infinity;
    for (const b of beats) {
      const d = Math.abs(b - time);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  };

  // === Beat jump (estilo Traktor): salto de N beats adelante/atrás ===
  const [jumpBeats, setJumpBeats] = useState(4);
  const beatJump = (dir) => {
    const el = audioRef.current;
    if (!el || !bpm) return;
    const dt = dir * jumpBeats * (60 / bpm);
    const dur = duration || el.duration || 0;
    const base = snapToGrid(el.currentTime || 0);
    const time = Math.max(0, Math.min(Math.max(0, dur - 0.01), base + dt));
    el.currentTime = time;
    setCurrent(time);
    setCueIfPaused(time);
  };

  // === Hot cues ===
  const triggerHotCue = (i) => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const cueT = hotCues[i];
    if (cueT == null) {
      const next = [...hotCues];
      next[i] = snapToGrid(el.currentTime || 0);
      setHotCues(next);
    } else {
      el.currentTime = cueT;
      setCurrent(cueT);
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
    setLoopIn(snapToGrid(el.currentTime || 0));
    setLoopOut(null);
    setLoopOn(false);
  };

  const setLoopOutNow = () => {
    const el = audioRef.current;
    if (!el || loopIn == null) return;
    const raw = el.currentTime || 0;
    const snapped = snapToGrid(raw);
    // si el snap lo dejaría pegado o antes del IN, usar el punto crudo
    const time = snapped > loopIn + 0.05 ? snapped : raw;
    if (time <= loopIn + 0.05) return;
    setLoopOut(time);
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
      const p = Math.min(1, (now - start) / DURATION_MS);
      const k = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      el.playbackRate = startRate + (target - startRate) * k;

      if (p < 1) {
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
      const p = Math.min(1, (now - start) / BEND_RELEASE_MS);
      const k = 1 - p;
      const v = startVal * k;
      setBendPct(v);
      if (p < 1 && !bendHoldRef.current) {
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
            {t("deck", { side })}
            {isActive && (
              <span
                className="ml-2 text-[9px] align-middle text-sky-400 border border-sky-500/40 rounded px-1 py-0.5"
                title={t("keyboardBadgeTitle")}
              >
                {t("keyboardBadge")}
              </span>
            )}
          </h2>
          <span className="text-xs text-neutral-400 truncate min-w-0">
            {getFilenameWithoutExtension()}
          </span>
        </header>
        {/* Archivo (botón propio: el input nativo no se puede traducir) */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 rounded-xl bg-neutral-200 text-neutral-900 text-sm font-semibold hover:bg-white/90 whitespace-nowrap"
          >
            {t("loadFile")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac"
            onChange={onFile}
            className="hidden"
          />
        </div>
        {/* Content */}
        <div className="flex flex-row gap-3 w-full">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            {/* Tiempo + BPM */}
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <h5
                  className="tracking-tight cursor-pointer tabular-nums"
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
                    className="text-[10px] text-orange-400 tabular-nums whitespace-nowrap"
                    title={t("cueTitle")}
                  >
                    {t("cue")} {calcDuration(cuePoint)}
                  </span>
                )}
              </div>
              <div className="text-right text-xs text-neutral-400 leading-tight tabular-nums min-w-20 shrink-0">
                <div>{calcDuration(duration)}</div>
                <div
                  ref={bpmDisplayRef}
                  onClick={onTapBeat}
                  className="cursor-pointer select-none"
                  title={t("bpmDisplayTitle")}
                >
                  {runningBpm
                    ? `${runningBpm.toFixed(1)} BPM`
                    : bpm
                    ? `${bpm} BPM`
                    : t("bpmNone")}
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
                onSeek={(time) => {
                  const el = audioRef.current;
                  if (!el) return;
                  el.currentTime = time;
                  setCurrent(time);
                  setFollow(false);
                  setCueIfPaused(time);
                }}
                onDragSeek={onDragSeek}
                onNudge={onNudge}
                onNudgeEnd={releaseBend}
                onWheelZoom={(dir) =>
                  setZoom((z) =>
                    Math.max(1, Math.min(256, dir > 0 ? z * 2 : z / 2))
                  )
                }
              />
              {/* Feedback de análisis */}
              {analyzing === "wave" && (
                <div className="absolute inset-x-0 top-0 h-20 flex items-center justify-center rounded-lg bg-neutral-900/70 pointer-events-none">
                  <span className="text-xs text-neutral-300 animate-pulse">
                    {t("analyzingTrack")}
                  </span>
                </div>
              )}
              {analyzing === "bpm" && (
                <div className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none">
                  <span className="px-2 py-0.5 rounded bg-neutral-900/80 text-[10px] text-neutral-300 animate-pulse">
                    {t("detectingBpm")}
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
                    title={t("followTitle")}
                  >
                    {t("follow")}
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
              {/* Un solo botón: en grid reservamos el ancho del texto más
                  largo (play/pausa) para que no baile al alternar idioma */}
              <button
                onClick={isPlaying ? pause : play}
                disabled={!objectUrl && !isPlaying}
                className={`px-4 py-2 rounded-2xl font-semibold text-black grid place-items-center disabled:opacity-50 ${
                  isPlaying ? "bg-yellow-400" : "bg-emerald-500"
                }`}
              >
                <span className="col-start-1 row-start-1 invisible h-0" aria-hidden>
                  {t("play")}
                </span>
                <span className="col-start-1 row-start-1 invisible h-0" aria-hidden>
                  {t("pause")}
                </span>
                <span className="col-start-1 row-start-1 whitespace-nowrap">
                  {isPlaying ? t("pause") : t("play")}
                </span>
              </button>
              <button
                onClick={stop}
                disabled={!objectUrl}
                className="px-4 py-2 rounded-2xl bg-neutral-200 text-black font-semibold text-center min-w-24 disabled:opacity-50"
                title={t("stopTitle")}
              >
                {t("stop")}
              </button>
              {/* min-w fijo: que el texto SYNC·MST no ensanche y desplace la UI */}
              <button
                onClick={() => onSync?.(side)}
                disabled={!canSync || !bpm}
                className={`px-3 py-2 rounded-2xl font-semibold text-center min-w-28 disabled:opacity-40 ${
                  syncActive
                    ? "bg-emerald-500 text-black"
                    : "bg-sky-500/80 text-black"
                }`}
                title={
                  syncActive
                    ? t("syncActiveTitle", { source: syncLabel })
                    : t("syncTitle")
                }
              >
                {syncActive ? `${t("sync")}·${syncLabel}` : t("sync")}
              </button>
              <button
                onClick={() => setKeyLock(side, !keyLock)}
                disabled={!objectUrl}
                className={`px-3 py-2 rounded-2xl text-xs font-semibold border disabled:opacity-40 ${
                  keyLock
                    ? "bg-sky-400 text-black border-sky-300"
                    : "bg-neutral-800 text-neutral-200 border-neutral-700"
                }`}
                title={t("keyLockTitle")}
              >
                {t("keyLock")}
              </button>
            </div>
            {/* Hot cues + Jump + Loop, alineados y separados del transporte */}
            <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-xs mt-1 pt-3 border-t border-neutral-800/70">
              <div className="flex items-center gap-1">
                {hotCues.map((cueT, i) => (
                  <button
                    key={i}
                    onClick={(e) => {
                      if (e.shiftKey) clearHotCue(i);
                      else triggerHotCue(i);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      clearHotCue(i);
                    }}
                    disabled={!objectUrl}
                    className="w-7 h-7 rounded-lg border font-bold disabled:opacity-40"
                    style={
                      cueT != null
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
                      cueT != null
                        ? t("hotCueGoTitle", {
                            n: i + 1,
                            time: calcDuration(cueT),
                          })
                        : t("hotCueSetTitle", { n: i + 1 })
                    }
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              {/* Beat jump */}
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 mr-1">{t("jump")}</span>
                <button
                  onClick={() => beatJump(-1)}
                  disabled={!objectUrl || !bpm}
                  className="px-2 py-1 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 font-bold disabled:opacity-40"
                  title={t("jumpBackTitle", { n: jumpBeats })}
                >
                  «
                </button>
                <select
                  value={jumpBeats}
                  onChange={(e) => setJumpBeats(Number(e.target.value))}
                  disabled={!objectUrl || !bpm}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg px-1 py-1 disabled:opacity-40"
                  title={t("jumpSizeTitle")}
                >
                  {[1, 2, 4, 8, 16, 32].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => beatJump(+1)}
                  disabled={!objectUrl || !bpm}
                  className="px-2 py-1 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 font-bold disabled:opacity-40"
                  title={t("jumpFwdTitle", { n: jumpBeats })}
                >
                  »
                </button>
                <button
                  onClick={onTapBeat}
                  disabled={!objectUrl}
                  className="px-2 py-1 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 font-semibold active:bg-orange-400 active:text-black disabled:opacity-40"
                  title={t("tapTitle")}
                >
                  {t("tap")}
                </button>
                <button
                  onClick={() => setQuantize((q) => !q)}
                  disabled={!objectUrl}
                  className={`px-2 py-1 rounded-lg border font-bold disabled:opacity-40 ${
                    quantize
                      ? "bg-violet-500/80 border-violet-400 text-black"
                      : "bg-neutral-800 border-neutral-700 text-neutral-400"
                  }`}
                  title={t("quantizeTitle")}
                >
                  Q
                </button>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-neutral-500 mr-1">{t("loop")}</span>
                <button
                  onClick={setLoopInNow}
                  disabled={!objectUrl}
                  className={`px-2 py-1 rounded-lg border disabled:opacity-40 ${
                    loopIn != null
                      ? "bg-sky-500/30 border-sky-500/50 text-sky-300"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300"
                  }`}
                  title={t("loopInTitle")}
                >
                  {t("loopIn")}
                </button>
                <button
                  onClick={setLoopOutNow}
                  disabled={!objectUrl || loopIn == null}
                  className={`px-2 py-1 rounded-lg border disabled:opacity-40 ${
                    loopOut != null
                      ? "bg-sky-500/30 border-sky-500/50 text-sky-300"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300"
                  }`}
                  title={t("loopOutTitle")}
                >
                  {t("loopOut")}
                </button>
                <button
                  onClick={() => autoLoop(4)}
                  disabled={!objectUrl || !bpm}
                  className="px-2 py-1 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 disabled:opacity-40"
                  title={t("loop4Title")}
                >
                  4
                </button>
                <button
                  onClick={() => autoLoop(8)}
                  disabled={!objectUrl || !bpm}
                  className="px-2 py-1 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 disabled:opacity-40"
                  title={t("loop8Title")}
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
                  title={t("loopToggleTitle")}
                >
                  ⟳
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-24 shrink-0 items-center">
            {/* Pitch + Bend */}
            <div className="flex flex-col items-center">
              <span className="text-xs text-neutral-400 w-full text-center truncate tabular-nums">
                {t("pitch")}: {livePitch.toFixed(2)}%
              </span>
              <span className="text-[10px] text-sky-300 w-full text-center truncate tabular-nums">
                {t("bend")} {bendPct > 0 ? "+" : ""}
                {bendPct.toFixed(2)}%
                {keyLock && " · 🔒"}
              </span>
              {/* Como un plato Technics: arriba más lento (−), abajo más rápido (+) */}
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
                title={t("bendMinusTitle")}
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
                title={t("bendPlusTitle")}
              >
                +
              </button>
            </div>
            {/* Rango del pitch, junto al fader al que afecta */}
            <select
              value={pitchRange}
              onChange={onRangeChange}
              className="bg-neutral-800 border border-neutral-700 rounded-lg px-1 py-1 text-xs text-neutral-300"
              title={t("rangeTitle")}
            >
              <option value={8}>±8%</option>
              <option value={16}>±16%</option>
              <option value={50}>±50%</option>
            </select>
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
