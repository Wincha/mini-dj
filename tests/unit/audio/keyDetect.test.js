import { describe, it, expect } from 'vitest'
import { detectKey, detectKeyFromChannels } from '../../../src/audio/keyDetect'
import { keyLabel } from '../../../src/lib/camelot'
import { makeAudioBuffer, progression, transpose, NOTE_INDEX } from '../../helpers/signals'

const SR = 44100
// I-IV-V-I y i-iv-V-i: las dos cadencias que fijan tonalidad y modo
const DO_MAYOR = [['C', 'E', 'G'], ['F', 'A', ['C', 5]], ['G', 'B', ['D', 5]], ['C', 'E', 'G']]
const LA_MENOR = [['A', 'C', 'E'], ['D', 'F', 'A'], ['E', 'G#', 'B'], ['A', 'C', 'E']]

const detect = (chords) => detectKeyFromChannels([progression(chords)], SR)

describe('detección de tonalidad', () => {
  it('reconoce una cadencia en Do mayor', () => {
    const key = detect(DO_MAYOR)
    expect(key.pitchClass).toBe(NOTE_INDEX.C)
    expect(key.mode).toBe('maj')
    expect(key.confidence).toBeGreaterThan(0.5)
  })

  it('reconoce el modo menor y no lo confunde con su relativa mayor', () => {
    const key = detect(LA_MENOR)
    expect(key.pitchClass).toBe(NOTE_INDEX.A)
    expect(key.mode).toBe('min')
  })

  it('acierta la tónica en cualquier transporte', () => {
    for (const semitonos of [1, 3, 6, 8, 11]) {
      const key = detect(transpose(DO_MAYOR, semitonos))
      expect({ semitonos, pc: key.pitchClass, mode: key.mode }).toEqual({
        semitonos,
        pc: semitonos % 12,
        mode: 'maj',
      })
    }
  })

  it('enlaza con la rueda Camelot que ve el usuario', () => {
    const key = detect(LA_MENOR)
    expect(keyLabel(key.pitchClass, key.mode)).toBe('Am / 8A')
  })

  it('el chroma suma 1 y tiene doce clases', () => {
    const { chroma } = detect(DO_MAYOR)
    expect(chroma).toHaveLength(12)
    expect(chroma.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })

  it('no se pronuncia sin material suficiente', () => {
    expect(detectKeyFromChannels([], SR)).toBeNull()
    expect(detectKeyFromChannels([new Float32Array(SR)], 0)).toBeNull()
    // Menos de dos marcos de análisis tras el diezmado
    expect(detectKeyFromChannels([new Float32Array(1000)], SR)).toBeNull()
    // Silencio: no hay energía de la que sacar chroma
    expect(detectKeyFromChannels([new Float32Array(SR * 4)], SR)).toBeNull()
  })
})

describe('detectKey sobre un AudioBuffer', () => {
  it('da el mismo resultado que sobre los canales sueltos', () => {
    const señal = progression(DO_MAYOR)
    const buf = makeAudioBuffer([señal, señal], SR)
    expect(detectKey(buf)).toEqual(detectKeyFromChannels([señal, señal], SR))
  })

  it('sin buffer no devuelve nada', () => {
    expect(detectKey(null)).toBeNull()
  })
})
