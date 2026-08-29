import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import Deck from '../../src/components/Deck'
import { renderWithI18n, t } from '../helpers/render.jsx'
import { makeAudioBuffer, sine } from '../helpers/signals'

// Igual que en DeckLoad: la onda va a un canvas y aquí solo estorba, y el
// detector real necesita OfflineAudioContext y un Worker.
vi.mock('../../src/components/WaveformCanvas', () => ({ default: () => null }))
vi.mock('../../src/audio/beatGrid', async (importOriginal) => ({
  ...(await importOriginal()),
  computeOnsetEnvelope: vi.fn(async () => null),
  detectTempoAsync: vi.fn(async () => null),
}))
vi.mock('../../src/audio/metadata', () => ({ readTrackMetadata: vi.fn(async () => ({})) }))

// Buffer largo (30 s) y ligero: la duración de la pista sale del AudioBuffer
// decodificado, y con dos segundos los loops de este test no cabrían.
const SR = 8000
let decodeAudioData
let tiempo // currentTime del <audio>: jsdom no reproduce nada

const motor = () => ({ ctx: { decodeAudioData }, resume: vi.fn(async () => {}) })
const pista = () => new File([new Uint8Array(2048)], 'tema.mp3', { type: 'audio/mpeg' })

const deckEl = (file, token, props) => (
  <Deck
    colorClass=""
    engine={motor()}
    side="A"
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
    externalTrack={{ file, loadToken: token, ...props.track }}
    isActive={false}
    onActivate={() => {}}
    lockLoadWhilePlaying
    {...props}
  />
)

// Monta el deck y espera a que la pista esté cargada (hay <audio src>)
const montar = async (props = {}) => {
  const utils = renderWithI18n(deckEl(pista(), 1, props))
  await waitFor(() =>
    expect(utils.container.querySelector('audio')).toHaveAttribute('src')
  )
  return utils
}

const pad = (n) =>
  screen.queryByTitle(t('hotCueSetTitle', { n })) ||
  screen.getByTitle(new RegExp(`^Hot cue ${n}: jump`))

beforeEach(() => {
  decodeAudioData = vi.fn(async () =>
    makeAudioBuffer([sine({ seconds: 30, amp: 0.5, sampleRate: SR })], SR)
  )
  URL.createObjectURL = vi.fn(() => 'blob:mini-dj/1')
  URL.revokeObjectURL = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  HTMLMediaElement.prototype.play = vi.fn(async () => {})
  HTMLMediaElement.prototype.pause = vi.fn()
  tiempo = 0
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => tiempo,
    set: (v) => {
      tiempo = v
    },
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get: () => 200,
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get: () => true,
  })
})

afterEach(() => vi.clearAllMocks())

