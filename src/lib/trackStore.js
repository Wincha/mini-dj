// Persistencia de la lista de canciones en IndexedDB.
// Los File son clonables estructuralmente, así que se guardan tal cual.

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
    console.error("IndexedDB load failed", err);
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
      duration = null,
      playedOn = {},
    } = track;
    await withStore("readwrite", (s) =>
      s.put({ id, name, size, file, bpm, duration, playedOn })
    );
  } catch (err) {
    console.error("IndexedDB save failed", err);
  }
}

export async function removeStoredTrack(id) {
  try {
    await withStore("readwrite", (s) => s.delete(id));
  } catch (err) {
    console.error("IndexedDB delete failed", err);
  }
}
