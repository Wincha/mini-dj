// Señales sintéticas para los tests de análisis: se generan aquí, en el
// propio test, para no depender de ningún archivo de audio.

// Marcos por segundo de la envolvente de onsets (RENDER_RATE / HOP en
// src/audio/beatGrid.js). Los tests trabajan a esta misma resolución.
export const ENVELOPE_RATE = 11025 / 64 // ≈ 172,27 Hz

// PRNG determinista: los tests tienen que fallar y pasar siempre igual.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Envolvente de onsets de un 4/4 a un BPM conocido, tal y como la devuelve
 * computeOnsetEnvelope: un pico por golpe, acento en el primer tiempo del
 * compás y una cola corta (los ataques reales no caen en un solo marco).
 *
 * @param bpm       tempo de los golpes
 * @param seconds   duración
 * @param offset    posición del primer golpe, en segundos (fase esperada)
 * @param jitterMs  desviación aleatoria por golpe (músicos, no cuantizados)
 * @param noise     nivel del ruido de fondo entre golpes
 */
export function makeOnsetEnvelope({
  bpm,
  seconds = 60,
  offset = 0,
  rate = ENVELOPE_RATE,
  accents = [1, 0.55, 0.75, 0.55],
  jitterMs = 0,
  noise = 0,
  seed = 7,
} = {}) {
  const frames = Math.round(seconds * rate)
  const data = new Float32Array(frames)
  const rnd = mulberry32(seed)

  if (noise > 0) for (let i = 0; i < frames; i++) data[i] = rnd() * noise

  const interval = 60 / bpm
  const beats = Math.floor((seconds - offset) / interval)
  for (let b = 0; b < beats; b++) {
    const jitter = jitterMs ? ((rnd() - 0.5) * 2 * jitterMs) / 1000 : 0
    const at = Math.round((offset + b * interval + jitter) * rate)
    const amp = accents[b % accents.length]
    // Ataque en un marco y cola de dos: el mismo perfil que deja el flujo
    // espectral rectificado sobre un golpe real.
    for (let k = 0; k < 3; k++) {
      const i = at + k
      if (i >= 0 && i < frames) data[i] = Math.max(data[i], amp * [1, 0.5, 0.2][k])
    }
  }

  return { data, rate, duration: seconds }
}

/**
 * AudioBuffer de mentira, con lo justo que leen analyzeTrackLoudness y
 * analyzeWaveform: canales, frecuencia de muestreo y duración.
 */
export function makeAudioBuffer(channels, sampleRate = 44100) {
  const data = channels.map((c) => (c instanceof Float32Array ? c : Float32Array.from(c)))
  return {
    numberOfChannels: data.length,
    sampleRate,
    length: data[0].length,
    duration: data[0].length / sampleRate,
    getChannelData: (i) => data[i],
  }
}

/** Tono senoidal de amplitud fija (para niveles conocidos en dBFS). */
export function sine({ seconds, freq = 440, amp = 1, sampleRate = 44100 }) {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

// === Material tonal para el detector de tonalidad ===

export const NOTE_INDEX = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
}

/** Frecuencia de una nota, con La4 = 440 Hz. */
export function noteFreq(name, octave = 4) {
  const semitones = NOTE_INDEX[name] - 9 + (octave - 4) * 12
  return 440 * Math.pow(2, semitones / 12)
}

/**
 * Acorde con cuatro armónicos por nota y una envolvente de decaimiento: sin
 * armónicos el chroma sale demasiado limpio y el test no se parecería en nada
 * a una pista real. Cada nota es "C" o ["C", 5] para fijar la octava.
 */
export function chord(notes, { seconds = 2, octave = 4, sampleRate = 44100 } = {}) {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (const spec of notes) {
    const [name, oct] = Array.isArray(spec) ? spec : [spec, octave]
    const f = noteFreq(name, oct)
    for (let h = 1; h <= 4; h++) {
      const amp = 0.25 / h
      for (let i = 0; i < n; i++) {
        out[i] += amp * Math.sin((2 * Math.PI * f * h * i) / sampleRate) * Math.exp((-2 * i) / sampleRate)
      }
    }
  }
  return out
}

/** Encadena varios acordes en una sola señal. */
export function progression(chords, opts = {}) {
  const parts = chords.map((c) => chord(c, opts))
  const out = new Float32Array(parts.reduce((acc, p) => acc + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Transporta una progresión escrita con nombres de nota. */
export function transpose(chords, semitones) {
  const names = Object.keys(NOTE_INDEX)
  return chords.map((c) =>
    c.map((spec) => {
      const [name, oct] = Array.isArray(spec) ? spec : [spec, 4]
      const pc = NOTE_INDEX[name] + semitones
      return [names[((pc % 12) + 12) % 12], oct + Math.floor(pc / 12)]
    })
  )
}

// === Energía de graves sintética (para el análisis de estructura) ===

/**
 * Serie de energía de graves como la que devuelve analyzeWaveform en
 * `bandLow`: un golpe con cola en cada beat CON kick, y un bajo sostenido
 * (mucho nivel, ningún ataque) en los tramos sin kick. Es justo el caso que
 * tiene que distinguir la detección.
 *
 * @param bpm      tempo de la rejilla
 * @param seconds  duración
 * @param offset   posición del primer beat, en segundos
 * @param rate     muestras por segundo (analyzeWaveform da ~80)
 * @param hasKick  (índice de beat) => bool
 */
export function makeLowBandEnergy({
  bpm,
  seconds,
  offset = 0,
  rate = 80,
  hasKick = () => true,
  kickLevel = 0.9,
  padLevel = 0.3,
  decaySec = 0.05,
  noise = 0.004,
  seed = 11,
} = {}) {
  const n = Math.round(seconds * rate)
  const interval = 60 / bpm
  const beats = Math.max(0, Math.floor((seconds - offset) / interval))
  const rnd = mulberry32(seed)

  // Nivel de fondo: bajo sostenido donde no hay kick, casi nada donde sí
  const base = new Float32Array(n).fill(0.02)
  for (let b = 0; b < beats; b++) {
    if (hasKick(b)) continue
    const from = Math.round((offset + b * interval) * rate)
    const to = Math.min(n, Math.round((offset + (b + 1) * interval) * rate))
    for (let i = Math.max(0, from); i < to; i++) base[i] = padLevel
  }
  // Suavizado de 0,4 s: el bajo entra y sale con rampa, sin escalón que
  // pudiera parecer un ataque
  const win = Math.max(1, Math.round(0.4 * rate))
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + base[i]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win)
    const b = Math.min(n, i + win + 1)
    out[i] = (prefix[b] - prefix[a]) / (b - a) + rnd() * noise
  }

  // Golpes: ataque en una muestra y cola exponencial
  const tail = Math.round(0.25 * rate)
  for (let b = 0; b < beats; b++) {
    if (!hasKick(b)) continue
    const at = Math.round((offset + b * interval) * rate)
    for (let k = 0; k <= tail; k++) {
      const i = at + k
      if (i >= 0 && i < n) out[i] += kickLevel * Math.exp(-k / (decaySec * rate))
    }
  }
  return out
}
