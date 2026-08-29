import { describe, it, expect } from 'vitest'
import { detectTempo, buildBeatGrid } from '../../../src/audio/beatGrid'
import { makeOnsetEnvelope } from '../../helpers/signals'

describe('detectTempo', () => {
  it('saca el BPM de un 4/4 limpio', () => {
    const env = makeOnsetEnvelope({ bpm: 128, seconds: 60, offset: 0.4 })
    const got = detectTempo(env)

    expect(got.bpm).toBeCloseTo(128, 0)
    // El ancla cae en fase con los golpes (tolerancia: un marco, ≈6 ms)
    const interval = 60 / got.bpm
    const phaseError = Math.abs((got.anchor - 0.4 + interval / 2) % interval) - interval / 2
    expect(Math.abs(phaseError)).toBeLessThan(0.012)
    expect(got.confidence).toBeGreaterThan(0.5)
  })

  it('aguanta jitter y ruido de fondo', () => {
    const env = makeOnsetEnvelope({
      bpm: 174,
      seconds: 90,
      offset: 1.2,
      jitterMs: 6,
      noise: 0.12,
    })
    expect(detectTempo(env).bpm).toBeCloseTo(174, 0)
  })

  it('no pliega los tempos rápidos a la mitad (makina a 190)', () => {
    // La librería anterior devolvía 95: el rango se quedaba en 90-180
    const env = makeOnsetEnvelope({ bpm: 190, seconds: 60 })
    expect(detectTempo(env).bpm).toBeCloseTo(190, 0)
  })

  it('el reanálisis guiado se queda cerca del BPM de partida', () => {
    const env = makeOnsetEnvelope({ bpm: 128, seconds: 60, offset: 0.4 })
    const got = detectTempo(env, { seedBpm: 129.5, seedAnchor: 0.4, bpmTolerance: 6 })

    expect(got.bpm).toBeGreaterThan(129.5 * 0.94)
    expect(got.bpm).toBeLessThan(129.5 * 1.06)
    // Y afina hacia el tempo real en vez de dejarlo donde estaba
    expect(Math.abs(got.bpm - 128)).toBeLessThan(Math.abs(129.5 - 128))
  })

  it('el reanálisis guiado deja el ancla en fase con los golpes', () => {
    const env = makeOnsetEnvelope({ bpm: 128, seconds: 60, offset: 0.4 })
    const got = detectTempo(env, { seedBpm: 128, seedAnchor: 12.4 })
    const interval = 60 / got.bpm
    // El ancla vuelve siempre al primer beat (0 <= ancla < un beat): lo que
    // define la rejilla es la fase, no la posición absoluta que tocara el usuario
    expect(got.anchor).toBeGreaterThanOrEqual(0)
    expect(got.anchor).toBeLessThan(interval)
    const phaseError = Math.abs(((got.anchor - 0.4 + interval * 1.5) % interval) - interval / 2)
    expect(phaseError).toBeLessThan(0.012)
  })

  it('devuelve null sin envolvente', () => {
    expect(detectTempo(null)).toBeNull()
    expect(detectTempo({ data: new Float32Array(0), rate: 172 })).toBeNull()
  })
})

describe('buildBeatGrid', () => {
  it('reparte los beats desde el ancla y no se sale de la pista', () => {
    const beats = buildBeatGrid(120, 0.25, 10)
    expect(beats[0]).toBeCloseTo(0.25, 6)
    expect(beats[1] - beats[0]).toBeCloseTo(0.5, 6)
    expect(beats[beats.length - 1]).toBeLessThan(10)
    expect(beats).toHaveLength(20)
  })

  it('mantiene la fase con anclas negativas o mayores que un beat', () => {
    const a = buildBeatGrid(120, 0.25, 10)
    const b = buildBeatGrid(120, 0.25 + 3 * 0.5, 10)
    const c = buildBeatGrid(120, 0.25 - 4 * 0.5, 10)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(a[0]).toBeGreaterThanOrEqual(0)
  })

  it('sin BPM o sin duración no hay rejilla', () => {
    expect(buildBeatGrid(0, 0, 10)).toEqual([])
    expect(buildBeatGrid(120, 0, 0)).toEqual([])
    expect(buildBeatGrid(null, 0, 10)).toEqual([])
  })
})
