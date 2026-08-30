import { describe, it, expect, vi } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TrackList from '../../src/components/TrackList'
import { renderWithI18n, t } from '../helpers/render.jsx'

const pista = (over) => ({
  id: over.name,
  size: 5 * 1024 * 1024,
  duration: 200,
  bpm: 128,
  playedOn: {},
  musicalKey: null,
  ...over,
})

const PISTAS = [
  pista({ name: 'aurora.mp3', title: 'Aurora', artist: 'Nina', bpm: 174, duration: 300 }),
  pista({ name: 'bombo.mp3', title: 'Bombo', artist: 'Kraft', bpm: 128, duration: 200 }),
  pista({ name: 'cierre.mp3', title: 'Cierre', artist: 'Nina', bpm: 92, duration: 150 }),
]

const pintar = (props = {}) =>
  renderWithI18n(
    <TrackList
      tracks={PISTAS}
      deckTracks={{ A: null, B: null }}
      onAddTracks={() => {}}
      onLoadToDeck={() => {}}
      onRemoveTrack={() => {}}
      referenceKey={null}
      showArtwork={false}
      onToggleArtwork={() => {}}
      showKey={false}
      playing={{ A: false, B: false }}
      lockLoadWhilePlaying={false}
      {...props}
    />
  )

const titulosVisibles = () =>
  screen
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-testid="track-title"]').textContent)

describe('búsqueda', () => {
  it('filtra por título, por archivo y por artista', async () => {
    const user = userEvent.setup()
    pintar()
    const buscador = screen.getByPlaceholderText(t('search'))

    await user.type(buscador, 'auro')
    expect(titulosVisibles()).toEqual(['Aurora'])

    await user.clear(buscador)
    await user.type(buscador, 'Nina') // artista: dos pistas
    expect(titulosVisibles()).toEqual(['Aurora', 'Cierre'])

    await user.clear(buscador)
    await user.type(buscador, 'bombo.mp3') // nombre de archivo
    expect(titulosVisibles()).toEqual(['Bombo'])
  })

  it('no distingue mayúsculas', async () => {
    const user = userEvent.setup()
    pintar()
    await user.type(screen.getByPlaceholderText(t('search')), 'AURORA')
    expect(titulosVisibles()).toEqual(['Aurora'])
  })

  it('avisa cuando no hay coincidencias', async () => {
    const user = userEvent.setup()
    pintar()
    await user.type(screen.getByPlaceholderText(t('search')), 'zzz')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(t('noMatch', { query: 'zzz' }))).toBeInTheDocument()
  })

  it('con la lista vacía invita a añadir canciones', () => {
    pintar({ tracks: [] })
    expect(screen.getByText(t('emptyList'))).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(t('search'))).toBeNull()
  })
})

describe('ordenación', () => {
  const ordenarPor = async (valor) => {
    const user = userEvent.setup()
    await user.selectOptions(screen.getByTitle(t('sortByTitle')), valor)
  }

  it('respeta el orden de llegada mientras no se pida otra cosa', () => {
    pintar()
    expect(titulosVisibles()).toEqual(['Aurora', 'Bombo', 'Cierre'])
  })

  it('ordena por nombre, BPM y duración', async () => {
    pintar()
    await ordenarPor('bpm')
    expect(titulosVisibles()).toEqual(['Cierre', 'Bombo', 'Aurora'])

    await ordenarPor('duration')
    expect(titulosVisibles()).toEqual(['Cierre', 'Bombo', 'Aurora'])

    await ordenarPor('name')
    expect(titulosVisibles()).toEqual(['Aurora', 'Bombo', 'Cierre'])
  })

  it('invierte el orden con la flecha', async () => {
    const user = userEvent.setup()
    pintar()
    await user.click(screen.getByTitle(t('reverseTitle')))
    expect(titulosVisibles()).toEqual(['Cierre', 'Bombo', 'Aurora'])

    await ordenarPor('bpm')
    expect(titulosVisibles()).toEqual(['Aurora', 'Bombo', 'Cierre'])
  })

  it('las pistas sin analizar se van al final', async () => {
    pintar({ tracks: [pista({ name: 'sin.mp3', title: 'Sin BPM', bpm: null }), ...PISTAS] })
    await ordenarPor('bpm')
    expect(titulosVisibles().at(-1)).toBe('Sin BPM')
  })

  it('ordena por tonalidad solo cuando la columna se ve', async () => {
    const conKey = [
      pista({ name: 'a.mp3', title: 'En 8A', musicalKey: { pitchClass: 9, mode: 'min' } }),
      pista({ name: 'b.mp3', title: 'En 1A', musicalKey: { pitchClass: 2, mode: 'min' } }),
    ]
    const { unmount } = pintar({ tracks: conKey, showKey: true })
    expect(screen.getByRole('option', { name: t('sortKey') })).toBeInTheDocument()
    await ordenarPor('key')
    expect(titulosVisibles()).toEqual(['En 1A', 'En 8A'])
    unmount()

    pintar({ tracks: conKey, showKey: false })
    expect(screen.queryByRole('option', { name: t('sortKey') })).toBeNull()
  })
})

