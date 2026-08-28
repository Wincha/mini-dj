/**
 * Playhead suave.
 *
 * El navegador no actualiza `currentTime` en cada frame: lo hace por bloques
 * de audio, y con `playbackRate` distinto de 1 (pitch, bend) el resampling
 * hace que esas actualizaciones lleguen aún más a saltos. Leerlo tal cual
 * para dibujar hace que la onda y el beat match parezcan ir a tirones.
 *
 * Esto mantiene un reloj propio: se reancla con cada actualización real y
 * entre medias avanza por tiempo transcurrido × playbackRate.
 */
export function createSmoothTime() {
  let anchorCt = 0; // último currentTime real visto
  let anchorPerf = 0; // instante (performance.now) en que se vio
  let lastOut = 0;

  const MAX_AHEAD = 0.12; // nunca predecir más de 120 ms por delante
  const SEEK_BACK = 0.05; // un retroceso mayor a esto es un seek real

  return function read(el) {
    if (!el) return 0;
    const ct = el.currentTime || 0;

    if (el.paused) {
      anchorCt = ct;
      anchorPerf = performance.now();
      lastOut = ct;
      return ct;
    }

    const now = performance.now();
    if (ct !== anchorCt) {
      anchorCt = ct;
      anchorPerf = now;
    }

    const rate = el.playbackRate || 1;
    let predicted = anchorCt + ((now - anchorPerf) / 1000) * rate;
    if (predicted > anchorCt + MAX_AHEAD) predicted = anchorCt + MAX_AHEAD;

    // Monótono hacia delante, salvo que haya habido un salto real (seek/loop)
    if (predicted < lastOut - SEEK_BACK) lastOut = predicted;
    else lastOut = Math.max(lastOut, predicted);
    return lastOut;
  };
}
