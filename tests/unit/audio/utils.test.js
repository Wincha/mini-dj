import { describe, it, expect } from 'vitest'
import {
  analyzeTrackLoudness,
  analyzeWaveform,
  computeAutoGainDb,
  AUTO_GAIN_MIN_DB,
  AUTO_GAIN_MAX_DB,
  AUTO_GAIN_PEAK_CEILING_DB,
} from '../../../src/audio/utils'
import { makeAudioBuffer, sine } from '../../helpers/signals'

const SR = 44100
// dBFS del valor eficaz de un seno de amplitud `amp`
const rmsDbOfSine = (amp) => 20 * Math.log10(amp / Math.SQRT2)

describe('analyzeTrackLoudness', () => {
  it('mide el nivel eficaz de un tono de amplitud conocida', () => {
    const buf = makeAudioBuffer([sine({ seconds: 4, amp: 0.5 })], SR)
    const { db, rms } = analyzeTrackLoudness(buf)
    expect(db).toBeCloseTo(rmsDbOfSine(0.5), 1)
    expect(rms).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  it('la mediana ignora los silencios en vez de promediarlos', () => {
    // Mitad silencio, mitad tono: el nivel de la pista es el del tono
    const tono = sine({ seconds: 4, amp: 0.5 })
    const señal = new Float32Array(tono.length * 2)
    señal.set(tono, tono.length)
    const { db } = analyzeTrackLoudness(makeAudioBuffer([señal], SR))
    expect(db).toBeCloseTo(rmsDbOfSine(0.5), 1)
  })

  it('el percentil 90 apunta a la parte fuerte, la mediana al cuerpo del tema', () => {
    // 80 % flojo (intro) + 20 % fuerte (drop)
    const flojo = sine({ seconds: 8, amp: 0.1 })
    const fuerte = sine({ seconds: 2, amp: 0.8 })
    const señal = new Float32Array(flojo.length + fuerte.length)
    señal.set(flojo)
    señal.set(fuerte, flojo.length)

    const { db, loudDb } = analyzeTrackLoudness(makeAudioBuffer([señal], SR))
    expect(db).toBeCloseTo(rmsDbOfSine(0.1), 1)
    expect(loudDb).toBeCloseTo(rmsDbOfSine(0.8), 1)
    expect(loudDb).toBeGreaterThan(db)
  })

  it('mezcla los dos canales a mono', () => {
    const izq = sine({ seconds: 4, amp: 0.5 })
    const mono = analyzeTrackLoudness(makeAudioBuffer([izq], SR))
    const estereo = analyzeTrackLoudness(makeAudioBuffer([izq, izq], SR))
    expect(estereo.db).toBeCloseTo(mono.db, 6)

    // Canales en oposición de fase: la suma mono se cancela
    const der = izq.map((v) => -v)
    const anulado = analyzeTrackLoudness(makeAudioBuffer([izq, der], SR))
    expect(anulado.db).toBe(-Infinity)
    expect(anulado.rms).toBe(0)
  })

  it('una pista en silencio no revienta', () => {
    const buf = makeAudioBuffer([new Float32Array(SR)], SR)
    expect(analyzeTrackLoudness(buf)).toEqual({ rms: 0, db: -Infinity })
  })
})

describe('analyzeWaveform', () => {
  const buf = () => makeAudioBuffer([sine({ seconds: 10, amp: 0.6 })], SR)

  it('devuelve una envolvente normalizada y la duración', () => {
    const { waveData, duration } = analyzeWaveform(buf())
    expect(duration).toBeCloseTo(10, 6)
    expect(waveData.length).toBeGreaterThan(0)
    expect(Math.max(...waveData)).toBeCloseTo(1, 6)
    expect(Math.min(...waveData)).toBeGreaterThanOrEqual(0)
  })

  it('el pico es el de la muestra cruda, no el de la envolvente dibujada', () => {
    // Un transitorio corto casi no levanta la envolvente, pero es el que
    // manda en el techo del auto-gain
    const señal = sine({ seconds: 10, amp: 0.2 })
    señal[SR * 5] = 0.97
    const { peak, waveData } = analyzeWaveform(makeAudioBuffer([señal], SR))
    expect(peak).toBeCloseTo(0.97, 6)
    expect(Math.max(...waveData)).toBeCloseTo(1, 6) // normalizada aparte
  })

  it('mira el pico de los DOS canales', () => {
    const izq = sine({ seconds: 4, amp: 0.3 })
    const der = sine({ seconds: 4, amp: 0.9 })
    expect(analyzeWaveform(makeAudioBuffer([izq, der], SR)).peak).toBeCloseTo(0.9, 2)
  })

  it('con bandas da un color por muestra; sin ellas, ninguno', () => {
    const conBandas = analyzeWaveform(buf())
    expect(conBandas.bandIndex).toHaveLength(conBandas.waveData.length)

    const sinBandas = analyzeWaveform(buf(), { withBands: false })
    expect(sinBandas.bandIndex).toBeNull()
  })
})

describe('auto-gain por pista', () => {
  it('sube una pista floja hasta el objetivo', () => {
    // -16 dB de nivel: le faltan 4 dB para el objetivo de -12, y los picos
    // tienen sitio de sobra
    expect(computeAutoGainDb({ loudDb: -16, peak: 0.1 })).toBeCloseTo(4, 6)
  })

  it('baja una pista pasada de vueltas', () => {
    expect(computeAutoGainDb({ loudDb: -6, peak: 1 })).toBeCloseTo(-6, 6)
  })

  it('el techo de -1 dBFS manda sobre lo que pida el RMS (regresión: distorsión)', () => {
    // Master muy comprimido: RMS bajo, picos pegados al techo. Sin el tope,
    // el auto-gain pedía +6 dB y la pista distorsionaba.
    const gain = computeAutoGainDb({ loudDb: -18, peak: 0.99 })
    expect(gain).toBeLessThan(6)
    expect(20 * Math.log10(0.99) + gain).toBeCloseTo(AUTO_GAIN_PEAK_CEILING_DB, 6)
  })

  it('ninguna combinación deja los picos por encima de -1 dBFS', () => {
    for (const loudDb of [-30, -24, -18, -12, -6, -3]) {
      for (const peak of [0.05, 0.2, 0.5, 0.8, 0.95, 1]) {
        const gain = computeAutoGainDb({ loudDb, peak })
        const peakDb = 20 * Math.log10(peak) + gain
        expect(peakDb).toBeLessThanOrEqual(AUTO_GAIN_PEAK_CEILING_DB + 1e-9)
      }
    }
  })

  it('se queda dentro de los límites de ±dB', () => {
    expect(computeAutoGainDb({ loudDb: -90, peak: 0.001 })).toBe(AUTO_GAIN_MAX_DB)
    expect(computeAutoGainDb({ loudDb: 0, peak: 1 })).toBe(AUTO_GAIN_MIN_DB)
  })

  it('es determinista: la misma pista siempre da la misma ganancia', () => {
    // El nivelado dinámico bombeaba el volumen a mitad de tema; ahora la
    // ganancia se calcula una vez y no depende de nada más
    const args = { loudDb: -15.3, peak: 0.72 }
    const primera = computeAutoGainDb(args)
    for (let i = 0; i < 5; i++) expect(computeAutoGainDb(args)).toBe(primera)
  })

  it('con una pista en silencio no aplica ganancia', () => {
    // analyzeTrackLoudness no devuelve loudDb cuando todo es silencio
    expect(computeAutoGainDb({ loudDb: undefined, peak: 0 })).toBe(0)
    expect(computeAutoGainDb({ loudDb: -Infinity, peak: 0 })).toBe(0)
  })
})
