import { describe, it, expect } from 'vitest'
import {
  dbToFraction,
  colorForDb,
  createLevelMeter,
  METER_MIN_DB,
  METER_MAX_DB,
  METER_COLORS,
  ZONE_AMBER_DB,
  ZONE_RED_DB,
} from '../../../src/audio/levelMeter'
import { FakeAudioContext } from '../../helpers/fakeAudio'

describe('dB → fracción del medidor', () => {
  it('la escala es lineal en dB, como los LED de una mesa', () => {
    expect(dbToFraction(METER_MAX_DB)).toBe(1)
    expect(dbToFraction(METER_MIN_DB)).toBe(0)
    expect(dbToFraction(METER_MIN_DB / 2)).toBeCloseTo(0.5, 6)
    // Los mismos dB ocupan lo mismo en cualquier punto del recorrido
    const paso = dbToFraction(-6) - dbToFraction(-12)
    expect(dbToFraction(-24) - dbToFraction(-30)).toBeCloseTo(paso, 6)
  })

  it('recorta fuera de la escala', () => {
    expect(dbToFraction(12)).toBe(1)
    expect(dbToFraction(-120)).toBe(0)
    expect(dbToFraction(-Infinity)).toBe(0)
  })
})

describe('zonas de color', () => {
  it('verde, ámbar y rojo pegado al techo', () => {
    expect(colorForDb(-30)).toBe(METER_COLORS.green)
    expect(colorForDb(ZONE_AMBER_DB - 0.1)).toBe(METER_COLORS.green)
    expect(colorForDb(ZONE_AMBER_DB)).toBe(METER_COLORS.amber)
    expect(colorForDb(ZONE_RED_DB - 0.1)).toBe(METER_COLORS.amber)
    expect(colorForDb(ZONE_RED_DB)).toBe(METER_COLORS.red)
    expect(colorForDb(0)).toBe(METER_COLORS.red)
  })
})

describe('balística del medidor', () => {
  // El reloj del medidor es performance.now(): nunca arranca en 0, así que
  // los tests miden desde un instante cualquiera y cuentan en milisegundos
  // desde ahí.
  const T0 = 1000
  const meter = () => {
    const analyser = new FakeAudioContext().createAnalyser()
    analyser.fftSize = 64
    const read = createLevelMeter(analyser)
    return {
      analyser,
      read: (ms) => read(T0 + ms),
      set: (a) => analyser.setSignal([a, -a]),
    }
  }

  it('sube al instante con el pico de la señal', () => {
    const m = meter()
    m.set(0.5) // -6,02 dBFS
    const { db } = m.read(0)
    expect(db).toBeCloseTo(-6.02, 1)
  })

  it('baja a ritmo constante, no de golpe', () => {
    const m = meter()
    m.set(1)
    expect(m.read(0).db).toBeCloseTo(0, 2)

    m.set(0.00001) // prácticamente silencio
    // 20 dB/s: cada lectura baja lo que le toca al tiempo transcurrido
    expect(m.read(100).db).toBeCloseTo(-2, 1)
    expect(m.read(300).db).toBeCloseTo(-6, 1)
    expect(m.read(500).db).toBeCloseTo(-10, 1)
  })

  it('el testigo de pico se queda arriba y luego cae más despacio que la barra', () => {
    const m = meter()
    m.set(1)
    m.read(0)
    m.set(0.001)
    const tras200 = m.read(200)
    expect(tras200.db).toBeCloseTo(-4, 1) // la barra ya baja
    expect(tras200.peakDb).toBeCloseTo(0, 2) // el testigo sigue retenido

    // Pasado el tiempo de retención (1,2 s) el testigo cae, y más despacio
    const trasSoltar = m.read(1400)
    expect(trasSoltar.peakDb).toBeLessThan(0)
    expect(trasSoltar.peakDb).toBeGreaterThan(trasSoltar.db)
  })

  it('el testigo nunca queda por debajo de la barra', () => {
    const m = meter()
    let t = 0
    for (const amp of [1, 0.01, 0.5, 0.02, 0.9, 0.001, 0.3]) {
      m.set(amp)
      for (let i = 0; i < 10; i++) {
        t += 33
        const { db, peakDb } = m.read(t)
        expect(peakDb).toBeGreaterThanOrEqual(db - 1e-9)
      }
    }
  })

  it('avisa de saturación y mantiene el aviso un rato', () => {
    const m = meter()
    m.set(0.9)
    expect(m.read(0).clip).toBe(false)

    m.set(0.999) // ≈ -0,009 dBFS: recorte
    expect(m.read(33).clip).toBe(true)

    m.set(0.1)
    expect(m.read(1000).clip).toBe(true) // sigue avisando
    expect(m.read(1600).clip).toBe(false) // y se apaga solo
  })

  it('con la pestaña dormida no se desploma la barra', () => {
    const m = meter()
    m.set(1)
    m.read(0)
    m.set(0.001)
    // Un salto de 10 s se trata como 250 ms: 20 dB/s → -5 dB, no -200
    expect(m.read(10000).db).toBeCloseTo(-5, 1)
  })

  it('el silencio absoluto se queda en el mínimo de la escala', () => {
    const m = meter()
    m.set(0)
    const { db, peakDb } = m.read(0)
    expect(db).toBe(METER_MIN_DB)
    expect(peakDb).toBe(METER_MIN_DB)
  })
})
