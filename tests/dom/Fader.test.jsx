import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Fader from '../../src/components/Fader'
import { I18nProvider } from '../../src/i18n'

// El Fader se dibuja encima de un <input type="range">. Estas ayudas leen la
// geometría pintada: el carril con su tramo iluminado y el cabezal.
const draw = (props) => {
  const { container } = render(
    <I18nProvider>
      <Fader ariaLabel="fader" onChange={() => {}} {...props} />
    </I18nProvider>
  )
  const root = container.firstChild
  const rail = root.children[0]
  const head = root.children[1]
  return {
    root,
    head,
    fill: rail.querySelector('[style*="box-shadow"]'),
    input: container.querySelector('input[type="range"]'),
  }
}
// "calc(72% - 8.64px)" → 72
const pctOf = (value) => parseFloat(String(value).replace(/^calc\(/, ''))

describe('Fader vertical', () => {
  it('arriba es el máximo: el cabezal sube con el valor', () => {
    const lo = draw({ orientation: 'vertical', value: 0 })
    const mid = draw({ orientation: 'vertical', value: 0.5 })
    const hi = draw({ orientation: 'vertical', value: 1 })

    expect(pctOf(lo.head.style.bottom)).toBeCloseTo(0, 1)
    expect(pctOf(mid.head.style.bottom)).toBeCloseTo(50, 1)
    expect(pctOf(hi.head.style.bottom)).toBeCloseTo(100, 1)
  })

  it('el relleno crece desde abajo', () => {
    const { fill } = draw({ orientation: 'vertical', value: 0.75 })
    expect(fill.style.bottom).toBe('0%')
    expect(pctOf(fill.style.height)).toBeCloseTo(75, 1)
  })

  it('el input nativo no queda al revés (regresión: fader invertido)', () => {
    const { input } = draw({ orientation: 'vertical', value: 0.25 })
    expect(input.style.writingMode).toBe('vertical-lr')
    expect(input.style.direction).toBe('rtl')
    expect(input.style.transform).toBe('none')
  })
})

describe('Fader de pitch (invertido, estilo Technics)', () => {
  const pitch = { orientation: 'vertical', invert: true, min: -8, max: 8, fill: 'center' }

  it('el máximo queda ABAJO', () => {
    expect(pctOf(draw({ ...pitch, value: 8 }).head.style.bottom)).toBeCloseTo(0, 1)
    expect(pctOf(draw({ ...pitch, value: -8 }).head.style.bottom)).toBeCloseTo(100, 1)
    expect(pctOf(draw({ ...pitch, value: 0 }).head.style.bottom)).toBeCloseTo(50, 1)
  })

  it('el input nativo va espejado', () => {
    expect(draw({ ...pitch, value: 0 }).input.style.transform).toBe('scaleY(-1)')
  })

  it('el relleno sale del centro hacia el valor', () => {
    const arriba = draw({ ...pitch, value: -4 }) // pitch negativo → cabezal arriba
    expect(pctOf(arriba.fill.style.bottom)).toBeCloseTo(50, 1)
    expect(pctOf(arriba.fill.style.height)).toBeCloseTo(25, 1)

    const abajo = draw({ ...pitch, value: 4 })
    expect(pctOf(abajo.fill.style.bottom)).toBeCloseTo(25, 1)
    expect(pctOf(abajo.fill.style.height)).toBeCloseTo(25, 1)
  })
})

describe('Fader horizontal', () => {
  it('la derecha es el máximo', () => {
    expect(pctOf(draw({ value: 1 }).head.style.left)).toBeCloseTo(100, 1)
    expect(pctOf(draw({ value: 0 }).head.style.left)).toBeCloseTo(0, 1)
  })

  it('el crossfader se rellena desde el centro', () => {
    const { fill } = draw({ value: 0.8, fill: 'center' })
    expect(pctOf(fill.style.left)).toBeCloseTo(50, 1)
    expect(pctOf(fill.style.width)).toBeCloseTo(30, 1)
  })
})

describe('reset con click derecho', () => {
  it('vuelve al valor de reposo sin abrir el menú del navegador', () => {
    const onChange = vi.fn()
    const { root } = draw({ value: 0.9, resetValue: 0.5, onChange })

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    fireEvent(root, evt)

    expect(onChange).toHaveBeenCalledWith({ target: { value: 0.5 } })
    expect(evt.defaultPrevented).toBe(true)
  })

  it('sin resetValue el click derecho no hace nada', () => {
    const onChange = vi.fn()
    const { root } = draw({ value: 0.9, onChange })
    fireEvent.contextMenu(root)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('anuncia el atajo en el tooltip', () => {
    const { root } = draw({ value: 0.5, resetValue: 0.5, onChange: () => {}, title: 'Volumen A' })
    expect(root.title).toContain('Volumen A')
    expect(root.title.length).toBeGreaterThan('Volumen A'.length)
  })
})
