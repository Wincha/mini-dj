import { bandColorIndex } from "../lib/waveColors";

export function analyzeTrackLoudness(audioBuffer) {
  const ch0 = audioBuffer.getChannelData(0);
  const hasStereo = audioBuffer.numberOfChannels > 1;
  const ch1 = hasStereo ? audioBuffer.getChannelData(1) : null;

  const len = ch0.length;

  // Tamaño de bloque para análisis (≈ 50 ms a 44.1 kHz → ~2205)
  const sampleRate = audioBuffer.sampleRate || 44100;
  const blockSize = Math.floor(sampleRate * 0.05); // 50 ms

  const blockRms = [];

  for (let i = 0; i < len; i += blockSize) {
    const end = Math.min(len, i + blockSize);
    let sumSq = 0;
    let count = 0;

    for (let j = i; j < end; j++) {
      const l = ch0[j];
      const r = ch1 ? ch1[j] : l;
      const mono = (l + r) * 0.5;
      sumSq += mono * mono;
      count++;
    }

    if (!count) continue;
    const rms = Math.sqrt(sumSq / count);

    blockRms.push(rms);
  }

  // Filtramos bloques prácticamente silenciosos
  const SILENCE_THRESH = 0.01;
  const usable = blockRms.filter((r) => r >= SILENCE_THRESH);

  if (!usable.length) {
    return { rms: 0, db: -Infinity };
  }

  // Ordenar: mediana (referencia general) y percentil 90 (la parte de la
  // canción "con todo el ritmo", que es lo que se percibe como su nivel)
  usable.sort((a, b) => a - b);
  const mid = Math.floor(usable.length / 2);
  const medianRms =
    usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[mid];

  const p90Idx = Math.min(usable.length - 1, Math.floor(usable.length * 0.9));
  const loudRms = usable[p90Idx];

  const db = 20 * Math.log10(medianRms + 1e-9);
  const loudDb = 20 * Math.log10(loudRms + 1e-9);

  return { rms: medianRms, db, loudRms, loudDb };
}

// === Forma de onda + bandas de frecuencia, en una sola pasada ===
// Devuelve la envolvente normalizada (lo que se dibuja), el índice de color
// por banda de cada muestra y el pico absoluto de la pista (para el techo del
// auto-gain). Antes esto eran dos recorridos completos del buffer; al
// fusionarlos, el coste de los filtros de banda casi se compensa solo.
export function analyzeWaveform(audioBuffer, { withBands = true } = {}) {
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 =
    audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;

  const len = ch0.length;
  const duration = audioBuffer.duration;
  const sampleRate = audioBuffer.sampleRate || 44100;

  const targetPerSecond = 80;
  let samples = Math.floor(duration * targetPerSecond);
  samples = Math.max(4000, Math.min(samples, 40000));

  const blockSize = Math.max(1, Math.floor(len / samples));
  const peaks = new Float32Array(samples);
  const bandIndex = withBands ? new Uint8Array(samples) : null;
  // Energía por banda de cada muestra; se guarda en crudo porque el color no
  // se decide hasta conocer el rango de toda la pista (ver más abajo)
  const rmsLow = withBands ? new Float32Array(samples) : null;
  const rmsMid = withBands ? new Float32Array(samples) : null;
  const rmsHigh = withBands ? new Float32Array(samples) : null;

  // Dos filtros de un polo en cascada por banda (12 dB/oct): suficiente para
  // separar graves/medios/agudos a ojo y cuesta cuatro multiplicaciones por
  // muestra, que es lo que nos podemos permitir aquí.
  const alphaFor = (freq) => {
    const rc = 1 / (2 * Math.PI * freq);
    const dt = 1 / sampleRate;
    return dt / (rc + dt);
  };
  const aLow = alphaFor(200);
  const aMid = alphaFor(2500);
  let lo1 = 0;
  let lo2 = 0;
  let mi1 = 0;
  let mi2 = 0;

  let peak = 0;
  let used = 0;

  for (let i = 0; i < samples; i++) {
    const start = i * blockSize;
    if (start >= len) break;
    const end = i === samples - 1 ? len : Math.min(len, start + blockSize);

    let acc = 0;
    let sumLow = 0;
    let sumMid = 0;
    let sumHigh = 0;
    let count = 0;

    for (let j = start; j < end; j++) {
      const l = ch0[j];
      const r = ch1 ? ch1[j] : l;
      const mono = (l + r) * 0.5;

      const al = Math.abs(l);
      if (al > peak) peak = al;
      if (ch1) {
        const ar = Math.abs(r);
        if (ar > peak) peak = ar;
      }

      acc += Math.abs(mono);
      count++;

      if (withBands) {
        lo1 += aLow * (mono - lo1);
        lo2 += aLow * (lo1 - lo2); // graves
        mi1 += aMid * (mono - mi1);
        mi2 += aMid * (mi1 - mi2); // graves + medios
        const high = mono - mi2;
        const mid = mi2 - lo2;
        sumLow += lo2 * lo2;
        sumMid += mid * mid;
        sumHigh += high * high;
      }
    }

    if (!count) break;
    peaks[i] = acc / count;
    used = i + 1;
    if (withBands) {
      rmsLow[i] = Math.sqrt(sumLow / count);
      rmsMid[i] = Math.sqrt(sumMid / count);
      rmsHigh[i] = Math.sqrt(sumHigh / count);
    }
  }

  // Color por banda: cada banda se normaliza por SU propio percentil 95 antes
  // de repartir el color. Sin esto la mezcla típica de una pista (más o menos
  // 25 % graves / 45 % medios / 30 % agudos) caía siempre en las mismas cuatro
  // entradas de paleta y la onda salía verde plana.
  if (withBands && used) {
    const ref = (arr) => {
      const sorted = Float32Array.prototype.slice.call(arr, 0, used).sort();
      const v = sorted[Math.floor(used * 0.95)];
      return v > 0 ? v : 1;
    };
    const refLow = ref(rmsLow);
    const refMid = ref(rmsMid);
    const refHigh = ref(rmsHigh);
    for (let i = 0; i < used; i++) {
      bandIndex[i] = bandColorIndex(
        rmsLow[i] / refLow,
        rmsMid[i] / refMid,
        rmsHigh[i] / refHigh
      );
    }
  }

  let max = 0;
  for (let i = 0; i < used; i++) if (peaks[i] > max) max = peaks[i];
  if (!max) max = 1;

  const wave = peaks.subarray(0, used);
  for (let i = 0; i < used; i++) wave[i] /= max;

  return {
    waveData: wave,
    bandIndex: bandIndex ? bandIndex.subarray(0, used) : null,
    peak,
    duration,
  };
}
