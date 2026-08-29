import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSmoothTime } from '../../../src/lib/smoothTime'

// <audio> de mentira: solo lo que lee el playhead
const media = (over = {}) => ({ currentTime: 0, paused: false, playbackRate: 1, ...over })

let now
beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => vi.restoreAllMocks())

describe('playhead interpolado', () => {
  it('en pausa devuelve el tiempo real tal cual', () => {
    const read = createSmoothTime()
    const el = media({ currentTime: 12.5, paused: true })
    expect(read(el)).toBe(12.5)
    now += 500
    expect(read(el)).toBe(12.5)
  })

  it('avanza entre actualizaciones reales del navegador', () => {
    const read = createSmoothTime()
    const el = media({ currentTime: 10 })
    expect(read(el)).toBeCloseTo(10, 6)

    // El navegador no ha refrescado currentTime, pero han pasado 40 ms
    now += 40
    expect(read(el)).toBeCloseTo(10.04, 3)
  })

  it('sigue el playbackRate (pitch y bend)', () => {
    const read = createSmoothTime()
    const el = media({ currentTime: 10, playbackRate: 1.08 })
    read(el)
    now += 100
    expect(read(el)).toBeCloseTo(10.108, 3)
  })

  it('no se adelanta más de 120 ms aunque el navegador tarde', () => {
    const read = createSmoothTime()
    const el = media({ currentTime: 10 })
    read(el)
    now += 2000
    expect(read(el)).toBeCloseTo(10.12, 6)
  })

  it('nunca retrocede con el goteo normal de currentTime', () => {
    const read = createSmoothTime()
    const el = media({ currentTime: 10 })
    let prev = read(el)
    // currentTime se actualiza a bloques mientras el reloj corre a 60 fps
    for (let frame = 1; frame <= 60; frame++) {
      now += 16
      if (frame % 6 === 0) el.currentTime = 10 + (frame * 16) / 1000
      const out = read(el)
      expect(out).toBeGreaterThanOrEqual(prev)
      prev = out
    }
  })

  it('acepta un salto atrás de verdad (seek o loop)', () => {
    const read = createSmoothTime()
    const el = media({ currentTime: 30 })
    read(el)
    now += 16
    read(el)

    el.currentTime = 5 // el usuario salta al principio
    now += 16
    expect(read(el)).toBeCloseTo(5, 1)

    // …y desde ahí vuelve a avanzar
    now += 32
    expect(read(el)).toBeGreaterThan(5)
  })

  it('un loop corto hacia atrás también se sigue', () => {
    const read = createSmoothTime()
    const el = media({ currentTime: 20 })
    read(el)
    el.currentTime = 19.5 // salida de loop de medio segundo
    now += 16
    expect(read(el)).toBeLessThan(20)
  })

  it('sin elemento devuelve 0', () => {
    expect(createSmoothTime()(null)).toBe(0)
  })
})
