// Worker de detección de tempo.
//
// El barrido de periodos y fases son unos cientos de milisegundos de CPU pura.
// En el hilo principal se notaban: la onda se quedaba congelada justo al
// cargar la pista y al pulsar el reanálisis guiado. Aquí no molesta a nadie.
//
// Solo entra la envolvente de onsets (un Float32Array de ~200 KB), nunca el
// audio: el AudioBuffer se queda en el hilo principal y no se vuelve a leer.
import { detectTempo } from "./beatGrid";

self.onmessage = (e) => {
  const { id, envelope, opts } = e.data || {};
  try {
    const result = detectTempo(envelope, opts);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
