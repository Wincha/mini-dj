import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import Deck from '../../src/components/Deck'
import { computeOnsetEnvelope, detectTempoAsync } from '../../src/audio/beatGrid'
import { renderWithI18n } from '../helpers/render.jsx'
import { makeAudioBuffer, sine } from '../helpers/signals'

// La onda se pinta en un canvas: aquí no aporta nada y sí ruido
vi.mock('../../src/components/WaveformCanvas', () => ({ default: () => null }))
// El detector real necesita OfflineAudioContext y un Worker; lo que se prueba
// es CON QUÉ se le llama, no lo que calcula
vi.mock('../../src/audio/beatGrid', async (importOriginal) => ({
  ...(await importOriginal()),
  computeOnsetEnvelope: vi.fn(async () => null),
  detectTempoAsync: vi.fn(async () => null),
}))
vi.mock('../../src/audio/metadata', () => ({ readTrackMetadata: vi.fn(async () => ({})) }))

const SR = 44100
let decoded
let decodeAudioData
let creados // Blobs pasados a URL.createObjectURL
let sonando // estado del <audio>: jsdom no reproduce nada

const motor = () => ({
  ctx: { decodeAudioData },
  resume: vi.fn(async () => {}),
})

const pista = () =>
  new File([new Uint8Array(2048)], 'tema.mp3', { type: 'audio/mpeg' })

const deckEl = (side, file, token, props = {}) => (
    <Deck
      colorClass=""
      engine={motor()}
      side={side}
      pitchPct={0}
      setPitchPct={() => {}}
      pitchRange={8}
      setPitchRange={() => {}}
      keyLock={false}
      setKeyLock={() => {}}
      onAttachEl={() => {}}
      onAutoGainComputed={() => {}}
      onBpmDetected={() => {}}
      onAnalysis={() => {}}
      onSync={() => {}}
      canSync={false}
      syncActive={false}
      syncLabel=""
      onPlayed={() => {}}
      onPlayingChange={() => {}}
      onTrackMeta={() => {}}
      wavePalette={[]}
      externalTrack={{ file, loadToken: token }}
      isActive={false}
      onActivate={() => {}}
      lockLoadWhilePlaying
      {...props}
    />
)

const montarDeck = (side, file, props = {}) => {
  const utils = renderWithI18n(deckEl(side, file, 1, props))
  return {
    ...utils,
    // Segunda carga en el MISMO deck (como al pulsar otra pista de la lista)
    cargarOtra: (otro) => utils.rerender(deckEl(side, otro, 2, props)),
  }
}

beforeEach(() => {
  decoded = makeAudioBuffer([sine({ seconds: 2, amp: 0.5, sampleRate: SR })], SR)
  decodeAudioData = vi.fn(async () => decoded)
  creados = []
  URL.createObjectURL = vi.fn((blob) => {
    creados.push(blob)
    return `blob:mini-dj/${creados.length}`
  })
  URL.revokeObjectURL = vi.fn()
  // jsdom no reproduce audio
  HTMLMediaElement.prototype.load = vi.fn()
  HTMLMediaElement.prototype.play = vi.fn(async () => {})
  HTMLMediaElement.prototype.pause = vi.fn()
  sonando = false
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get: () => !sonando,
  })
})

afterEach(() => vi.clearAllMocks())

describe('carga de pista: un solo decode y una copia por deck', () => {
  it('el análisis trabaja sobre el AudioBuffer YA decodificado', async () => {
    // Regresión: el detector de BPM volvía a leer el mismo blob que estaba
    // sonando y la reproducción se congelaba al pulsar Play durante el análisis
    montarDeck('A', pista())

    await waitFor(() => expect(computeOnsetEnvelope).toHaveBeenCalled())
    expect(computeOnsetEnvelope).toHaveBeenCalledTimes(1)
    expect(computeOnsetEnvelope.mock.calls[0][0]).toBe(decoded)
  })

  it('decodifica UNA sola vez por carga', async () => {
    montarDeck('A', pista())
    await waitFor(() => expect(computeOnsetEnvelope).toHaveBeenCalled())
    expect(decodeAudioData).toHaveBeenCalledTimes(1)
  })

  it('el <audio> reproduce una COPIA del archivo, no el File original', async () => {
    const file = pista()
    const { container } = montarDeck('A', file)

    await waitFor(() => expect(creados).toHaveLength(1))
    expect(creados[0]).toBeInstanceOf(Blob)
    expect(creados[0]).not.toBe(file) // copia propia de los bytes
    expect(creados[0].type).toBe('audio/mpeg')

    await waitFor(() =>
      expect(container.querySelector('audio').getAttribute('src')).toBe('blob:mini-dj/1')
    )
  })

  it('la MISMA pista en los dos decks recibe dos copias distintas', async () => {
    // Regresión: dos <audio> leyendo en streaming el mismo File se atascaban
    // y la reproducción se congelaba
    const file = pista()
    montarDeck('A', file)
    montarDeck('B', file)

    await waitFor(() => expect(creados).toHaveLength(2))
    expect(creados[0]).not.toBe(creados[1])
    expect(creados[0]).not.toBe(file)
    expect(creados[1]).not.toBe(file)
    expect(decodeAudioData).toHaveBeenCalledTimes(2) // uno por deck, no más
  })

  it('cada deck calcula su auto-gain una sola vez, al cargar', async () => {
    const onAutoGainComputed = vi.fn()
    montarDeck('A', pista(), { onAutoGainComputed })

    await waitFor(() => expect(onAutoGainComputed).toHaveBeenCalled())
    expect(onAutoGainComputed).toHaveBeenCalledTimes(1)
    const [side, gainDb] = onAutoGainComputed.mock.calls[0]
    expect(side).toBe('A')
    expect(Number.isFinite(gainDb)).toBe(true)

    // Y no se vuelve a mover: no hay nada que lo recalcule durante la escucha
    await new Promise((r) => setTimeout(r, 50))
    expect(onAutoGainComputed).toHaveBeenCalledTimes(1)
  })

  it('con el deck sonando y el bloqueo puesto, no carga otra pista', async () => {
    const { cargarOtra } = montarDeck('A', pista())
    await waitFor(() => expect(creados).toHaveLength(1))

    sonando = true // el deck está reproduciendo
    cargarOtra(new File([new Uint8Array(1024)], 'otra.mp3', { type: 'audio/mpeg' }))

    await new Promise((r) => setTimeout(r, 30))
    expect(creados).toHaveLength(1) // no se ha cargado nada nuevo
    expect(decodeAudioData).toHaveBeenCalledTimes(1)
  })

  it('sin el bloqueo, un deck sonando sí acepta otra pista', async () => {
    const { cargarOtra } = montarDeck('A', pista(), { lockLoadWhilePlaying: false })
    await waitFor(() => expect(creados).toHaveLength(1))

    sonando = true
    cargarOtra(new File([new Uint8Array(1024)], 'otra.mp3', { type: 'audio/mpeg' }))

    await waitFor(() => expect(creados).toHaveLength(2))
  })

  it('sin rejilla detectada no se inventa un BPM', async () => {
    const onBpmDetected = vi.fn()
    montarDeck('A', pista(), { onBpmDetected })

    await waitFor(() => expect(detectTempoAsync).not.toHaveBeenCalled())
    await waitFor(() => expect(onBpmDetected).toHaveBeenCalledWith('A', null, expect.anything()))
  })
})
