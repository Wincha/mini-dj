import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import Deck from '../../src/components/Deck'
import { renderWithI18n, t } from '../helpers/render.jsx'
import { makeAudioBuffer, sine } from '../helpers/signals'

// La onda va a un canvas y aquí solo estorba; el detector de tempo real
// necesita OfflineAudioContext y un Worker. La pista llega con la rejilla ya
// puesta, que es lo que necesita la caja de estructura.
vi.mock('../../src/components/WaveformCanvas', () => ({ default: () => null }))
vi.mock('../../src/audio/beatGrid', async (importOriginal) => ({
  ...(await importOriginal()),
  computeOnsetEnvelope: vi.fn(async () => null),
  detectTempoAsync: vi.fn(async () => null),
}))
vi.mock('../../src/audio/metadata', () => ({ readTrackMetadata: vi.fn(async () => ({})) }))

// Ajustes por defecto, tal y como los resuelve el diálogo
const prefsBase = {
  show: true,
  phraseSize: 16,
  unit: 'kicks',
  warnAmber: 16,
  warnRed: 4,
  endWarn: { enabled: true, mode: 'seconds', seconds: 30, percent: 10 },
}

const SR = 8000
let decodeAudioData

const motor = () => ({ ctx: { decodeAudioData }, resume: vi.fn(async () => {}) })
const archivo = () => new File([new Uint8Array(2048)], 'tema.mp3', { type: 'audio/mpeg' })

// Estructura como la deja el análisis: ritmo, bajón y ritmo otra vez
const estructura = (over = {}) => ({
  sections: [
    { start: 0, end: 30, kick: true, startBeat: 0, endBeat: 64 },
    { start: 30, end: 60, kick: false, startBeat: 64, endBeat: 128 },
    { start: 60, end: 120, kick: true, startBeat: 128, endBeat: 256 },
  ],
  phraseSize: 16,
  phraseOffset: 4,
  detectedOffset: 4,
  confident: true,
  manual: false,
  ...over,
})

const pistaConRejilla = (over = {}) => ({
  file: archivo(),
  loadToken: 1,
  bpm: 128,
  gridAnchor: 0,
  gridManual: true,
  structure: estructura(),
  ...over,
})

const montar = async (props = {}) => {
  const utils = renderWithI18n(
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
      isActive={false}
      onActivate={() => {}}
      lockLoadWhilePlaying
      externalTrack={pistaConRejilla(props.track)}
      {...props}
    />
  )
  await waitFor(() => expect(document.querySelector('audio')?.src).toBeTruthy())
  // Las herramientas del deck van por pestañas: hay que abrir la suya
  fireEvent.click(screen.getByRole('tab', { name: t('toolsBpm') }))
  return utils
}

const desplazamiento = () => screen.getByTitle(t('phraseOffsetTitle'))

