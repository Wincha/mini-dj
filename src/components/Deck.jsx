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

  const maxZoom = 64;

  // === Forma de onda ===
  const canvasRef = useRef(null);
  const [waveData, setWaveData] = useState(null);
  const [beats, setBeats] = useState([]);
  const [zoom, setZoom] = useState(maxZoom);
  const [scroll, setScroll] = useState(0); // posición visible [0..1]
  const [follow, setFollow] = useState(true); // sigue la reproducción mientras no toques el scroll
  const userScrollingRef = useRef(false); // para saber si estás moviendo el scroll a mano

  const bufferCanvasRef = useRef(null);
  const [bufferReady, setBufferReady] = useState(false);

  // DPR para nitidez
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  const bufferLenRef = useRef(0);
  function buildWaveBuffer() {
    if (!waveData) return;

    // Cap seguro por navegador (en CSS px). Con DPR=2 => 8192*2 = 16384px
    const MAX_BUF_COLS = 8192;

    const src = waveData;
    const srcLen = src.length;
    const cols = Math.min(srcLen, MAX_BUF_COLS);
    const block = Math.ceil(srcLen / cols);

    // re-muestreo: pico por bloque (máximo absoluto)
    const reduced = new Array(cols);
    for (let i = 0; i < cols; i++) {
      let peak = 0;
      const start = i * block;
      const end = Math.min(srcLen, start + block);
      for (let j = start; j < end; j++) {
        const v = src[j] || 0;
        if (v > peak) peak = v;
      }
      reduced[i] = peak;
    }

    // canvas offscreen escalado por DPR
    const bufW = cols;
    const bufH = 100;
    const off = document.createElement("canvas");
    off.width = Math.max(1, Math.floor(bufW * dpr));
    off.height = Math.floor(bufH * dpr);

    const bctx = off.getContext("2d");
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.scale(dpr, dpr);

    // fondo
    bctx.fillStyle = "#171717";
    bctx.fillRect(0, 0, bufW, bufH);

    // waveform
    bctx.fillStyle = "#22c55e";
    for (let x = 0; x < bufW; x++) {
      const v = reduced[x] || 0;
      const y = (1 - v) * bufH * 0.5;
      const hh = v * bufH;
      bctx.fillRect(x, y, 1, hh);
    }

    bufferCanvasRef.current = off;
    bufferLenRef.current = bufW; // << longitud real del buffer
    setBufferReady(true);
  }

  // extrae la forma de onda y la guarda en waveData (array de amplitudes normalizadas)
  async function extractWaveform(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
    const raw = audioBuffer.getChannelData(0); // canal izquierdo (o mono)
    const samples = 22000; // número de columnas a dibujar
    const blockSize = Math.floor(raw.length / samples);
    const peaks = [];

    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(raw[i * blockSize + j]);
      }
      peaks.push(sum / blockSize);
    }

    // normaliza
    const max = Math.max(...peaks);
    const norm = peaks.map((v) => v / max);
    setWaveData(norm);
    setBufferReady(false);
    bufferCanvasRef.current = null;
  }

  useEffect(() => {
    if (waveData) buildWaveBuffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveData, dpr]);

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

    // detección básica por umbral
    const avg = energy.reduce((a, b) => a + b, 0) / energy.length;
    const threshold = avg * 1.5;
    const beats = [];
    for (let i = 1; i < energy.length - 1; i++) {
      if (
        energy[i] > threshold &&
        energy[i] > energy[i - 1] &&
        energy[i] > energy[i + 1]
      ) {
        const t = (i * blockSize) / sampleRate; // segundos
        beats.push(t);
      }
    }
    return beats;
  }

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

  useEffect(() => {
    let rafId;
    const canvas = canvasRef.current;
    if (!canvas || !waveData) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    // para nitidez en pantallas retina
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));

    if (rect.width === 0 || rect.height === 0) return;

    if (
      canvas.width !== Math.floor(cssW * dpr) ||
      canvas.height !== Math.floor(cssH * dpr)
    ) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      // IMPORTANT: reset antes de escalar para no acumular transform
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }

    const render = () => {
      // fondo
      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, cssW, cssH);

      // longitudes reales del buffer (no de waveData) para que coincida con drawImage
      const total =
        bufferReady && bufferCanvasRef.current
          ? bufferLenRef.current
          : waveData
          ? waveData.length
          : 0;

      const visible = Math.max(1, Math.floor(total / zoom));

      // OJO: 'scroll' está definido en [0..1] pero en tu código representa
      // start sobre (total - visible). Calculamos 'start' en índices y su fracción real:
      const startFloat = scroll * (total - visible); // índice flotante de la columna izquierda
      const startIdx = Math.floor(startFloat);
      const startFrac = startFloat / total; // fracción real [0..1] de la izquierda visible
      const visFrac = visible / total; // fracción real [0..1] del ancho visible

      if (bufferReady && bufferCanvasRef.current) {
        const buf = bufferCanvasRef.current;
        ctx.imageSmoothingEnabled = false;

        // El buffer está escalado por DPR: srcX/srcW en píxeles del buffer
        const srcX = startFloat * dpr; // ¡float! evita “saltitos”
        const srcW = visible * dpr;
        const srcH = buf.height;

        ctx.drawImage(
          buf,
          srcX,
          0,
          srcW,
          srcH, // src (px del buffer)
          0,
          0,
          cssW,
          cssH // dst (CSS px)
        );
      }

      // === LÍNEAS DE BEAT (sobre el drawImage) ===
      if (beats && beats.length && duration > 0) {
        ctx.strokeStyle = "rgba(239,68,68,0.6)";
        ctx.lineWidth = 1;
        const visibleFrac = 1 / zoom;
        ctx.beginPath();
        for (const t of beats) {
          const frac = t / duration;
          if (frac >= scroll && frac <= scroll + visibleFrac) {
            const beatFrac = t / duration;
            if (beatFrac >= startFrac && beatFrac <= startFrac + visFrac) {
              const x = ((beatFrac - startFrac) / visFrac) * cssW;
              ctx.moveTo(x, 0);
              ctx.lineTo(x, cssH);
            }
          }
        }
        ctx.stroke();
      }

      // === CURSOR (modo /3 adelantado al principio, luego fijo en 1/3) ===
      if (duration > 0) {
        const posFrac = current / duration;

        // Centro preferido: 1/3 de la ventana (tu ajuste)
        const centerFrac = visFrac / 3;

        let cursorX;
        if (posFrac <= startFrac + centerFrac + 1e-6) {
          // aún no ha llegado al “centro”: dibuja en su posición real
          cursorX = ((posFrac - startFrac) / visFrac) * cssW;
        } else {
          // a partir de ahí, fijo en 1/3
          cursorX = cssW / 3;
        }
        // clamp por seguridad
        cursorX = Math.max(0, Math.min(cssW, cursorX));

        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(cursorX - 1, 0, 2, cssH);
      }

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [waveData, beats, zoom, scroll, bufferReady, dpr, current, duration]);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    const url = URL.createObjectURL(f);
    setObjectUrl(url);
    setFileName(f.name);
    extractWaveform(f);
    detectBeats(f).then(setBeats);
    const el = audioRef.current;
    if (!el) return;
    el.src = url;
    el.load();
    setIsPlaying(false);
    setCurrent(0);
    setDuration(0);
    setFollow(true);
    setScroll(0);
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

  useEffect(() => {
    if (!waveData || !duration) return;
    if (!follow || userScrollingRef.current) return;

    const visibleFrac = 1 / zoom;
    const posFrac = duration > 0 ? current / duration : 0;

    // 1) Al principio: no centres, mantén scroll=0 hasta que el cursor alcance el centro de la ventana
    if (posFrac <= visibleFrac / 3 + 1e-6) {
      if (scroll !== 0) setScroll(0);
      return;
    }

    // 2) A partir de la mitad visible: sigue centrando con easing suave
    const targetScroll = Math.max(
      0,
      Math.min(1 - visibleFrac, posFrac - visibleFrac / 3)
    );
    const smooth = 0.05;
    const newScroll = scroll + (targetScroll - scroll) * smooth;
    setScroll(newScroll);
  }, [current, follow, zoom, scroll, waveData, duration]);

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

  useEffect(() => {
    setZoom(maxZoom); // más detalle al iniciar
  }, []);

  useEffect(() => {
    if (!waveData || !duration) return;
    if (!follow) return;

    const visibleFrac = 1 / zoom;
    const posFrac = duration > 0 ? current / duration : 0;

    if (posFrac <= visibleFrac / 2 + 1e-6) {
      setScroll(0);
    } else {
      const snap = Math.max(
        0,
        Math.min(1 - visibleFrac, posFrac - visibleFrac / 2)
      );
      setScroll(snap);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

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

  const onCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frac = x / rect.width;

    const visibleFrac = 1 / zoom;
    const pos = scroll + frac * visibleFrac; // posición absoluta 0..1
    const target = Math.max(0, Math.min(1, pos));

    // seek
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = duration * target;
    setCurrent(el.currentTime);

    // si el target queda fuera de la zona visible, centramos en seco;
    // si queda dentro, no tocamos el scroll
    if (target < scroll || target > scroll + visibleFrac) {
      const newScroll = Math.max(
        0,
        Math.min(1 - visibleFrac, target - visibleFrac / 2)
      );
      setScroll(newScroll);
    }

    // tras un click, desactiva follow hasta que el usuario lo reactive
    setFollow(false);
  };

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
        {/* Forma de onda */}
        <div className="relative w-full pb-7">
          <canvas
            ref={canvasRef}
            width={1200}
            height={80}
            onClick={onCanvasClick}
            className="w-full h-20 bg-neutral-800 rounded-lg cursor-pointer"
          />
          <div className="absolute right-2 top-1 flex gap-2 text-xs text-neutral-400">
            <div className="absolute right-2 top-1 flex gap-2 text-xs text-neutral-400">
              <button
                onClick={() => setZoom((z) => Math.min(z * 2, maxZoom))}
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
          </div>
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
          {zoom > 1 && (
            <input
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={scroll}
              onChange={(e) => {
                const val = Number(e.target.value);
                userScrollingRef.current = true;
                setScroll(val);
                setFollow(false); // desactiva seguimiento si tocaste
              }}
              onMouseUp={() => (userScrollingRef.current = false)}
              onTouchEnd={() => (userScrollingRef.current = false)}
              className="absolute bottom-1 left-2 right-2 accent-white"
            />
          )}
        </div>
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
