import { useEffect, useRef, useState, useMemo } from "react";
import VerticalSlider from "./VerticalSlider";
import HorizontalSlider from "./HorizontalSlider";
import WaveformCanvas from "./WaveformCanvas";
import { analyzeTrackLoudness, BeatDetect } from "../audio/utils";

export default function Deck({
  colorClass,
  engine,
  side,
  pitchPct,
  setPitchPct,
  pitchRange,
  setPitchRange,
  // keyLock,
  // setKeyLock,
  onAttachEl,
  onAutoGainComputed,
}) {
  const pitchRafRef = useRef(null);
  const audioRef = useRef(null);
  const timeupdateHandlerRef = useRef(null);
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
      detectBeats({
        url: sourceUrl,
        duration,
        trackName: file?.name || "track",
      });
    }
  }

  // === BPM avanzado + detección de beats ===
  async function detectBeats({ url, duration: trackDuration, trackName }) {
    const detector = beatDetectorRef.current;
    if (!detector || !url) {
      setBeats([]);
      setBpm(null);
      return;
    }

    try {
      const info = await detector.getBeatInfo({
        url,
        name: trackName,
      });

      const resolvedBpm = info?.bpm;
      if (!resolvedBpm) {
        setBpm(null);
        setBeats([]);
        return;
      }

      const normalizedBpm = Math.round(resolvedBpm);
      setBpm(normalizedBpm);

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
      } else {
        setBeats([]);
      }
    } catch (err) {
      console.error("Beat detection failed", err);
      setBeats([]);
      setBpm(null);
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
          setBpm(numeric);
        }
      },
    });

    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }
    };
  }, [isBeatDetectorReady]);

  // listeners básicos del <audio>
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

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
  }, []);

  // conectar el mediaElement al engine
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    onAttachEl(side, el);

    const onTimeUpdate = () => setCurrent(el.currentTime || 0);
    const onEnded = () => setIsPlaying(false);

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("ended", onEnded);

    timeupdateHandlerRef.current = onTimeUpdate;

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("ended", onEnded);
    };
  }, [onAttachEl, side]);

  // limpiar URL de archivo
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(f);
    setObjectUrl(url);
    setFileName(f.name);

    extractWaveform(f, url);

    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    el.load();
    setIsPlaying(false);
    setCurrent(0);
    setDuration(0);
    setScroll(0);
    setFollow(true);
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

  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setCurrent(0);
    setIsPlaying(false);
  };

  const seek = (v) => {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(v);
    el.currentTime = t;
    setCurrent(t);
  };

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
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl relative overflow-hidden">
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${colorClass}`}
      />
      <div className="relative grid gap-4">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{`Deck ${side}`}</h2>
          <span className="text-xs text-neutral-400 truncate max-w-[50%]">
            {getFilenameWithoutExtension()}
          </span>
        </header>
        {/* Archivo */}
        <label className="flex items-center gap-3">
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac"
            onChange={onFile}
            className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-neutral-200 file:text-neutral-900 hover:file:bg-white/90 cursor-pointer"
          />
        </label>
        {/* Content */}
        <div className="flex flex-row gap-1 w-full">
          <div className="flex flex-col gap-1 w-5/6">
            {/* Tiempo + BPM */}
            <div className="flex items-center justify-between">
              <h5
                className="tracking-tight cursor-pointer"
                onClick={() =>
                  setReverseAdvancedTime((prevReverseTime) => !prevReverseTime)
                }
              >
                {reverseAdvancedTime
                  ? `-${calcDuration(duration - current)}`
                  : calcDuration(current)}
              </h5>
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
            <div className="relative w_full pb-7">
              <WaveformCanvas
                waveData={waveData}
                beats={beats}
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
                }}
              />
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
                  className="absolute bottom-1 left-2 right-2 accent-white"
                />
              )}
            </div>
            {/* Transporte */}
            <div className="flex items-center gap-3 flex-wrap">
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
              >
                ■ Stop
              </button>
              {/* <button
                onClick={() => setKeyLock(side, !keyLock)}
                className={`px-3 py-2 rounded-2xl font-semibold border ${
                  keyLock
                    ? "bg-sky-400 text-black border-sky-300"
                    : "bg-neutral-800 text-neutral-200 border-neutral-700"
                }`}
              >
                Key Lock {keyLock ? "ON" : "OFF"}
              </button> */}
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
          </div>
          <div className="flex flex-col gap-1 w-1/6">
            {/* Pitch + Bend */}
            <div className="flex flex-col items-center">
              <span className="text-xs text-neutral-400">
                Pitch: {livePitch.toFixed(2)}%
              </span>
              <span className="text-xs text-neutral-400">
                <span className="ml-2 text-[10px] text-sky-300">
                  bend {bendPct > 0 ? "+" : ""}
                  {bendPct.toFixed(2)}%
                </span>
                {/* {keyLock && " · (Key Lock)"} */}
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
            <div className="flex items-center gap-2">
              <button
                onMouseDown={() => startBend(-1)}
                onMouseUp={releaseBend}
                onMouseLeave={releaseBend}
                onTouchStart={() => startBend(-1)}
                onTouchEnd={releaseBend}
                className="px-3 py-1 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs"
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
                className="px-3 py-1 rounded-xl bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs"
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
