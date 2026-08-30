import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Readout from '../../src/components/Readout'

describe('Readout', () => {
  it('en modo normal escribe el texto tal cual', () => {
    const { container } = render(<Readout text="144.0" />)
    expect(container).toHaveTextContent('144.0')
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('en modo segmentos pinta un carácter por letra', () => {
    const { container } = render(<Readout text="144.0" mode="segments" />)
    // Cinco caracteres, cinco lienzos
    expect(container.querySelectorAll('svg')).toHaveLength(5)
  })

  it('el texto sigue estando para quien no ve los segmentos', () => {
    render(<Readout text="-03:43" mode="segments" />)
    expect(screen.getByText('-03:43')).toBeInTheDocument()
  })

  it('los espacios también son casilla: en un display están ahí', () => {
    const { container } = render(<Readout text="A B" mode="segments" />)
    expect(container.querySelectorAll('svg')).toHaveLength(3)
    // La del espacio solo lleva el fondo de segmentos apagados
    expect(container.querySelectorAll('svg')[1].querySelectorAll('path')).toHaveLength(1)
  })

  it('con `cells` rellena la línea de casillas apagadas', () => {
    const { container } = render(<Readout text="AB" mode="segments" cells={10} />)
    expect(container.querySelectorAll('svg')).toHaveLength(10)
    // Las dos primeras encienden algo; el resto, solo el fondo
    expect(container.querySelectorAll('svg')[0].querySelectorAll('path')).toHaveLength(2)
    expect(container.querySelectorAll('svg')[9].querySelectorAll('path')).toHaveLength(1)
  })

  it('`cells` nunca recorta el texto: si sobra, manda el texto', () => {
    const { container } = render(<Readout text="ABCDE" mode="segments" cells={2} />)
    expect(container.querySelectorAll('svg')).toHaveLength(5)
  })

  it('un carácter que no está en la tabla no revienta: sale en blanco', () => {
    const { container } = render(<Readout text="♪@" mode="segments" />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(2)
    // Solo el fondo de segmentos apagados, sin ninguno encendido
    expect(svgs[0].querySelectorAll('path')).toHaveLength(1)
  })

  it('un dígito conocido enciende sus segmentos', () => {
    const { container } = render(<Readout text="8" mode="segments" />)
    // Fondo (todos apagados) + los encendidos
    expect(container.querySelectorAll('svg path')).toHaveLength(2)
  })

  it('el color y el tamaño vienen de fuera, en los dos modos', () => {
    const { container, rerender } = render(
      <Readout text="12" color="#ff0000" size="text-xl" />
    )
    expect(container.firstChild.className).toContain('text-xl')
    expect(container.firstChild).toHaveStyle({ color: '#ff0000' })

    rerender(<Readout text="12" mode="segments" color="#ff0000" size="text-xl" />)
    expect(container.firstChild.className).toContain('text-xl')
    expect(container.querySelector('svg path')).toHaveAttribute('fill', '#ff0000')
  })


  it('el patrón manda sobre el modo: cada casilla es del tipo que se le diga', () => {
    const fondo = (c) => c.querySelectorAll('svg')[0].querySelector('path').getAttribute('d')
    const siete = fondo(render(<Readout text="8" mode="seg7" />).container)
    const catorce = fondo(render(<Readout text="8" mode="seg14" />).container)
    expect(siete).not.toBe(catorce)

    const { container } = render(
      <Readout text="8:" mode="seg14" pattern={['seg7', 'seg14']} />
    )
    const svgs = container.querySelectorAll('svg')
    expect(svgs[0].querySelector('path').getAttribute('d')).toBe(siete)
    expect(svgs[1].querySelector('path').getAttribute('d')).toBe(catorce)
  })

  it('una casilla no cambia de tipo porque cambie lo que se escribe', () => {
    const pattern = ['seg14', 'seg7', 'seg7']
    const fondos = (t) =>
      [...render(<Readout text={t} mode="seg14" pattern={pattern} />).container.querySelectorAll('svg')]
        .map((svg) => svg.querySelector('path').getAttribute('d'))
    // El signo cambia de + a −, pero el panel sigue montado igual
    expect(fondos('+00')).toEqual(fondos('−12'))
  })


  it('una casilla de siete sigue siendo de siete con la raya de "sin dato"', () => {
    const fondo = (c) => c.querySelectorAll('svg')[0].querySelector('path').getAttribute('d')
    const siete = fondo(render(<Readout text="8" mode="seg7" />).container)
    for (const raya of ['-', '\u2014', '\u2212']) {
      const { container } = render(<Readout text={raya} mode="seg14" pattern={['seg7']} />)
      const svg = container.querySelectorAll('svg')[0]
      // El fondo sigue siendo el de siete…
      expect(svg.querySelector('path').getAttribute('d')).toBe(siete)
      // …y la raya enciende su barra
      expect(svg.querySelectorAll('path')).toHaveLength(2)
    }
  })

  it('sin brillo no se pinta ninguna sombra', () => {
    const { container } = render(<Readout text="12" glow={false} />)
    expect(container.firstChild.style.textShadow).toBe('')
  })
})
