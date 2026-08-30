import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  loadStoredTracks,
  storeTrack,
  removeStoredTrack,
  mergeTrackAnalysis,
} from '../../../src/lib/trackStore'

// Base limpia en cada test: fake-indexeddb da una implementación completa en
// memoria, así que la persistencia se prueba de verdad y no contra un doble.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

const pista = (over = {}) => ({
  id: 'tema-1',
  name: 'tema.mp3',
  size: 4096,
  file: new File([new Uint8Array([1, 2, 3])], 'tema.mp3', { type: 'audio/mpeg' }),
  ...over,
})

describe('biblioteca en IndexedDB', () => {
  it('guarda y vuelve a leer una pista', async () => {
    await storeTrack(pista({ bpm: 128.5, duration: 210 }))
    const rows = await loadStoredTracks()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'tema-1', name: 'tema.mp3', bpm: 128.5, duration: 210 })
    // El archivo se guarda tal cual (clonado estructuralmente) y vuelve con
    // su contenido. Ojo: el doble de IndexedDB devuelve un Blob pelado donde
    // el navegador devuelve el File; lo que importa aquí es que los bytes
    // sobreviven al viaje.
    expect(rows[0].file).toBeInstanceOf(Blob)
    expect(rows[0].file.type).toBe('audio/mpeg')
    expect(new Uint8Array(await rows[0].file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rellena los campos que no vienen', async () => {
    await storeTrack(pista())
    const [row] = await loadStoredTracks()
    expect(row).toMatchObject({
      bpm: null,
      gridAnchor: null,
      gridManual: false,
      duration: null,
      musicalKey: null,
      analyzed: false,
      metaRead: false,
      playedOn: {},
    })
  })

  it('guarda la estructura de la pista y la devuelve tal cual', async () => {
    const structure = {
      sections: [
        { start: 0, end: 30, kick: true, startBeat: 0, endBeat: 64 },
        { start: 30, end: 60, kick: false, startBeat: 64, endBeat: 128 },
      ],
      phraseSize: 16,
      phraseOffset: 4,
      detectedOffset: 0,
      confident: true,
      manual: true,
    }
    await storeTrack(pista({ structure }))
    const [row] = await loadStoredTracks()
    expect(row.structure).toEqual(structure)
  })

  it('una estructura rota no llega a guardarse', async () => {
    await storeTrack(pista({ structure: { sections: 'nada de esto vale' } }))
    const [row] = await loadStoredTracks()
    expect(row.structure).toBeNull()
  })

  it('no persiste el fallo de análisis: se reintenta en cada sesión', async () => {
    await storeTrack(pista({ analyzeFailed: true }))
    const [row] = await loadStoredTracks()
    expect(row.analyzeFailed).toBeUndefined()
  })

  it('sobrescribe la pista con el mismo id en vez de duplicarla', async () => {
    await storeTrack(pista({ bpm: 120 }))
    await storeTrack(pista({ bpm: 174 }))
    const rows = await loadStoredTracks()
    expect(rows).toHaveLength(1)
    expect(rows[0].bpm).toBe(174)
  })

  it('borra una pista y deja el resto', async () => {
    await storeTrack(pista())
    await storeTrack(pista({ id: 'tema-2', name: 'otro.mp3' }))
    await removeStoredTrack('tema-1')

    const rows = await loadStoredTracks()
    expect(rows.map((t) => t.id)).toEqual(['tema-2'])
  })

  it('descarta filas sin archivo (restos de versiones viejas)', async () => {
    await storeTrack({ id: 'roto', name: 'roto.mp3', size: 0, file: null })
    expect(await loadStoredTracks()).toEqual([])
  })

  it('si IndexedDB falla, la app sigue con la lista vacía', async () => {
    globalThis.indexedDB = {
      open: () => {
        const req = {}
        setTimeout(() => {
          req.error = new Error('sin almacenamiento')
          req.onerror?.()
        }, 0)
        return req
      },
    }
    await expect(loadStoredTracks()).resolves.toEqual([])
    await expect(storeTrack(pista())).resolves.toBeUndefined()
    await expect(removeStoredTrack('tema-1')).resolves.toBeUndefined()
  })
})

