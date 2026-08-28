// === Detección de BPM y rejilla de beats ===
//
// Implementación propia (licencia MIT, como el resto del proyecto), escrita a
// partir de la descripción publicada del método clásico de seguimiento de
// tempo: banco de filtros → envolvente de energía por banda → flujo espectral
// rectificado (onset strength) → autocorrelación para el periodo → fase por
// correlación con un tren de pulsos.
//
// Referencias del algoritmo (solo la descripción, sin reutilizar código):
//   - E. Scheirer, "Tempo and beat analysis of acoustic musical signals" (1998)
//   - D. Ellis, "Beat Tracking by Dynamic Programming" (2007)
//   - G. Percival & G. Tzanetakis, "Streamlined tempo estimation..." (2014)
//
// Reglas de la casa:
//   - TODO trabaja sobre un AudioBuffer YA decodificado. Nunca se vuelve a
//     descargar ni a leer el blob que está reproduciendo el <audio>: hacerlo
//     congela la reproducción.
//   - La envolvente de onsets (unos 200 KB por pista) se puede guardar y
//     reutilizar para el reanálisis guiado sin volver a decodificar nada.

// Frecuencia de muestreo a la que se rebaja el audio para el análisis. El
// remuestreo lo hace el propio Web Audio (nativo, rápido); a 11 kHz sobra
// para seguir golpes y el coste baja x4.
import { ERRORS, logWarn } from "../lib/log";

const RENDER_RATE = 11025;
// Salto entre marcos de la envolvente: 64 muestras → 172,27 Hz (≈5,8 ms),
// resolución de sobra para cuadrar una rejilla.
const HOP = 64;

// Banco de filtros: separar por bandas evita que un bombo constante tape el
// resto (y que unos hi-hats a corcheas se confundan con el pulso).
const BANDS = [
  [0, 100], // bombo
  [100, 200],
  [200, 400],
  [400, 800],
  [800, 1600],
  [1600, 5000], // caja / charles
];

// Rango de búsqueda por defecto. Amplio a propósito: la librería anterior
// plegaba todo a 90-180 BPM, y eso partía por la mitad el hardcore y la
// makina (160-220 BPM reales).
export const DEFAULT_BPM_RANGE = [70, 220];

// Pesos del peine armónico (1, 2, 3 y 4 periodos). El de 4 pesa como el de 1
// a propósito: en 4/4 el pico del compás es el más fiable.
const HARMONICS = [1, 0.9, 0.7, 1];

// Centro y anchura (en octavas) del sesgo suave hacia tempos plausibles. Solo
// desempata entre candidatos parecidos; no fuerza el resultado.
const PRIOR_CENTER_BPM = 140;
const PRIOR_OCTAVES = 1.1;

function getOfflineCtor() {
  if (typeof window === "undefined") return null;
  return window.OfflineAudioContext || window.webkitOfflineAudioContext || null;
}

