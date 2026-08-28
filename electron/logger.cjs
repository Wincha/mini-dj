// Registro del proceso principal, a fichero.
//
// Existe porque en una app empaquetada de Windows no hay consola: los
// console.log del updater y del ruteo de descargas no se ven en ningún sitio,
// y cuando algo falla en casa del usuario no queda ni rastro. Aquí se escribe
// en el mismo formato de línea que el registro del renderer
// (src/lib/log.js), así que un fichero y el otro se leen igual y se pueden
// juntar sin más:
//
//   2026-08-28T20:31:00.000Z | ERROR | UPDATE-CHECK | Update check failed | ...
//
// Los mensajes van en inglés a propósito, por lo mismo que allí: el registro
// no se traduce, para poder buscarlo.

const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const MAX_BYTES = 512 * 1024; // al pasarse, se archiva y se empieza de cero
const MAX_LINE = 4000;

// Catálogo del proceso principal. El del renderer va en src/lib/log.js.
const CODES = {
  UPDATE_DISABLED: ["UPDATE-DISABLED", "Auto-update is off for this build"],
  UPDATE_START: ["UPDATE-START", "Update check starting"],
  UPDATE_CHECK: ["UPDATE-CHECK", "Update check failed"],
  UPDATE_EVENT: ["UPDATE-EVENT", "Updater reported an error"],
  UPDATE_STATE: ["UPDATE-STATE", "Updater state"],
  DOWNLOAD_DONE: ["DESKTOP-DOWNLOAD", "File download finished"],
  DOWNLOAD_FAILED: ["DESKTOP-DOWNLOAD", "File download did not complete"],
};

let logFile = null;

function filePath() {
  if (logFile) return logFile;
  try {
    logFile = path.join(app.getPath("userData"), "mini-dj.log");
  } catch {
    logFile = null;
  }
  return logFile;
}

function rotate(p) {
  try {
    if (fs.statSync(p).size > MAX_BYTES) fs.renameSync(p, `${p}.1`);
  } catch {
    // no existe todavía, o no se puede rotar: seguimos añadiendo
  }
}

// Escribe una línea ya formateada. Es también por donde entran las del
// renderer, así que se recorta y se limpian los saltos: una entrada, una línea.
function writeLine(line) {
  const p = filePath();
  if (!p) return;
  const clean = String(line).replace(/[\r\n]+/g, " ⏎ ").slice(0, MAX_LINE);
  try {
    rotate(p);
    fs.appendFileSync(p, clean + "\n");
  } catch {
    // Disco lleno o sin permisos: el registro es lo primero que sobra
  }
}

const clip = (v) => String(v === undefined ? "undefined" : v).slice(0, 200);

function describeError(err) {
  if (!err) return "";
  if (err instanceof Error) {
    return err.stack ? String(err.stack).slice(0, 1200) : `${err.name}: ${err.message}`;
  }
  return clip(err);
}

function log(level, definition, err, context) {
  const [code, message] = definition || CODES.UPDATE_STATE;
  const ctx = context
    ? Object.entries(context)
        .map(([k, v]) => `${k}=${clip(v)}`)
        .join(" ")
    : "";
  const line = [new Date().toISOString(), level, code, message, ctx, describeError(err)]
    .filter(Boolean)
    .join(" | ");
  console.log(line); // en desarrollo sí hay consola
  writeLine(line);
}

module.exports = {
  CODES,
  logInfo: (definition, context) => log("INFO", definition, null, context),
  logWarn: (definition, err, context) => log("WARN", definition, err, context),
  logError: (definition, err, context) => log("ERROR", definition, err, context),
  writeLine,
  logFilePath: filePath,
};