beforeEach(() => {
  decodeAudioData = vi.fn(async () => makeAudioBuffer([sine({ seconds: 30, sampleRate: SR })], SR))
  global.URL.createObjectURL = vi.fn(() => 'blob:tema')
  global.URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('caja de estructura', () => {
  it('enseña el desplazamiento de frase que trae la pista', async () => {
    await montar()
    await waitFor(() => expect(desplazamiento()).toHaveTextContent('+4'))
  })

  it('« ‹ › » mueven la frase, con el salto grueso a media frase', async () => {
    await montar()
    await waitFor(() => expect(desplazamiento()).toHaveTextContent('+4'))

    fireEvent.click(screen.getByTitle(t('phraseFwdFineTitle')))
    expect(desplazamiento()).toHaveTextContent('+5')

    fireEvent.click(screen.getByTitle(t('phraseBackFineTitle')))
    expect(desplazamiento()).toHaveTextContent('+4')

    // Media frase de 16 son 8 kicks
    fireEvent.click(screen.getByTitle(t('phraseFwdCoarseTitle', { n: 8 })))
    expect(desplazamiento()).toHaveTextContent('+12')

    // Y da la vuelta por el tamaño de frase en vez de salirse
    fireEvent.click(screen.getByTitle(t('phraseFwdCoarseTitle', { n: 8 })))
    expect(desplazamiento()).toHaveTextContent('+4')
  })

  it('el reset devuelve el desplazamiento al que detectó el análisis', async () => {
    await montar()
    await waitFor(() => expect(desplazamiento()).toHaveTextContent('+4'))

    const reset = screen.getByTitle(t('phraseResetTitle'))
    expect(reset).toBeDisabled() // nada que deshacer todavía

    fireEvent.click(screen.getByTitle(t('phraseFwdFineTitle')))
    expect(desplazamiento()).toHaveTextContent('+5')
    expect(reset).toBeEnabled()

    fireEvent.click(reset)
    expect(desplazamiento()).toHaveTextContent('+4')
    expect(reset).toBeDisabled()
  })

  it('lo que se ajusta a mano sube al padre para guardarse con la pista', async () => {
    const onStructure = vi.fn()
    await montar({ onStructure })
    await waitFor(() => expect(onStructure).toHaveBeenCalled())
    onStructure.mockClear()

    fireEvent.click(screen.getByTitle(t('phraseFwdFineTitle')))
    await waitFor(() => expect(onStructure).toHaveBeenCalled())
    const [side, st] = onStructure.mock.calls.at(-1)
    expect(side).toBe('A')
    expect(st).toMatchObject({ phraseOffset: 5, manual: true, detectedOffset: 4 })
  })

  it('el tamaño de frase es el mismo ajuste que el del diálogo ⚙', async () => {
    const onPhraseSize = vi.fn()
    await montar({ onPhraseSize })

    const selector = screen.getByTitle(t('phraseSizeTitle'))
    expect(selector).toHaveValue('16')
    fireEvent.change(selector, { target: { value: '32' } })
    expect(onPhraseSize).toHaveBeenCalledWith(32)
  })

  it('el tamaño que llega de la configuración manda sobre el guardado', async () => {
    await montar({ structurePrefs: { ...prefsBase, phraseSize: 8 } })
    expect(screen.getByTitle(t('phraseSizeTitle'))).toHaveValue('8')
    // Y el desplazamiento se recoloca dentro de la frase nueva
    await waitFor(() => expect(desplazamiento()).toHaveTextContent('+4'))
  })

  it('sin estructura, los controles de frase no se pueden tocar', async () => {
    await montar({ track: { structure: null, bpm: null, gridAnchor: null, gridManual: false } })
    await waitFor(() => expect(desplazamiento()).toHaveTextContent('—'))
    expect(screen.getByTitle(t('phraseFwdFineTitle'))).toBeDisabled()
    expect(screen.getByTitle(t('phraseResetTitle'))).toBeDisabled()
  })
})

describe('pestañas de herramientas', () => {
  // El montador ya deja abierta la de estructura
  const abrir = (clave) => fireEvent.click(screen.getByRole('tab', { name: t(clave) }))

  it('son tres, agrupadas por lo que hacen', async () => {
    await montar()
    expect(screen.getAllByRole('tab').map((b) => b.textContent)).toEqual([
      t('toolsPosition'),
      t('toolsBpm'),
      t('toolsLoops'),
    ])
  })

  it('solo se ve la pestaña abierta: es lo que compacta el deck', async () => {
    await montar()
    // Abierta la de BPM: rejilla y estructura juntas, lo demás fuera
    expect(screen.getByTitle(t('phraseResetTitle'))).toBeInTheDocument()
    expect(screen.getByTitle(t('tapTitle'))).toBeInTheDocument()
    expect(screen.queryByTitle(t('loopInTitle'))).toBeNull()

    abrir('toolsLoops')
    expect(screen.getByTitle(t('loopInTitle'))).toBeInTheDocument()
    expect(screen.getByTitle(t('savedLoopSaveTitle'))).toBeInTheDocument()
    expect(screen.queryByTitle(t('phraseResetTitle'))).toBeNull()

    abrir('toolsPosition')
    expect(screen.getByTitle(t('hotCueSetTitle', { n: 1 }))).toBeInTheDocument()
    expect(screen.getByTitle(t('jumpSizeTitle'))).toBeInTheDocument()
    expect(screen.queryByTitle(t('loopInTitle'))).toBeNull()
  })

  it('la pestaña abierta se marca como tal', async () => {
    await montar()
    const dela = (clave) => screen.getByRole('tab', { name: t(clave) })
    expect(dela('toolsBpm')).toHaveAttribute('aria-selected', 'true')
    expect(dela('toolsLoops')).toHaveAttribute('aria-selected', 'false')

    abrir('toolsLoops')
    expect(dela('toolsLoops')).toHaveAttribute('aria-selected', 'true')
    expect(dela('toolsBpm')).toHaveAttribute('aria-selected', 'false')
  })
})