// === 1. Envolvente de onsets ===
// Devuelve una señal a ~172 Hz donde cada pico es un ataque (golpe) de la
// pista. Es lo único que necesitan los pasos siguientes.
export async function computeOnsetEnvelope(audioBuffer) {
  const Offline = getOfflineCtor();
  if (!Offline || !audioBuffer || !(audioBuffer.duration > 0)) return null;

  const length = Math.max(HOP * 4, Math.ceil(audioBuffer.duration * RENDER_RATE));
  const ctx = new Offline(BANDS.length, length, RENDER_RATE);
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;

  const merger = ctx.createChannelMerger(BANDS.length);
  const nyquist = RENDER_RATE / 2;
  BANDS.forEach(([lo, hi], i) => {
    let node = src;
    if (hi > 0 && hi < nyquist) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = hi;
      lp.Q.value = 0.7;
      node.connect(lp);
      node = lp;
    }
    if (lo > 0) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = lo;
      hp.Q.value = 0.7;
      node.connect(hp);
      node = hp;
    }
    // Cada entrada del merger es mono: el estéreo se mezcla solo.
    node.connect(merger, 0, i);
  });
  merger.connect(ctx.destination);
  src.start(0);

  const rendered = await ctx.startRendering();
  const frames = Math.floor(rendered.length / HOP);
  if (frames < 8) return null;

  const rate = RENDER_RATE / HOP;
  const flux = new Float32Array(frames);

  for (let b = 0; b < BANDS.length; b++) {
    const ch = rendered.getChannelData(b);
    let prev = 0;
    for (let f = 0; f < frames; f++) {
      const start = f * HOP;
      let sum = 0;
      for (let i = start; i < start + HOP; i++) sum += ch[i] * ch[i];
      // Compresión logarítmica: un golpe en un pasaje flojo cuenta igual que
      // uno en el drop, que es justo lo que queremos para cuadrar la rejilla.
      const level = Math.log1p(1000 * Math.sqrt(sum / HOP));
      const d = level - prev;
      if (f > 0 && d > 0) flux[f] += d;
      prev = level;
    }
  }

  // Normalización local: se resta la media móvil de ~1 s y se rectifica. Así
  // un tema que sube de volumen no desplaza la línea base.
  const win = Math.max(3, Math.round(rate * 1.0));
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + flux[i];

  const osf = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - win);
    const b = Math.min(frames, i + win + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    const v = flux[i] - mean;
    osf[i] = v > 0 ? v : 0;
    if (osf[i] > peak) peak = osf[i];
  }
  if (peak > 0) for (let i = 0; i < frames; i++) osf[i] /= peak;

  return { data: osf, rate, duration: audioBuffer.duration };
}

// === 2. Puntuación de una rejilla ===

// Valor de la envolvente en una posición fraccionaria, cogiendo el máximo de
// un entorno de ±1 marco: absorbe el jitter de los ataques sin ensanchar la
// rejilla.
function sampleEnv(osf, pos) {
  const i = Math.round(pos);
  if (i < 1 || i >= osf.length - 1) return 0;
  return Math.max(osf[i - 1], osf[i], osf[i + 1]);
}

// Energía media de la envolvente sobre una rejilla de periodo `period`
// (marcos) y fase `phase`, entre los marcos [from, to). Es la medida de
// "cuánto golpe cae encima de la rejilla", que es lo que se ve al mirar la
// onda con las marcas pintadas.
function gridScore(osf, period, phase, from, to) {
  if (!(period > 1)) return 0;
  const end = Math.min(to, osf.length - 1);
  let p = phase + Math.ceil((from - phase) / period) * period;
  let sum = 0;
  let count = 0;
  for (; p < end; p += period) {
    if (p >= 1) {
      sum += sampleEnv(osf, p);
      count++;
    }
  }
  return count ? sum / count : 0;
}

// Mejor fase para un periodo dado: barrido COMPLETO del ciclo y afinado.
// Cuesta poco (gridScore recorre un punto por beat, no la envolvente entera),
// y es lo único que garantiza no quedarse en un máximo local: con música de
// corcheas constantes hay varias fases razonables y solo una cuadra.
function bestPhase(osf, period, from, to) {
  const COARSE = 64;
  const step = period / COARSE;
  let best = 0;
  let bestScore = -1;
  for (let k = 0; k < COARSE; k++) {
    const ph = k * step;
    const sc = gridScore(osf, period, ph, from, to);
    if (sc > bestScore) {
      bestScore = sc;
      best = ph;
    }
  }
  const base = best;
  const fine = step / 8;
  for (let k = -7; k <= 7; k++) {
    let ph = base + k * fine;
    ph -= Math.floor(ph / period) * period;
    const sc = gridScore(osf, period, ph, from, to);
    if (sc > bestScore) {
      bestScore = sc;
      best = ph;
    }
  }
  return { phase: best, score: bestScore };
}

