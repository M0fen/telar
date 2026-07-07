// NÚCLEO DSP del limitador TRUE-PEAK con lookahead (Tier 1 — mastering nivel plataforma).
//
// Web Audio no trae un brickwall con lookahead ni control de pico REAL (inter-muestra):
// su DynamicsCompressorNode es un compresor sin lookahead → los transientes rebasan el
// umbral y el pico entre-muestras (true-peak) sube al codificar a MP3/AAC (Spotify/YouTube)
// y distorsiona. Los masters pro van a ≤ −1 dBTP. Esto lo garantiza.
//
// Es un módulo PURO (sin Web Audio) para poder TESTEARLO en Node: comprueba que la salida
// nunca supera el techo ni siquiera midiendo el pico oversampleado 4x. El AudioWorklet
// (masterLimiterWorklet) transcribe este mismo algoritmo al hilo de audio.

export const dbToLin = (db: number): number => Math.pow(10, db / 20);
export const linToDb = (x: number): number => (x > 1e-12 ? 20 * Math.log10(x) : -Infinity);

// Banco polifásico FIR para oversample ×`phases` (sinc enventanado con Blackman). Cada fase
// suma 1 → pasa DC a ganancia unidad en cada sub-muestra. Se usa para estimar el pico REAL.
export function polyphaseBanks(phases = 4, tapsPerPhase = 12): Float32Array[] {
  const N = phases * tapsPerPhase;
  const fc = 0.5 / phases; // corte a Nyquist/phases
  const mid = (N - 1) / 2;
  const proto = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = i - mid;
    const sinc = Math.abs(x) < 1e-9 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
    proto[i] = sinc * w;
  }
  const banks: Float32Array[] = [];
  for (let p = 0; p < phases; p++) {
    const b = new Float32Array(tapsPerPhase);
    let s = 0;
    for (let t = 0; t < tapsPerPhase; t++) { b[t] = proto[t * phases + p]; s += b[t]; }
    if (Math.abs(s) > 1e-9) for (let t = 0; t < tapsPerPhase; t++) b[t] /= s; // fase a ganancia DC 1
    banks.push(b);
  }
  return banks;
}

export interface LimiterOpts {
  ceilingDb?: number;   // techo de salida en dBTP (def −1)
  lookaheadMs?: number; // ventana de anticipación (def 1.5 ms)
  releaseMs?: number;   // recuperación de ganancia (def 60 ms)
  phases?: number;      // oversample para el true-peak (def 4)
}

// Cola monótona creciente para el MÍNIMO deslizante de la ganancia objetivo en la ventana
// de lookahead (garantiza que ningún pico de la ventana se cuele: el ataque ya bajó).
class MinWindow {
  private v: number[] = [];
  private idx: number[] = [];
  private n = 0;
  constructor(private size: number) {}
  push(x: number): number {
    while (this.v.length && this.v[this.v.length - 1] >= x) { this.v.pop(); this.idx.pop(); }
    this.v.push(x); this.idx.push(this.n);
    while (this.idx[0] <= this.n - this.size) { this.v.shift(); this.idx.shift(); }
    this.n++;
    return this.v[0];
  }
}

// Limitador true-peak con lookahead, estéreo LINKADO (misma reducción en L/R → no mueve la
// imagen). `process` recibe bloques por canal y devuelve la salida limitada, retrasada
// `lookahead` muestras. Mantiene estado entre bloques (usable en streaming/worklet).
export class TruePeakLimiter {
  private banks: Float32Array[];
  private phases: number;
  private taps: number;
  private ceiling: number;
  private LA: number;
  private relCoef: number;
  private hist: Float32Array[];      // historia del FIR por canal (para el oversampler)
  private delay: Float32Array[];     // línea de retardo del audio por canal
  private dpos = 0;
  private minWin: MinWindow;
  private gain = 1;                  // ganancia suavizada actual

  constructor(sampleRate: number, opts: LimiterOpts = {}) {
    this.phases = opts.phases ?? 4;
    this.banks = polyphaseBanks(this.phases, 12);
    this.taps = this.banks[0].length;
    this.ceiling = dbToLin(opts.ceilingDb ?? -1);
    this.LA = Math.max(1, Math.round(sampleRate * ((opts.lookaheadMs ?? 1.5) / 1000)));
    this.relCoef = Math.exp(-1 / (sampleRate * ((opts.releaseMs ?? 60) / 1000)));
    this.hist = [new Float32Array(this.taps), new Float32Array(this.taps)];
    this.delay = [new Float32Array(this.LA), new Float32Array(this.LA)];
    this.minWin = new MinWindow(this.LA + 1);
  }

  get lookahead(): number { return this.LA; }

  // pico REAL (inter-muestra) del sample n del canal ch, oversampleando ×phases con el FIR.
  private truePeakAt(ch: number, x: number): number {
    const h = this.hist[ch];
    for (let i = this.taps - 1; i > 0; i--) h[i] = h[i - 1];
    h[0] = x;
    let mx = 0;
    for (let p = 0; p < this.phases; p++) {
      const b = this.banks[p];
      let y = 0;
      for (let t = 0; t < this.taps; t++) y += b[t] * h[t];
      const a = Math.abs(y);
      if (a > mx) mx = a;
    }
    return mx;
  }

  process(chIn: Float32Array[]): Float32Array[] {
    const nCh = chIn.length;
    const len = chIn[0].length;
    const out: Float32Array[] = chIn.map(() => new Float32Array(len));
    const ceil = this.ceiling;
    for (let n = 0; n < len; n++) {
      // 1) detector = mayor pico REAL entre canales (link estéreo)
      let peak = 0;
      for (let c = 0; c < nCh; c++) { const tp = this.truePeakAt(c, chIn[c][n]); if (tp > peak) peak = tp; }
      // 2) ganancia objetivo para que ese pico no pase del techo
      const target = peak > ceil ? ceil / peak : 1;
      // 3) MÍN deslizante en la ventana de lookahead (ataque ya anticipado, sin overshoot)
      const winMin = this.minWin.push(target);
      // 4) ataque instantáneo hacia abajo (cubierto por el lookahead), release suave hacia arriba
      if (winMin < this.gain) this.gain = winMin;
      else this.gain = winMin + (this.gain - winMin) * this.relCoef;
      // 5) salida = audio RETRASADO × ganancia, con clamp final de seguridad al techo
      for (let c = 0; c < nCh; c++) {
        const d = this.delay[c];
        const delayed = d[this.dpos];
        d[this.dpos] = chIn[c][n];
        let y = delayed * this.gain;
        if (y > ceil) y = ceil; else if (y < -ceil) y = -ceil;
        out[c][n] = y;
      }
      this.dpos = (this.dpos + 1) % this.LA;
    }
    return out;
  }
}

// Medidor: pico REAL (dBTP) de un bloque, oversampleando ×4. Para el panel junto al LUFS.
export function blockTruePeakDb(chIn: Float32Array[], phases = 4): number {
  const banks = polyphaseBanks(phases, 12);
  const taps = banks[0].length;
  let mx = 0;
  for (const ch of chIn) {
    const h = new Float32Array(taps);
    for (let n = 0; n < ch.length; n++) {
      for (let i = taps - 1; i > 0; i--) h[i] = h[i - 1];
      h[0] = ch[n];
      for (let p = 0; p < phases; p++) {
        const b = banks[p];
        let y = 0;
        for (let t = 0; t < taps; t++) y += b[t] * h[t];
        const a = Math.abs(y);
        if (a > mx) mx = a;
      }
    }
  }
  return linToDb(mx);
}
