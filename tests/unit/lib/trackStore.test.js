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
