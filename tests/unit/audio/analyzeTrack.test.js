import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { detectBeatGrid } from '../../../src/audio/beatGrid'
import { detectKey } from '../../../src/audio/keyDetect'
import { quickAnalyzeTrack } from '../../../src/audio/analyzeTrack'

vi.mock('../../../src/audio/beatGrid', () => ({ detectBeatGrid: vi.fn() }))
vi.mock('../../../src/audio/keyDetect', () => ({ detectKey: vi.fn() }))

// AudioBuffer decodificado de mentira: lo único que se comprueba de él es que
// sea EXACTAMENTE el mismo objeto que reciben los analizadores.
const decoded = { duration: 212.5, sampleRate: 44100, numberOfChannels: 2 }
let decodeAudioData
let bytes

class OfflineAudioContextDoble {
  constructor(channels, length, rate) {
    this.args = [channels, length, rate]
    this.decodeAudioData = decodeAudioData
  }
}

const archivo = () => {
  const arrayBuffer = vi.fn(async () => bytes)
  return { name: 'tema.mp3', type: 'audio/mpeg', arrayBuffer }
}

beforeEach(() => {
  bytes = new ArrayBuffer(64)
  decodeAudioData = vi.fn(async () => decoded)
  globalThis.OfflineAudioContext = OfflineAudioContextDoble
  globalThis.fetch = vi.fn(() => {
    throw new Error('el análisis no debe descargar nada')
  })
  detectBeatGrid.mockResolvedValue({ bpm: 128.456, anchor: 0.37 })
  detectKey.mockReturnValue({ pitchClass: 9, mode: 'min' })
})

afterEach(() => {
  vi.clearAllMocks()
  delete globalThis.OfflineAudioContext
  delete globalThis.fetch
})

describe('análisis de la lista (un solo decode por pista)', () => {
  it('lee el archivo UNA vez y lo decodifica UNA vez', async () => {
    // Regresión: el detector de BPM volvía a leer por su cuenta el mismo blob
    // que estaba sonando y la reproducción se congelaba al pulsar Play
    const file = archivo()
    await quickAnalyzeTrack(file)

    expect(file.arrayBuffer).toHaveBeenCalledTimes(1)
    expect(decodeAudioData).toHaveBeenCalledTimes(1)
    expect(decodeAudioData).toHaveBeenCalledWith(bytes)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('el MISMO AudioBuffer alimenta rejilla y tonalidad', async () => {
    await quickAnalyzeTrack(archivo())

    expect(detectBeatGrid).toHaveBeenCalledTimes(1)
    expect(detectBeatGrid.mock.calls[0][0]).toBe(decoded)
    expect(detectKey).toHaveBeenCalledTimes(1)
    expect(detectKey.mock.calls[0][0]).toBe(decoded)
  })

  it('decodifica fuera de línea: sin salida de audio ni gesto del usuario', async () => {
    const creados = []
    globalThis.OfflineAudioContext = class {
      constructor(...args) {
        creados.push(args)
        this.decodeAudioData = decodeAudioData
      }
    }
    await quickAnalyzeTrack(archivo())
    // Un contexto mínimo (1 canal, 1 muestra): solo se usa para decodificar
    expect(creados).toEqual([[1, 1, 44100]])
  })

  it('devuelve BPM con dos decimales, ancla y duración', async () => {
    const out = await quickAnalyzeTrack(archivo())
    expect(out).toEqual({
      duration: 212.5,
      bpm: 128.46,
      gridAnchor: 0.37,
      musicalKey: { pitchClass: 9, mode: 'min' },
    })
  })

  it('sin rejilla detectada no inventa BPM ni ancla', async () => {
    detectBeatGrid.mockResolvedValue(null)
    const out = await quickAnalyzeTrack(archivo())
    expect(out.bpm).toBeNull()
    expect(out.gridAnchor).toBeNull()
  })

  it('una duración imposible se descarta', async () => {
    decodeAudioData.mockResolvedValue({ ...decoded, duration: Infinity })
    expect((await quickAnalyzeTrack(archivo())).duration).toBeNull()
  })
})
