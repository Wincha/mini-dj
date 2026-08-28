// Proceso principal de Electron.
// Estrategia: en desarrollo se carga el dev server de Vite; en producción se
// sirve dist/ mediante un esquema propio `app://` registrado como estándar y
// seguro. No se usa file:// a propósito: Chromium trata file:// como un origen
// opaco, y la app necesita un origen estable y "secure context" para que
// IndexedDB/localStorage persistan entre arranques y para que funcionen
// getUserMedia y setSinkId.

const {
  app,
  BrowserWindow,
  Menu,
  session,
  protocol,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { initAutoUpdate } = require("./updater.cjs");

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "";
// Sin empaquetar y sin dev server (npm run desktop:preview) se sirve dist/
// por app://, igual que en producción
const useDevServer = isDev && !!DEV_SERVER_URL;
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://mini-dj`;
const DIST_DIR = path.join(__dirname, "..", "dist");

// --- CSP -------------------------------------------------------------------
// blob: es imprescindible: las pistas se cargan con createObjectURL y la
// grabación produce un blob. 'unsafe-inline' en style-src es necesario porque
// React aplica estilos por atributo `style` (faders, waveform, medidores).
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

// Permisos concedidos a la app. `media`/`audioCapture` no son para grabar el
// micro: sin ellos enumerateDevices() devuelve la lista sin nombres y el
// selector de salidas del diálogo de configuración sale vacío.
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "audioCapture",
  "speaker-selection",
  "clipboard-sanitized-write",
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);

// --- Servidor del bundle ---------------------------------------------------
function registerAppProtocol(ses) {
  ses.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const target = path.resolve(DIST_DIR, relative || "index.html");

    // Nada fuera de dist/
    if (target !== DIST_DIR && !target.startsWith(DIST_DIR + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const body = await fs.readFile(target);
      const type = MIME_TYPES[path.extname(target).toLowerCase()];
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": type || "application/octet-stream",
          "Content-Security-Policy": PROD_CSP,
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

// --- Sesión ----------------------------------------------------------------
function configureSession(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission)
  );

  // Descargas (grabación .webm, CSV del tracklist): diálogo nativo de guardado.
  // Al no llamar a setSavePath, Electron muestra el diálogo con estas opciones.
  ses.on("will-download", (_event, item) => {
    const name = item.getFilename();
    const ext = path.extname(name).replace(".", "").toLowerCase();
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath("downloads"), name),
      filters: ext
        ? [
            { name: ext.toUpperCase(), extensions: [ext] },
            { name: "Todos los archivos", extensions: ["*"] },
          ]
        : undefined,
    });
    item.once("done", (_e, state) => {
      // Si el usuario cancela no hay nada que hacer, pero una interrupción sí
      // conviene dejarla en el log: una grabación perdida es un fallo serio
      const line = `[download] ${name} -> ${state}`;
      if (state === "completed") console.log(`${line} (${item.getSavePath()})`);
      else console.warn(line);
    });
  });

  registerAppProtocol(ses);
}

// --- Ventana ---------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    show: false,
    title: "Mini DJ",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Sin esto Chromium ralentiza timers y rAF al perder el foco: la
      // forma de onda se congelaría y el análisis en segundo plano se pararía
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Enlaces externos al navegador del sistema; nada abre ventanas nuevas
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
    return { action: "deny" };
  });

  // La app es de una sola página: no debe navegar fuera de su propio origen
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = useDevServer ? DEV_SERVER_URL : APP_ORIGIN;
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  if (useDevServer) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Mismo camino en producción y en `npm run desktop:preview`
    win.loadURL(`${APP_ORIGIN}/index.html`);
  }

  return win;
}

// --- Arranque --------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    configureSession(session.defaultSession);
    // En macOS se conserva el menú de la app (copiar/pegar, ocultar…)
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    createWindow();
    // La ventana se pide cuando hace falta: en macOS se puede cerrar y volver
    // a abrir, y el updater dura más que ella
    initAutoUpdate(() => BrowserWindow.getAllWindows()[0] || null);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
