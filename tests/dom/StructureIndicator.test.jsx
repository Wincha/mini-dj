import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import StructureIndicator from '../../src/components/StructureIndicator'
import { renderWithI18n, t } from '../helpers/render.jsx'

// Rejilla de 200 beats a medio segundo: 100 s de pista
const beats = Array.from({ length: 200 }, (_, i) => i * 0.5)

// Ritmo, bajón a los 25 s (beat 50) y ritmo otra vez a los 50 s (beat 100)
const estructura = {
  sections: [
    { start: 0, end: 25, kick: true, startBeat: 0, endBeat: 50 },
    { start: 25, end: 50, kick: false, startBeat: 50, endBeat: 100 },
    { start: 50, end: 100, kick: true, startBeat: 100, endBeat: 200 },
  ],
  phraseSize: 16,
  phraseOffset: 0,
  confident: true,
  manual: false,
}

const pintar = (time, props = {}) => {
  const audioRef = { current: { currentTime: time, paused: true, duration: 100 } }
  const utils = renderWithI18n(
    <StructureIndicator
      structure={estructura}
      beats={beats}
      audioRef={audioRef}
      phraseSize={16}
      phraseOffset={0}
      {...props}
    />
  )
  const caja = utils.getByTestId('structure-indicator')
  return { ...utils, caja, texto: caja.textContent.replace(/\s+/g, '') }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('StructureIndicator', () => {
  it('con ritmo, cuenta lo que falta para el bajón y para el siguiente subidón', () => {
    const { texto } = pintar(20) // beat 40: faltan 10 para el bajón y 60 para el ritmo
    expect(texto).toContain('♪')
    expect(texto).toContain('▼10')
    expect(texto).toContain('▲60')
  })

  it('en el bajón, la flecha se da la vuelta', () => {
    const { texto } = pintar(30) // beat 60: el ritmo vuelve en 40
    expect(texto).toContain('○')
    expect(texto).toContain('▲40')
  })

  it('sin más cambios, cuenta los kicks que quedan de pista', () => {
    const { texto, caja } = pintar(80) // beat 160, último beat el 199
    expect(texto).toContain('▪39')
    expect(caja.title).toContain(t('structureTipNoChanges'))
    expect(caja.title).toContain(t('structureTipToEnd', { n: 39 }))
  })

  it('la cuenta se pone roja cuando queda poco', () => {
    const { caja } = pintar(24) // beat 48: quedan 2 para el bajón
    // El número del primer aviso: el segundo hueco de la primera pareja
    const num = caja.querySelectorAll('span')[3]
    expect(num.textContent).toBe('2')
    expect(num.className).toContain('text-red-400')
  })

  it('en compases divide entre cuatro, redondeando hacia arriba', () => {
    const { texto } = pintar(20, { unit: 'bars' })
    expect(texto).toContain('▼3') // 10 kicks = 3 compases empezados
    expect(texto).toContain('/4') // la frase, también en compases
  })

  it('sin estructura fiable no se inventa ningún cambio', () => {
    const { texto } = pintar(20, { structure: { ...estructura, confident: false } })
    expect(texto).not.toContain('▼')
    expect(texto).not.toContain('▲')
    // pero sigue contando la frase y lo que queda de pista
    expect(texto).toContain('▪')
    expect(texto).toContain('/16')
  })

  it('no toca el DOM si la cuenta no ha cambiado', () => {
    const { caja } = pintar(20)
    const antes = caja.innerHTML
    vi.advanceTimersByTime(300)
    expect(caja.innerHTML).toBe(antes)
  })

  it('sin rejilla no pinta nada', () => {
    const { queryByTestId } = renderWithI18n(
      <StructureIndicator structure={estructura} beats={[]} audioRef={{ current: null }} />
    )
    expect(queryByTestId('structure-indicator')).toBeNull()
  })
})