// Afina el periodo alrededor de un valor de partida maximizando la energía que
// cae sobre la rejilla.
//
// El número de pasos importa más de lo que parece: el error de periodo se
// acumula beat a beat, así que la resolución tiene que ser lo bastante fina
// como para que la deriva a lo largo del tramo analizado no llegue a media
// marca. Por eso la elección de candidatos se hace sobre una VENTANA (unos
// 45 s) y solo el ganador se afina contra la pista entera.
function refinePeriod(osf, period, spread, steps, from, to) {
  let best = { period, ...bestPhase(osf, period, from, to) };
  for (let k = -steps; k <= steps; k++) {
    const p = period + (spread * k) / steps;
    if (p < 2) continue;
    const r = bestPhase(osf, p, from, to);
    if (r.score > best.score) best = { period: p, ...r };
  }
  return best;
}

function autocorrelation(osf, minLag, maxLag) {
  const n = osf.length;
  const acf = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (lag >= n) break;
    let s = 0;
    for (let i = lag; i < n; i++) s += osf[i] * osf[i - lag];
    acf[lag] = s / (n - lag);
  }
  return acf;
}

function tempoPrior(bpm) {
  const oct = Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_OCTAVES;
  return Math.exp(-0.5 * oct * oct);
}

// Tramo más "movido" de la pista, de WINDOW_SECONDS de largo: es donde la
// rejilla se decide con menos ruido (intros y finales suelen no tener pulso).
const WINDOW_SECONDS = 45;

function scoringWindow(envelope) {
  const { data: osf, rate } = envelope;
  const win = Math.round(WINDOW_SECONDS * rate);
  if (osf.length <= win) return [0, osf.length];
  let sum = 0;
  for (let i = 0; i < win; i++) sum += osf[i];
  let best = sum;
  let bestAt = 0;
  for (let i = win; i < osf.length; i++) {
    sum += osf[i] - osf[i - win];
    if (sum > best) {
      best = sum;
      bestAt = i - win + 1;
    }
  }
  return [bestAt, bestAt + win];
}

