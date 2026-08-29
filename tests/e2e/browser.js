// Arranque compartido de las pruebas de navegador: servidor de Vite + Chrome
// del sistema con puppeteer-core (nada de descargar navegadores).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { clickTrack, encodeWav } from '../helpers/wav.js'

const CANDIDATOS = [
  process.env.MINI_DJ_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

export function findChrome() {
  return CANDIDATOS.find((ruta) => existsSync(ruta)) || null
}

/** Pista WAV en disco, para dársela al <input type="file">. */
export function makeTrackFile(nombre, bpm, seconds = 20) {
  const dir = join(tmpdir(), 'mini-dj-e2e')
  mkdirSync(dir, { recursive: true })
  const ruta = join(dir, nombre)
  writeFileSync(ruta, encodeWav(clickTrack({ bpm, seconds })))
  return ruta
}

export async function startApp() {
  const server = await createServer({ server: { port: 0 }, logLevel: 'error' })
  await server.listen()
  const { port } = server.httpServer.address()

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // Sin tarjeta de sonido (WSL2, CI): salida muda y sin exigir gesto
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })

  return {
    url: `http://localhost:${port}/`,
    browser,
    async close() {
      await browser.close()
      await server.close()
    },
  }
}

export async function openPage(browser, url) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })

  // AudioContext.resume() no resuelve NUNCA sin salida de audio, y la app
  // espera a esa promesa antes de reproducir. Se sustituye por una promesa ya
  // resuelta: el grafo se monta igual.
  await page.evaluateOnNewDocument(() => {
    const parche = (Ctor) => {
      if (Ctor) Ctor.prototype.resume = () => Promise.resolve()
    }
    parche(window.AudioContext)
    parche(window.webkitAudioContext)
  })

  page.on('pageerror', (err) => console.error('[página]', err.message))
  await page.goto(url, { waitUntil: 'networkidle0' })
  return page
}

// Los <input type="file"> de los decks son los que NO admiten varios archivos
// (el de la lista de canciones sí). Orden en la página: deck A, deck B.
export async function loadTrackIntoDeck(page, side, ruta) {
  const inputs = await page.$$('input[type="file"]:not([multiple])')
  await inputs[side === 'A' ? 0 : 1].uploadFile(ruta)
}

/** Espera a que el deck muestre un BPM y lo devuelve como número. */
export async function waitForBpm(page, side, timeout = 40000) {
  const index = side === 'A' ? 0 : 1
  return page.waitForFunction(
    (i) => {
      const textos = [...document.querySelectorAll('[data-testid="deck-bpm"]')]
      const el = textos[i]
      if (!el) return false
      const n = parseFloat(el.textContent)
      return Number.isFinite(n) && n > 0 ? n : false
    },
    { timeout, polling: 300 },
    index
  ).then((h) => h.jsonValue())
}
