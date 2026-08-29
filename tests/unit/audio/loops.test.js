import { describe, it, expect } from 'vitest'
import {
  AUTO_LOOP_SIZES,
  ROLL_SIZES,
  autoLoop,
  beatSeconds,
  beatsLabel,
  moveLoop,
  nearestBeat,
  previousBeat,
  resizeLoop,
  rollExitTime,
  rollLoop,
  subdivisionStart,
  wrapTime,
} from '../../../src/audio/loops'

// Rejilla de 128 BPM: un beat cada 0,46875 s, empezando en 0,25 s
const BPM = 128
const BEAT = 60 / BPM
const rejilla = (n = 64, anchor = 0.25) =>
  Array.from({ length: n }, (_, i) => anchor + i * BEAT)

const cerca = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)

describe('rejilla', () => {
  it('beatSeconds solo con un BPM válido', () => {
    cerca(beatSeconds(120), 0.5)
    expect(beatSeconds(0)).toBeNull()
    expect(beatSeconds(null)).toBeNull()
  })

  it('nearestBeat imanta al beat más cercano por los dos lados', () => {
    const b = rejilla()
    cerca(nearestBeat(b, 0.25 + BEAT * 3 + 0.01), 0.25 + BEAT * 3)
    cerca(nearestBeat(b, 0.25 + BEAT * 3 - 0.01), 0.25 + BEAT * 3)
    // Empate exacto en la mitad: se queda con el beat anterior (regla fija,
    // para que quantize no dependa del último bit del cálculo)
    cerca(nearestBeat(b, 0.25 + BEAT * 1.5), 0.25 + BEAT)
  })

  it('nearestBeat aguanta los extremos y la falta de rejilla', () => {
    const b = rejilla(8)
    cerca(nearestBeat(b, -5), b[0])
    cerca(nearestBeat(b, 999), b[7])
    expect(nearestBeat([], 3.3)).toBe(3.3)
    expect(nearestBeat(null, 3.3)).toBe(3.3)
  })

  it('previousBeat devuelve el beat que YA ha sonado', () => {
    const b = rejilla()
    cerca(previousBeat(b, 0.25 + BEAT * 2 + 0.4), 0.25 + BEAT * 2)
    // Encima de la marca, esa misma marca (no la anterior)
    cerca(previousBeat(b, 0.25 + BEAT * 2), 0.25 + BEAT * 2)
  })

  it('subdivisionStart cae en la subdivisión que contiene al tiempo', () => {
    // Corcheas (1/2 beat) contadas desde el ancla
    const paso = BEAT / 2
    cerca(subdivisionStart(0.25, paso, 0.25 + paso * 3 + 0.05), 0.25 + paso * 3)
    // Antes del ancla cuenta hacia atrás, no se atasca en ella
    cerca(subdivisionStart(0.25, paso, 0.25 - 0.01), 0.25 - paso)
  })
})

describe('loops automáticos', () => {
  it('empiezan en el beat anterior y duran N beats exactos', () => {
    const beats = rejilla()
    const r = autoLoop({ bpm: BPM, beats, time: 0.25 + BEAT * 5 + 0.2, lengthBeats: 4 })
    cerca(r.start, 0.25 + BEAT * 5)
    cerca(r.end - r.start, 4 * BEAT)
    expect(r.beats).toBe(4)
  })

  it('no se monta si no cabe entero en la pista', () => {
    const beats = rejilla()
    expect(
      autoLoop({ bpm: BPM, beats, time: 9.5, lengthBeats: 32, duration: 10 })
    ).toBeNull()
  })

  it('sin BPM no hay loop automático', () => {
    expect(autoLoop({ bpm: null, beats: [], time: 1, lengthBeats: 4 })).toBeNull()
  })
})

describe('loop roll', () => {
  it('con quantize arranca en la subdivisión de su propio tamaño', () => {
    // Roll de 1/8: la rejilla se parte en ocho por beat
    const paso = BEAT / 8
    const r = rollLoop({
      bpm: BPM,
      gridAnchor: 0.25,
      time: 0.25 + paso * 10 + paso * 0.4,
      lengthBeats: 1 / 8,
      quantize: true,
    })
    cerca(r.start, 0.25 + paso * 10)
    cerca(r.end - r.start, paso)
  })

  it('sin quantize arranca donde esté el playhead', () => {
    const r = rollLoop({
      bpm: BPM,
      gridAnchor: 0.25,
      time: 3.3333,
      lengthBeats: 1,
      quantize: false,
    })
    cerca(r.start, 3.3333)
    cerca(r.end, 3.3333 + BEAT)
  })

  it('cubre los seis tamaños del roll', () => {
    expect(ROLL_SIZES).toEqual([1 / 8, 1 / 4, 1 / 2, 1, 2, 4])
    for (const n of ROLL_SIZES) {
      const r = rollLoop({ bpm: BPM, gridAnchor: 0, time: 10, lengthBeats: n, quantize: true })
      cerca(r.end - r.start, n * BEAT)
    }
  })

  it('al soltar, la reproducción sigue donde estaría sin el roll', () => {
    // Roll de 1 beat: tras 3 vueltas completas la pista "ha perdido" 3 beats,
    // que es justo lo que hay que devolverle.
    const inicio = 10
    const fin = inicio + BEAT
    const dentro = inicio + BEAT * 0.4
    const salida = rollExitTime({ current: dentro, wraps: 3, loopLength: fin - inicio })
    cerca(salida, dentro + 3 * BEAT)
  })

  it('sin ninguna vuelta, se sigue exactamente donde está', () => {
    cerca(rollExitTime({ current: 7.5, wraps: 0, loopLength: BEAT }), 7.5)
  })

  it('la salida nunca se va más allá del final de la pista', () => {
    const salida = rollExitTime({ current: 99, wraps: 40, loopLength: 1, duration: 100 })
    expect(salida).toBeLessThanOrEqual(100)
    cerca(salida, 99.99)
  })
})