// === 3. Detección de tempo ===
//
// opts:
//   bpmRange      [min, max] de búsqueda
//   seedBpm       BPM de partida (reanálisis guiado): la búsqueda se limita a
//                 su entorno en vez de empezar de cero
//   seedAnchor    ancla de partida, en segundos
//   bpmTolerance  ±% alrededor de seedBpm (por defecto 6)
export function detectTempo(envelope, opts = {}) {
  if (!envelope?.data?.length) return null;
  const osf = envelope.data;
  const rate = envelope.rate;
  const [winFrom, winTo] = scoringWindow(envelope);
  const seedBpm =
    Number.isFinite(opts.seedBpm) && opts.seedBpm > 0 ? opts.seedBpm : null;

  if (seedBpm) {
    // --- Reanálisis guiado: el mejor encaje CERCA de lo que hay ---
    const tol =
      (Number.isFinite(opts.bpmTolerance) ? opts.bpmTolerance : 6) / 100;
    const period = (60 / seedBpm) * rate;
    const coarse = refinePeriod(osf, period, period * tol, 200, winFrom, winTo);
    const fine = polish(osf, coarse.period);

    let phase = fine.phase;
    if (Number.isFinite(opts.seedAnchor)) {
      // La rejilla se queda en la misma fase que dejó el usuario: de las
      // posiciones equivalentes (φ + k·P) se coge la más cercana a su ancla.
      const seedFrame = opts.seedAnchor * rate;
      const k = Math.round((seedFrame - phase) / fine.period);
      phase += k * fine.period;
    }
    return finish(fine.period, phase, fine.score, rate, osf);
  }

  // --- Detección desde cero ---
  const [minBpm, maxBpm] = opts.bpmRange || DEFAULT_BPM_RANGE;
  const minLag = Math.max(2, Math.floor((60 / maxBpm) * rate));
  const maxLag = Math.min(osf.length >> 2, Math.ceil((60 / minBpm) * rate));
  if (maxLag <= minLag) return null;

  // La autocorrelación llega a 4 periodos: hace falta para el peine armónico.
  const acfMax = Math.min(osf.length >> 1, maxLag * HARMONICS.length);
  const acf = autocorrelation(osf, minLag, acfMax);
  // Los picos de la autocorrelación son MUY estrechos (uno o dos marcos), y el
  // periodo real casi nunca cae en un número entero de marcos: al mirar el
  // cuarto armónico, errar por un marco basta para perder el pico del compás y
  // dar por bueno un múltiplo raro. Por eso se coge el máximo de un entorno
  // proporcional al desfase acumulado (±1 %), que además absorbe la deriva
  // natural del tempo.
  const acfPeak = (lag) => {
    const w = Math.max(1, Math.round(lag * 0.01));
    const lo = Math.max(minLag, Math.floor(lag) - w);
    const hi = Math.min(acfMax, Math.floor(lag) + w + 1);
    let m = 0;
    for (let i = lo; i <= hi; i++) if (acf[i] > m) m = acf[i];
    return m;
  };

  // Peine armónico: puntúa cada periodo candidato sumando la autocorrelación
  // en 1, 2, 3 y 4 periodos. Es lo que distingue el pulso de un múltiplo raro:
  // en un 4/4 hay picos en 1, 2, 3 y 4 beats (el de 4 es el compás, el más
  // fiable), pero no en 1,5 · 4,5 · 6.
  const comb = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let k = 0; k < HARMONICS.length; k++) {
      sum += HARMONICS[k] * acfPeak(lag * (k + 1));
    }
    comb[lag] = sum * tempoPrior((60 * rate) / lag);
  }

  const peaks = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (comb[lag] > comb[lag - 1] && comb[lag] >= comb[lag + 1]) {
      peaks.push({ lag, v: comb[lag] });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  if (!peaks.length) return null;

  const candidates = new Set();
  for (const p of peaks.slice(0, 6)) {
    candidates.add(p.lag);
    // Solo octavas: incluir tresillos daba falsos positivos sistemáticos
    for (const f of [0.5, 2]) {
      const l = Math.round(p.lag * f);
      if (l >= minLag && l <= maxLag) candidates.add(l);
    }
  }

  // El peine decide QUÉ periodo; la energía sobre la rejilla decide la fase
  // y los decimales.
  let best = null;
  for (const lag of candidates) {
    const r = refinePeriod(osf, lag, 0.6, 40, winFrom, winTo);
    const rank = comb[Math.min(maxLag, Math.max(minLag, Math.round(r.period)))];
    if (!best || rank > best.rank) best = { ...r, rank };
  }
  if (!best) return null;

  best = resolveOctave(osf, best, minLag, maxLag, winFrom, winTo);

  const fine = polish(osf, best.period);
  return finish(fine.period, fine.phase, fine.score, rate, osf);
}

// Afinado final contra la pista ENTERA. Dos pasadas: la primera busca el
// periodo con la resolución justa para que la rejilla siga cuadrada al final
// del tema (un 0,1 % de error son varios beats de desfase en 5 minutos), la
// segunda remata los decimales.
function polish(osf, period) {
  const n = osf.length;
  const a = refinePeriod(osf, period, period * 0.01, 200, 0, n);
  return refinePeriod(osf, a.period, period * 0.0006, 120, 0, n);
}

// Desempate de octava. La autocorrelación no distingue un pulso de su mitad ni
// de su doble, así que hay que decidirlo con la energía real por beat.
//
// Regla: se parte del candidato MÁS LENTO de la familia y se dobla el BPM
// mientras la energía media por beat aguante. Si el pulso real es el doble de
// rápido, al doblar caen golpes igual de fuertes en los huecos y la media
// apenas baja; si no lo es, la mitad de las marcas cae en silencio y la media
// se desploma.
const OCTAVE_KEEP = 0.72;

function resolveOctave(osf, best, minLag, maxLag, from, to) {
  let cur = best;
  // Bajar hasta el más lento de la familia que siga siendo una rejilla válida
  for (const f of [4, 2]) {
    const p = best.period * f;
    if (p <= maxLag) {
      const r = refinePeriod(osf, p, 0.6, 40, from, to);
      if (r.score >= best.score * 0.9) {
        cur = r;
        break;
      }
    }
  }
  // Y volver a subir mientras los "huecos" tengan golpes de verdad
  for (let i = 0; i < 3; i++) {
    const half = cur.period / 2;
    if (half < minLag) break;
    const r = refinePeriod(osf, half, 0.4, 40, from, to);
    if (r.score < cur.score * OCTAVE_KEEP) break;
    cur = r;
  }
  return cur;
}

