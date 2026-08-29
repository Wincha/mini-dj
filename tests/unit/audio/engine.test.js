import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AudioEngine } from '../../../src/audio/engine'
import { installFakeAudio, pathExists, targetsOf } from '../../helpers/fakeAudio'

let engine
let fake

beforeEach(() => {
  fake = installFakeAudio()
  engine = new AudioEngine()
})

afterEach(() => {
  fake.restore()
})

describe('crossfader dipless', () => {
  const gains = (x) => {
    engine.setCrossfader(x)
    return { a: engine.deckA.xfGain.gain.value, b: engine.deckB.xfGain.gain.value }
  }

  it('en los extremos deja pasar un solo deck', () => {
    expect(gains(0).a).toBeCloseTo(1, 6)
    expect(gains(0).b).toBeCloseTo(0, 6)
    expect(gains(1).a).toBeCloseTo(0, 6)
    expect(gains(1).b).toBeCloseTo(1, 6)
  })

  it('en el centro los dos van a tope (sin bajón de volumen al mezclar)', () => {
    const { a, b } = gains(0.5)
    expect(a).toBeCloseTo(1, 6)
    expect(b).toBeCloseTo(1, 6)
  })

  it('al salir del centro solo BAJA el canal contrario, nunca sube el propio', () => {
    let prevA = gains(0.5).a
    let prevB = gains(0.5).b
    for (let x = 0.5; x <= 1.0001; x += 0.05) {
      const { a, b } = gains(x)
      // Hacia B: A se atenúa y B se queda donde estaba (a tope)
      expect(a).toBeLessThanOrEqual(prevA + 1e-9)
      expect(b).toBeCloseTo(1, 6)
      expect(b).toBeLessThanOrEqual(prevB + 1e-9)
      prevA = a
      prevB = b
    }
    prevA = gains(0.5).a
    prevB = gains(0.5).b
    for (let x = 0.5; x >= -0.0001; x -= 0.05) {
      const { a, b } = gains(x)
      expect(b).toBeLessThanOrEqual(prevB + 1e-9)
      expect(a).toBeCloseTo(1, 6)
      prevA = a
      prevB = b
    }
  })
})

describe('filtro DJ por deck', () => {
  it('en el centro es transparente', () => {
    engine.setDeckFilter('A', 0.02)
    expect(engine.deckA.filter.type).toBe('peaking')
    expect(engine.deckA.filter.gain.value).toBe(0)
  })

  it('a la izquierda es paso bajo y a la derecha paso alto', () => {
    engine.setDeckFilter('A', -1)
    expect(engine.deckA.filter.type).toBe('lowpass')
    expect(engine.deckA.filter.frequency.value).toBeCloseTo(80, 0)

    engine.setDeckFilter('A', 1)
    expect(engine.deckA.filter.type).toBe('highpass')
    expect(engine.deckA.filter.frequency.value).toBeCloseTo(8000, 0)
  })

  it('cuanto más se gira, más cierra', () => {
    const freqAt = (v) => {
      engine.setDeckFilter('B', v)
      return engine.deckB.filter.frequency.value
    }
    expect(freqAt(-0.3)).toBeGreaterThan(freqAt(-0.7))
    expect(freqAt(0.7)).toBeGreaterThan(freqAt(0.3))
  })
})

