// Preload mínimo: la app no necesita nada de Node, solo saber que corre en
// escritorio (por ahora únicamente informativo, útil para diagnóstico).
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("miniDJDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
