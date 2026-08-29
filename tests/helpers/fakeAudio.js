// Doble del grafo de Web Audio.
//
// No sintetiza audio: registra el grafo (qué nodo conecta con cuál) y los
// valores de los parámetros. Con eso se comprueba lo que de verdad importa
// del motor —ruteo, curva del crossfader, EQ y filtro— sin tarjeta de sonido,
// que es justo lo que no hay ni en WSL2 ni en el CI.

class FakeParam {
  constructor(value = 0) {
    this.value = value
    this.automation = []
  }
  cancelScheduledValues(t) {
    this.automation.push(['cancel', t])
    return this
  }
  setValueAtTime(v, t) {
    this.automation.push(['set', v, t])
    this.value = v
    return this
  }
  linearRampToValueAtTime(v, t) {
    this.automation.push(['ramp', v, t])
    this.value = v
    return this
  }
}

class FakeNode {
  constructor(ctx, type) {
    this.context = ctx
    this.type_ = type
    this.channelCount = 2
  }
  connect(dest, output = 0, input = 0) {
    this.context.edges.push({ from: this, to: dest, output, input })
    return dest
  }
  disconnect(dest) {
    this.context.edges = this.context.edges.filter(
      (e) => e.from !== this || (dest && e.to !== dest)
    )
  }
}

export class FakeAudioContext {
  constructor() {
    this.edges = []
    this.currentTime = 0
    this.state = 'running'
    this.sampleRate = 48000
    this.destination = new FakeNode(this, 'destination')
    this.resumed = 0
  }

  resume() {
    this.resumed++
    this.state = 'running'
    return Promise.resolve()
  }

  createGain() {
    const n = new FakeNode(this, 'gain')
    n.gain = new FakeParam(1)
    return n
  }

  createBiquadFilter() {
    const n = new FakeNode(this, 'biquad')
    n.type = 'lowpass'
    n.frequency = new FakeParam(350)
    n.Q = new FakeParam(1)
    n.gain = new FakeParam(0)
    n.detune = new FakeParam(0)
    return n
  }

  createAnalyser() {
    const n = new FakeNode(this, 'analyser')
    n.fftSize = 2048
    n.smoothingTimeConstant = 0.8
    Object.defineProperty(n, 'frequencyBinCount', { get: () => n.fftSize / 2 })
    // Señal que devuelve el analizador; los tests la fijan con setSignal()
    n._wave = null
    n.setSignal = (arr) => {
      n._wave = arr
    }
    n.getFloatTimeDomainData = (out) => {
      for (let i = 0; i < out.length; i++) out[i] = n._wave ? n._wave[i % n._wave.length] : 0
    }
    n.getByteTimeDomainData = (out) => {
      for (let i = 0; i < out.length; i++) {
        const v = n._wave ? n._wave[i % n._wave.length] : 0
        out[i] = Math.max(0, Math.min(255, Math.round(v * 128 + 128)))
      }
    }
    return n
  }

  createDynamicsCompressor() {
    const n = new FakeNode(this, 'compressor')
    n.threshold = new FakeParam(-24)
    n.knee = new FakeParam(30)
    n.ratio = new FakeParam(12)
    n.attack = new FakeParam(0.003)
    n.release = new FakeParam(0.25)
    return n
  }

  createMediaStreamDestination() {
    const n = new FakeNode(this, 'mediaStreamDestination')
    n.stream = { id: `stream-${this.edges.length}-${Math.random()}` }
    return n
  }

  createMediaElementSource(el) {
    const n = new FakeNode(this, 'mediaElementSource')
    n.mediaElement = el
    return n
  }

  createChannelMerger(inputs = 6) {
    const n = new FakeNode(this, 'merger')
    n.numberOfInputs = inputs
    return n
  }

  createBufferSource() {
    const n = new FakeNode(this, 'bufferSource')
    n.buffer = null
    n.start = () => {}
    return n
  }
}

/** Nodos a los que llega `node` directamente. */
export function targetsOf(ctx, node) {
  return ctx.edges.filter((e) => e.from === node).map((e) => e.to)
}

/** ¿Hay camino de `from` a `to` siguiendo las conexiones? */
export function pathExists(ctx, from, to) {
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    const node = queue.shift()
    if (node === to) return true
    for (const next of targetsOf(ctx, node)) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

/**
 * Instala el doble como window.AudioContext y devuelve el motor ya montado.
 * Hay que llamar a restore() al terminar.
 */
export function installFakeAudio() {
  const previous = globalThis.window
  const ctx = new FakeAudioContext()
  globalThis.window = {
    ...(previous || {}),
    AudioContext: function () {
      return ctx
    },
  }
  return {
    ctx,
    restore() {
      if (previous === undefined) delete globalThis.window
      else globalThis.window = previous
    },
  }
}
