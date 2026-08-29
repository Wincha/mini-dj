import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { findChrome, loadTrackIntoDeck, makeTrackFile, openPage, startApp } from './browser.js'

const chrome = findChrome()
const suite = chrome ? describe : describe.skip
if (!chrome) {
  console.warn('[e2e] No hay Chrome instalado: se saltan las pruebas de navegador.')
}

// Selectores por CONTENIDO, no por clases: sobreviven a un retoque de estilos.
const BPM_DECKS = `[...document.querySelectorAll('div')]
  .filter((d) => !d.children.length && /^[\\d.]+ BPM$/.test(d.textContent.trim()))`

let app
let page

suite('flujos de la aplicación en el navegador', () => {
  beforeAll(async () => {
    app = await startApp()
    page = await openPage(app.browser, app.url)
  })

  afterAll(async () => {
    await app?.close()
  })

  const bpmDeDecks = () =>
    page.evaluate(`${BPM_DECKS}.map((d) => parseFloat(d.textContent))`)

  const esperarBpm = (index, timeout = 45000) =>
    page
      .waitForFunction(
        `(() => { const v = ${BPM_DECKS}[${index}]; return v ? parseFloat(v.textContent) : false })()`,
        { timeout, polling: 300 }
      )
      .then((h) => h.jsonValue())

  // Botón por su texto visible (el índice elige entre deck A y deck B)
  const botonesCon = async (texto) => {
    const todos = await page.$$('button')
    const encontrados = []
    for (const b of todos) {
      const txt = await b.evaluate((el) => el.textContent.trim())
      if (txt.includes(texto)) encontrados.push(b)
    }
    return encontrados
  }
  const pulsar = async (texto, index = 0) => (await botonesCon(texto))[index].click()

  it('carga una pista y detecta su BPM', async () => {
    const ruta = makeTrackFile('deck-a-128.wav', 128, 25)
    await loadTrackIntoDeck(page, 'A', ruta)

    await page.waitForFunction(
      "document.body.textContent.includes('deck-a-128')",
      { timeout: 20000 }
    )
    const bpm = await esperarBpm(0)
    expect(bpm).toBeGreaterThan(126)
    expect(bpm).toBeLessThan(130)
  })

  it('reproduce: el playhead avanza', async () => {
    await pulsar('Play')
    await page.waitForFunction(
      "(document.querySelectorAll('audio')[0]?.currentTime || 0) > 0.3",
      { timeout: 15000, polling: 100 }
    )
    const t1 = await page.evaluate("document.querySelectorAll('audio')[0].currentTime")
    expect(t1).toBeGreaterThan(0.3)

    await pulsar('Pause')
    const parado = await page.evaluate("document.querySelectorAll('audio')[0].paused")
    expect(parado).toBe(true)
  })

  it('sincroniza el segundo deck con el primero', async () => {
    await loadTrackIntoDeck(page, 'B', makeTrackFile('deck-b-132.wav', 132, 25))
    const bpmB = await esperarBpm(1)
    expect(bpmB).toBeGreaterThan(130)
    expect(bpmB).toBeLessThan(134)

    // El SYNC del deck B lo lleva al BPM del A ajustando su pitch
    await pulsar('SYNC', 1)

    await page.waitForFunction(
      `(() => { const v = ${BPM_DECKS}.map((d) => parseFloat(d.textContent)); return v.length === 2 && Math.abs(v[0] - v[1]) < 0.5 })()`,
      { timeout: 10000, polling: 200 }
    )
    const [a, b] = await bpmDeDecks()
    expect(Math.abs(a - b)).toBeLessThan(0.5)
  })

  it('los ajustes sobreviven a recargar la página', async () => {
    await page.select('select[aria-label]', 'en')
    await pulsar('⚙')
    await pulsar('Safety')

    const casilla = 'input[type="checkbox"]'
    const antes = await page.$$eval(casilla, (els) => els.map((e) => e.checked))
    expect(antes.some(Boolean)).toBe(true)
    // El bloqueo de carga es la única casilla de esta pestaña
    await page.click(casilla)
    await page.$$eval('button', (bs) => bs.find((b) => b.textContent.trim() === '✕')?.click())

    await page.reload({ waitUntil: 'networkidle0' })
    await pulsar('⚙')
    await pulsar('Safety')
    expect(await page.$eval(casilla, (e) => e.checked)).toBe(false)

    // Se deja como estaba para no arrastrar el ajuste a los demás tests
    await page.click(casilla)
    await page.$$eval('button', (bs) => bs.find((b) => b.textContent.trim() === '✕')?.click())
  })

  it('cambiar de idioma no rompe el layout', async () => {
    const desbordes = []
    for (const code of ['es', 'ca', 'gl', 'eu', 'fr', 'it', 'pt', 'zh', 'ja', 'ko', 'en']) {
      await page.select('select[aria-label]', code)
      await page.waitForFunction(`document.documentElement.lang === '${code}'`, { timeout: 5000 })

      const info = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        // Elementos que se salen por la derecha del viewport
        fuera: [...document.querySelectorAll('body *')].filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.right > window.innerWidth + 1
        }).length,
      }))
      if (info.scrollWidth > info.clientWidth + 1 || info.fuera > 0) {
        desbordes.push({ code, ...info })
      }
    }
    expect(desbordes).toEqual([])
  })
})