describe('mover el loop', () => {
  it('lo desplaza una longitud entera y conserva el tamaño', () => {
    const r = moveLoop({ start: 10, end: 12, dir: 1 })
    expect(r).toEqual({ start: 12, end: 14 })
    const atras = moveLoop({ start: 10, end: 12, dir: -1 })
    expect(atras).toEqual({ start: 8, end: 10 })
  })

  it('ida y vuelta deja el loop donde estaba', () => {
    const ida = moveLoop({ start: 4.2, end: 6.7, dir: 1 })
    const vuelta = moveLoop({ ...ida, dir: -1 })
    cerca(vuelta.start, 4.2)
    cerca(vuelta.end, 6.7)
  })

  it('no se sale de la pista por ninguno de los dos lados', () => {
    expect(moveLoop({ start: 1, end: 3, dir: -1 })).toBeNull()
    expect(moveLoop({ start: 8, end: 10, dir: 1, duration: 11 })).toBeNull()
  })

  it('una región inválida no se mueve', () => {
    expect(moveLoop({ start: 5, end: 5, dir: 1 })).toBeNull()
    expect(moveLoop({ start: 5, end: 3, dir: 1 })).toBeNull()
    expect(moveLoop({ start: 1, end: 2, dir: 0 })).toBeNull()
  })
})

describe('doblar y partir la longitud', () => {
  it('con rejilla, la longitud sigue midiéndose en beats', () => {
    const start = 10
    const doble = resizeLoop({ start, end: start + 4 * BEAT, factor: 2, bpm: BPM, lengthBeats: 4 })
    expect(doble.beats).toBe(8)
    cerca(doble.end - start, 8 * BEAT)

    const mitad = resizeLoop({ start, end: start + 4 * BEAT, factor: 0.5, bpm: BPM, lengthBeats: 4 })
    expect(mitad.beats).toBe(2)
    cerca(mitad.end - start, 2 * BEAT)
  })

  it('el punto de entrada no se mueve', () => {
    const r = resizeLoop({ start: 7.25, end: 7.25 + BEAT, factor: 0.5, bpm: BPM, lengthBeats: 1 })
    expect(r.start).toBe(7.25)
  })

  it('partir ocho veces seguidas se para en el mínimo', () => {
    let loop = { start: 0, end: 4 * BEAT, beats: 4 }
    for (let i = 0; i < 8; i++) {
      const next = resizeLoop({
        start: loop.start,
        end: loop.end,
        factor: 0.5,
        bpm: BPM,
        lengthBeats: loop.beats,
      })
      if (!next) break
      loop = next
    }
    expect(loop.beats).toBe(1 / 32)
    expect(
      resizeLoop({ start: 0, end: BEAT / 32, factor: 0.5, bpm: BPM, lengthBeats: 1 / 32 })
    ).toBeNull()
  })

  it('sin rejilla se trabaja en segundos y hay un mínimo', () => {
    const r = resizeLoop({ start: 1, end: 3, factor: 0.5, bpm: null, lengthBeats: null })
    expect(r).toEqual({ start: 1, end: 2, beats: null })
    expect(
      resizeLoop({ start: 1, end: 1.02, factor: 0.5, bpm: null, lengthBeats: null })
    ).toBeNull()
  })

  it('no crece más allá del final de la pista', () => {
    expect(
      resizeLoop({ start: 8, end: 9, factor: 2, bpm: null, lengthBeats: null, duration: 9.5 })
    ).toBeNull()
  })
})

describe('vuelta del loop', () => {
  it('arrastra el retraso del aviso para no perder la fase', () => {
    // El salto llega 4 ms tarde: se entra 4 ms DENTRO del loop, no en el IN
    const t = wrapTime({ current: 12.004, start: 10, end: 12 })
    cerca(t, 10.004)
  })

  it('un retraso mayor que el propio loop se reparte igual', () => {
    // Loop de 50 ms con un aviso 120 ms tarde: 120 % 50 = 20
    const t = wrapTime({ current: 10.17, start: 10, end: 10.05 })
    cerca(t, 10.02, 1e-9)
  })

  it('sin retraso se entra clavado en el IN', () => {
    expect(wrapTime({ current: 12, start: 10, end: 12 })).toBe(10)
    expect(wrapTime({ current: 11, start: 10, end: 12 })).toBe(10)
  })
})

describe('etiquetas', () => {
  it('las fracciones se leen como fracciones', () => {
    expect(beatsLabel(1 / 8)).toBe('1/8')
    expect(beatsLabel(1 / 32)).toBe('1/32')
    expect(beatsLabel(4)).toBe('4')
    expect(beatsLabel(0)).toBe('—')
  })

  it('los tamaños automáticos son los de la interfaz', () => {
    expect(AUTO_LOOP_SIZES).toEqual([4, 8, 16])
  })
})
