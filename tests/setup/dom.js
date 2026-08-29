// Preparación común de los tests de componentes (proyecto "dom").
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { stubCanvas2D } from '../helpers/canvas2d'

// jsdom no trae canvas: sin esto, cualquier componente que pinte revienta con
// un contexto nulo.
stubCanvas2D()

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})
