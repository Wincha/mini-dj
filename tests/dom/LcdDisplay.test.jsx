import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import LcdDisplay from '../../src/components/LcdDisplay'

// La pantalla del deck es un panel MONTADO: cada casilla es de siete
// segmentos, de catorce o de puntos desde que se enciende, y no cambia porque
// cambie lo que se escribe. Aquí se comprueba justo eso, leyendo el trazo del
// fondo apagado de cada casilla (el de siete tiene siete piezas; el de
// catorce, quince contando el punto decimal; el de puntos, treinta y cinco).
const piezas = (svg) => (svg.querySelector('path')?.getAttribute('d').match(/M/g) || []).length
const tipo = (svg) => (piezas(svg) <= 7 ? 'seg7' : piezas(svg) <= 20 ? 'seg14' : 'dot')

const campo = (container, rotulo) =>
  [...container.querySelectorAll('div')].find(
    (d) => d.firstElementChild?.textContent === rotulo && d.querySelector('svg, span')
  )

const tipos = (container, rotulo) =>
  [...campo(container, rotulo).querySelectorAll('svg')].map(tipo)

const props = (over = {}) => ({
  trackTitle: 'PISTA',
  trackInfo: 'ARTISTA',
  marqueeSpeed: 0,
  time: '-05:03',
  timeLabel: 'RESTANTE',
  duration: '05:03',
  durationLabel: 'TOTAL',
  bpm: '154',
  bpmLabel: 'BPM PISTA',
  runningBpm: '154',
  runningLabel: 'BPM',
  musicalKey: null,
  pitch: '0.00%',
  pitchLabel: 'PITCH',
  bend: '0.00%',
  bendLabel: 'BEND',
  font: 'lcd',
  titleFont: 'dot',
  ...over,
})

describe('LcdDisplay: el montaje del panel', () => {
  it('los tiempos llevan los ":" de catorce y las cifras de siete', () => {
    const { container } = render(<LcdDisplay {...props()} />)
    expect(tipos(container, 'RESTANTE')).toEqual([
      'seg7', 'seg7', 'seg7', 'seg14', 'seg7', 'seg7',
    ])
    expect(tipos(container, 'TOTAL')).toEqual(['seg7', 'seg7', 'seg14', 'seg7', 'seg7'])
  })

  it('los DOS indicadores de BPM son de siete segmentos', () => {
    const { container } = render(<LcdDisplay {...props()} />)
    expect(tipos(container, 'BPM PISTA')).toEqual(['seg7', 'seg7', 'seg7'])
    expect(tipos(container, 'BPM')).toEqual(['seg7', 'seg7', 'seg7'])
  })

  it('sin BPM, la barra sigue en una casilla de siete', () => {
    const { container } = render(<LcdDisplay {...props({ bpm: '-', runningBpm: '-' })} />)
    expect(tipos(container, 'BPM PISTA')).toEqual(['seg7', 'seg7', 'seg7'])
    expect(tipos(container, 'BPM')).toEqual(['seg7', 'seg7', 'seg7'])
  })

  it('una casilla no cambia de tipo aunque cambie lo que se escribe', () => {
    const { container, rerender } = render(<LcdDisplay {...props()} />)
    const antes = tipos(container, 'RESTANTE')
    rerender(<LcdDisplay {...props({ time: '-00:00' })} />)
    expect(tipos(container, 'RESTANTE')).toEqual(antes)
  })

  it('pitch y bend van enteros de catorce: llevan signos y el %', () => {
    const { container } = render(<LcdDisplay {...props({ pitch: '+3.25%' })} />)
    expect(new Set(tipos(container, 'PITCH'))).toEqual(new Set(['seg14']))
    expect(new Set(tipos(container, 'BEND'))).toEqual(new Set(['seg14']))
  })

  it('una pista de más de una hora estrena tres casillas más, no se sale', () => {
    const { container } = render(
      <LcdDisplay {...props({ time: '-01:05:03', duration: '01:05:03' })} />
    )
    expect(tipos(container, 'RESTANTE')).toEqual([
      'seg7', 'seg7', 'seg7', 'seg14', 'seg7', 'seg7', 'seg14', 'seg7', 'seg7',
    ])
    expect(tipos(container, 'TOTAL')).toHaveLength(8)
  })

  it('en modo de letras no se pinta ni un segmento', () => {
    const { container } = render(<LcdDisplay {...props({ font: 'rounded', titleFont: 'rounded' })} />)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
    expect(screen.getByText('-05:03')).toBeInTheDocument()
  })

  it('la tonalidad solo aparece si se pide', () => {
    const { container, rerender } = render(<LcdDisplay {...props()} />)
    expect(campo(container, 'KEY')).toBeUndefined()
    rerender(<LcdDisplay {...props({ musicalKey: 'Am', keyLabel: 'KEY' })} />)
    expect(campo(container, 'KEY')).toBeDefined()
  })
})
