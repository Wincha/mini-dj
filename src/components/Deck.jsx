import { useEffect, useRef, useState, useMemo } from "react";
import VerticalSlider from "./VerticalSlider";
import HorizontalSlider from "./HorizontalSlider";
import WaveformCanvas from "./WaveformCanvas";
import { analyzeTrackLoudness } from "../audio/utils";

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
}) {
  const pitchRafRef = useRef(null);
  const audioRef = useRef(null);
  const timeupdateHandlerRef = useRef(null);

  // === Forma de onda ===
  const [waveData, setWaveData] = useState(null);
  const [beats, setBeats] = useState([]);

  const [zoom, setZoom] = useState(64);
  const [scroll, setScroll] = useState(0);

  // Seguimiento automático del playback
  const [follow, setFollow] = useState(true);

  async function extractWaveform(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);

    // === 1) Waveform L+R → mono con resolución adaptativa ===
    const ch0 = audioBuffer.getChannelData(0);
    const hasStereo = audioBuffer.numberOfChannels > 1;
    const ch1 = hasStereo ? audioBuffer.getChannelData(1) : null;

    const duration = audioBuffer.duration; // en segundos
    const targetPerSecond = 80; // columnas por segundo visibles
    let samples = Math.floor(duration * targetPerSecond);
    samples = Math.max(4000, Math.min(samples, 40000)); // clamp

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

    // === 2) Loudness medio usando MEDIANA por bloques ===
    const { db: medianDb } = analyzeTrackLoudness(audioBuffer);

    // Queremos un target MÁS ALTO que antes.
    // Si antes usábamos -12 dBFS, por ejemplo pasa a -8 dBFS o -6 dBFS:
    const targetDb = -8; // prueba -8, si lo quieres aún más arriba, -6

    let gainDb = targetDb - medianDb;

    // Limites para no hacer salvajadas
    const MIN_GAIN_DB = -12; // cortar si ya viene muy caliente
    const MAX_GAIN_DB = +9; // permitimos un poco más de boost
    gainDb = Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));

    if (typeof onAutoGainComputed === "function") {
      onAutoGainComputed(side, gainDb);
    }
  }

  async function detectBeats(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);

    const sampleRate = audioBuffer.sampleRate;
    const blockSize = 1024;
    const energy = [];
    for (let i = 0; i < data.length; i += blockSize) {
      let sum = 0;
      for (let j = 0; j < blockSize && i + j < data.length; j++) {
        const v = data[i + j];
        sum += v * v;
      }
      energy.push(sum / blockSize);
    }

    const avg = energy.reduce((a, b) => a + b, 0) / energy.length;
    const threshold = avg * 1.5;
    const beatsArr = [];
    for (let i = 1; i < energy.length - 1; i++) {
      if (
        energy[i] > threshold &&
        energy[i] > energy[i - 1] &&
        energy[i] > energy[i + 1]
      ) {
        const t = (i * blockSize) / sampleRate;
        beatsArr.push(t);
      }
    }
    setBeats(beatsArr);
  }

  const [fileName, setFileName] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [bendPct, setBendPct] = useState(0);
  const bendHoldRef = useRef(false);
  const bendRafRef = useRef(null);

  const livePitch = useMemo(() => pitchPct + bendPct, [pitchPct, bendPct]);

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

    extractWaveform(f);
    detectBeats(f);

    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    el.load();
    setIsPlaying(false);
    setCurrent(0);
    setDuration(0);
    setScroll(0);
    setFollow(true); // al cargar pista nueva, volvemos a seguir
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

  // Pitch / tempo
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
        <header className="flex items-center justify_between">
          <h2 className="text-lg font-semibold tracking-tight">{`Deck ${side}`}</h2>
          <span
            className="text-xs text-neutral-400 truncate max-w-[50%]"
            title={fileName || "Sin archivo"}
          >
            {fileName || "Sin archivo"}
          </span>
        </header>

        {/* Archivo */}
        <label className="flex items-center gap-3">
          <span className="shrink-0 px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-sm">
            Archivo
          </span>
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac"
            onChange={onFile}
            className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-neutral-200 file:text-neutral-900 hover:file:bg-white/90 cursor-pointer"
          />
        </label>

        {/* Tiempos y seek */}
        <div className="flex items-center justify-between text-sm text-neutral-300">
          <span className="text-xs text-neutral-400">
            Pitch: {livePitch.toFixed(2)}%
            {bendPct !== 0 && (
              <span className="ml-2 text-[10px] text-sky-300">
                (base {pitchPct.toFixed(2)}% · bend {bendPct > 0 ? "+" : ""}
                {bendPct.toFixed(2)}%)
              </span>
            )}
            {keyLock && " · (Key Lock)"}
          </span>
        </div>

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
              setFollow(false); // si clicas en la forma, dejas de seguir
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

          {/* Scroll manual (solo útil cuando follow = false) */}
          {zoom > 1 && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={scroll}
              onChange={(e) => {
                setScroll(Number(e.target.value));
                setFollow(false); // si mueves el scroll, dejas de seguir
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

          <button
            onClick={() => setKeyLock(side, !keyLock)}
            className={`px-3 py-2 rounded-2xl font-semibold border ${
              keyLock
                ? "bg-sky-400 text-black border-sky-300"
                : "bg-neutral-800 text-neutral-200 border-neutral-700"
            }`}
          >
            Key Lock {keyLock ? "ON" : "OFF"}
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

        {/* Pitch Slider */}
        <div className="flex items-end gap-6">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs text-neutral-400">Pitch</span>
            <VerticalSlider
              min={-pitchRange}
              max={pitchRange}
              step={0.01}
              value={pitchPct}
              onChange={(e) => onPitchChange(e.target.value)}
              height={180}
              width={28}
              inverted={true}
            />
          </div>
        </div>

        {/* Bend */}
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
            Bend −
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
            Bend +
          </button>
        </div>

        {/* Audio */}
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