describe('ruteo', () => {
  it('el PFL sale post-EQ y PRE-fader', () => {
    const { filter, preGain, cueGain } = engine.deckA
    // El envío a auriculares cuelga del filtro (final del bloque de EQ)…
    expect(targetsOf(fake.ctx, filter)).toContain(cueGain)
    // …y no del fader del canal: bajar el volumen no puede callar el PFL
    expect(pathExists(fake.ctx, preGain, cueGain)).toBe(false)
    expect(pathExists(fake.ctx, cueGain, engine.cueDest)).toBe(true)
  })

  it('el VU del canal mide en el mismo punto que el PFL', () => {
    expect(targetsOf(fake.ctx, engine.deckA.filter)).toContain(engine.deckA.meter)
    expect(engine.getMeterAnalyser('A')).toBe(engine.deckA.meter)
    expect(engine.getMeterAnalyser('B')).toBe(engine.deckB.meter)
  })

  it('el VU del master mide DESPUÉS del limitador', () => {
    expect(targetsOf(fake.ctx, engine.limiter)).toContain(engine.masterMeter)
    expect(engine.getMeterAnalyser('master')).toBe(engine.masterMeter)
  })

  it('el analizador que realimenta al AGC cuelga ANTES del trim', () => {
    // Si midiera su propia salida, el lazo del auto-nivel se cerraría sobre sí mismo
    expect(targetsOf(fake.ctx, engine.masterGain)).toContain(engine.mixAnalyser)
    expect(pathExists(fake.ctx, engine.masterTrim, engine.mixAnalyser)).toBe(false)
  })

  it('cada deck llega a la salida pasando por EQ, fader y crossfader', () => {
    for (const deck of [engine.deckA, engine.deckB]) {
      expect(targetsOf(fake.ctx, deck.eqPreGain)).toContain(deck.low)
      expect(targetsOf(fake.ctx, deck.high)).toContain(deck.filter)
      expect(targetsOf(fake.ctx, deck.filter)).toContain(deck.preGain)
      expect(targetsOf(fake.ctx, deck.preGain)).toContain(deck.xfGain)
      expect(pathExists(fake.ctx, deck.xfGain, fake.ctx.destination)).toBe(true)
    }
  })
})

describe('EQ', () => {
  it('el kill de una banda la manda al mínimo y respeta el resto', () => {
    engine.setDeckEQ('A', { gain: 0, low: -26, mid: 0, high: 3 })
    expect(engine.deckA.low.gain.value).toBe(-26)
    expect(engine.deckA.mid.gain.value).toBe(0)
    expect(engine.deckA.high.gain.value).toBe(3)
  })

  it('con refuerzos grandes recorta el pre-gain para no saturar', () => {
    engine.setDeckEQ('A', { gain: 0, low: 0, mid: 0, high: 0 })
    const flat = engine.deckA.eqPreGain.gain.value
    engine.setDeckEQ('A', { gain: 0, low: 8, mid: 8, high: 8 })
    expect(engine.deckA.eqPreGain.gain.value).toBeLessThan(flat)
  })

  it('los cortes no disparan el auto-trim', () => {
    engine.setDeckEQ('A', { gain: 0, low: -26, mid: -26, high: -26 })
    expect(engine.deckA.eqPreGain.gain.value).toBeCloseTo(1, 6)
  })
})

describe('auto-nivel del master (AGC)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('desactivarlo para de verdad el lazo', () => {
    engine.setMasterAutoLevel(true, { tickMs: 50 })
    expect(vi.getTimerCount()).toBe(1)

    engine.setMasterAutoLevel(false)
    expect(vi.getTimerCount()).toBe(0)
    const congelada = engine.masterTrim.gain.value
    vi.advanceTimersByTime(1000)
    expect(engine.masterTrim.gain.value).toBe(congelada)
  })

  it('activarlo dos veces no deja dos temporizadores (StrictMode)', () => {
    engine.setMasterAutoLevel(true, { tickMs: 50 })
    engine.setMasterAutoLevel(true, { tickMs: 50 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('en silencio no sube la ganancia', () => {
    engine.mixAnalyser.setSignal([0, 0, 0, 0])
    engine.setMasterAutoLevel(true, { tickMs: 50 })
    vi.advanceTimersByTime(500)
    // Sin señal solo hay una deriva mínima hacia 1, nunca un refuerzo
    expect(engine.masterTrim.gain.value).toBeLessThanOrEqual(1.02)
  })

  it('se mantiene dentro de los topes de ganancia', () => {
    // Mix muy flojo: pide subir, pero no más allá de maxGain
    engine.mixAnalyser.setSignal([0.005, -0.005])
    engine.setMasterAutoLevel(true, { tickMs: 50, maxGain: 1.4 })
    vi.advanceTimersByTime(20000)
    expect(engine.masterTrim.gain.value).toBeLessThanOrEqual(1.4)

    // Y mix muy alto: baja, pero no por debajo de minGain
    engine.mixAnalyser.setSignal([1, -1])
    vi.advanceTimersByTime(60000)
    expect(engine.masterTrim.gain.value).toBeGreaterThanOrEqual(0.05)
  })
})