describe('hot cues del deck', () => {
  it('hay ocho pads, y todos empiezan vacíos', async () => {
    await montar()
    for (let n = 1; n <= 8; n++) {
      expect(screen.getByTitle(t('hotCueSetTitle', { n }))).toBeInTheDocument()
    }
    expect(screen.queryByTitle(t('hotCueSetTitle', { n: 9 }))).toBeNull()
  })

  it('el primer click fija el cue y el segundo salta a él', async () => {
    await montar()
    tiempo = 12.5
    fireEvent.click(pad(1))

    // El pad ya no ofrece "fijar": ahora ofrece saltar
    await waitFor(() =>
      expect(screen.queryByTitle(t('hotCueSetTitle', { n: 1 }))).toBeNull()
    )

    tiempo = 90
    fireEvent.click(pad(1))
    expect(tiempo).toBe(12.5)
  })

  it('Shift+click y click derecho borran el cue', async () => {
    await montar()
    tiempo = 20
    fireEvent.click(pad(1))
    await waitFor(() => expect(screen.queryByTitle(t('hotCueSetTitle', { n: 1 }))).toBeNull())

    fireEvent.click(pad(1), { shiftKey: true })
    await waitFor(() =>
      expect(screen.getByTitle(t('hotCueSetTitle', { n: 1 }))).toBeInTheDocument()
    )

    fireEvent.click(pad(2))
    await waitFor(() => expect(screen.queryByTitle(t('hotCueSetTitle', { n: 2 }))).toBeNull())
    fireEvent.contextMenu(pad(2))
    await waitFor(() =>
      expect(screen.getByTitle(t('hotCueSetTitle', { n: 2 }))).toBeInTheDocument()
    )
  })

  it('doble click abre el editor y el nombre se ve en el pad', async () => {
    await montar()
    tiempo = 30
    fireEvent.click(pad(3))
    await waitFor(() => expect(screen.queryByTitle(t('hotCueSetTitle', { n: 3 }))).toBeNull())

    fireEvent.dblClick(pad(3))
    const input = await screen.findByPlaceholderText(t('namePlaceholder'))
    fireEvent.change(input, { target: { value: 'drop' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(pad(3)).toHaveTextContent('drop'))
    // El editor se cierra y no deja hueco detrás
    expect(screen.queryByPlaceholderText(t('namePlaceholder'))).toBeNull()
  })

  it('Esc cierra el editor sin cambiar el nombre', async () => {
    await montar()
    tiempo = 30
    fireEvent.click(pad(4))
    await waitFor(() => expect(screen.queryByTitle(t('hotCueSetTitle', { n: 4 }))).toBeNull())

    fireEvent.dblClick(pad(4))
    const input = await screen.findByPlaceholderText(t('namePlaceholder'))
    fireEvent.change(input, { target: { value: 'no quiero' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByPlaceholderText(t('namePlaceholder'))).toBeNull())
    expect(pad(4)).not.toHaveTextContent('no quiero')
  })
})

describe('cues y loops que suben al padre para guardarse', () => {
  it('avisa con la lista compacta de cues', async () => {
    const onCues = vi.fn()
    await montar({ onCues })
    tiempo = 42
    fireEvent.click(pad(2))

    await waitFor(() => {
      const ultimo = onCues.mock.calls.at(-1)
      expect(ultimo[0]).toBe('A')
      expect(ultimo[1].hotCues).toEqual([{ i: 1, t: 42, name: '' }])
    })
  })

  it('un loop marcado a mano también sube', async () => {
    const onCues = vi.fn()
    await montar({ onCues })

    tiempo = 10
    fireEvent.click(screen.getByTitle(t('loopInTitle')))
    tiempo = 14
    fireEvent.click(screen.getByTitle(t('loopOutTitle')))

    await waitFor(() => {
      const ultimo = onCues.mock.calls.at(-1)
      expect(ultimo[1].activeLoop).toMatchObject({ start: 10, end: 14 })
    })
  })
})

describe('restaurar lo guardado al volver a cargar la pista', () => {
  const guardado = {
    hotCues: [
      { i: 0, t: 12.5, name: 'drop' },
      { i: 5, t: 88, name: '' },
    ],
    savedLoops: [{ id: 'loop-1', start: 30, end: 34, beats: 8, name: 'coro' }],
    activeLoop: { start: 30, end: 34, beats: 8 },
  }

  it('los hot cues vuelven a su sitio, con su nombre', async () => {
    await montar({ track: guardado })

    await waitFor(() => expect(pad(1)).toHaveTextContent('drop'))
    expect(screen.queryByTitle(t('hotCueSetTitle', { n: 1 }))).toBeNull()
    expect(screen.queryByTitle(t('hotCueSetTitle', { n: 6 }))).toBeNull()
    // Las ranuras que no tenían nada siguen libres
    expect(screen.getByTitle(t('hotCueSetTitle', { n: 2 }))).toBeInTheDocument()

    // Y saltan a donde se dejaron
    tiempo = 0
    fireEvent.click(pad(1))
    expect(tiempo).toBe(12.5)
  })

  it('los loops guardados vuelven a la lista y se pueden activar', async () => {
    await montar({ track: guardado })

    const selector = await screen.findByTitle(t('savedLoopSelectTitle'))
    await waitFor(() => expect(selector).not.toBeDisabled())
    expect(selector).toHaveTextContent('coro')

    tiempo = 0
    fireEvent.click(screen.getByTitle(t('savedLoopRecallTitle')))
    expect(tiempo).toBe(30)
  })

  it('el loop de la pista vuelve marcado pero APAGADO', async () => {
    await montar({ track: guardado })
    const toggle = await screen.findByTitle(t('loopToggleTitle'))
    await waitFor(() => expect(toggle).not.toBeDisabled())
    // Apagado: el botón no está en verde (esa clase solo aparece con el loop on)
    expect(toggle.className).not.toContain('bg-emerald-500')
  })
})

describe('longitud del loop', () => {
  it('÷2 y ×2 mantienen el punto de entrada', async () => {
    const onCues = vi.fn()
    await montar({ onCues })

    tiempo = 10
    fireEvent.click(screen.getByTitle(t('loopInTitle')))
    tiempo = 14
    fireEvent.click(screen.getByTitle(t('loopOutTitle')))

    fireEvent.click(screen.getByTitle(t('loopHalveTitle')))
    await waitFor(() =>
      expect(onCues.mock.calls.at(-1)[1].activeLoop).toMatchObject({ start: 10, end: 12 })
    )

    fireEvent.click(screen.getByTitle(t('loopDoubleTitle')))
    await waitFor(() =>
      expect(onCues.mock.calls.at(-1)[1].activeLoop).toMatchObject({ start: 10, end: 14 })
    )
  })

  it('mover el loop lo desplaza una longitud entera', async () => {
    const onCues = vi.fn()
    await montar({ onCues })

    tiempo = 10
    fireEvent.click(screen.getByTitle(t('loopInTitle')))
    tiempo = 14
    fireEvent.click(screen.getByTitle(t('loopOutTitle')))

    fireEvent.click(screen.getByTitle(t('loopMoveFwdTitle')))
    await waitFor(() =>
      expect(onCues.mock.calls.at(-1)[1].activeLoop).toMatchObject({ start: 14, end: 18 })
    )

    fireEvent.click(screen.getByTitle(t('loopMoveBackTitle')))
    await waitFor(() =>
      expect(onCues.mock.calls.at(-1)[1].activeLoop).toMatchObject({ start: 10, end: 14 })
    )
  })
})
