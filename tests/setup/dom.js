// Preparación común de los tests de componentes (proyecto "dom").
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { stubCanvas2D } from '../helpers/canvas2d'

// jsdom no trae canvas: sin esto, cualquier componente que pinte revienta con
// un contexto nulo.
stubCanvas2D()

// Tampoco trae ResizeObserver, y todo lo que mide (la pantalla del deck, los
// medidores, la marquesina) lo usa. jsdom no hace layout, así que no hay
// cambios de tamaño que avisar: basta con que exista y trague las llamadas.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})
