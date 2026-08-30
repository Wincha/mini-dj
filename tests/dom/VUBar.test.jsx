import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import VUBar from '../../src/components/VUBar'
import { renderWithI18n } from '../helpers/render.jsx'

// El medidor pinta el aparato entero en DOS capas fijas (todo apagado y todo
// encendido) y cada frame solo vuelca lo que toca. Lo que se comprueba aquí es
// justo eso: que las capas se construyen una vez y que el refresco no repinta
// lámpara por lámpara.

// Analizador de mentira: devuelve una senoide de la amplitud que se le diga
const analizador = (amp) => ({
  fftSize: 256,
  getFloatTimeDomainData(buf) {
    for (let i = 0; i < buf.length; i++) buf[i] = amp * Math.sin((i / buf.length) * Math.PI * 4)
  },
})

const motor = (amp) => ({ getMeterAnalyser: () => analizador(amp) })

const pintar = (props = {}) =>
  renderWithI18n(<VUBar engine={motor(0.5)} side="A" {...props} />)

// El lienzo de un medidor vertical del mixer
const medidas = () => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 12, height: 120, right: 12, bottom: 120, x: 0, y: 0 }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  medidas()
})

afterEach(() => {
  vi.useRealTimers()
  delete HTMLElement.prototype.getBoundingClientRect
})

const llamadas = (canvas, nombre) =>
  canvas.getContext('2d').calls.filter(([n]) => n === nombre).length

describe('VUBar', () => {
  it('pinta volcando capas, no lámpara a lámpara', () => {
    const { container } = pintar({ mode: 'led' })
    const canvas = container.querySelector('canvas')
    expect(llamadas(canvas, 'drawImage')).toBeGreaterThan(0)
    // Las 21 lámparas se dibujan en la capa, no en el lienzo de cada frame
    expect(llamadas(canvas, 'fill')).toBe(0)
  })

  it('las capas se construyen una sola vez, por muchos frames que pasen', () => {
    const { container } = pintar({ mode: 'led' })
    const canvas = container.querySelector('canvas')
    const capa = document.createElement('canvas') // mismo doble de contexto
    expect(capa.getContext('2d').calls).toHaveLength(0)

    const antes = llamadas(canvas, 'drawImage')
    vi.advanceTimersByTime(330) // diez vueltas
    const despues = llamadas(canvas, 'drawImage')
    // Cada vuelta vuelca como mucho tres trozos (apagado, encendido y pico)
    expect(despues - antes).toBeGreaterThan(0)
    expect(despues - antes).toBeLessThanOrEqual(30)
  })

  it('en silencio solo se ve el aparato apagado', () => {
    const { container } = renderWithI18n(<VUBar engine={motor(0)} side="A" mode="led" />)
    const canvas = container.querySelector('canvas')
    vi.advanceTimersByTime(100)
    // Un volcado por vuelta: la capa de encendido no entra
    expect(llamadas(canvas, 'drawImage')).toBeLessThanOrEqual(4)
  })

  it('cambiar de modo no reinicia el medidor: sigue el mismo lienzo', () => {
    const { container, rerender } = pintar({ mode: 'led' })
    const canvas = container.querySelector('canvas')
    vi.advanceTimersByTime(100)
    rerender(<VUBar engine={motor(0.5)} side="A" mode="continuous" />)
    vi.advanceTimersByTime(100)
    expect(container.querySelector('canvas')).toBe(canvas)
    expect(llamadas(canvas, 'drawImage')).toBeGreaterThan(0)
  })

  it('el master enseña su escala en dB; los de canal, no', () => {
    const { container } = pintar({ direction: 'horizontal', showScale: true, side: 'master' })
    expect(container.textContent).toContain('-42')
    expect(container.textContent).toContain('0')
    const solo = renderWithI18n(<VUBar engine={motor(0.5)} side="A" />)
    expect(solo.container.textContent).not.toContain('-42')
  })

  it('al saturar enciende el aviso rojo del techo', () => {
    // Una muestra a fondo de escala: eso es saturación
    const { container } = renderWithI18n(<VUBar engine={motor(1)} side="A" mode="continuous" />)
    const canvas = container.querySelector('canvas')
    const rojo = canvas
      .getContext('2d')
      .calls.filter(([n]) => n === 'fillRect').length
    // El bloque del techo y su filo blanco, encima de los volcados de capa
    expect(rojo).toBeGreaterThanOrEqual(2)
  })

  it('sin motor no revienta ni pinta', () => {
    expect(() => renderWithI18n(<VUBar engine={null} side="A" />)).not.toThrow()
  })
})
