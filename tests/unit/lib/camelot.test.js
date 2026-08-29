import { describe, it, expect } from 'vitest'
import {
  camelotCode,
  camelotNumber,
  camelotSortIndex,
  harmonicRelation,
  keyLabel,
  keyName,
  NOTE_NAMES,
} from '../../../src/lib/camelot'

const pc = (nota) => NOTE_NAMES.indexOf(nota)
const maj = (nota) => ({ pitchClass: pc(nota), mode: 'maj' })
const min = (nota) => ({ pitchClass: pc(nota), mode: 'min' })

describe('rueda Camelot', () => {
  it('coloca las referencias donde las pone Rekordbox', () => {
    expect(camelotCode(pc('C'), 'maj')).toBe('8B')
    expect(camelotCode(pc('A'), 'min')).toBe('8A')
    expect(camelotCode(pc('G'), 'maj')).toBe('9B')
    expect(camelotCode(pc('F'), 'maj')).toBe('7B')
    expect(camelotCode(pc('D#'), 'min')).toBe('2A')
  })

  it('las mayores avanzan por quintas', () => {
    // Cada quinta ascendente suma uno al número Camelot (con vuelta en 12)
    let esperado = camelotNumber(pc('C'), 'maj')
    for (let i = 1; i <= 12; i++) {
      esperado = (esperado % 12) + 1
      expect(camelotNumber((pc('C') + 7 * i) % 12, 'maj')).toBe(esperado)
    }
  })

  it('cada menor comparte número con su relativa mayor', () => {
    for (let p = 0; p < 12; p++) {
      // La relativa mayor está tres semitonos por encima
      expect(camelotNumber(p, 'min')).toBe(camelotNumber((p + 3) % 12, 'maj'))
    }
  })

  it('normaliza pitch classes fuera de rango', () => {
    expect(camelotNumber(12, 'maj')).toBe(camelotNumber(0, 'maj'))
    expect(camelotNumber(-1, 'maj')).toBe(camelotNumber(11, 'maj'))
  })

  it('los 24 códigos son distintos y cubren la rueda entera', () => {
    const todos = new Set()
    for (let p = 0; p < 12; p++) for (const m of ['maj', 'min']) todos.add(camelotCode(p, m))
    expect(todos.size).toBe(24)
  })
})

describe('nombres para la interfaz', () => {
  it('escribe la tonalidad como se lee en una carátula', () => {
    expect(keyName(pc('A'), 'min')).toBe('Am')
    expect(keyName(pc('C'), 'maj')).toBe('C')
    expect(keyLabel(pc('A'), 'min')).toBe('Am / 8A')
  })

  it('sin tonalidad no inventa nada', () => {
    expect(keyName(null, 'min')).toBeNull()
    expect(camelotCode(3, null)).toBeNull()
    expect(keyLabel(null, null)).toBeNull()
  })

  it('ordena por número y deja las menores antes que las mayores', () => {
    expect(camelotSortIndex(pc('A'), 'min')).toBeLessThan(camelotSortIndex(pc('C'), 'maj'))
    expect(camelotSortIndex(pc('C'), 'maj')).toBeLessThan(camelotSortIndex(pc('G'), 'maj'))
    // Las pistas sin analizar van al final
    expect(camelotSortIndex(null, null)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('compatibilidad armónica', () => {
  it('la misma tonalidad', () => {
    expect(harmonicRelation(min('A'), min('A'))).toBe('same')
  })

  it('la relativa mayor/menor (mismo número, otra letra)', () => {
    expect(harmonicRelation(min('A'), maj('C'))).toBe('compatible')
    expect(harmonicRelation(maj('C'), min('A'))).toBe('compatible')
  })

  it('las vecinas de la rueda, ±1 del mismo tipo', () => {
    expect(harmonicRelation(maj('C'), maj('G'))).toBe('compatible') // 8B ↔ 9B
    expect(harmonicRelation(maj('C'), maj('F'))).toBe('compatible') // 8B ↔ 7B
    expect(harmonicRelation(min('A'), min('E'))).toBe('compatible') // 8A ↔ 9A
  })

  it('la vuelta 12 ↔ 1 también es vecindad', () => {
    const doce = { pitchClass: pc('E'), mode: 'maj' } // 12B
    const uno = { pitchClass: pc('B'), mode: 'maj' } // 1B
    expect(camelotCode(doce.pitchClass, doce.mode)).toBe('12B')
    expect(camelotCode(uno.pitchClass, uno.mode)).toBe('1B')
    expect(harmonicRelation(doce, uno)).toBe('compatible')
  })

  it('lo lejano no se marca como compatible', () => {
    expect(harmonicRelation(maj('C'), maj('D'))).toBeNull() // 8B ↔ 10B
    expect(harmonicRelation(min('A'), maj('G'))).toBeNull() // 8A ↔ 9B
    expect(harmonicRelation(maj('C'), min('C'))).toBeNull() // homónima: 8B ↔ 5A
  })

  it('sin datos no se pronuncia', () => {
    expect(harmonicRelation(null, min('A'))).toBeNull()
    expect(harmonicRelation({ pitchClass: null, mode: 'min' }, min('A'))).toBeNull()
    expect(harmonicRelation(min('A'), { pitchClass: 3, mode: null })).toBeNull()
  })

  it('es simétrica', () => {
    for (let p = 0; p < 12; p++) {
      for (const m of ['maj', 'min']) {
        const a = { pitchClass: p, mode: m }
        const b = min('A')
        expect(harmonicRelation(a, b)).toBe(harmonicRelation(b, a))
      }
    }
  })
})
