/* eslint-disable no-unused-vars */
import { useEffect, useRef, useState, useMemo } from "react";
import VerticalSlider from "./VerticalSlider";
import HorizontalSlider from "./HorizontalSlider";

export default function Deck({
  title,
  colorClass,
  engine,
  side,
  onVolChange,
  vol,
  eq,
  setEq,
  pitchPct,
  setPitchPct,
  pitchRange,
  setPitchRange,
  keyLock,
  setKeyLock,
  onAttachEl,
}) {
  const pitchRafRef = useRef(null);
  const audioRef = useRef(null);
  const rafRef = useRef(null);
  const tickerRunningRef = useRef(false);
  const timeupdateHandlerRef = useRef(null);

  const startTicker = () => {
    if (tickerRunningRef.current) return;
    tickerRunningRef.current = true;

    const loop = () => {
      const el = audioRef.current;
      if (!el) return;
      setCurrent(el.currentTime || 0);
      if (!el.paused && tickerRunningRef.current) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const stopTicker = () => {
    tickerRunningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  const [fileName, setFileName] = useState("");
  const [objectUrl, setObjectUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [bendPct, setBendPct] = useState(0);
  const bendHoldRef = useRef(false);
  const bendRafRef = useRef(null);

  const livePitch = useMemo(() => pitchPct + bendPct, [pitchPct, bendPct]);

  useEffect(() => {
    const onVisibility = () => {
      const el = audioRef.current;
      if (
        document.visibilityState === "visible" &&
        el &&
        !el.paused &&
        isPlaying
      ) {
        startTicker();
      } else {
        stopTicker();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isPlaying]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    onAttachEl(side, el);

    // fallback: si RAF se pausa (cambio de pestaña, throttling), timeupdate nos mantiene vivos
    const onTimeUpdate = () => setCurrent(el.currentTime || 0);
    const onEnded = () => {
      setIsPlaying(false);
      stopTicker();
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("ended", onEnded);

    timeupdateHandlerRef.current = onTimeUpdate;

    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("ended", onEnded);
      stopTicker();
    };
  }, [onAttachEl, side]);

  useEffect(
    () => () => objectUrl && URL.revokeObjectURL(objectUrl),
    [objectUrl]
  );

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(f);
    setObjectUrl(url);
    setFileName(f.name);
    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    el.load();
    setIsPlaying(false);
    setCurrent(0);
    setDuration(0);
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
      startTicker();
    } catch (e) {
      console.error(e);
    }
  };

  const pause = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setIsPlaying(false);
    stopTicker();
  };

  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setCurrent(0);
    setIsPlaying(false);
    stopTicker();
  };

  const seek = (v) => {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(v);
    el.currentTime = t;
    setCurrent(t);
  };

  // === Pitch/Tempo estilo vinilo (centralizado) ===
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // base + bend → playbackRate objetivo
    const target = 1 + (pitchPct + bendPct) / 100;

    // Cancela rampa anterior
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

  const BEND_MAX = 2.0; // ±2% típico CDJ
  const BEND_RELEASE_MS = 120; // suelta rápido al dejar el botón

  function startBend(sign) {
    bendHoldRef.current = true;
    cancelAnimationFrame(bendRafRef.current);
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
      className={`rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5 shadow-xl relative overflow-hidden`}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${colorClass}`}
      />
      <div className="relative grid gap-4">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
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

        {/* Transporte + opciones */}
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

        {/* Columna lateral: Pitch (vertical), Volumen (vertical) + VU mini */}
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

        <div className="flex items-center gap-2">
          {/* Bend – (más lento mientras lo mantienes) */}
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

          {/* Bend + (más rápido mientras lo mantienes) */}
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
