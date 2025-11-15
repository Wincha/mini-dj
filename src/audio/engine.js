export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    // Master (único)
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;

    // Trim de master (AGC fuerte) y analizador del mix
    this.masterTrim = this.ctx.createGain();
    this.masterTrim.gain.value = 1;

    this.mixAnalyser = this.ctx.createAnalyser();
    this.mixAnalyser.fftSize = 1024;
    this.mixAnalyser.smoothingTimeConstant = 0.85;

    // Ruteo final (sin duplicados, sin conexiones huérfanas):
    // decks -> masterGain -> (tap a analyser) -> masterTrim -> destination
    this.masterGain.connect(this.mixAnalyser);
    this.masterGain.connect(this.masterTrim);
    this.masterTrim.connect(this.ctx.destination);

    const mkEQ = () => {
      const eqPreGain = this.ctx.createGain(); // knob "Gain" en dB → lineal
      const low = this.ctx.createBiquadFilter(); // low-shelf 100 Hz
      const mid = this.ctx.createBiquadFilter(); // peaking 1 kHz
      const high = this.ctx.createBiquadFilter(); // high-shelf 10 kHz

      low.type = "lowshelf";
      low.frequency.value = 100;

      mid.type = "peaking";
      mid.frequency.value = 1000;
      mid.Q.value = 0.7;

      high.type = "highshelf";
      high.frequency.value = 10000;

      return { eqPreGain, low, mid, high };
    };

    this.deckA = {
      media: null,
      mediaEl: null,
      // EQ
      ...mkEQ(),
      // Fader y mezcla
      preGain: this.ctx.createGain(), // volumen del deck (slider)
      xfGain: this.ctx.createGain(), // coeficiente del crossfader
      analyser: this.ctx.createAnalyser(),
    };

    this.deckB = {
      media: null,
      mediaEl: null,
      ...mkEQ(),
      preGain: this.ctx.createGain(),
      xfGain: this.ctx.createGain(),
      analyser: this.ctx.createAnalyser(),
    };

    // Conexiones por deck (A)
    this.deckA.eqPreGain.connect(this.deckA.low);
    this.deckA.low.connect(this.deckA.mid);
    this.deckA.mid.connect(this.deckA.high);
    this.deckA.high.connect(this.deckA.preGain);
    this.deckA.preGain.connect(this.deckA.xfGain);
    this.deckA.xfGain.connect(this.deckA.analyser);
    this.deckA.analyser.connect(this.masterGain);

    // Conexiones por deck (B)
    this.deckB.eqPreGain.connect(this.deckB.low);
    this.deckB.low.connect(this.deckB.mid);
    this.deckB.mid.connect(this.deckB.high);
    this.deckB.high.connect(this.deckB.preGain);
    this.deckB.preGain.connect(this.deckB.xfGain);
    this.deckB.xfGain.connect(this.deckB.analyser);
    this.deckB.analyser.connect(this.masterGain);

    // Ajuste de analyser (ligero)
    [this.deckA.analyser, this.deckB.analyser].forEach((a) => {
      a.fftSize = 1024;
      a.smoothingTimeConstant = 0.8;
    });
  }

  resume() {
    if (this.ctx.state === "suspended") return this.ctx.resume();
  }

  // Conectar <audio> de cada deck al grafo
  attachMediaElement(which, el) {
    const deck = which === "A" ? this.deckA : this.deckB;
    if (deck.mediaEl === el && deck.media) return;
    if (deck.media && deck.mediaEl && deck.mediaEl !== el) {
      try {
        deck.media.disconnect();
      } catch {
        // ignorar
      }
      deck.media = null;
    }

    deck.mediaEl = el;
    deck.media = this.ctx.createMediaElementSource(el);
    deck.media.connect(deck.eqPreGain); // ← ahora entra por el bloque de EQ
  }

  setDeckVolume(which, vol) {
    const deck = which === "A" ? this.deckA : this.deckB;
    deck.preGain.gain.value = vol;
  }

  setMaster(vol) {
    this.masterGain.gain.value = vol;
  }

  // Crossfader equal-power (x∈[0,1]) con volumen por deck
  setCrossfader(x) {
    const a = Math.cos(x * Math.PI * 0.5);
    const b = Math.sin(x * Math.PI * 0.5);
    const ga = a * a;
    const gb = b * b;
    this.deckA.xfGain.gain.value = ga;
    this.deckB.xfGain.gain.value = gb;
  }

  getRMS(which) {
    const an = which === "A" ? this.deckA.analyser : this.deckB.analyser;
    const arr = new Uint8Array(an.frequencyBinCount);
    an.getByteTimeDomainData(arr);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = (arr[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    return Math.sqrt(sum / arr.length); // 0..1 aprox
  }

  // Conversión dB → ganancia lineal
  _dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  // Aplicar EQ por deck: {gain, low, mid, high} en dB
  setDeckEQ(which, { gain = 0, low = 0, mid = 0, high = 0 } = {}) {
    const d = which === "A" ? this.deckA : this.deckB;

    // === AUTO-TRIM SUAVE (mantenemos la idea, pero sin rampas) ===
    const boostSum = [low, mid, high].reduce(
      (acc, v) => acc + Math.max(0, v),
      0
    );
    // cuando supera ~9 dB combinados, restamos un poco al pre-gain
    const trimDb = boostSum > 9 ? -(boostSum - 9) * 0.4 : 0;
    const effectiveGainDb = gain + trimDb;

    const target = this._dbToGain(effectiveGainDb);

    // 👉 Cambio importante: nada de cancelScheduledValues ni linearRamp
    // Ajuste directo, súper barato:
    d.eqPreGain.gain.value = target;

    // filtros EQ (esto ya era “gratis”)
    d.low.gain.value = low;
    d.mid.gain.value = mid;
    d.high.gain.value = high;
  }

  // === Auto Level (AGC) para master ===
  _enableAGC = false;
  _agcTimer = null;

  // Devuelve RMS del mix 0..1
  _getMixRMS() {
    const an = this.mixAnalyser;
    const arr = new Uint8Array(an.frequencyBinCount);
    an.getByteTimeDomainData(arr);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = (arr[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / arr.length);
  }

  // Activa/desactiva AGC
  setMasterAutoLevel(enabled, opts = {}) {
    this._enableAGC = !!enabled;
    const {
      targetRMS = 0.14, // objetivo alto
      deadband = 0.01, // si estoy cerca, no toco
      upRate = 0.06, // SUBE rápido
      downRate = 0.001, // BAJA muy lento
      tickMs = 50,
      minGain = 0.05, // no caigas por debajo de X
      maxGain = 2.5,
      silenceGate = 0.02, // no subas en silencio
    } = opts;

    this._agcTimer = setInterval(() => {
      const rms = this._getMixRMS();
      const cur = this.masterTrim.gain.value;
      let next = cur;

      if (rms < silenceGate) {
        // En silencio: no bostear; leve drift hacia 1.0 si está muy bajo
        next = cur < 1 ? cur * 1.002 : cur;
      } else {
        const hi = targetRMS * (1 + deadband);
        const lo = targetRMS * (1 - deadband);

        if (rms < lo) {
          // Por debajo: sube rápido (proporcional al error)
          const ratio = targetRMS / Math.max(1e-6, rms); // >1
          const boost = Math.min(1.0, (ratio - 1) * 0.3); // suaviza
          next = cur * (1 + Math.max(upRate, boost * upRate));
        } else if (rms > hi) {
          // Por encima: baja muy, muy lento
          next = cur * (1 - downRate);
        } else {
          // Dentro de banda: tírate muy despacio hacia 1.0 si quedó por debajo
          if (cur < 1.0) next = cur * 1.005;
        }
      }

      next = Math.min(maxGain, Math.max(minGain, next));

      const now = this.ctx.currentTime;
      this.masterTrim.gain.cancelScheduledValues(now);
      this.masterTrim.gain.setValueAtTime(this.masterTrim.gain.value, now);
      this.masterTrim.gain.linearRampToValueAtTime(next, now + tickMs / 1000);
    }, tickMs);
  }
}
