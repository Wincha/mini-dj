import { describe, it, expect } from 'vitest'
import { LOCALES, DEFAULT_LOCALE } from '../../../src/i18n/locales'
import { LANGUAGES, translate } from '../../../src/i18n/context'

const codes = Object.keys(LOCALES)
const reference = LOCALES[DEFAULT_LOCALE]
const referenceKeys = Object.keys(reference).sort()
// Parámetros de una cadena: "Deck {side}" → ["side"]
const placeholders = (str) =>
  [...String(str).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('traducciones', () => {
  it('el selector de idioma ofrece exactamente los idiomas que existen', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(codes.sort())
    expect(codes).toHaveLength(11)
  })

  it.each(codes)('%s tiene las mismas claves que el inglés', (code) => {
    const keys = Object.keys(LOCALES[code])
    const missing = referenceKeys.filter((k) => !keys.includes(k))
    const extra = keys.filter((k) => !referenceKeys.includes(k))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it.each(codes)('%s conserva los parámetros de cada cadena', (code) => {
    const wrong = []
    for (const key of referenceKeys) {
      const expected = placeholders(reference[key])
      const actual = placeholders(LOCALES[code][key] ?? '')
      if (expected.join() !== actual.join()) wrong.push({ key, expected, actual })
    }
    expect(wrong).toEqual([])
  })

  it.each(codes)('%s no deja ninguna cadena vacía', (code) => {
    const empty = referenceKeys.filter((k) => !String(LOCALES[code][k] ?? '').trim())
    expect(empty).toEqual([])
  })
})

describe('translate', () => {
  it('sustituye los parámetros', () => {
    expect(translate('es', 'deck', { side: 'A' })).toBe('Deck A')
  })

  it('cae al inglés con un idioma desconocido y devuelve la clave si no existe', () => {
    expect(translate('xx', 'bpm')).toBe(LOCALES.en.bpm)
    expect(translate('es', 'clave-que-no-existe')).toBe('clave-que-no-existe')
  })
})
