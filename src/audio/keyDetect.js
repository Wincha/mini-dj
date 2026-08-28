// Detección de tonalidad (key) a partir de un AudioBuffer ya decodificado.
//
// Plan de trabajo, pensado para que no cueste más de lo necesario:
//   1. Mezcla a mono, filtro paso bajo y diezmado ×8 (44.1 kHz → ~5.5 kHz).
//      Todo el material armónico útil vive por debajo de 2 kHz, así que
//      trabajar a 5.5 kHz divide por 8 el coste de la FFT.
//   2. FFT de 2048 muestras (≈371 ms) sin solape, ventana de Hann.
//   3. Chroma: solo los picos espectrales (máximos locales) cuentan, con
//      interpolación parabólica para afinar la frecuencia. Filtrar por picos
//      evita que el ruido de banda ancha emborrone el perfil.
//   4. Correlación de Pearson del chroma con los 24 perfiles tonales
//      rotados. Gana el máximo.

const TARGET_RATE = 5512.5; // 44100 / 8
const FRAME = 2048;
const F_MIN = 110; // A2: por debajo el bombo domina y no aporta tonalidad
const F_MAX = 1800; // por encima el filtro anti-alias ya no es fiable

// Perfiles de Temperley (corpus Kostka-Payne). Elegidos tras comparar cuatro
// juegos (Krumhansl-Kessler, Temperley, Albrecht-Shanahan y Shaath) contra un
// banco de progresiones sintéticas de tonalidad conocida: KK y Shaath fallaban
// el modo en las menores armónicas (confundían Am con A mayor por la sensible),
// Temperley y Albrecht acertaron las 8. Se queda Temperley porque en pistas
// reales da modos más estables.
const MAJOR_PROFILE = [
  0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057,
  0.4,
];
const MINOR_PROFILE = [
  0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133,
  0.33,
];

// === FFT iterativa radix-2 (tablas cacheadas por tamaño) ===
const fftCache = new Map();

function fftTables(n) {
  let tables = fftCache.get(n);
  if (tables) return tables;
  const cos = new Float32Array(n / 2);
  const sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  tables = { cos, sin, rev };
  fftCache.set(n, tables);
  return tables;
}

// FFT in-place sobre (re, im). Devuelve el resultado en los mismos arrays.
function fft(re, im) {
  const n = re.length;
  const { cos, sin, rev } = fftTables(n);

  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const wr = cos[k];
        const wi = sin[k];
        const tre = re[j + half] * wr - im[j + half] * wi;
        const tim = re[j + half] * wi + im[j + half] * wr;
        re[j + half] = re[j] - tre;
        im[j + half] = im[j] - tim;
        re[j] += tre;
        im[j] += tim;
      }
    }
  }
}

// === Preproceso: mono + paso bajo + diezmado ===
// Cuatro polos simples a 2 kHz (24 dB/oct) antes de quedarnos con 1 de cada
// `factor` muestras. Devuelve también la respuesta del filtro para poder
// compensarla después: si no, el chroma quedaría muy escorado hacia los graves.
function decimate(channels, sampleRate, factor) {
  const len = channels[0].length;
  const outLen = Math.floor(len / factor);
  const out = new Float32Array(outLen);

  const cutoff = 2000;
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = dt / (rc + dt);

  const chCount = channels.length;
  const inv = 1 / chCount;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;

  let o = 0;
  for (let i = 0; i < len; i++) {
    let x = 0;
    for (let c = 0; c < chCount; c++) x += channels[c][i];
    x *= inv;

    s0 += alpha * (x - s0);
    s1 += alpha * (s0 - s1);
    s2 += alpha * (s1 - s2);
    s3 += alpha * (s2 - s3);

    if (i % factor === 0 && o < outLen) out[o++] = s3;
  }

  return { data: out, rate: sampleRate / factor, cutoff };
}

/** Detecta la tonalidad a partir de los canales crudos.
 *  @param {Float32Array[]} channels - uno o más canales
 *  @param {number} sampleRate
 *  @returns {{pitchClass:number, mode:"maj"|"min", confidence:number, chroma:number[]}|null} */