describe('bloqueo de carga sobre un deck en reproducción', () => {
  const botonesDe = (titulo) => screen.getAllByRole('listitem').map((li) => within(li).getByTitle(titulo).querySelector('button'))

  it('con el bloqueo puesto y el deck sonando, el botón queda deshabilitado', async () => {
    const onLoadToDeck = vi.fn()
    pintar({ lockLoadWhilePlaying: true, playing: { A: true, B: false }, onLoadToDeck })

    const [botonA] = botonesDe(t('loadLockedTitle', { side: 'A' }))
    expect(botonA).toBeDisabled()

    fireEvent.click(botonA)
    expect(onLoadToDeck).not.toHaveBeenCalled()
  })

  it('el otro deck sigue admitiendo pistas', async () => {
    const user = userEvent.setup()
    const onLoadToDeck = vi.fn()
    pintar({ lockLoadWhilePlaying: true, playing: { A: true, B: false }, onLoadToDeck })

    const [botonB] = botonesDe(t('loadToDeckTitle', { side: 'B' }))
    expect(botonB).toBeEnabled()
    await user.click(botonB)
    expect(onLoadToDeck).toHaveBeenCalledWith('B', expect.objectContaining({ title: 'Aurora' }))
  })

  it('sin la opción activada, un deck sonando no bloquea nada', async () => {
    const user = userEvent.setup()
    const onLoadToDeck = vi.fn()
    pintar({ lockLoadWhilePlaying: false, playing: { A: true, B: true }, onLoadToDeck })

    const [botonA] = botonesDe(t('loadToDeckTitle', { side: 'A' }))
    expect(botonA).toBeEnabled()
    await user.click(botonA)
    expect(onLoadToDeck).toHaveBeenCalledWith('A', expect.objectContaining({ title: 'Aurora' }))
  })

  it('el motivo del bloqueo se explica en el tooltip', () => {
    pintar({ lockLoadWhilePlaying: true, playing: { A: true, B: false } })
    expect(screen.getAllByTitle(t('loadLockedTitle', { side: 'A' })).length).toBe(PISTAS.length)
  })
})

describe('estado de cada pista', () => {
  it('marca la pista cargada en cada deck y la que ya se pinchó', () => {
    pintar({
      deckTracks: { A: PISTAS[0], B: null },
      tracks: [PISTAS[0], { ...PISTAS[1], playedOn: { B: true } }],
    })
    const filas = screen.getAllByRole('listitem')
    expect(within(filas[0]).getByTitle(t('badgeCurrentTitle', { side: 'A' }))).toBeInTheDocument()
    expect(within(filas[1]).getByTitle(t('badgePlayedTitle', { side: 'B' }))).toBeInTheDocument()
  })

  it('quita una pista de la lista', async () => {
    const user = userEvent.setup()
    const onRemoveTrack = vi.fn()
    pintar({ onRemoveTrack })
    await user.click(screen.getAllByTitle(t('removeTitle'))[1])
    expect(onRemoveTrack).toHaveBeenCalledWith('bombo.mp3')
  })

  it('resalta las tonalidades compatibles con la que está sonando', () => {
    pintar({
      showKey: true,
      referenceKey: { pitchClass: 9, mode: 'min' }, // Am · 8A
      tracks: [
        pista({ name: 'misma.mp3', title: 'Misma', musicalKey: { pitchClass: 9, mode: 'min' } }),
        pista({ name: 'relativa.mp3', title: 'Relativa', musicalKey: { pitchClass: 0, mode: 'maj' } }),
        pista({ name: 'lejana.mp3', title: 'Lejana', musicalKey: { pitchClass: 2, mode: 'maj' } }),
      ],
    })
    const filas = screen.getAllByRole('listitem')
    expect(within(filas[0]).getByTitle(t('keySameTitle'))).toHaveTextContent('Am / 8A')
    expect(within(filas[1]).getByTitle(t('keyCompatibleTitle'))).toHaveTextContent('C / 8B')
    expect(within(filas[2]).getByTitle(t('keyClashTitle'))).toHaveTextContent('D / 10B')
  })
})

describe('cabecera y formato del archivo', () => {
  it('la cabecera nombra las columnas', () => {
    pintar({ showKey: true })
    const cabecera = screen.getByTestId('track-header')
    const textos = [...cabecera.children].map((c) => c.textContent).filter(Boolean)
    expect(textos).toEqual([
      t('csvDuration'),
      t('bpm'),
      t('colDeck'),
      t('csvName'),
      t('sortKey'),
      t('csvSize'),
    ])
  })

  it('sin carátula, el hueco dice de qué formato es el archivo', () => {
    pintar({ showArtwork: true })
    // Las pistas de prueba son .mp3 y ninguna trae carátula
    const marcas = screen.getAllByTitle(t('noArtworkFormatTitle', { format: 'MP3' }))
    expect(marcas.length).toBeGreaterThan(0)
    expect(marcas[0]).toHaveTextContent('MP3')
  })
})
