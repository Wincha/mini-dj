import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PHRASE_SIZE,
  alignStructure,
  detectStructure,
  fitPhraseOffset,
  kickStrengths,
  nearestBeatIndex,
  refitPhrase,
  sanitizeStructure,
  shiftPhraseOffset,
  structureAt,
} from '../../../src/audio/structure'
import { buildBeatGrid } from '../../../src/audio/beatGrid'
import { makeLowBandEnergy } from '../../helpers/signals'

const BPM = 128
const INTERVAL = 60 / BPM

// Pista de mentira con la estructura que se le pide: `cortes` son los índices
// de beat donde cambia, empezando CON ritmo salvo que se diga lo contrario.
function pista({ cortes, beats = 320, offset = 0, empiezaConRitmo = true, ...extra }) {
  const seconds = offset + beats * INTERVAL + 1
  const hasKick = (b) => {
    let ritmo = empiezaConRitmo
    for (const c of cortes) {
      if (b < c) break
      ritmo = !ritmo
    }
    return ritmo
  }
  const bandLow = makeLowBandEnergy({ bpm: BPM, seconds, offset, hasKick, ...extra })
  const grid = buildBeatGrid(BPM, offset, seconds)
  return { bandLow, duration: seconds, beats: grid }
}

const limites = (st) => st.sections.slice(1).map((s) => s.startBeat)

