import { BeatDetect } from "./utils";
import { detectKey } from "./keyDetect";

let detector = null;

// Análisis ligero para la lista de canciones: duración + BPM + tonalidad.
// Se ejecuta en segundo plano, de una en una (la cola vive en MiniDJPlayer).
//
// Un ÚNICO decode para las tres cosas: antes se leía la duración con un
// <audio> y BeatDetect volvía a descargar y decodificar el archivo por su
// cuenta. Decodificamos en un OfflineAudioContext (no necesita gesto del
// usuario ni salida de audio) y el mismo AudioBuffer alimenta el BPM y la key.
export async function quickAnalyzeTrack(file) {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const duration = audioBuffer.duration;

  if (!detector) detector = new BeatDetect({ round: true, sampleRate: 44100 });
  const info = await detector.getBeatInfoFromBuffer(audioBuffer, file.name);

  return {
    duration: Number.isFinite(duration) ? duration : null,
    bpm: info?.bpm ? Math.round(info.bpm) : null,
    musicalKey: detectKey(audioBuffer),
  };
}
