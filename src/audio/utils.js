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
  const SILENCE_THRESH = 0.01; // súbelo/bájalo si hace falta
  const usable = blockRms.filter((r) => r >= SILENCE_THRESH);

  if (!usable.length) {
    return { rms: 0, db: -Infinity };
  }

  // Ordenar y coger mediana
  usable.sort((a, b) => a - b);
  const mid = Math.floor(usable.length / 2);
  const medianRms =
    usable.length % 2 === 0 ? (usable[mid - 1] + usable[mid]) / 2 : usable[mid];

  const db = 20 * Math.log10(medianRms + 1e-9);

  return { rms: medianRms, db };
}
