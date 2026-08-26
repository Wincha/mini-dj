import { BeatDetect } from "./utils";

let detector = null;

// Análisis ligero para la lista de canciones: duración + BPM.
// Se ejecuta en segundo plano, de una en una (la cola vive en MiniDJPlayer).
export async function quickAnalyzeTrack(file) {
  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise((resolve, reject) => {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => resolve(a.duration);
      a.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
      a.src = url;
    });

    if (!detector) detector = new BeatDetect({ round: true });
    const info = await detector.getBeatInfo({ url, name: file.name });

    return {
      duration: Number.isFinite(duration) ? duration : null,
      bpm: info?.bpm ? Math.round(info.bpm) : null,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
