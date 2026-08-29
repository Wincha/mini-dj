import { describe, it, expect } from 'vitest'
import { CUE_NAME_MAX, MAX_HOT_CUES, MAX_SAVED_LOOPS } from '../../../src/lib/constants'
import {
  emptyHotCues,
  hotCuesToSlots,
  nextLoopId,
  sameCueData,
  sanitizeHotCues,
  sanitizeLoopRegion,
  sanitizeName,
  sanitizeSavedLoops,
  slotsToHotCues,
} from '../../../src/lib/cuePoints'

describe('etiquetas de cues y loops', () => {
  it('se limpian y se acortan', () => {
    expect(sanitizeName('  drop  ')).toBe('drop')
    expect(sanitizeName('voz\n  principal')).toBe('voz princi'.slice(0, CUE_NAME_MAX))
    expect(sanitizeName('x'.repeat(50))).toHaveLength(CUE_NAME_MAX)
  })

  it('lo que no es texto no es un nombre', () => {
    expect(sanitizeName(null)).toBe('')
    expect(sanitizeName(42)).toBe('')
    expect(sanitizeName(undefined)).toBe('')
  })
})

describe('hot cues: forma compacta en disco, ranuras en el deck', () => {
  it('ocho ranuras vacías de partida', () => {
    expect(emptyHotCues()).toHaveLength(MAX_HOT_CUES)
    expect(emptyHotCues().every((c) => c === null)).toBe(true)
  })

  it('solo se guarda lo que el usuario ha puesto', () => {
    const slots = emptyHotCues()
    slots[0] = { t: 12.5, name: 'drop' }
    slots[5] = { t: 90, name: '' }

    const compacto = slotsToHotCues(slots)
    expect(compacto).toEqual([
      { i: 0, t: 12.5, name: 'drop' },
      { i: 5, t: 90, name: '' },
    ])
  })

  it('ida y vuelta: guardar y volver a repartir en ranuras', () => {
    const slots = emptyHotCues()
    slots[2] = { t: 4, name: 'break' }
    slots[7] = { t: 8, name: '' }
    expect(hotCuesToSlots(slotsToHotCues(slots))).toEqual(slots)
  })

  it('descarta ranuras y tiempos imposibles', () => {
    const sucio = [
      { i: 0, t: 1, name: 'ok' },
      { i: -1, t: 2 },
      { i: 99, t: 3 },
      { i: 1, t: -5 },
      { i: 2, t: NaN },
      null,
      'basura',
    ]
    expect(sanitizeHotCues(sucio)).toEqual([{ i: 0, t: 1, name: 'ok' }])
  })

  it('con dos cues en la misma ranura se queda el último y salen ordenados', () => {
    const out = sanitizeHotCues([
      { i: 3, t: 30 },
      { i: 1, t: 10 },
      { i: 3, t: 33 },
    ])
    expect(out.map((c) => [c.i, c.t])).toEqual([
      [1, 10],
      [3, 33],
    ])
  })

  it('lo que no es una lista se lee como "sin cues"', () => {
    expect(sanitizeHotCues(undefined)).toEqual([])
    expect(hotCuesToSlots(null)).toEqual(emptyHotCues())
  })
})

describe('loops guardados', () => {
  const loop = (over = {}) => ({ id: 'loop-1', start: 10, end: 12, name: 'coro', ...over })

  it('acepta los válidos y pone id a los que no lo traen', () => {
    const out = sanitizeSavedLoops([{ start: 1, end: 2, name: 'a' }, loop()])
    expect(out).toHaveLength(2)
    expect(out[0].id).toBeTruthy()
    expect(out[1]).toMatchObject({ id: 'loop-1', start: 10, end: 12, name: 'coro' })
    expect(new Set(out.map((l) => l.id)).size).toBe(2)
  })

  it('tira los que no son una región', () => {
    expect(
      sanitizeSavedLoops([
        loop({ end: 10 }), // fin igual al inicio
        loop({ end: 5 }), // fin antes del inicio
        loop({ start: -1 }),
        loop({ start: 'x' }),
        null,
      ])
    ).toEqual([])
  })

  it('respeta el tope de loops por pista', () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ start: i, end: i + 1 }))
    expect(sanitizeSavedLoops(muchos)).toHaveLength(MAX_SAVED_LOOPS)
  })

  it('la longitud en beats se conserva cuando se sabe', () => {
    expect(sanitizeLoopRegion({ start: 0, end: 2, beats: 4 })).toEqual({
      start: 0,
      end: 2,
      beats: 4,
    })
    // Sin longitud fiable, null: las cuentas irán en segundos
    expect(sanitizeLoopRegion({ start: 0, end: 2 }).beats).toBeNull()
    expect(sanitizeLoopRegion({ start: 0, end: 2, beats: -3 }).beats).toBeNull()
  })

  it('una región inválida es null', () => {
    expect(sanitizeLoopRegion(null)).toBeNull()
    expect(sanitizeLoopRegion({ start: 5, end: 5 })).toBeNull()
  })

  it('nextLoopId no repite identificadores', () => {
    const existentes = [{ id: 'loop-1' }, { id: 'loop-2' }]
    expect(existentes.map((l) => l.id)).not.toContain(nextLoopId(existentes))
  })
})

describe('comparación para no escribir de más', () => {
  it('dos listas iguales no cuentan como cambio', () => {
    expect(sameCueData([{ i: 0, t: 1, name: '' }], [{ i: 0, t: 1, name: '' }])).toBe(true)
    expect(sameCueData(null, undefined)).toBe(true)
  })

  it('cualquier diferencia sí cuenta', () => {
    expect(sameCueData([{ i: 0, t: 1, name: '' }], [{ i: 0, t: 2, name: '' }])).toBe(false)
    expect(sameCueData([], null)).toBe(false)
  })
})