describe('hot cues y loops guardados con la pista', () => {
  const cues = [
    { i: 0, t: 12.5, name: 'drop' },
    { i: 7, t: 180.25, name: '' },
  ]
  const loops = [
    { id: 'loop-1', start: 30, end: 34, beats: 8, name: 'coro' },
    { id: 'loop-2', start: 60, end: 61, beats: 2, name: '' },
  ]

  it('sobreviven a guardar y volver a leer', async () => {
    await storeTrack(pista({ hotCues: cues, savedLoops: loops, activeLoop: { start: 30, end: 34, beats: 8 } }))
    const [row] = await loadStoredTracks()

    expect(row.hotCues).toEqual(cues)
    expect(row.savedLoops).toEqual(loops)
    expect(row.activeLoop).toEqual({ start: 30, end: 34, beats: 8 })
  })

  it('una pista sin cues se guarda vacía, no rota', async () => {
    await storeTrack(pista())
    const [row] = await loadStoredTracks()
    expect(row).toMatchObject({ hotCues: [], savedLoops: [], activeLoop: null })
  })

  it('lo que llega mal formado no se guarda', async () => {
    await storeTrack(
      pista({
        hotCues: [{ i: 0, t: 5 }, { i: 99, t: 5 }, { i: 1, t: -2 }, null],
        savedLoops: [{ start: 3, end: 3 }, { start: 1, end: 2 }],
        activeLoop: { start: 9, end: 1 },
      })
    )
    const [row] = await loadStoredTracks()
    expect(row.hotCues).toEqual([{ i: 0, t: 5, name: '' }])
    expect(row.savedLoops).toHaveLength(1)
    expect(row.activeLoop).toBeNull()
  })

  it('borrar la pista se lleva por delante sus cues y sus loops', async () => {
    await storeTrack(pista({ hotCues: cues, savedLoops: loops }))
    await removeStoredTrack('tema-1')
    expect(await loadStoredTracks()).toEqual([])

    // Y si se vuelve a añadir el mismo archivo, entra limpia
    await storeTrack(pista())
    const [row] = await loadStoredTracks()
    expect(row.hotCues).toEqual([])
    expect(row.savedLoops).toEqual([])
  })

  it('sobreviven a recargar la app y a un reanálisis posterior', async () => {
    await storeTrack(pista({ hotCues: cues, savedLoops: loops }))
    const [recargada] = await loadStoredTracks()
    expect(recargada.hotCues).toEqual(cues)

    const tras = mergeTrackAnalysis(recargada, {
      bpm: 128,
      gridAnchor: 0.4,
      duration: 300,
      musicalKey: { pitchClass: 2, mode: 'min' },
    })
    await storeTrack(tras)
    const [final] = await loadStoredTracks()

    expect(final.hotCues).toEqual(cues)
    expect(final.savedLoops).toEqual(loops)
    expect(final.bpm).toBe(128) // el análisis sí actualiza lo suyo
  })
})

describe('rejilla ajustada a mano frente al análisis de fondo', () => {
  const analisis = { bpm: 175, gridAnchor: 0.9, duration: 200, musicalKey: { pitchClass: 0, mode: 'maj' } }

  it('una pista sin tocar acepta todo lo que trae el análisis', () => {
    const out = mergeTrackAnalysis({ id: 'x', bpm: null, gridAnchor: null }, analisis)
    expect(out).toMatchObject({ bpm: 175, gridAnchor: 0.9, duration: 200, analyzed: true })
  })

  it('una pista con rejilla manual conserva SU BPM y SU ancla', () => {
    const manual = { id: 'x', bpm: 87.5, gridAnchor: 0.32, gridManual: true }
    const out = mergeTrackAnalysis(manual, analisis)

    expect(out.bpm).toBe(87.5)
    expect(out.gridAnchor).toBe(0.32)
    expect(out.gridManual).toBe(true)
    // Lo que no toca la rejilla sí se aprovecha
    expect(out.duration).toBe(200)
    expect(out.musicalKey).toEqual(analisis.musicalKey)
    expect(out.analyzed).toBe(true)
  })

  it('los hot cues y los loops NUNCA los toca el análisis', () => {
    const conCues = {
      id: 'x',
      hotCues: [{ i: 0, t: 12.5, name: 'drop' }],
      savedLoops: [{ id: 'loop-1', start: 30, end: 34, name: 'coro' }],
      activeLoop: { start: 30, end: 34, beats: 8 },
    }
    const out = mergeTrackAnalysis(conCues, analisis)
    expect(out.hotCues).toEqual(conCues.hotCues)
    expect(out.savedLoops).toEqual(conCues.savedLoops)
    expect(out.activeLoop).toEqual(conCues.activeLoop)

    // Y tampoco con la rejilla ajustada a mano, que va por otra rama
    const manual = mergeTrackAnalysis({ ...conCues, gridManual: true }, analisis)
    expect(manual.hotCues).toEqual(conCues.hotCues)
    expect(manual.savedLoops).toEqual(conCues.savedLoops)
  })

  it('la estructura ajustada a mano NUNCA la toca el análisis', async () => {
    const structure = {
      sections: [
        { start: 0, end: 30, kick: true, startBeat: 0, endBeat: 64 },
        { start: 30, end: 60, kick: false, startBeat: 64, endBeat: 128 },
      ],
      phraseSize: 16,
      phraseOffset: 9,
      detectedOffset: 0,
      confident: true,
      manual: true,
    }
    // Ni en la rama normal ni en la de rejilla manual
    expect(mergeTrackAnalysis({ id: 'x', structure }, analisis).structure).toEqual(structure)
    expect(
      mergeTrackAnalysis({ id: 'x', structure, gridManual: true }, analisis).structure
    ).toEqual(structure)

    // Y aguanta la vuelta completa por IndexedDB
    await storeTrack(pista({ structure }))
    const [recargada] = await loadStoredTracks()
    await storeTrack(mergeTrackAnalysis(recargada, analisis))
    const [final] = await loadStoredTracks()
    expect(final.structure).toEqual(structure)
  })

  it('el ajuste manual sobrevive a guardar, recargar y reanalizar', async () => {
    await storeTrack(pista({ bpm: 87.5, gridAnchor: 0.32, gridManual: true }))
    const [recargada] = await loadStoredTracks()
    expect(recargada).toMatchObject({ bpm: 87.5, gridAnchor: 0.32, gridManual: true })

    const tras = mergeTrackAnalysis(recargada, analisis)
    await storeTrack(tras)
    const [final] = await loadStoredTracks()
    expect(final).toMatchObject({ bpm: 87.5, gridAnchor: 0.32, gridManual: true })
  })
})
