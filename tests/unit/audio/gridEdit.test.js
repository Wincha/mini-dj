import { describe, it, expect } from 'vitest'
import {
  buildBeatGrid,
  nudgeAnchor,
  stretchBpm,
  scaleBpm,
  GRID_BPM_MIN,
  GRID_BPM_MAX,
} from '../../../src/audio/beatGrid'

describe('mover el ancla', () => {
  it('desplaza la rejilla entera sin tocar el BPM', () => {
    const anchor = nudgeAnchor(0.5, 0.01)
    expect(anchor).toBeCloseTo(0.51, 9)

    const antes = buildBeatGrid(120, 0.5, 6)
    const despues = buildBeatGrid(120, anchor, 6)
    expect(despues).toHaveLength(antes.length)
    despues.forEach((t, i) => expect(t - antes[i]).toBeCloseTo(0.01, 9))
  })

  it('acepta desplazamientos negativos y un ancla sin definir', () => {
    expect(nudgeAnchor(0.5, -0.001)).toBeCloseTo(0.499, 9)
    expect(nudgeAnchor(null, 0.01)).toBeCloseTo(0.01, 9)
    expect(nudgeAnchor(undefined, -0.01)).toBeCloseTo(-0.01, 9)
  })
})

describe('estirar y encoger el espaciado', () => {
  it('suma el incremento y redondea a dos decimales', () => {
    expect(stretchBpm(128, 0.1)).toBe(128.1)
    expect(stretchBpm(128, -0.1)).toBe(127.9)
    expect(stretchBpm(128.004, 0.01)).toBe(128.01)
  })

  it('el beat del ancla no se mueve: la rejilla pivota sobre él', () => {
    const anchor = 1.25
    const antes = buildBeatGrid(120, anchor, 30)
    const despues = buildBeatGrid(stretchBpm(120, 0.1), anchor, 30)
    // Mismo beat en el ancla…
    expect(antes).toContain(anchor)
    expect(despues).toContain(anchor)
    // …y a partir de ahí los beats se juntan
    const i = antes.indexOf(anchor)
    expect(despues[i + 4]).toBeLessThan(antes[i + 4])
  })

  it('no se sale del rango permitido', () => {
    expect(stretchBpm(GRID_BPM_MAX, 10)).toBe(GRID_BPM_MAX)
    expect(stretchBpm(GRID_BPM_MIN, -10)).toBe(GRID_BPM_MIN)
  })

  it('sin BPM no hace nada', () => {
    expect(stretchBpm(null, 0.1)).toBeNull()
    expect(stretchBpm(0, 0.1)).toBeNull()
  })
})

describe('×2 y ÷2', () => {
  it('dobla y parte el tempo', () => {
    expect(scaleBpm(87.5, 2)).toBe(175)
    expect(scaleBpm(175, 0.5)).toBe(87.5)
  })

  it('÷2 seguido de ×2 devuelve EXACTAMENTE el BPM de partida', () => {
    // Sin redondeos por el camino: un 128,37 que vuelve como 128,36 desalinea
    // la rejilla al final de la pista
    const bpm = 128.37
    expect(scaleBpm(scaleBpm(bpm, 0.5), 2)).toBe(bpm)
  })

  it('mantiene el ancla, así que la rejilla sigue cuadrada donde ya lo estaba', () => {
    const anchor = 0.4
    const simple = buildBeatGrid(128, anchor, 20)
    const doble = buildBeatGrid(scaleBpm(128, 2), anchor, 20)
    // Cada beat del original sigue siendo beat con el tempo doblado
    for (const t of simple) {
      expect(doble.some((d) => Math.abs(d - t) < 1e-9)).toBe(true)
    }
    expect(doble.length).toBeGreaterThan(simple.length * 1.9)
  })

  it('fuera de rango no cambia nada', () => {
    expect(scaleBpm(30, 0.5)).toBeNull() // 15 < 20
    expect(scaleBpm(220, 2)).toBeNull() // 440 > 400
    expect(scaleBpm(null, 2)).toBeNull()
  })
})
