// Preload mínimo: la app no necesita nada de Node, solo saber que corre en
// escritorio y poder hablar del flujo de actualización.
const { contextBridge, ipcRenderer } = require("electron");

const UPDATE_CHANNEL = "minidj:update";
const INSTALL_CHANNEL = "minidj:update-install";

contextBridge.exposeInMainWorld("miniDJDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // Estado de la actualización. Devuelve la función para desuscribirse.
  // Solo se expone esto: la página no puede provocar comprobaciones ni
  // enterarse de nada más del proceso principal.
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(UPDATE_CHANNEL, listener);
    return () => ipcRenderer.off(UPDATE_CHANNEL, listener);
  },
  // Reiniciar e instalar lo ya descargado
  installUpdate: () => ipcRenderer.invoke(INSTALL_CHANNEL),
});
