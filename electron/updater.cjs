// Auto-actualización (electron-updater sobre GitHub Releases).
//
// Cómo funciona: al arrancar, la app pregunta a GitHub por la última release
// PUBLICADA, se descarga el instalador en segundo plano y avisa a la ventana
// cuando está listo. La instalación la decide el usuario (botón "Reiniciar e
// instalar") o se hace sola al cerrar la app.
//
// Dos cosas que conviene tener presentes:
//   - Una release en BORRADOR no existe para el updater: la API pública de
//     GitHub no la devuelve. Hay que publicarla para que llegue a nadie.
//   - El que comprueba actualizaciones es la versión INSTALADA. Una versión
//     anterior a esta nunca se actualizará sola, por mucho que se publiquen
//     releases nuevas.

const { app, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");

const UPDATE_CHANNEL = "minidj:update";
const INSTALL_CHANNEL = "minidj:update-install";

// Margen para que la ventana termine de pintar antes de tocar la red
const FIRST_CHECK_DELAY_MS = 8000;

let started = false;

// Dónde tiene sentido intentarlo:
//   - macOS exige que la app esté FIRMADA; sin firma el updater falla nada más
//     arrancar, así que ni se intenta (ver README, "Desktop limitations").
//   - En Linux solo se actualiza el AppImage. El .deb lo gestiona el gestor de
//     paquetes del sistema y actualizarlo desde dentro pediría privilegios.
function updaterSupported() {
  if (process.platform === "darwin") return "la app de macOS no está firmada";
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    return "en Linux solo se actualiza el AppImage";
  }
  return null;
}

// `getWindow` en vez de la ventana: en macOS la ventana se puede cerrar y
// volver a crear, y el updater vive más que ella.
function initAutoUpdate(getWindow) {
  if (started) return;
  started = true;

  // El instalador se descarga solo; la instalación la decide el usuario
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => console.log(`[update] ${m}`),
    warn: (m) => console.warn(`[update] ${m}`),
    error: (m) => console.error(`[update] ${m}`),
    debug: () => {},
  };

  // Instalar es lo único que la página puede pedir, y solo cuando ya está
  // descargado: el resto del flujo lo lleva el proceso principal.
  ipcMain.handle(INSTALL_CHANNEL, () => {
    // Fuera del handler: quitAndInstall cierra la app y dejaría el IPC colgado
    setImmediate(() => autoUpdater.quitAndInstall());
  });

  if (!app.isPackaged) {
    console.log("[update] desactivado: la app no está empaquetada");
    return;
  }
  const blocked = updaterSupported();
  if (blocked) {
    console.log(`[update] desactivado: ${blocked}`);
    return;
  }

  let version = null;
  const send = (state) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(UPDATE_CHANNEL, { version, ...state });
    }
  };

  autoUpdater.on("update-available", (info) => {
    version = info?.version || null;
    send({ status: "downloading", percent: 0 });
  });
  autoUpdater.on("download-progress", (p) => {
    send({ status: "downloading", percent: Math.round(p?.percent || 0) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    version = info?.version || version;
    send({ status: "ready" });
  });
  autoUpdater.on("update-not-available", () => send({ status: "idle" }));
  autoUpdater.on("error", (err) => {
    // Un fallo aquí no es motivo para molestar al usuario (lo más normal es
    // estar sin red); queda en el log y la app sigue como si nada.
    console.warn(`[update] ${err?.message || err}`);
    send({ status: "idle" });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn(`[update] comprobación fallida: ${err?.message || err}`);
    });
  }, FIRST_CHECK_DELAY_MS);
}

module.exports = { initAutoUpdate, UPDATE_CHANNEL, INSTALL_CHANNEL };
