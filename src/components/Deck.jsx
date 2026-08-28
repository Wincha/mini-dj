import {
  memo,
  useEffect,
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
} from "react";
import Fader from "./Fader";
import WaveformCanvas from "./WaveformCanvas";
import { HOT_CUE_COLORS } from "../lib/constants";
import { useI18n } from "../i18n/context";
import { analyzeTrackLoudness, analyzeWaveform } from "../audio/utils";
import {
  buildBeatGrid,
  computeOnsetEnvelope,
  detectTempoAsync,
} from "../audio/beatGrid";
import { detectKey } from "../audio/keyDetect";
import { keyLabel } from "../lib/camelot";
import { readTrackMetadata } from "../audio/metadata";
import { ERRORS, logError, logWarn } from "../lib/log";

// Ejecuta algo cuando el navegador esté ocioso (con tope), devolviendo un
// cancelador. Se usa para el análisis de tonalidad, que es síncrono y no debe
// competir con el pintado inicial de la onda.
function deferIdle(fn) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 250);
  return () => clearTimeout(id);
}

function Deck({
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
  onPlayingChange,
  onTrackMeta,
  wavePalette,
  externalTrack,
  isActive,
  onActivate,
  lockLoadWhilePlaying,
  ref,
}) {
  const { t } = useI18n();
  const pitchRafRef = useRef(null);
  const audioRef = useRef(null);
  const bpmDisplayRef = useRef(null);
  const fileInputRef = useRef(null);

  // === Forma de onda / análisis ===
  const [waveData, setWaveData] = useState(null);
  const [bandIndex, setBandIndex] = useState(null);
  // === Rejilla de beats ===
  // BPM base de la pista (el analizado, o el que haya dejado el usuario a
  // mano). NO incluye el pitch: el pitch va aparte, en el fader.
  const [bpm, setBpm] = useState(null);
  // Ancla: instante (en segundos) donde cae un beat. Toda la rejilla se
  // deriva de (bpm, ancla), así que moverla es mover este valor.
  const [gridAnchor, setGridAnchor] = useState(0);
  // La rejilla la ha tocado el usuario: el análisis automático ya no la pisa
  // y el ajuste se guarda en IndexedDB.
  const [gridManual, setGridManual] = useState(false);
  // Duración según el buffer decodificado: está disponible antes que la del
  // <audio>, y así la rejilla se puede dibujar en cuanto acaba el análisis.
  const [bufferDuration, setBufferDuration] = useState(0);
  // Envolvente de onsets de la pista (~200 KB). Se guarda para poder
  // reanalizar sobre el ajuste manual sin volver a decodificar el audio.
  const envelopeRef = useRef(null);
  // La pista llegó con una rejilla ajustada a mano: no la sobreescribimos
  const cachedGridRef = useRef(false);

  // Etiquetas ID3 y tonalidad de la pista cargada
  const [tags, setTags] = useState(null); // {artist, title, album}
  const [musicalKey, setMusicalKey] = useState(null); // {pitchClass, mode, confidence}
  const keyIdleRef = useRef(null);
  // Datos que ya venían analizados desde la lista: evitan repetir el trabajo
  const cachedKeyRef = useRef(null);
  // Token de carga: descarta los resultados asíncronos de una pista anterior
  // si mientras tanto se ha cargado otra en este deck
  const loadIdRef = useRef(0);
  const onTrackMetaRef = useRef(onTrackMeta);
  onTrackMetaRef.current = onTrackMeta;
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

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

  // Fase de análisis para feedback en UI: null | "wave" | "bpm" | "regrid"
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

  // La rejilla SIEMPRE se deriva de (bpm, ancla, duración). Por eso cualquier
  // ajuste manual se propaga solo a todo lo que la usa: marcas de la onda,
  // quantize, loops automáticos de 4/8, beat jump y el panel de beat match.
  const gridDuration = duration || bufferDuration;
  const beats = useMemo(
    () => buildBeatGrid(bpm, gridAnchor, gridDuration),
    [bpm, gridAnchor, gridDuration]
  );

  const onAnalysisRef = useRef(onAnalysis);
  onAnalysisRef.current = onAnalysis;
  useEffect(() => {
    onAnalysisRef.current?.(side, { beats });
  }, [beats, side]);

  const round2 = (v) => Math.round(v * 100) / 100;

  // Punto ÚNICO de cambio de rejilla: BPM base + ancla. Avisa al padre, que
  // lo usa para el SYNC entre decks y para persistirlo en IndexedDB.
  const applyGrid = (nextBpm, nextAnchor, manual) => {
    const anchor = Number.isFinite(nextAnchor) ? nextAnchor : gridAnchor;
    const isManual = manual === undefined ? gridManual : manual;
    setBpm(nextBpm);
    setGridAnchor(anchor);
    setGridManual(isManual);
    if (typeof onBpmDetected === "function") {
      onBpmDetected(side, nextBpm, { anchor, manual: isManual });
    }
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

  // === Waveform + bandas + loudness (una sola pasada por el buffer) ===
  // `name` solo se usa para el registro: el estado fileName todavía tiene
  // el de la pista anterior cuando esto corre
  async function extractWaveform(arrayBuffer, loadId, name) {
    const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);

    const duration = audioBuffer.duration;
    setBufferDuration(duration);
    const { waveData: norm, bandIndex: bands, peak } =
      analyzeWaveform(audioBuffer);

    setWaveData(norm);
    setBandIndex(bands);
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
    detectBeats({ audioBuffer, loadId });

    // Tonalidad: aprovecha el MISMO AudioBuffer, sin otro fetch ni otro
    // decode. Bloquea el hilo principal unos cientos de ms, así que se deja
    // para un hueco libre y solo si la pista no la traía ya analizada.
    if (!cachedKeyRef.current) {
      keyIdleRef.current = deferIdle(() => {
        try {
          const detected = detectKey(audioBuffer);
          if (detected && loadIdRef.current === loadId) setMusicalKey(detected);
        } catch (err) {
          logWarn(ERRORS.ANALYSIS_KEY, err, { deck: side, track: name });
        }
      });
    }
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

  // === Detección de BPM y rejilla ===
  // Trabaja sobre el AudioBuffer YA decodificado: nada de volver a leer el
  // blob que está reproduciendo el <audio> (eso congelaba la reproducción si
  // se pulsaba Play durante el análisis).
  async function detectBeats({ audioBuffer, loadId }) {
    try {
      // La envolvente se calcula siempre, aunque la rejilla venga ajustada a
      // mano: es lo que necesita después el reanálisis guiado.
      const envelope = await computeOnsetEnvelope(audioBuffer);
      if (loadIdRef.current !== loadId) return;
      envelopeRef.current = envelope;

      if (cachedGridRef.current) return; // rejilla manual guardada: no se toca

      const info = envelope ? await detectTempoAsync(envelope) : null;
      if (loadIdRef.current !== loadId) return;

      if (!info?.bpm) {
        applyGrid(null, 0, false);
        return;
      }
      applyGrid(round2(info.bpm), info.anchor, false);
      // Auto-cue definitivo: primer beat detectado
      applyAutoCue(info.anchor);
    } catch (err) {
      logError(ERRORS.ANALYSIS_BEATS, err, { deck: side });
      if (loadIdRef.current === loadId) applyGrid(null, 0, false);
    } finally {
      if (loadIdRef.current === loadId) setAnalyzing(null);
    }
  }

  // === TAP de rejilla (estilo Traktor) ===
  // Pulsando al ritmo mientras suena: cada tap reancla la rejilla de beats a
  // ese instante, y con 2+ taps se recalcula el BPM. Los taps se guardan en
  // TIEMPO DE PISTA, así el pitch no falsea el cálculo.
  const tapRef = useRef({ taps: [], lastWall: 0 });

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
      }
    }
    if (!interval) return; // sin BPM previo y con un solo tap no hay rejilla
    applyGrid(round2(60 / interval), anchor, true);
  };

  // === Ajuste manual de la rejilla ===
  // Dos ejes independientes: la FASE (dónde empieza) y la SEPARACIÓN entre
  // beats (el BPM base de la pista). Ninguno de los dos toca el pitch.
  const GRID_NUDGE_FINE = 0.001; // 1 ms
  const GRID_NUDGE_COARSE = 0.01; // 10 ms
  const GRID_BPM_FINE = 0.01;
  const GRID_BPM_COARSE = 0.1;
  const GRID_BPM_MIN = 20;
  const GRID_BPM_MAX = 400;

  // Mueve la rejilla entera hacia atrás/adelante sin cambiar el BPM
  const nudgeGrid = (deltaSec) => {
    if (!bpm) return;
    applyGrid(bpm, gridAnchor + deltaSec, true);
  };

  // Estira o encoge la separación entre beats. Pivota sobre el ancla: como
  // buildBeatGrid siempre deja un beat exactamente en el ancla, este se queda
  // donde está y los demás se juntan o se separan a partir de ahí.
  const stretchGrid = (deltaBpm) => {
    if (!bpm) return;
    const next = Math.min(
      GRID_BPM_MAX,
      Math.max(GRID_BPM_MIN, round2(bpm + deltaBpm))
    );
    applyGrid(next, gridAnchor, true);
  };

  // x2 / ÷2: cuando la detección pilla el tempo al doble o a la mitad.
  // El ancla se mantiene, así que la rejilla sigue cuadrada donde ya lo estaba.
  const scaleGrid = (factor) => {
    if (!bpm) return;
    // Sin redondear: si se redondeara a 2 decimales, ÷2 seguido de x2 no
    // devolvería exactamente el BPM de partida
    const next = bpm * factor;
    if (next < GRID_BPM_MIN || next > GRID_BPM_MAX) return;
    applyGrid(next, gridAnchor, true);
  };

  // Reanálisis guiado: busca el mejor encaje ALREDEDOR del BPM y el ancla que
  // ha dejado el usuario, no desde cero. Reutiliza la envolvente de onsets,
  // así que no hay ni fetch ni decode.
  const regridFromManual = async () => {
    const envelope = envelopeRef.current;
    if (!envelope || !bpm || analyzing) return;
    const loadId = loadIdRef.current;
    setAnalyzing("regrid");
    try {
      const info = await detectTempoAsync(envelope, {
        seedBpm: bpm,
        seedAnchor: gridAnchor,
        bpmTolerance: 6,
      });
      // Si mientras tanto se ha cargado otra pista, el resultado no vale
      if (loadIdRef.current !== loadId) return;
      if (info?.bpm) applyGrid(round2(info.bpm), info.anchor, true);
    } catch (err) {
      logError(ERRORS.ANALYSIS_REGRID, err, { deck: side, bpm });
    } finally {
      if (loadIdRef.current === loadId) setAnalyzing(null);
    }
  };

  // conectar el mediaElement al engine + listeners básicos del <audio>
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    onAttachEl(side, el);

    const onTimeUpdate = () => setCurrent(el.currentTime || 0);
    const onLoadedMetadata = () => setDuration(el.duration || 0);
    const onEnded = () => {
      setIsPlaying(false);
      onPlayingChangeRef.current?.(side, false);
    };

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

  useEffect(() => () => keyIdleRef.current?.(), []);

  // La tonalidad de la pista cargada sube al padre (venga del análisis o de
  // la caché de la lista): la usa la lista para marcar compatibilidades
  useEffect(() => {
    onTrackMetaRef.current?.(side, { musicalKey });
  }, [musicalKey, side]);

  // Bloqueo de carga: con la opción puesta, un deck que está sonando no
  // admite otra pista. Se comprueba aquí, el único punto por el que pasan
  // TODAS las vías de carga (botón del deck y lista de canciones).
  const lockLoadRef = useRef(lockLoadWhilePlaying);
  lockLoadRef.current = lockLoadWhilePlaying;
  const loadBlocked = Boolean(lockLoadWhilePlaying && isPlaying);

  const loadTrack = (f, cached) => {
    if (!f) return;
    const playingNow = audioRef.current && !audioRef.current.paused;
    if (lockLoadRef.current && playingNow) return;
    keyIdleRef.current?.();
    keyIdleRef.current = null;
    cachedKeyRef.current = cached?.musicalKey || null;
    const loadId = ++loadIdRef.current;

    // Rejilla guardada por el usuario: se restaura tal cual y el análisis
    // automático no la vuelve a pisar.
    const hasManualGrid = Boolean(
      cached?.gridManual && cached?.bpm > 0 && Number.isFinite(cached?.gridAnchor)
    );
    cachedGridRef.current = hasManualGrid;
    envelopeRef.current = null;
    setBufferDuration(0);

    setFileName(f.name);
    setWaveData(null);
    setBandIndex(null);
    setMusicalKey(cached?.musicalKey || null);
    setTags(
      cached?.artist || cached?.title
        ? { artist: cached.artist, title: cached.title, album: cached.album }
        : null
    );
    applyGrid(hasManualGrid ? cached.bpm : null, hasManualGrid ? cached.gridAnchor : 0, hasManualGrid);
    setCuePoint(0);
    setHotCues([null, null, null]);
    setLoopIn(null);
    setLoopOut(null);
    setLoopOn(false);
    cueManualRef.current = false;
    setAnalyzing("wave");
    if (typeof onAnalysis === "function") {
      onAnalysis(side, { waveData: null, duration: 0 });
    }

    // Etiquetas ID3: no dependen del decode, así que se leen en paralelo y
    // aparecen en cuanto están (normalmente antes que la onda)
    if (!cached?.title && !cached?.artist) {
      readTrackMetadata(f).then((meta) => {
        if (loadIdRef.current !== loadId) return; // ya hay otra pista cargada
        if (meta.artist || meta.title) {
          setTags({ artist: meta.artist, title: meta.title, album: meta.album });
        }
        onTrackMetaRef.current?.(side, meta);
      });
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
      await extractWaveform(arrayBuffer, loadId, f.name);
    })().catch((err) => {
      logError(ERRORS.TRACK_LOAD, err, { deck: side, file: f.name });
      setAnalyzing(null);
    });
  };

  const loadTrackRef = useRef(loadTrack);
  loadTrackRef.current = loadTrack;

  // Carga desde la lista de canciones (crate)
  const externalTrackRef = useRef(externalTrack);
  externalTrackRef.current = externalTrack;
  useEffect(() => {
    const tr = externalTrackRef.current;
    if (!tr?.file) return;
    // Lo que la lista ya tenga analizado se reutiliza tal cual
    loadTrackRef.current(tr.file, {
      musicalKey: tr.musicalKey,
      artist: tr.artist,
      title: tr.title,
      album: tr.album,
      bpm: tr.bpm,
      gridAnchor: tr.gridAnchor,
      gridManual: tr.gridManual,
    });
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
      onPlayingChange?.(side, true);
      if (typeof onPlayed === "function") onPlayed(side);
    } catch (e) {
      logError(ERRORS.AUDIO_PLAY, e, { deck: side, file: fileName });
    }
  };

  const pause = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    setIsPlaying(false);
    onPlayingChange?.(side, false);
  };

  // STOP vuelve al punto CUE (0 si no hay cue)
  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = cuePoint;
    setCurrent(cuePoint);
    setIsPlaying(false);
    onPlayingChange?.(side, false);
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

  // Handlers del canvas con identidad estable: así WaveformCanvas (memo) no
  // se re-renderiza en cada movimiento del fader de pitch
  const waveHandlersRef = useRef({});
  const stableWave = useMemo(
    () => ({
      onSeek: (...a) => waveHandlersRef.current.onSeek?.(...a),
      onDragSeek: (...a) => waveHandlersRef.current.onDragSeek?.(...a),
      onNudge: (...a) => waveHandlersRef.current.onNudge?.(...a),
      onNudgeEnd: (...a) => waveHandlersRef.current.onNudgeEnd?.(...a),
      onWheelZoom: (...a) => waveHandlersRef.current.onWheelZoom?.(...a),
    }),
    []
  );

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

  // Pitch / tempo.
  // Arrastrar el fader genera decenas de cambios por segundo: escribir
  // playbackRate en cada uno (y peor, mantener una rampa por rAF viva)
  // provoca microcortes en el audio. Aquí se agrupa en un solo write por
  // frame y solo se rampa cuando el salto es grande (SYNC, reset...).
  const pitchTargetRef = useRef(1);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const target = 1 + (pitchPct + bendPct) / 100;
    pitchTargetRef.current = target;

    const RAMP_MS = 120;
    const BIG_JUMP = 0.01; // 1% de tempo

    // Salto pequeño (arrastre normal): un único write, agrupado por frame
    if (Math.abs(target - el.playbackRate) < BIG_JUMP) {
      if (pitchRafRef.current) return; // ya hay un write programado
      pitchRafRef.current = requestAnimationFrame(() => {
        pitchRafRef.current = null;
        const elNow = audioRef.current;
        if (!elNow) return;
        const want = pitchTargetRef.current;
        // ignorar cambios inaudibles (< 0.02 %)
        if (Math.abs(want - elNow.playbackRate) > 0.0002) {
          elNow.playbackRate = want;
        }
      });
      return;
    }

    // Salto grande: rampa suave
    if (pitchRafRef.current) cancelAnimationFrame(pitchRafRef.current);
    const startRate = el.playbackRate || 1;
    const start = performance.now();
    const step = (now) => {
      const k0 = Math.min(1, (now - start) / RAMP_MS);
      const k = k0 < 0.5 ? 2 * k0 * k0 : -1 + (4 - 2 * k0) * k0;
      el.playbackRate = startRate + (pitchTargetRef.current - startRate) * k;
      if (k0 < 1) {
        pitchRafRef.current = requestAnimationFrame(step);
      } else {
        pitchRafRef.current = null;
        el.playbackRate = pitchTargetRef.current;
      }
    };
    pitchRafRef.current = requestAnimationFrame(step);
    return () => {
      if (pitchRafRef.current) cancelAnimationFrame(pitchRafRef.current);
      pitchRafRef.current = null;
    };
  }, [pitchPct, bendPct]);

  // El fader emite muchos eventos por frame al arrastrarlo; agrupamos la
  // actualización de estado en uno por frame para no re-renderizar de más
  const pitchPendingRef = useRef(null);
  const pitchCommitRef = useRef(null);
  const onPitchChange = (val) => {
    const v = Math.max(-pitchRange, Math.min(pitchRange, Number(val)));
    pitchPendingRef.current = v;
    if (pitchCommitRef.current) return;
    pitchCommitRef.current = requestAnimationFrame(() => {
      pitchCommitRef.current = null;
      const pending = pitchPendingRef.current;
      if (pending != null) setPitchPct(side, pending);
    });
  };

  useEffect(
    () => () => {
      if (pitchCommitRef.current) cancelAnimationFrame(pitchCommitRef.current);
    },
    []
  );

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

  waveHandlersRef.current = {
    onSeek: (time) => {
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = time;
      setCurrent(time);
      setFollow(false);
      setCueIfPaused(time);
    },
    onDragSeek,
    onNudge,
    onNudgeEnd: releaseBend,
    onWheelZoom: (dir) =>
      setZoom((z) => Math.max(1, Math.min(256, dir > 0 ? z * 2 : z / 2))),
  };

  return (
    <div
      onPointerDown={() => onActivate?.(side)}
      className={`rounded-2xl border bg-neutral-900/70 p-4 sm:p-5 shadow-xl relative overflow-hidden min-w-0 ${
        isActive ? "border-sky-500/60 ring-1 ring-sky-500/40" : "border-neutral-800"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${colorClass}`}
      />
      <div className="relative grid gap-4 min-w-0">
        <header className="flex items-start justify-between gap-3 min-w-0">
          <h2 className="text-lg font-semibold tracking-tight shrink-0 pt-1">
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
          {/* Cargar archivo y nombre de la pista en un solo control.
              Ocupa el hueco que queda a la derecha del título del deck:
              flex-1 + min-w-0 para que el nombre largo se corte con … en
              vez de desbordar la tarjeta. */}
          {/* El title va en el envoltorio: un <button disabled> no dispara
              eventos de ratón y el navegador no le enseña el tooltip */}
          <span
            className="flex flex-1 min-w-0"
            title={loadBlocked ? t("loadLockedTitle", { side }) : t("loadFile")}
          >
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loadBlocked}
            className={`flex w-full min-w-0 items-center gap-2 px-3 py-1.5 rounded-xl border text-left ${
              loadBlocked
                ? "border-neutral-800 bg-neutral-900/60 opacity-60 cursor-not-allowed"
                : "border-neutral-700 bg-neutral-800/70 hover:bg-neutral-700/70"
            }`}
          >
            {/* Título y artista de las etiquetas ID3; si no hay, el nombre
                del archivo como siempre. La segunda línea se pinta aunque
                esté vacía para que el alto no baile al cargar una pista. */}
            <span className="flex-1 min-w-0 grid">
              <span
                className={`truncate text-base font-semibold leading-tight ${
                  objectUrl ? "text-neutral-100" : "text-neutral-500"
                }`}
              >
                {tags?.title || getFilenameWithoutExtension()}
              </span>
              <span className="truncate text-[10px] leading-tight text-neutral-400">
                {tags?.artist || "\u00A0"}
              </span>
            </span>
            <span className="text-base shrink-0">
              {loadBlocked ? "🔒" : "📂"}
            </span>
          </button>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac"
            onChange={onFile}
            className="hidden"
          />
        </header>
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
                  // Distancia hasta el CUE, no su posición absoluta: al
                  // moverte por la pista lo que quieres saber es cuánto te
                  // falta. El signo va en una caja de ancho fijo porque
                  // tabular-nums cuadra las cifras, pero no + y −.
                  <span
                    className="text-[10px] text-orange-400 tabular-nums whitespace-nowrap"
                    title={t("cueTitle", { time: calcDuration(cuePoint) })}
                  >
                    {t("cue")}{" "}
                    <span className="inline-block w-[0.62em] text-center">
                      {/* El signo sale de la cifra YA redondeada: por debajo
                          de un segundo estás en el cue, y un "−00:00" no
                          significa nada */}
                      {current < cuePoint && cuePoint - current >= 1 ? "−" : "+"}
                    </span>
                    {calcDuration(Math.abs(current - cuePoint))}
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
                {/* Tonalidad: se pinta siempre (guion si aún no se sabe) para
                    reservar la línea y no mover el resto de la cabecera */}
                <div
                  className={`text-[10px] whitespace-nowrap ${
                    musicalKey ? "text-violet-300" : "text-neutral-600"
                  }`}
                  title={t("keyTitle")}
                >
                  {musicalKey
                    ? keyLabel(musicalKey.pitchClass, musicalKey.mode)
                    : t("keyNone")}
                </div>
              </div>
            </div>
            {/* Seek global */}
            <Fader
              min={0}
              max={Math.max(1, Math.floor(duration))}
              step={0.01}
              value={Number.isFinite(current) ? current : 0}
              onChange={(e) => seek(e.target.value)}
              disabled={!objectUrl}
              thickness={16}
              railThickness={5}
              accent={side === "A" ? "#22d3ee" : "#e879f9"}
              resetValue={cuePoint}
              title={t("seekTitle")}
              ariaLabel={t("seekTitle")}
            />
            {/* Forma de onda */}
            <div className="relative w-full pb-7">
              <WaveformCanvas
                waveData={waveData}
                bandIndex={bandIndex}
                palette={wavePalette}
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
                onSeek={stableWave.onSeek}
                onDragSeek={stableWave.onDragSeek}
                onNudge={stableWave.onNudge}
                onNudgeEnd={stableWave.onNudgeEnd}
                onWheelZoom={stableWave.onWheelZoom}
              />
              {/* Feedback de análisis */}
              {analyzing === "wave" && (
                <div className="absolute inset-x-0 top-0 h-20 flex items-center justify-center rounded-lg bg-neutral-900/70 pointer-events-none">
                  <span className="text-xs text-neutral-300 animate-pulse">
                    {t("analyzingTrack")}
                  </span>
                </div>
              )}
              {(analyzing === "bpm" || analyzing === "regrid") && (
                <div className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none">
                  <span className="px-2 py-0.5 rounded bg-neutral-900/80 text-[10px] text-neutral-300 animate-pulse">
                    {analyzing === "regrid" ? t("regridding") : t("detectingBpm")}
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
            {/* Herramientas agrupadas en dos filas:
                arriba hot cues + rejilla, abajo jump + loop */}
            <div className="flex flex-col gap-2 text-xs mt-1 pt-3 border-t border-neutral-800/70">
              <div className="flex flex-wrap items-stretch gap-2">
              <Group label={t("hotCuesLabel")}>
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
              </Group>

              <Group label={t("gridLabel")}>
                <div className="flex flex-col gap-1">
                  {/* Fila 1: TAP · quantize · octava · reanálisis guiado.
                      A la derecha, el BPM BASE de la pista: es el que define
                      la rejilla y NO es el pitch (el pitch va en el fader). */}
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={onTapBeat}
                      disabled={!objectUrl}
                      className="h-7 px-2 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 font-semibold active:bg-orange-400 active:text-black disabled:opacity-40"
                      title={t("tapTitle")}
                    >
                      {t("tap")}
                    </button>
                    <button
                      onClick={() => setQuantize((q) => !q)}
                      disabled={!objectUrl}
                      className={`w-7 h-7 rounded-lg border font-bold disabled:opacity-40 ${
                        quantize
                          ? "bg-violet-500/80 border-violet-400 text-black"
                          : "bg-neutral-800 border-neutral-700 text-neutral-400"
                      }`}
                      title={t("quantizeTitle")}
                    >
                      Q
                    </button>
                    <span className="w-px h-5 bg-neutral-800 mx-0.5" />
                    <GridBtn
                      onClick={() => scaleGrid(0.5)}
                      disabled={!bpm}
                      title={t("gridHalveTitle")}
                    >
                      ÷2
                    </GridBtn>
                    <GridBtn
                      onClick={() => scaleGrid(2)}
                      disabled={!bpm}
                      title={t("gridDoubleTitle")}
                    >
                      ×2
                    </GridBtn>
                    <GridBtn
                      onClick={regridFromManual}
                      disabled={!bpm || !!analyzing}
                      title={t("gridRegridTitle")}
                      className={
                        analyzing === "regrid"
                          ? "bg-orange-400 border-orange-300 text-black animate-pulse"
                          : ""
                      }
                    >
                      ⟳
                    </GridBtn>
                    <span
                      className="ml-auto pl-1.5 w-12 shrink-0 text-right text-[10px] text-neutral-400 tabular-nums"
                      title={t("gridBaseBpmTitle")}
                    >
                      {bpm ? `${bpm.toFixed(2)}` : "—"}
                    </span>
                  </div>
                  {/* Fila 2: los dos ejes del ajuste manual.
                      Izquierda: mover la rejilla (fase). Derecha: separar o
                      juntar los beats (BPM base de la pista). */}
                  <div className="flex items-end gap-1.5">
                    <Cluster
                      label={t("gridPhaseLabel")}
                      title={t("gridPhaseTitle")}
                    >
                      <GridBtn
                        onClick={() => nudgeGrid(-GRID_NUDGE_COARSE)}
                        disabled={!bpm}
                        title={t("gridPhaseBackCoarseTitle")}
                      >
                        «
                      </GridBtn>
                      <GridBtn
                        onClick={() => nudgeGrid(-GRID_NUDGE_FINE)}
                        disabled={!bpm}
                        title={t("gridPhaseBackFineTitle")}
                      >
                        ‹
                      </GridBtn>
                      <GridBtn
                        onClick={() => nudgeGrid(GRID_NUDGE_FINE)}
                        disabled={!bpm}
                        title={t("gridPhaseFwdFineTitle")}
                      >
                        ›
                      </GridBtn>
                      <GridBtn
                        onClick={() => nudgeGrid(GRID_NUDGE_COARSE)}
                        disabled={!bpm}
                        title={t("gridPhaseFwdCoarseTitle")}
                      >
                        »
                      </GridBtn>
                    </Cluster>
                    <Cluster
                      label={t("gridTempoLabel")}
                      title={t("gridTempoTitle")}
                    >
                      <GridBtn
                        onClick={() => stretchGrid(-GRID_BPM_COARSE)}
                        disabled={!bpm}
                        title={t("gridTempoDownCoarseTitle")}
                      >
                        <span className="tracking-tighter">−−</span>
                      </GridBtn>
                      <GridBtn
                        onClick={() => stretchGrid(-GRID_BPM_FINE)}
                        disabled={!bpm}
                        title={t("gridTempoDownFineTitle")}
                      >
                        −
                      </GridBtn>
                      <GridBtn
                        onClick={() => stretchGrid(GRID_BPM_FINE)}
                        disabled={!bpm}
                        title={t("gridTempoUpFineTitle")}
                      >
                        +
                      </GridBtn>
                      <GridBtn
                        onClick={() => stretchGrid(GRID_BPM_COARSE)}
                        disabled={!bpm}
                        title={t("gridTempoUpCoarseTitle")}
                      >
                        <span className="tracking-tighter">++</span>
                      </GridBtn>
                    </Cluster>
                  </div>
                </div>
              </Group>
              </div>

              <div className="flex flex-wrap items-stretch gap-2">
              <Group label={t("jump")}>
                <button
                  onClick={() => beatJump(-1)}
                  disabled={!objectUrl || !bpm}
                  className="w-7 h-7 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 font-bold disabled:opacity-40"
                  title={t("jumpBackTitle", { n: jumpBeats })}
                >
                  «
                </button>
                <select
                  value={jumpBeats}
                  onChange={(e) => setJumpBeats(Number(e.target.value))}
                  disabled={!objectUrl || !bpm}
                  className="h-7 bg-neutral-800 border border-neutral-700 rounded-lg px-1 disabled:opacity-40"
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
                  className="w-7 h-7 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 font-bold disabled:opacity-40"
                  title={t("jumpFwdTitle", { n: jumpBeats })}
                >
                  »
                </button>
              </Group>

              <Group label={t("loop")}>
                <button
                  onClick={setLoopInNow}
                  disabled={!objectUrl}
                  className={`h-7 px-2 rounded-lg border disabled:opacity-40 ${
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
                  className={`h-7 px-2 rounded-lg border disabled:opacity-40 ${
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
                  className="w-7 h-7 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 disabled:opacity-40"
                  title={t("loop4Title")}
                >
                  4
                </button>
                <button
                  onClick={() => autoLoop(8)}
                  disabled={!objectUrl || !bpm}
                  className="w-7 h-7 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 disabled:opacity-40"
                  title={t("loop8Title")}
                >
                  8
                </button>
                <button
                  onClick={toggleLoop}
                  disabled={loopIn == null || loopOut == null}
                  className={`w-7 h-7 rounded-lg border font-semibold disabled:opacity-40 ${
                    loopOn
                      ? "bg-emerald-500 border-emerald-400 text-black"
                      : "bg-neutral-800 border-neutral-700 text-neutral-300"
                  }`}
                  title={t("loopToggleTitle")}
                >
                  ⟳
                </button>
              </Group>
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
              <Fader
                orientation="vertical"
                min={-pitchRange}
                max={pitchRange}
                step={0.01}
                value={pitchPct}
                onChange={(e) => onPitchChange(e.target.value)}
                length={150}
                fill="center"
                ticks={9}
                invert={true}
                accent="#7dd3fc"
                resetValue={0}
                title={t("pitchFaderTitle")}
                ariaLabel={t("pitch")}
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

export default memo(Deck);

// Grupo de herramientas del deck: etiqueta pequeña + botones en una caja
function Group({ label, children }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/40 px-2 py-1 min-w-0">
      <Tiny className="text-[9px]">{label}</Tiny>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

// Sub-grupo dentro de una caja: una etiqueta diminuta sobre su fila de botones
function Cluster({ label, title, children }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0" title={title}>
      <Tiny className="text-[8px]">{label}</Tiny>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  );
}

// Etiqueta de caja. El truco de width:0 + minWidth:100% hace que NO cuente
// para el ancho intrínseco: así una traducción larga no ensancha la caja ni
// mueve el resto de la interfaz al cambiar de idioma.
function Tiny({ className = "", children }) {
  return (
    <span
      className={`uppercase tracking-wide text-neutral-500 truncate ${className}`}
      style={{ width: 0, minWidth: "100%" }}
    >
      {children}
    </span>
  );
}

// Botón cuadrado de la caja de rejilla (ancho fijo: nada se mueve al cambiar
// de estado o de idioma)
function GridBtn({ onClick, disabled, title, className = "", children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-6 h-7 shrink-0 grid place-items-center rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 text-[11px] font-bold leading-none disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}
