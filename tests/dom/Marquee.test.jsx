import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Marquee from '../../src/components/Marquee'

// jsdom no mide texto: se falsean los anchos para poder decidir si cabe
const medidas = (contenedor, contenido) => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => contenedor,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    // Quieto solo hay una copia: lo que se sale es lo que mide el texto
    get: () => contenido,
  })
}

const pintar = (props = {}) => {
  const { container } = render(<Marquee text="Un titulazo larguísimo" {...props} />)
  return container
}

afterEach(() => {
  delete HTMLElement.prototype.clientWidth
  delete HTMLElement.prototype.scrollWidth
})

describe('Marquee', () => {
  it('si el texto cabe, se queda quieto', () => {
    medidas(500, 200)
    const c = pintar()
    const inner = c.firstChild.firstChild
    expect(inner.style.animation).toBe('')
    expect(inner.className).toContain('truncate')
  })

  it('si no cabe, se desliza en bucle con dos copias', () => {
    medidas(100, 400)
    const c = pintar({ speed: 40 })
    const inner = c.firstChild.firstChild
    // Una vuelta son los 400 px del texto más los 30 del hueco entre copias,
    // a 40 px/s
    expect(inner.style.animation).toBe('minidj-marquee 10.75s linear infinite')
    expect(screen.getAllByText('Un titulazo larguísimo')).toHaveLength(2)
  })

  it('la velocidad manda: más lenta, más segundos por vuelta', () => {
    medidas(100, 400)
    const c = pintar({ speed: 10 })
    expect(c.firstChild.firstChild.style.animation).toContain('43s')
  })

  it('a velocidad cero no se mueve aunque no quepa', () => {
    medidas(100, 400)
    const c = pintar({ speed: 0 })
    const inner = c.firstChild.firstChild
    expect(inner.style.animation).toBe('')
    expect(inner.className).toContain('truncate')
  })

  it('el texto entero queda en el tooltip, quepa o no', () => {
    medidas(100, 400)
    pintar({ speed: 30 })
    expect(screen.getByTitle('Un titulazo larguísimo')).toBeInTheDocument()
  })
})
