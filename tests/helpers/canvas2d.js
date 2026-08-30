// Contexto 2D de mentira para jsdom, que no trae canvas.
//
// Los componentes que pintan (onda, VU, vista previa de la paleta) solo
// necesitan que el contexto exista y trague las llamadas: lo que se prueba de
// ellos es el estado y el marcado, nunca los píxeles. Las llamadas quedan
// registradas por si algún test quiere mirarlas.
const NO_OP = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo',
  'lineTo', 'arc', 'arcTo', 'rect', 'ellipse', 'quadraticCurveTo',
  'bezierCurveTo', 'fill', 'stroke', 'clip', 'save', 'restore', 'translate',
  'rotate', 'scale', 'setTransform', 'resetTransform', 'fillText',
  'strokeText', 'drawImage', 'setLineDash', 'putImageData', 'roundRect',
]

export function makeContext2D() {
  const calls = []
  const ctx = {
    calls,
    canvas: null,
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
    measureText: (text) => ({ width: String(text).length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getLineDash: () => [],
  }
  for (const name of NO_OP) ctx[name] = (...args) => calls.push([name, ...args])
  return ctx
}

/** Hace que <canvas>.getContext('2d') devuelva un contexto utilizable. */
export function stubCanvas2D() {
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== '2d') return null
    if (!this._ctx2d) {
      this._ctx2d = makeContext2D()
      this._ctx2d.canvas = this
    }
    return this._ctx2d
  }
}