export function detectKeyFromChannels(channels, sampleRate) {
  if (!channels?.length || !sampleRate) return null;

  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const { data, rate, cutoff } = decimate(channels, sampleRate, factor);
  if (data.length < FRAME * 2) return null;

  const binHz = rate / FRAME;
  const minBin = Math.max(2, Math.floor(F_MIN / binHz));
  const maxBin = Math.min(FRAME / 2 - 2, Math.ceil(F_MAX / binHz));
  if (maxBin <= minBin) return null;

  // Compensación del paso bajo (4 polos simples) por bin, y ponderación
  // perceptual: la zona 150-1000 Hz es la que mejor define la tonalidad.
  const binGain = new Float32Array(maxBin + 1);
  for (let b = minBin; b <= maxBin; b++) {
    const f = b * binHz;
    const single = 1 / Math.sqrt(1 + (f / cutoff) ** 2);
    const comp = 1 / single ** 4;
    const weight = f < 1000 ? 1 : 1000 / f; // suaviza los agudos
    binGain[b] = comp * weight;
  }

  const window = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  }

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const mag = new Float32Array(FRAME / 2 + 1);
  const chroma = new Float64Array(12);

  const frames = Math.floor(data.length / FRAME);
  for (let f = 0; f < frames; f++) {
    const off = f * FRAME;

    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = data[off + i];
      energy += v * v;
      re[i] = v * window[i];
      im[i] = 0;
    }
    // Saltar silencios: no aportan nada y ensucian la normalización
    if (energy / FRAME < 1e-7) continue;

    fft(re, im);

    for (let b = minBin - 1; b <= maxBin + 1; b++) {
      mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
    }

    for (let b = minBin; b <= maxBin; b++) {
      const m = mag[b];
      // Solo picos espectrales: descarta las faldas y el ruido de fondo
      if (m <= mag[b - 1] || m < mag[b + 1]) continue;

      // Interpolación parabólica en dB para afinar la frecuencia del pico
      const l = Math.log(mag[b - 1] + 1e-12);
      const c = Math.log(m + 1e-12);
      const r = Math.log(mag[b + 1] + 1e-12);
      const denom = l - 2 * c + r;
      const delta = denom !== 0 ? (0.5 * (l - r)) / denom : 0;
      const freq = (b + Math.max(-0.5, Math.min(0.5, delta))) * binHz;
      if (freq < F_MIN || freq > F_MAX) continue;

      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += m * binGain[b];
    }
  }

  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (total <= 0) return null;
  for (let i = 0; i < 12; i++) chroma[i] /= total;

  // Correlación de Pearson contra los 24 perfiles rotados
  let mean = 0;
  for (let i = 0; i < 12; i++) mean += chroma[i];
  mean /= 12;
  let chromaVar = 0;
  for (let i = 0; i < 12; i++) chromaVar += (chroma[i] - mean) ** 2;
  chromaVar = Math.sqrt(chromaVar);
  if (chromaVar <= 0) return null;

  const scored = [];
  for (const [mode, profile] of [
    ["maj", MAJOR_PROFILE],
    ["min", MINOR_PROFILE],
  ]) {
    let pMean = 0;
    for (let i = 0; i < 12; i++) pMean += profile[i];
    pMean /= 12;
    let pVar = 0;
    for (let i = 0; i < 12; i++) pVar += (profile[i] - pMean) ** 2;
    pVar = Math.sqrt(pVar);

    for (let rot = 0; rot < 12; rot++) {
      let cov = 0;
      for (let i = 0; i < 12; i++) {
        cov += (chroma[(i + rot) % 12] - mean) * (profile[i] - pMean);
      }
      scored.push({ pitchClass: rot, mode, score: cov / (chromaVar * pVar) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  // Confianza: cuánto despega el ganador del siguiente candidato
  const confidence = Math.max(0, Math.min(1, (best.score - second.score) * 3));

  return {
    pitchClass: best.pitchClass,
    mode: best.mode,
    confidence,
    chroma: Array.from(chroma),
  };
}

/** Igual que detectKeyFromChannels pero desde un AudioBuffer del navegador. */
export function detectKey(audioBuffer) {
  if (!audioBuffer) return null;
  const channels = [];
  const n = Math.min(2, audioBuffer.numberOfChannels);
  for (let c = 0; c < n; c++) channels.push(audioBuffer.getChannelData(c));
  return detectKeyFromChannels(channels, audioBuffer.sampleRate);
}
