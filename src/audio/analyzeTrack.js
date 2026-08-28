import { detectBeatGrid } from "./beatGrid";
import { detectKey } from "./keyDetect";

// Análisis ligero para la lista de canciones: duración + BPM + rejilla + tonalidad.
// Se ejecuta en segundo plano, de una en una (la cola vive en MiniDJPlayer).
//
// Un ÚNICO decode para todo: antes se leía la duración con un <audio> y el
// detector de BPM volvía a descargar y decodificar el archivo por su cuenta.
// Decodificamos en un OfflineAudioContext (no necesita gesto del usuario ni
// salida de audio) y el mismo AudioBuffer alimenta BPM, rejilla y tonalidad.
export async function quickAnalyzeTrack(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const duration = audioBuffer.duration;
  const grid = await detectBeatGrid(audioBuffer);

  return {
    duration: Number.isFinite(duration) ? duration : null,
    // Dos decimales: con el BPM redondeado a entero la rejilla se desalinea
    // visiblemente antes de que acabe la pista.
    bpm: grid?.bpm ? Math.round(grid.bpm * 100) / 100 : null,
    gridAnchor: grid?.bpm ? grid.anchor : null,
    musicalKey: detectKey(audioBuffer),
  };
}