describe('detectStructure', () => {
  it('encuentra los tramos con y sin ritmo donde están', () => {
    const { bandLow, duration, beats } = pista({ cortes: [64, 128], beats: 256 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })

    expect(st.confident).toBe(true)
    expect(st.sections.map((s) => s.kick)).toEqual([true, false, true])
    // El límite cae en el beat exacto del cambio (±1 por la cola de graves)
    const [drop, rise] = limites(st)
    expect(Math.abs(drop - 64)).toBeLessThanOrEqual(1)
    expect(Math.abs(rise - 128)).toBeLessThanOrEqual(1)
  })

  it('los tramos van en segundos, en fase con la rejilla', () => {
    const { bandLow, duration, beats } = pista({ cortes: [64, 128], beats: 256 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })

    expect(st.sections[0].start).toBe(0)
    expect(st.sections[1].start).toBeCloseTo(beats[st.sections[1].startBeat], 6)
    expect(st.sections.at(-1).end).toBeCloseTo(duration, 6)
  })

  it('no parte la pista por un beat suelto sin bombo', () => {
    // Un solo beat sin kick en mitad del tema no es un cambio de estructura
    const { bandLow, duration, beats } = pista({ cortes: [100, 101], beats: 256 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    expect(st.sections).toHaveLength(1)
    expect(st.confident).toBe(false)
  })

  it('degrada sin inventarse cambios cuando el ritmo no para nunca', () => {
    const { bandLow, duration, beats } = pista({ cortes: [], beats: 256 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    expect(st.sections).toHaveLength(1)
    expect(st.sections[0].kick).toBe(true)
    expect(st.confident).toBe(false)
  })

  it('sin graves con los que trabajar no se inventa nada', () => {
    const duration = 60
    const beats = buildBeatGrid(BPM, 0, duration)
    const st = detectStructure({
      bandLow: new Float32Array(Math.round(duration * 80)),
      duration,
      beats,
      phraseSize: 16,
    })
    expect(st.confident).toBe(false)
    expect(st.sections).toHaveLength(1)
  })

  it('sin rejilla o sin datos devuelve null', () => {
    expect(detectStructure({})).toBeNull()
    expect(detectStructure({ bandLow: new Float32Array(10), duration: 0, beats: [] })).toBeNull()
  })
})

describe('desplazamiento de frase', () => {
  it('encuentra el desplazamiento de una intro corrida', () => {
    // La estructura empieza 4 kicks tarde, como una intro de electrónica
    const { bandLow, duration, beats } = pista({ cortes: [68, 132, 196], beats: 288 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    expect(st.phraseOffset).toBe(4)
    expect(st.detectedOffset).toBe(4)
    expect(st.manual).toBe(false)
  })

  it('con los cambios en la frase de siempre, el desplazamiento es cero', () => {
    const { bandLow, duration, beats } = pista({ cortes: [64, 128, 192], beats: 288 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    expect(st.phraseOffset).toBe(0)
  })

  it('un cambio suelto fuera de sitio no arrastra el encaje', () => {
    // Tres cambios en frase y uno descolocado: gana la mayoría
    expect(fitPhraseOffset([32, 64, 96, 101], 16)).toBe(0)
  })

  it('sin cambios que mirar, no hay desplazamiento', () => {
    expect(fitPhraseOffset([], 16)).toBe(0)
  })

  it('mueve el desplazamiento dando la vuelta por el tamaño', () => {
    expect(shiftPhraseOffset(0, -1, 16)).toBe(15)
    expect(shiftPhraseOffset(15, 1, 16)).toBe(0)
    expect(shiftPhraseOffset(4, 8, 16)).toBe(12)
    expect(shiftPhraseOffset(undefined, 0, 16)).toBe(0)
  })
})

describe('cuenta atrás', () => {
  const escena = () => {
    const { bandLow, duration, beats } = pista({ cortes: [64, 128], beats: 256 })
    const structure = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    return { structure, beats, drop: structure.sections[1].startBeat }
  }

  it('cuenta los kicks que faltan y llega a uno en el último', () => {
    const { structure, beats, drop } = escena()
    const en = (b) => structureAt({ structure, beats, time: beats[b] + 0.01 })

    expect(en(drop - 32).toChange).toBe(32)
    expect(en(drop - 4).toChange).toBe(4)
    expect(en(drop - 1).toChange).toBe(1)
    // Y en el beat del cambio ya estamos en el bajón
    expect(en(drop - 1).inKick).toBe(true)
    expect(en(drop).inKick).toBe(false)
  })

  it('enseña la cadena: el cambio de después del próximo', () => {
    const { structure, beats, drop } = escena()
    const info = structureAt({ structure, beats, time: beats[drop - 8] + 0.01 })
    const rise = structure.sections[2].startBeat
    expect(info.toChange).toBe(8)
    expect(info.toNext).toBe(rise - (drop - 8))
  })

  it('en el bajón cuenta hasta que vuelve el ritmo', () => {
    const { structure, beats } = escena()
    const rise = structure.sections[2].startBeat
    const info = structureAt({ structure, beats, time: beats[rise - 16] + 0.01 })
    expect(info.inKick).toBe(false)
    expect(info.toChange).toBe(16)
  })

  it('en el último tramo no hay más cambios que contar', () => {
    const { structure, beats } = escena()
    const info = structureAt({ structure, beats, time: beats[beats.length - 4] })
    expect(info.toChange).toBeNull()
    expect(info.toNext).toBeNull()
  })

  it('la posición en la frase va de 1 al tamaño y respeta el desplazamiento', () => {
    const beats = buildBeatGrid(BPM, 0, 60)
    const pos = (b, offset) =>
      structureAt({ structure: null, beats, time: beats[b] + 0.01, phraseSize: 16, phraseOffset: offset })
        .phrasePos
    expect(pos(0, 0)).toBe(1)
    expect(pos(15, 0)).toBe(16)
    expect(pos(16, 0)).toBe(1)
    // Con la intro corrida 4, el beat 4 es el primero de la frase
    expect(pos(4, 4)).toBe(1)
    expect(pos(3, 4)).toBe(16)
  })

  it('sin estructura fiable sigue dando la frase pero ningún cambio', () => {
    const { bandLow, duration, beats } = pista({ cortes: [], beats: 256 })
    const structure = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    const info = structureAt({ structure, beats, time: beats[40] })
    expect(info.toChange).toBeNull()
    expect(info.phrasePos).toBe(9) // beat 40 → 40 % 16 = 8, y la cuenta empieza en 1
  })

  it('antes del primer beat cuenta como si ya estuviéramos en él', () => {
    // Al cargar una pista el playhead está en 0 y el ancla más allá: el
    // indicador tiene que decir algo, no quedarse en blanco.
    const info = structureAt({ structure: null, beats: [5, 6, 7], time: 4.9 })
    expect(info.beatIndex).toBe(0)
    expect(info.phrasePos).toBe(1)
  })

  it('sin rejilla o sin tiempo no devuelve nada', () => {
    expect(structureAt({ structure: null, beats: [], time: 10 })).toBeNull()
    expect(structureAt({ structure: null, beats: [5, 6], time: NaN })).toBeNull()
  })
})

describe('el ajuste manual no lo pisa el análisis', () => {
  it('cambiar el tamaño de frase respeta el desplazamiento puesto a mano', () => {
    const { bandLow, duration, beats } = pista({ cortes: [68, 132], beats: 256 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    const aMano = { ...st, phraseOffset: 9, manual: true }

    const conFrase32 = refitPhrase(aMano, 32)
    expect(conFrase32.phraseSize).toBe(32)
    expect(conFrase32.phraseOffset).toBe(9)
    expect(conFrase32.manual).toBe(true)
    // Y el desplazamiento detectado sí se recalcula, para poder volver a él
    expect(conFrase32.detectedOffset).toBe(4)
  })

  it('sin ajuste manual, el tamaño nuevo recoloca la retícula', () => {
    const { bandLow, duration, beats } = pista({ cortes: [68, 132], beats: 256 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    const conFrase8 = refitPhrase(st, 8)
    expect(conFrase8.phraseOffset).toBe(conFrase8.detectedOffset)
    expect(conFrase8.phraseOffset).toBe(4)
  })

  it('el mismo tamaño devuelve el mismo objeto, sin trabajo de más', () => {
    const st = { sections: [{ start: 0, end: 10, kick: true, startBeat: 0, endBeat: 20 }], phraseSize: 16 }
    expect(refitPhrase(st, 16)).toBe(st)
  })

  it('la estructura guardada sobrevive a ir y volver de IndexedDB', () => {
    const { bandLow, duration, beats } = pista({ cortes: [68, 132], beats: 256 })
    const st = { ...detectStructure({ bandLow, duration, beats, phraseSize: 16 }), phraseOffset: 7, manual: true }
    const vuelta = sanitizeStructure(JSON.parse(JSON.stringify(st)))
    expect(vuelta.manual).toBe(true)
    expect(vuelta.phraseOffset).toBe(7)
    expect(vuelta.detectedOffset).toBe(st.detectedOffset)
    expect(vuelta.sections).toHaveLength(st.sections.length)
  })

  it('lo que llegue roto de la base de datos no se usa', () => {
    expect(sanitizeStructure(null)).toBeNull()
    expect(sanitizeStructure({ sections: [] })).toBeNull()
    expect(sanitizeStructure({ sections: [{ start: 5, end: 1 }] })).toBeNull()
    const raro = sanitizeStructure({
      sections: [{ start: 0, end: 10, kick: 1 }],
      phraseSize: 7,
      phraseOffset: 99,
    })
    expect(raro.phraseSize).toBe(DEFAULT_PHRASE_SIZE)
    expect(raro.phraseOffset).toBe(99 % DEFAULT_PHRASE_SIZE)
    expect(raro.sections[0].kick).toBe(true)
  })
})

describe('alignStructure', () => {
  it('recoloca los índices de beat contra la rejilla que haya ahora', () => {
    const { bandLow, duration, beats } = pista({ cortes: [64, 128], beats: 256 })
    const st = detectStructure({ bandLow, duration, beats, phraseSize: 16 })
    const drop = st.sections[1].start

    // La misma rejilla movida medio beat: los tiempos mandan
    const movida = buildBeatGrid(BPM, INTERVAL / 4, duration)
    const alineada = alignStructure(st, movida)
    expect(Math.abs(movida[alineada.sections[1].startBeat] - drop)).toBeLessThanOrEqual(INTERVAL)
    expect(alineada.sections.at(-1).endBeat).toBe(movida.length)
  })

  it('sin rejilla devuelve lo que le llega', () => {
    const st = { sections: [{ start: 0, end: 1, kick: true }] }
    expect(alignStructure(st, [])).toBe(st)
    expect(alignStructure(null, [1, 2])).toBeNull()
  })
})

describe('structureAt: cuenta hasta el final', () => {
  const beats = Array.from({ length: 100 }, (_, i) => i * 0.5)

  it('sin más cambios por delante, cuenta los kicks que quedan de pista', () => {
    const info = structureAt({ structure: null, beats, time: 10, phraseSize: 16 })
    // beat 20 de 100: quedan 79 hasta el último
    expect(info.toChange).toBe(null)
    expect(info.toEnd).toBe(79)
  })

  it('en el último beat ya no cuenta nada', () => {
    const info = structureAt({ structure: null, beats, time: 49.5, phraseSize: 16 })
    expect(info.toEnd).toBe(null)
  })
})

describe('kickStrengths', () => {
  const BPM = 150
  const rate = 80

  it('mide el GOLPE, no el nivel: un bajo sostenido sin ataque no cuenta', () => {
    const conKick = makeLowBandEnergy({ bpm: BPM, seconds: 8, rate })
    // Sin ningún kick: solo queda el bajo de fondo, que no da golpes
    const sinKick = makeLowBandEnergy({ bpm: BPM, seconds: 8, rate, hasKick: () => false })
    const beats = buildBeatGrid(BPM, 0, 8)
    const fuertes = kickStrengths({ bandLow: conKick, rate, beats })
    const flojos = kickStrengths({ bandLow: sinKick, rate, beats })
    const media = (a) => a.reduce((s, v) => s + v, 0) / a.length
    expect(media(fuertes)).toBeGreaterThan(media(flojos) * 5)
  })

  it('devuelve una fuerza por beat de la rejilla', () => {
    const beats = buildBeatGrid(BPM, 0, 8)
    const out = kickStrengths({
      bandLow: makeLowBandEnergy({ bpm: BPM, seconds: 8, rate }),
      rate,
      beats,
    })
    expect(out).toHaveLength(beats.length)
  })

  it('sin datos devuelve un array vacío en vez de reventar', () => {
    expect(kickStrengths({})).toHaveLength(0)
    expect(kickStrengths({ bandLow: new Float32Array(10), rate: 0, beats: [0, 1] })).toHaveLength(2)
  })
})

describe('nearestBeatIndex', () => {
  const beats = [0, 0.5, 1, 1.5, 2]

  it('da el beat que está sonando, no el más cercano por delante', () => {
    expect(nearestBeatIndex(beats, 0.5)).toBe(1)
    expect(nearestBeatIndex(beats, 0.9)).toBe(1)
    expect(nearestBeatIndex(beats, 1.0)).toBe(2)
  })

  it('antes del primer beat y después del último no se sale', () => {
    expect(nearestBeatIndex(beats, -3)).toBeLessThanOrEqual(0)
    expect(nearestBeatIndex(beats, 99)).toBe(beats.length - 1)
  })

  it('sin rejilla devuelve -1', () => {
    expect(nearestBeatIndex([], 1)).toBe(-1)
  })
})