function finish(period, phase, score, rate, osf) {
  const bpm = (60 * rate) / period;
  let anchorFrame = phase;
  anchorFrame -= Math.floor(anchorFrame / period) * period;
  const anchor = anchorFrame / rate;

  // Confianza: cuánta energía cae sobre la rejilla comparada con el nivel
  // medio de la envolvente.
  let mean = 0;
  for (let i = 0; i < osf.length; i++) mean += osf[i];
  mean /= osf.length || 1;
  const confidence = mean > 0 ? Math.min(1, score / (mean * 4)) : 0;

  return { bpm, anchor, beatInterval: 60 / bpm, confidence, score };
}

// === 4. Detección fuera del hilo principal ===
//
// detectTempo son unos cientos de ms de CPU seguidos. En el hilo principal se
// notaban: al cargar una pista la onda se quedaba clavada. Se hace en un
// Worker, y si por lo que sea no hay Worker se calcula aquí mismo.

let worker; // undefined = sin crear · false = no disponible
let workerSeq = 0;
const pendingJobs = new Map();

function failAllJobs(message) {
  for (const [, job] of pendingJobs) job.reject(new Error(message));
  pendingJobs.clear();
}

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./beatGrid.worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e) => {
      const { id, result, error } = e.data || {};
      const job = pendingJobs.get(id);
      if (!job) return;
      pendingJobs.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    };
    worker.onerror = () => {
      // Si el Worker se cae, se descarta y las siguientes llamadas van por el
      // camino síncrono en lugar de quedarse colgadas.
      worker = false;
      failAllJobs("beatGrid worker failed");
    };
  } catch {
    worker = false;
  }
  return worker;
}

// Igual que detectTempo pero sin bloquear la interfaz.
export function detectTempoAsync(envelope, opts = {}) {
  if (!envelope?.data?.length) return Promise.resolve(null);
  const w = getWorker();
  if (!w) return Promise.resolve(detectTempo(envelope, opts));
  return new Promise((resolve, reject) => {
    const id = ++workerSeq;
    pendingJobs.set(id, { resolve, reject });
    // Se COPIA la envolvente (no se transfiere): el deck la conserva para
    // poder reanalizar luego sin volver a decodificar el audio.
    w.postMessage({
      id,
      envelope: {
        data: envelope.data,
        rate: envelope.rate,
        duration: envelope.duration,
      },
      opts,
    });
  }).catch((err) => {
    // Degrada al hilo principal: molesta, pero no rompe nada
    logWarn(ERRORS.ANALYSIS_TEMPO_WORKER, err);
    return detectTempo(envelope, opts);
  });
}

// === 5. API de conveniencia ===

// Análisis completo desde un AudioBuffer ya decodificado.
// Devuelve también la envolvente para poder reanalizar después sin decodificar.
export async function detectBeatGrid(audioBuffer, opts = {}) {
  const envelope = await computeOnsetEnvelope(audioBuffer);
  if (!envelope) return null;
  const result = await detectTempoAsync(envelope, opts);
  return result ? { ...result, envelope } : null;
}

// Construye el array de tiempos de beat que consumen la onda, el quantize,
// los loops automáticos y el beat jump. Punto único: cualquier ajuste manual
// de rejilla pasa por aquí.
export function buildBeatGrid(bpm, anchor, duration) {
  if (!(bpm > 0) || !(duration > 0)) return [];
  const interval = 60 / bpm;
  if (!(interval > 0)) return [];
  const base = Number.isFinite(anchor) ? anchor : 0;
  // Primer beat >= 0 en fase con el ancla
  let start = base - Math.floor(base / interval) * interval;
  const beats = [];
  // Tope de seguridad por si llega un BPM absurdo
  const max = Math.ceil(duration / interval) + 2;
  for (let i = 0; i < max; i++) {
    const time = start + i * interval;
    if (time >= duration) break;
    beats.push(time);
  }
  return beats;
}
