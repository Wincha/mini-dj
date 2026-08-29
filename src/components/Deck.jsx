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
import {
  CUE_NAME_MAX,
  HOT_CUE_COLORS,
  MAX_SAVED_LOOPS,
} from "../lib/constants";
import {
  emptyHotCues,
  hotCuesToSlots,
  nextLoopId,
  sanitizeLoopRegion,
  sanitizeName,
  sanitizeSavedLoops,
  slotsToHotCues,
} from "../lib/cuePoints";
import {
  AUTO_LOOP_SIZES,
  ROLL_SIZES,
  autoLoop as computeAutoLoop,
  beatsLabel,
  moveLoop,
  nearestBeat,
  resizeLoop,
  rollExitTime,
  rollLoop,
  wrapTime,
} from "../audio/loops";
import { useI18n } from "../i18n/context";
import {
  analyzeTrackLoudness,
  analyzeWaveform,
  computeAutoGainDb,
} from "../audio/utils";
import {
  buildBeatGrid,
  computeOnsetEnvelope,
  detectTempoAsync,
  nudgeAnchor,
  scaleBpm,
  stretchBpm,
  GRID_NUDGE_FINE,
  GRID_NUDGE_COARSE,
  GRID_BPM_FINE,
  GRID_BPM_COARSE,
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
  onCues,
  onLocalLoad,
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

  // Hot cues: ranuras de tamaño fijo, hotCues[i] = null | { t, name }.
  // Se guardan por pista en IndexedDB y se restauran al volver a cargarla.
  const [hotCues, setHotCues] = useState(emptyHotCues);
  // Loops guardados de la pista y cuál está seleccionado en la lista
  const [savedLoops, setSavedLoops] = useState([]);
  const [savedLoopIdx, setSavedLoopIdx] = useState(0);
  // Loop activo
  const [loopIn, setLoopIn] = useState(null);
  const [loopOut, setLoopOut] = useState(null);
  const [loopOn, setLoopOn] = useState(false);
  // Longitud del loop en BEATS cuando se conoce (automáticos, roll, doblar y
  // partir). Con IN/OUT a mano es null y las cuentas van en segundos.
  const [loopBeats, setLoopBeats] = useState(null);
  // Loop roll en curso: { beats }. Mientras dura, el loop activo es el del
  // roll y el que hubiera antes espera en rollRef para volver al soltar.
  const [rolling, setRolling] = useState(null);
  // Editor de nombre abierto: { kind: "cue" | "loop", index, value }
  const [naming, setNaming] = useState(null);

  // Longitud del loop para la UI: en beats cuando cuadra con la rejilla, en
  // segundos cuando el IN/OUT se puso a mano fuera de ella.
  const loopLabel =
    loopIn != null && loopOut != null
      ? loopBeats
        ? `${beatsLabel(loopBeats)} \u266a`
        : `${(loopOut - loopIn).toFixed(2)} s`
      : "\u2014";

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

    // Loudness de TODA la pista, calculado una sola vez al cargarla: nunca se
    // vuelve a mover durante la reproducción
    const { loudDb } = analyzeTrackLoudness(audioBuffer);
    const gainDb = computeAutoGainDb({ loudDb, peak });

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
  // Las operaciones viven en src/audio/beatGrid.js (funciones puras); aquí
  // solo se aplican al estado del deck.
  const nudgeGrid = (deltaSec) => {
    if (!bpm) return;
    applyGrid(bpm, nudgeAnchor(gridAnchor, deltaSec), true);
  };

  const stretchGrid = (deltaBpm) => {
    const next = stretchBpm(bpm, deltaBpm);
    if (next == null) return;
    applyGrid(next, gridAnchor, true);
  };

  const scaleGrid = (factor) => {
    const next = scaleBpm(bpm, factor);
    if (next == null) return;
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
    // Hot cues y loops guardados de ESTA pista. Son del usuario: se restauran
    // tal cual y el análisis no los toca nunca.
    setHotCues(hotCuesToSlots(cached?.hotCues));
    setSavedLoops(sanitizeSavedLoops(cached?.savedLoops));
    setSavedLoopIdx(0);
    // El último loop marcado vuelve donde estaba, pero APAGADO: al cargar una
    // pista nadie espera que empiece a dar vueltas sola.
    const cachedLoop = sanitizeLoopRegion(cached?.activeLoop);
    rollRef.current = null;
    setRolling(null);
    setNaming(null);
    setLoopIn(cachedLoop?.start ?? null);
    setLoopOut(cachedLoop?.end ?? null);
    setLoopBeats(cachedLoop?.beats ?? null);
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
      hotCues: tr.hotCues,
      savedLoops: tr.savedLoops,
      activeLoop: tr.activeLoop,
    });
  }, [externalTrack?.loadToken, externalTrack?.file]);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Este archivo no viene de la lista: se avisa al padre para que suelte el
    // vínculo con la pista que hubiera cargada y no le escriba encima cues,
    // loops ni rejilla de otra canción.
    onLocalLoad?.(side);
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
  const snapToGrid = (time) =>
    quantize ? nearestBeat(beats, time) : time;

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
  // Click fija (si está vacío) o salta; click derecho o Shift+click borra;
  // doble click abre el editor de nombre.
  const triggerHotCue = (i) => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const cue = hotCues[i];
    if (!cue) {
      const next = [...hotCues];
      next[i] = { t: snapToGrid(el.currentTime || 0), name: "" };
      setHotCues(next);
    } else {
      el.currentTime = cue.t;
      setCurrent(cue.t);
    }
  };

  const clearHotCue = (i) => {
    setNaming((n) => (n?.kind === "cue" && n.index === i ? null : n));
    setHotCues((prev) => {
      if (!prev[i]) return prev;
      const next = [...prev];
      next[i] = null;
      return next;
    });
  };

  const renameHotCue = (i, name) => {
    setHotCues((prev) => {
      if (!prev[i]) return prev;
      const next = [...prev];
      next[i] = { ...next[i], name: sanitizeName(name) };
      return next;
    });
  };

  // === Loop ===
  // Punto único por el que pasan TODOS los cambios de región del loop: así la
  // longitud en beats y el motor del salto no se desincronizan nunca.
  const applyLoop = (region, on) => {
    setLoopIn(region?.start ?? null);
    setLoopOut(region?.end ?? null);
    setLoopBeats(region?.beats ?? null);
    setLoopOn(Boolean(region && on));
  };

  const setLoopInNow = () => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    setLoopIn(snapToGrid(el.currentTime || 0));
    setLoopOut(null);
    setLoopBeats(null);
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
    // Longitud en beats solo si cuadra con la rejilla: es lo que permite
    // después doblar y partir sin salirse de ella.
    const beat = bpm > 0 ? 60 / bpm : null;
    const enBeats = beat ? (time - loopIn) / beat : null;
    const cuadra =
      enBeats != null && Math.abs(enBeats - Math.round(enBeats * 32) / 32) < 1e-6;
    setLoopOut(time);
    setLoopBeats(cuadra ? Math.round(enBeats * 32) / 32 : null);
    setLoopOn(true);
  };

  const toggleLoop = () => {
    if (loopIn != null && loopOut != null) setLoopOn((v) => !v);
  };

  // Loop automático de N beats anclado al beat anterior más cercano
  const autoLoop = (nBeats) => {
    const el = audioRef.current;
    if (!el || !objectUrl) return;
    const region = computeAutoLoop({
      bpm,
      beats,
      time: el.currentTime || 0,
      lengthBeats: nBeats,
      duration: gridDuration,
    });
    if (region) applyLoop(region, true);
  };

  // Mueve el loop entero una longitud hacia delante o hacia atrás. Si está
  // sonando dentro, el playhead se mueve con él y conserva su sitio relativo.
  const moveLoopBy = (dir) => {
    if (loopIn == null || loopOut == null) return;
    const next = moveLoop({
      start: loopIn,
      end: loopOut,
      dir,
      duration: gridDuration,
    });
    if (!next) return;
    const el = audioRef.current;
    const cur = el?.currentTime ?? null;
    setLoopIn(next.start);
    setLoopOut(next.end);
    if (el && loopOn && cur != null && cur >= loopIn && cur <= loopOut) {
      const time = next.start + (cur - loopIn);
      el.currentTime = time;
      setCurrent(time);
    }
  };

  // Dobla (2) o parte (0,5) la longitud manteniendo el punto de entrada
  const resizeLoopBy = (factor) => {
    if (loopIn == null || loopOut == null) return;
    const next = resizeLoop({
      start: loopIn,
      end: loopOut,
      factor,
      bpm,
      lengthBeats: loopBeats,
      duration: gridDuration,
    });
    if (!next) return;
    setLoopOut(next.end);
    setLoopBeats(next.beats);
    // Al partir, el playhead puede quedarse fuera del tramo nuevo: se le mete
    // dentro por donde le tocaría, sin esperar a la siguiente vuelta.
    const el = audioRef.current;
    if (el && loopOn && !el.paused) {
      const cur = el.currentTime || 0;
      if (cur >= next.end) {
        const time = wrapTime({ current: cur, start: next.start, end: next.end });
        el.currentTime = time;
        setCurrent(time);
      }
    }
  };

  // === Loop roll ===
  // Loop momentáneo mientras se mantiene pulsado. Al soltar, la reproducción
  // sigue DONDE ESTARÍA si el roll no hubiera ocurrido (rollExitTime), no
  // donde quedó el bucle.
  const rollRef = useRef(null);

  const startRoll = (lengthBeats) => {
    const el = audioRef.current;
    if (!el || !objectUrl || rollRef.current) return;
    const region = rollLoop({
      bpm,
      gridAnchor,
      time: el.currentTime || 0,
      lengthBeats,
      quantize,
      duration: gridDuration,
    });
    if (!region) return;
    rollRef.current = {
      prev: { in: loopIn, out: loopOut, on: loopOn, beats: loopBeats },
      length: region.end - region.start,
    };
    loopRef.current.wraps = 0;
    applyLoop(region, true);
    setRolling({ beats: lengthBeats });
  };

  const endRoll = () => {
    const st = rollRef.current;
    if (!st) return;
    rollRef.current = null;
    // Se apaga el motor a mano ANTES de recolocar el playhead: si no, el
    // temporizador que aún está armado vería la posición de salida como un
    // "pasado del OUT" y devolvería la pista al bucle.
    loopRef.current.on = false;
    const el = audioRef.current;
    if (el) {
      const exit = rollExitTime({
        current: el.currentTime || 0,
        wraps: loopRef.current.wraps,
        loopLength: st.length,
        duration: gridDuration || el.duration || 0,
      });
      el.currentTime = exit;
      setCurrent(exit);
    }
    loopRef.current.wraps = 0;
    setRolling(null);
    applyLoop(
      st.prev.in != null && st.prev.out != null
        ? { start: st.prev.in, end: st.prev.out, beats: st.prev.beats }
        : null,
      st.prev.on
    );
  };

  // === Loops guardados (por pista) ===
  const saveCurrentLoop = () => {
    if (loopIn == null || loopOut == null) return;
    if (savedLoops.length >= MAX_SAVED_LOOPS) return;
    const next = [
      ...savedLoops,
      {
        id: nextLoopId(savedLoops),
        start: loopIn,
        end: loopOut,
        beats: loopBeats,
        // Nombre por defecto: la longitud en beats, que es lo que identifica
        // un loop de un vistazo. Se puede cambiar con ✎.
        name: loopBeats ? beatsLabel(loopBeats) : `L${savedLoops.length + 1}`,
      },
    ];
    setSavedLoops(next);
    setSavedLoopIdx(next.length - 1);
  };

  const recallSavedLoop = (idx = savedLoopIdx) => {
    const loop = savedLoops[idx];
    if (!loop) return;
    applyLoop(loop, true);
    setSavedLoopIdx(idx);
    const el = audioRef.current;
    if (el) {
      el.currentTime = loop.start;
      setCurrent(loop.start);
    }
  };

  // Si ya está sonando ese mismo loop, la tecla lo apaga
  const toggleSavedLoop = () => {
    const loop = savedLoops[savedLoopIdx];
    if (!loop) return;
    if (loopOn && loopIn === loop.start && loopOut === loop.end) {
      setLoopOn(false);
      return;
    }
    recallSavedLoop(savedLoopIdx);
  };

  const deleteSavedLoop = (idx) => {
    setNaming((n) => (n?.kind === "loop" ? null : n));
    setSavedLoops((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setSavedLoopIdx((cur) => Math.max(0, Math.min(cur, next.length - 1)));
      return next;
    });
  };

  const renameSavedLoop = (idx, name) => {
    setSavedLoops((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, name: sanitizeName(name) } : l))
    );
  };

  const selectSavedLoop = (dir) => {
    if (!savedLoops.length) return;
    setSavedLoopIdx(
      (i) => (i + dir + savedLoops.length) % savedLoops.length
    );
  };

  // === Motor del loop ===
  // Comprobar la posición una vez por frame deja 17 ms de margen: en un loop
  // de 1/8 de beat (≈59 ms a 128 BPM) eso es casi un tercio de su longitud y
  // el tropiezo se oye. Aquí se programa un temporizador para el instante del
  // salto y solo en los últimos milisegundos se hila fino a base de ticks
  // cortos. Además el retraso que quede se ARRASTRA al punto de entrada
  // (wrapTime), así el bucle mantiene la fase aunque el aviso llegue tarde.
  const loopRef = useRef({ on: false, start: 0, end: 0, wraps: 0, gen: 0 });
  const loopActive = loopOn && loopIn != null && loopOut != null;
  {
    const st = loopRef.current;
    const start = loopIn ?? 0;
    const end = loopOut ?? 0;
    if (st.start !== start || st.end !== end) {
      st.start = start;
      st.end = end;
      st.wraps = 0;
      st.gen++;
    }
    st.on = loopActive;
  }

  useEffect(() => {
    if (!loopActive) return;
    const el = audioRef.current;
    if (!el) return;
    const FINE_MS = 12; // tramo final que se apura con ticks cortos
    const gen = loopRef.current.gen;
    let timer = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const st = loopRef.current;
      if (st.gen !== gen) return; // manda otra región: este temporizador sobra
      if (!st.on || el.paused) {
        timer = setTimeout(tick, 60); // nada que vigilar por ahora
        return;
      }
      const now = el.currentTime || 0;
      if (now >= st.end) {
        el.currentTime = wrapTime({ current: now, start: st.start, end: st.end });
        st.wraps += 1;
        timer = setTimeout(tick, 0);
        return;
      }
      const rate = el.playbackRate || 1;
      const remainMs = ((st.end - now) / rate) * 1000;
      timer = setTimeout(tick, remainMs > FINE_MS ? remainMs - FINE_MS : 0);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loopActive, loopIn, loopOut]);

  // Los hot cues y los loops suben al padre, que los refleja en la lista y los
  // guarda en IndexedDB. Sin pista cargada no hay nada que guardar.
  const onCuesRef = useRef(onCues);
  onCuesRef.current = onCues;
  useEffect(() => {
    if (!objectUrl) return;
    onCuesRef.current?.(side, {
      hotCues: slotsToHotCues(hotCues),
      savedLoops,
      // El loop del roll es momentáneo: no se guarda como el loop de la pista
      activeLoop:
        !rolling && loopIn != null && loopOut != null
          ? { start: loopIn, end: loopOut, beats: loopBeats }
          : undefined,
    });
  }, [hotCues, savedLoops, loopIn, loopOut, loopBeats, rolling, objectUrl, side]);

  // API imperativa para atajos de teclado (MiniDJPlayer)
  useImperativeHandle(ref, () => ({
    playPause: () => (isPlaying ? pause() : play()),
    cueStop: stop,
    hotCue: triggerHotCue,
    hotCueClear: clearHotCue,
    loopIn: setLoopInNow,
    loopOut: setLoopOutNow,
    loopToggle: toggleLoop,
    loopMove: moveLoopBy,
    loopResize: resizeLoopBy,
    rollStart: startRoll,
    rollEnd: endRoll,
    loopSave: saveCurrentLoop,
    loopSavedToggle: toggleSavedLoop,
    loopSavedSelect: selectSavedLoop,
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
                loopRolling={Boolean(rolling)}
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
              {/* Ocho hot cues en dos filas de cuatro. El hueco está
                  reservado aunque no haya ninguno puesto y cada pad tiene su
                  línea de etiqueta siempre pintada, así que ni ponerles nombre
                  ni cambiar de idioma mueve nada. */}
              <Group label={t("hotCuesLabel")} className="relative">
                <div className="grid grid-cols-4 gap-1">
                  {hotCues.map((cue, i) => (
                    <CuePad
                      key={i}
                      index={i}
                      cue={cue}
                      disabled={!objectUrl}
                      onTrigger={() => triggerHotCue(i)}
                      onClear={() => clearHotCue(i)}
                      onRename={() =>
                        setNaming({
                          kind: "cue",
                          index: i,
                          value: cue?.name || "",
                        })
                      }
                      title={
                        cue
                          ? t("hotCueGoTitle", {
                              n: i + 1,
                              time: calcDuration(cue.t),
                            })
                          : t("hotCueSetTitle", { n: i + 1 })
                      }
                    />
                  ))}
                </div>
                {naming?.kind === "cue" && (
                  <NameEditor
                    label={t("hotCueNameLabel", { n: naming.index + 1 })}
                    value={naming.value}
                    okTitle={t("nameSaveTitle")}
                    cancelTitle={t("nameCancelTitle")}
                    placeholder={t("namePlaceholder")}
                    onChange={(value) => setNaming((n) => ({ ...n, value }))}
                    onCommit={() => {
                      renameHotCue(naming.index, naming.value);
                      setNaming(null);
                    }}
                    onCancel={() => setNaming(null)}
                  />
                )}
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
                <div className="flex flex-col gap-1">
                  {/* Fila 1: marcar el loop a mano y loops automáticos */}
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={setLoopInNow}
                      disabled={!objectUrl}
                      className={`h-7 w-8 shrink-0 rounded-lg border text-[11px] font-semibold disabled:opacity-40 ${
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
                      className={`h-7 w-8 shrink-0 rounded-lg border text-[11px] font-semibold disabled:opacity-40 ${
                        loopOut != null
                          ? "bg-sky-500/30 border-sky-500/50 text-sky-300"
                          : "bg-neutral-800 border-neutral-700 text-neutral-300"
                      }`}
                      title={t("loopOutTitle")}
                    >
                      {t("loopOut")}
                    </button>
                    <button
                      onClick={toggleLoop}
                      disabled={loopIn == null || loopOut == null}
                      className={`w-7 h-7 shrink-0 rounded-lg border font-semibold disabled:opacity-40 ${
                        loopOn
                          ? "bg-emerald-500 border-emerald-400 text-black"
                          : "bg-neutral-800 border-neutral-700 text-neutral-300"
                      }`}
                      title={t("loopToggleTitle")}
                    >
                      ⟳
                    </button>
                    <span className="w-px h-5 bg-neutral-800 mx-0.5" />
                    {AUTO_LOOP_SIZES.map((n) => (
                      <GridBtn
                        key={n}
                        onClick={() => autoLoop(n)}
                        disabled={!objectUrl || !bpm}
                        title={t("loopAutoTitle", { n })}
                      >
                        {n}
                      </GridBtn>
                    ))}
                  </div>
                  {/* Fila 2: mover el loop y doblar/partir su longitud.
                      A la derecha, la longitud actual en beats. */}
                  <div className="flex items-center gap-0.5">
                    <GridBtn
                      onClick={() => moveLoopBy(-1)}
                      disabled={!loopOut}
                      title={t("loopMoveBackTitle")}
                    >
                      «
                    </GridBtn>
                    <GridBtn
                      onClick={() => moveLoopBy(1)}
                      disabled={!loopOut}
                      title={t("loopMoveFwdTitle")}
                    >
                      »
                    </GridBtn>
                    <span className="w-px h-5 bg-neutral-800 mx-0.5" />
                    <GridBtn
                      onClick={() => resizeLoopBy(0.5)}
                      disabled={!loopOut}
                      title={t("loopHalveTitle")}
                    >
                      ÷2
                    </GridBtn>
                    <GridBtn
                      onClick={() => resizeLoopBy(2)}
                      disabled={!loopOut}
                      title={t("loopDoubleTitle")}
                    >
                      ×2
                    </GridBtn>
                    <span
                      className="ml-auto pl-1.5 w-12 shrink-0 text-right text-[10px] text-neutral-400 tabular-nums"
                      title={t("loopLengthTitle")}
                    >
                      {loopLabel}
                    </span>
                  </div>
                </div>
              </Group>
              </div>

              <div className="flex flex-wrap items-stretch gap-2">
              {/* Loop roll: bucle momentáneo mientras se mantiene pulsado. Al
                  soltar, la pista sigue donde estaría sin el roll. */}
              <Group label={t("rollLabel")}>
                {ROLL_SIZES.map((n) => (
                  <button
                    key={n}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      // La captura garantiza recibir el "soltar" aunque el
                      // puntero se salga del pad. Si el navegador no la da,
                      // el roll funciona igual.
                      try {
                        e.currentTarget.setPointerCapture?.(e.pointerId);
                      } catch {
                        // puntero no capturable
                      }
                      startRoll(n);
                    }}
                    onPointerUp={endRoll}
                    onPointerCancel={endRoll}
                    onLostPointerCapture={endRoll}
                    disabled={!objectUrl || !bpm}
                    className={`w-8 h-7 shrink-0 grid place-items-center rounded-lg border text-[10px] font-bold leading-none disabled:opacity-40 ${
                      rolling?.beats === n
                        ? "bg-amber-400 border-amber-300 text-black"
                        : "bg-neutral-800 border-neutral-700 text-neutral-300"
                    }`}
                    title={t("rollSizeTitle", { n: beatsLabel(n) })}
                  >
                    {beatsLabel(n)}
                  </button>
                ))}
              </Group>

              {/* Loops guardados de la pista: se guardan con la pista y siguen
                  ahí al recargar la app. */}
              <Group label={t("savedLoopsLabel")} className="relative">
                <button
                  onClick={saveCurrentLoop}
                  disabled={
                    loopIn == null ||
                    loopOut == null ||
                    savedLoops.length >= MAX_SAVED_LOOPS
                  }
                  className="w-7 h-7 shrink-0 rounded-lg border bg-neutral-800 border-neutral-700 text-neutral-300 font-bold disabled:opacity-40"
                  title={t("savedLoopSaveTitle")}
                >
                  +
                </button>
                <select
                  value={savedLoops.length ? savedLoopIdx : ""}
                  onChange={(e) => setSavedLoopIdx(Number(e.target.value))}
                  disabled={!savedLoops.length}
                  className="h-7 w-20 shrink-0 bg-neutral-800 border border-neutral-700 rounded-lg px-1 disabled:opacity-40"
                  title={t("savedLoopSelectTitle")}
                >
                  {savedLoops.length === 0 ? (
                    <option value="">{t("savedLoopsNone")}</option>
                  ) : (
                    savedLoops.map((l, i) => (
                      <option key={l.id} value={i}>
                        {l.name || `L${i + 1}`}
                      </option>
                    ))
                  )}
                </select>
                <GridBtn
                  onClick={() => recallSavedLoop()}
                  disabled={!savedLoops.length}
                  title={t("savedLoopRecallTitle")}
                >
                  ⟳
                </GridBtn>
                <GridBtn
                  onClick={() =>
                    setNaming({
                      kind: "loop",
                      index: savedLoopIdx,
                      value: savedLoops[savedLoopIdx]?.name || "",
                    })
                  }
                  disabled={!savedLoops.length}
                  title={t("savedLoopRenameTitle")}
                >
                  ✎
                </GridBtn>
                <GridBtn
                  onClick={() => deleteSavedLoop(savedLoopIdx)}
                  disabled={!savedLoops.length}
                  title={t("savedLoopDeleteTitle")}
                >
                  ✕
                </GridBtn>
                {naming?.kind === "loop" && (
                  <NameEditor
                    label={t("savedLoopNameLabel")}
                    value={naming.value}
                    okTitle={t("nameSaveTitle")}
                    cancelTitle={t("nameCancelTitle")}
                    placeholder={t("namePlaceholder")}
                    onChange={(value) => setNaming((n) => ({ ...n, value }))}
                    onCommit={() => {
                      renameSavedLoop(naming.index, naming.value);
                      setNaming(null);
                    }}
                    onCancel={() => setNaming(null)}
                  />
                )}
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
function Group({ label, className = "", children }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/40 px-2 py-1 min-w-0 ${className}`}
    >
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

// Pad de hot cue. Ancho y alto FIJOS, y la línea de la etiqueta se pinta
// siempre (aunque esté vacía): así ponerle nombre a un cue —o cambiar de
// idioma— no mueve nada de sitio.
//
// Click fija o salta · click derecho o Shift+click borra · doble click abre el
// editor de nombre.
function CuePad({ index, cue, disabled, onTrigger, onClear, onRename, title }) {
  const color = HOT_CUE_COLORS[index] || "#ffffff";
  return (
    <button
      onClick={(e) => (e.shiftKey ? onClear() : onTrigger())}
      onDoubleClick={(e) => {
        e.preventDefault();
        if (cue) onRename();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onClear();
      }}
      disabled={disabled}
      title={title}
      className="w-12 h-9 shrink-0 grid content-center overflow-hidden rounded-lg border leading-none disabled:opacity-40"
      style={
        cue
          ? { backgroundColor: color, borderColor: color, color: "#000" }
          : {
              backgroundColor: "rgb(38 38 38)",
              borderColor: "rgb(64 64 64)",
              color: "rgb(163 163 163)",
            }
      }
    >
      <span className="text-[11px] font-bold">{index + 1}</span>
      <span className="px-0.5 text-[8px] truncate opacity-80">
        {cue?.name || "\u00A0"}
      </span>
    </button>
  );
}

// Editor de etiqueta de un cue o de un loop guardado. Va FLOTANDO sobre su
// caja (absolute), así abrirlo no empuja el resto de la interfaz.
// Enter confirma, Esc cancela.
function NameEditor({
  label,
  value,
  placeholder,
  okTitle,
  cancelTitle,
  onChange,
  onCommit,
  onCancel,
}) {
  return (
    <div className="absolute left-0 top-full z-20 mt-1 flex items-center gap-1 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
      <span className="text-[9px] whitespace-nowrap text-neutral-400">
        {label}
      </span>
      <input
        autoFocus
        value={value}
        maxLength={CUE_NAME_MAX}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onCommit();
          else if (e.key === "Escape") onCancel();
        }}
        className="w-24 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 text-[11px]"
      />
      <button
        onClick={onCommit}
        title={okTitle}
        className="w-6 h-6 shrink-0 grid place-items-center rounded border border-emerald-500/60 bg-emerald-500/20 text-[11px] text-emerald-300"
      >
        ✓
      </button>
      <button
        onClick={onCancel}
        title={cancelTitle}
        className="w-6 h-6 shrink-0 grid place-items-center rounded border border-neutral-700 bg-neutral-800 text-[11px] text-neutral-300"
      >
        ✕
      </button>
    </div>
  );
}
