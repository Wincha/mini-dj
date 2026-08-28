// Registro de errores de Mini DJ.
//
// Tres reglas, y las tres tienen motivo:
//
//  1. Los mensajes van SIEMPRE en inglés, nunca traducidos. La interfaz cambia
//     de idioma once veces; el registro no puede, porque entonces el mismo
//     fallo se escribiría de once maneras y no habría forma de buscarlo ni de
//     comparar dos informes.
//  2. Cada fallo tiene un CÓDIGO que dice en qué zona reventó (AUDIO, TRACK,
//     ANALYSIS, LIB, CONFIG, REC, APP). El código y el mensaje viven aquí, en
//     un solo sitio: quien lo lanza solo añade el contexto de ese momento.
//  3. Se guarda. Un error que solo pasa por la consola no existe: cuando el
//     usuario lo cuenta, hace rato que se lo llevó el recargar.
//
// Para leerlos: ⚙ Configuración › Registro.

const STORAGE_KEY = "mini-dj-log";
const MAX_ENTRIES = 200; // suficiente para una sesión larga, nada para el disco
const MAX_STACK = 1200; // recortamos el stack: interesa el principio
const MAX_VALUE = 200; // y cada valor de contexto

// === Catálogo ===
// [código, mensaje en inglés]. El código nombra la zona y la operación
// concreta, así que un `grep AUDIO-SINK` saca todos los fallos de ruteo de
// salida sin tener que acordarse de cómo estaba redactado el mensaje.
export const ERRORS = {
  // Grafo de audio y ruteo de salidas
  AUDIO_SINK_MASTER: ["AUDIO-SINK-MASTER", "Master output device could not be set"],
  AUDIO_SINK_DECK: ["AUDIO-SINK-DECK", "Deck output device could not be set"],
  AUDIO_SINK_CUE: ["AUDIO-SINK-CUE", "Pre-listen output device could not be set"],
  AUDIO_PLAY: ["AUDIO-PLAY", "Deck playback could not start"],

  // Carga de pistas
  TRACK_LOAD: ["TRACK-LOAD", "Track could not be loaded or decoded"],

  // Análisis (BPM, rejilla, tonalidad, etiquetas)
  ANALYSIS_LIST: ["ANALYSIS-LIST", "Background analysis of a list track failed"],
  ANALYSIS_TEMPO_WORKER: ["ANALYSIS-TEMPO-WORKER", "Tempo worker failed, falling back to the main thread"],
  ANALYSIS_BEATS: ["ANALYSIS-BEATS", "Beat detection failed"],
  ANALYSIS_REGRID: ["ANALYSIS-REGRID", "Guided beat-grid reanalysis failed"],
  ANALYSIS_KEY: ["ANALYSIS-KEY", "Musical key detection failed"],
  META_READ: ["META-READ", "Track tags could not be read"],
  META_ARTWORK: ["META-ARTWORK", "Artwork thumbnail could not be built"],

  // Biblioteca persistente (IndexedDB)
  LIB_DB_LOAD: ["LIB-DB-LOAD", "Stored track list could not be read"],
  LIB_DB_SAVE: ["LIB-DB-SAVE", "Track could not be stored"],
  LIB_DB_DELETE: ["LIB-DB-DELETE", "Stored track could not be deleted"],

  // Configuración
  CONFIG_DEVICE_PERMISSION: ["CONFIG-DEVICE-PERMISSION", "Audio permission denied, output devices stay unnamed"],

  // Grabación de la sesión
  REC_START: ["REC-START", "Session recording could not start"],

  // Interfaz
  UI_CLIPBOARD: ["UI-CLIPBOARD", "Log could not be copied to the clipboard"],

  // Cualquier cosa que se escape sin capturar
  APP_UNCAUGHT: ["APP-UNCAUGHT", "Uncaught error"],
  APP_REJECTION: ["APP-REJECTION", "Unhandled promise rejection"],
};

const clip = (v, max) => {
  const s = typeof v === "string" ? v : String(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

// El error tal y como se pueda: unos traen name/message/stack y otros son un
// string pelado o un DOMException
function describeError(err) {
  if (!err) return "";
  if (err instanceof Error || (err && err.name && err.message)) {
    const head = `${err.name}: ${err.message}`;
    return err.stack ? clip(err.stack, MAX_STACK) : head;
  }
  return clip(err, MAX_VALUE);
}

const describeContext = (context) =>
  context
    ? Object.entries(context)
        .map(([k, v]) => `${k}=${clip(v === undefined ? "undefined" : v, MAX_VALUE)}`)
        .join(" ")
    : "";

// Una línea, un fallo: fecha ISO, nivel, código, mensaje, contexto y error.
// El formato es plano a propósito, para poder pasarle un grep.
export function formatEntry(e) {
  return [e.time, e.level, e.code, e.message, e.context, e.error]
    .filter(Boolean)
    .join(" | ");
}

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function push(entry) {
  try {
    const list = read();
    list.push(entry);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(list.slice(-MAX_ENTRIES))
    );
  } catch {
    // Sin almacenamiento o sin cuota: el registro es lo primero que sobra
  }
}

function write(level, definition, err, context) {
  const [code, message] = definition || ERRORS.APP_UNCAUGHT;
  const entry = {
    time: new Date().toISOString(),
    level,
    code,
    message,
    context: describeContext(context),
    error: describeError(err),
  };
  const line = formatEntry(entry);

  // A la consola siempre: en desarrollo es donde se mira
  if (level === "ERROR") console.error(line);
  else console.warn(line);

  push(entry);

  // En escritorio, además al fichero del proceso principal: es el único sitio
  // donde queda algo si la ventana se cierra o el localStorage no está
  try {
    window.miniDJDesktop?.log?.(line);
  } catch {
    // el puente no está o falló: nos quedamos con lo guardado aquí
  }
  return entry;
}

export const logError = (definition, err, context) =>
  write("ERROR", definition, err, context);
export const logWarn = (definition, err, context) =>
  write("WARN", definition, err, context);

export const readLog = () => read();
export const clearLog = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nada que hacer
  }
};
export const formatLog = () => read().map(formatEntry).join("\n");

// Red de seguridad: lo que no capture nadie acaba también en el registro
export function installGlobalErrorHandlers() {
  window.addEventListener("error", (e) => {
    logError(ERRORS.APP_UNCAUGHT, e.error || e.message, {
      source: `${e.filename || "?"}:${e.lineno || 0}`,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    logError(ERRORS.APP_REJECTION, e.reason);
  });
}
