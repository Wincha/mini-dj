// Persistencia de la lista de canciones en IndexedDB.
// Los File son clonables estructuralmente, así que se guardan tal cual.

import { ERRORS, logError } from "./log";
import {
  sanitizeHotCues,
  sanitizeLoopRegion,
  sanitizeSavedLoops,
} from "./cuePoints";

const DB_NAME = "mini-dj";
const STORE = "tracks";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadStoredTracks() {
  try {
    const rows = (await withStore("readonly", (s) => s.getAll())) || [];
    // No persistimos flags de fallo de análisis: se reintenta en cada sesión
    return rows.filter((t) => t?.id && t?.file);
  } catch (err) {
    logError(ERRORS.LIB_DB_LOAD, err);
    return [];
  }
}

export async function storeTrack(track) {
  try {
    const {
      id,
      name,
      size,
      file,
      bpm = null,
      // Rejilla de beats: ancla (segundos) y si la ajustó el usuario a mano.
      // Se guardan para no perder el ajuste manual al recargar.
      gridAnchor = null,
      gridManual = false,
      duration = null,
      playedOn = {},
      // Etiquetas ID3 y tonalidad: se guardan para no re-analizar en cada
      // arranque. `artwork` es la MINIATURA (96 px, ~4 KB), nunca la carátula
      // original, que puede pesar 200 KB por pista.
      artist = null,
      title = null,
      album = null,
      artwork = null,
      metaRead = false,
      musicalKey = null,
      analyzed = false,
      // Hot cues y loops: son del USUARIO. Se guardan en forma compacta (solo
      // lo que ha puesto) para que subir el número de cues no obligue a migrar
      // lo ya guardado. Ver src/lib/cuePoints.js.
      hotCues = [],
      savedLoops = [],
      activeLoop = null,
    } = track;
    await withStore("readwrite", (s) =>
      s.put({
        id,
        name,
        size,
        file,
        bpm,
        gridAnchor,
        gridManual,
        duration,
        playedOn,
        artist,
        title,
        album,
        artwork,
        metaRead,
        musicalKey,
        analyzed,
        hotCues: sanitizeHotCues(hotCues),
        savedLoops: sanitizeSavedLoops(savedLoops),
        activeLoop: sanitizeLoopRegion(activeLoop),
      })
    );
  } catch (err) {
    logError(ERRORS.LIB_DB_SAVE, err, { id: track?.id });
  }
}

export async function removeStoredTrack(id) {
  try {
    await withStore("readwrite", (s) => s.delete(id));
  } catch (err) {
    logError(ERRORS.LIB_DB_DELETE, err, { id });
  }
}

/**
 * Aplica a una pista de la lista lo que ha sacado el análisis en segundo plano.
 *
 * Regla: un ajuste MANUAL de rejilla no lo pisa nunca el análisis automático.
 * De una pista con `gridManual` solo se aceptan la duración y la tonalidad; el
 * BPM y el ancla se quedan como los dejó el usuario.
 *
 * Los hot cues y los loops son del usuario SIEMPRE: el análisis no los toca en
 * ningún caso (aquí viajan intactos dentro de `...track`).
 */
export function mergeTrackAnalysis(track, { bpm, gridAnchor, duration, musicalKey } = {}) {
  if (track?.gridManual) {
    return { ...track, duration, musicalKey, analyzed: true };
  }
  return { ...track, bpm, gridAnchor, duration, musicalKey, analyzed: true };
}
