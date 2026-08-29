// Generador de WAV en memoria: los tests de navegador cargan pistas de verdad
// por el <input type="file">, y este archivo las fabrica al vuelo. Así no hay
// audio guardado en el repo y el BPM de la pista es EXACTAMENTE el esperado.

/** Cabecera WAV PCM 16 bits mono + muestras. */
export function encodeWav(samples, sampleRate = 44100) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // tamaño del bloque fmt
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // bytes por segundo
  buffer.writeUInt16LE(2, 32) // alineación de bloque
  buffer.writeUInt16LE(16, 34) // bits por muestra
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buffer
}

/**
 * Pista de prueba: bombo a negras al BPM pedido, con acento cada cuatro
 * tiempos y un colchón de graves para que la onda y el análisis tengan algo
 * que morder.
 */
export function clickTrack({ bpm, seconds = 20, sampleRate = 44100 }) {
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  const interval = 60 / bpm

  for (let beat = 0; beat * interval < seconds; beat++) {
    const start = Math.round(beat * interval * sampleRate)
    const amp = beat % 4 === 0 ? 0.9 : 0.6
    // Golpe de bombo: seno de 60 Hz con caída rápida
    for (let i = 0; i < sampleRate * 0.12 && start + i < n; i++) {
      const tSec = i / sampleRate
      out[start + i] += amp * Math.sin(2 * Math.PI * 60 * tSec) * Math.exp(-25 * tSec)
      // Chasquido de ataque, para que el onset sea nítido
      out[start + i] += amp * 0.35 * Math.sin(2 * Math.PI * 2000 * tSec) * Math.exp(-120 * tSec)
    }
  }
  return out
}
