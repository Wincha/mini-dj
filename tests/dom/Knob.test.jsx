import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import Knob from '../../src/components/Knob'

const draw = (props = {}) => {
  const utils = render(<Knob value={0} onChange={() => {}} label="LOW" {...props} />)
  const root = utils.container.firstChild
  return { ...utils, root, aguja: utils.container.querySelector('line') }
}

describe('Knob', () => {
  it('gira la aguja proporcionalmente al valor, entre -135° y +135°', () => {
    const rot = (value) =>
      parseFloat(draw({ value }).aguja.parentElement.getAttribute('transform').match(/-?[\d.]+/)[0])

    expect(rot(-12)).toBeCloseTo(-135, 3)
    expect(rot(0)).toBeCloseTo(0, 3)
    expect(rot(12)).toBeCloseTo(135, 3)
    expect(rot(6)).toBeCloseTo(67.5, 3)
  })

  it('el doble click devuelve el mando a su sitio', () => {
    const onChange = vi.fn()
    const { root } = draw({ value: 7.5, resetValue: 0, onChange })
    fireEvent.doubleClick(root)
    expect(onChange).toHaveBeenCalledWith({ target: { value: 0 } })
  })

  it('sin valor de reposo el doble click no hace nada', () => {
    const onChange = vi.fn()
    const { root } = draw({ value: 7.5, onChange })
    fireEvent.doubleClick(root)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('el click derecho llega al mixer, que es quien decide el kill', () => {
    const onContextMenu = vi.fn((e) => e.preventDefault())
    const { root } = draw({ onContextMenu })
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(root, evt)

    expect(onContextMenu).toHaveBeenCalledTimes(1)
    expect(evt.defaultPrevented).toBe(true) // sin menú del navegador
  })

  it('una banda en kill se ve: texto KILL y aguja en rojo', () => {
    const { aguja } = draw({ value: -40, killed: true, killLabel: 'KILL' })
    expect(screen.getByText('KILL')).toBeInTheDocument()
    expect(aguja.getAttribute('stroke')).toBe('rgb(248 113 113)')
  })

  it('sin kill muestra el valor en dB', () => {
    draw({ value: -3.5 })
    expect(screen.getByText('-3.5 dB')).toBeInTheDocument()
  })

  it('acepta un formato propio para los mandos que no van en dB', () => {
    draw({ value: -0.5, format: (v) => (v < 0 ? `LPF ${Math.round(-v * 100)}%` : 'OFF') })
    expect(screen.getByText('LPF 50%')).toBeInTheDocument()
  })

  it('el arrastre real sigue siendo un input de rango accesible', () => {
    const onChange = vi.fn()
    const { container } = draw({ min: -24, max: 12, step: 0.5, value: 0, onChange })
    const input = container.querySelector('input[type="range"]')

    expect(input).toHaveAttribute('min', '-24')
    expect(input).toHaveAttribute('max', '12')
    fireEvent.change(input, { target: { value: '3' } })
    expect(onChange).toHaveBeenCalled()
  })
})
