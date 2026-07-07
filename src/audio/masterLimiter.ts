// LIMITADOR TRUE-PEAK del máster como AudioWorklet (Tier 1, paso 2). Transcribe el núcleo
// probado en `truePeakLimiter.ts` (oversample 4x polifásico + lookahead con mínimo
// deslizante + release + clamp) al HILO DE AUDIO. Es la ÚLTIMA etapa antes de la salida:
// garantiza pico REAL ≤ techo (−1 dBTP) → sin clipping ni distorsión al codificar a MP3/AAC.
//
// Defensivo (CLAUDE.md §4): si el worklet no carga, `getMasterLimiterNode` devuelve null y
// el motor deja la salida DIRECTA (sin ceiling, pero nunca muda). Postea métricas
// (true-peak y reducción de ganancia) al hilo principal para el medidor junto al LUFS.

const WORKLET_NAME = 'telar-tp-limiter';

// Processor inline (Blob URL) — no depende de ?url/rutas en prod (igual que el grabador).
const WORKLET_SRC = `
class TPLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ceilingDb', defaultValue: -1, minValue: -12, maxValue: 0 }, { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1 }]; }
  constructor() {
    super();
    var sr = sampleRate, phases = 4, taps = 12;
    this.phases = phases; this.taps = taps;
    // banco polifásico (sinc*Blackman), cada fase normalizada a ganancia DC 1
    var N = phases * taps, fc = 0.5 / phases, mid = (N - 1) / 2, proto = new Float32Array(N), i, p, t;
    for (i = 0; i < N; i++) {
      var x = i - mid;
      var sinc = Math.abs(x) < 1e-9 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      var w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
      proto[i] = sinc * w;
    }
    this.banks = [];
    for (p = 0; p < phases; p++) {
      var b = new Float32Array(taps), s = 0;
      for (t = 0; t < taps; t++) { b[t] = proto[t * phases + p]; s += b[t]; }
      if (Math.abs(s) > 1e-9) for (t = 0; t < taps; t++) b[t] /= s;
      this.banks.push(b);
    }
    this.LA = Math.max(1, Math.round(sr * 0.0015));
    this.relCoef = Math.exp(-1 / (sr * 0.06));
    this.histL = new Float32Array(taps); this.histR = new Float32Array(taps);
    this.delayL = new Float32Array(this.LA); this.delayR = new Float32Array(this.LA);
    this.dpos = 0; this.gain = 1;
    this.tRing = new Float32Array(this.LA + 1); this.tRing.fill(1); this.tPos = 0;
    this.mTp = 0; this.mGr = 1; this.frame = 0;
  }
  tp(hist, x) {
    var taps = this.taps, i, p, t;
    for (i = taps - 1; i > 0; i--) hist[i] = hist[i - 1];
    hist[0] = x;
    var mx = 0;
    for (p = 0; p < this.phases; p++) {
      var b = this.banks[p], y = 0;
      for (t = 0; t < taps; t++) y += b[t] * hist[t];
      var a = y < 0 ? -y : y;
      if (a > mx) mx = a;
    }
    return mx;
  }
  minPush(x) {
    this.tRing[this.tPos] = x; this.tPos = (this.tPos + 1) % this.tRing.length;
    var m = 1, k, r = this.tRing;
    for (k = 0; k < r.length; k++) if (r[k] < m) m = r[k];
    return m;
  }
  process(inputs, outputs, params) {
    var inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    var oL = out[0], oR = out[1] || out[0], nn = oL.length, i;
    if (!inp || !inp.length || !inp[0]) { for (i = 0; i < nn; i++) { oL[i] = 0; if (oR !== oL) oR[i] = 0; } return true; }
    var L = inp[0], R = inp[1] || inp[0];
    var ceil = Math.pow(10, params.ceilingDb[0] / 20);
    var bypass = params.bypass[0] >= 0.5;
    for (i = 0; i < nn; i++) {
      var tpL = this.tp(this.histL, L[i]), tpR = this.tp(this.histR, R[i]);
      var peak = tpL > tpR ? tpL : tpR;
      if (peak > this.mTp) this.mTp = peak;
      var target = peak > ceil ? ceil / peak : 1;
      var wm = this.minPush(target);
      if (wm < this.gain) this.gain = wm; else this.gain = wm + (this.gain - wm) * this.relCoef;
      if (this.gain < this.mGr) this.mGr = this.gain;
      var dL = this.delayL[this.dpos], dR = this.delayR[this.dpos];
      this.delayL[this.dpos] = L[i]; this.delayR[this.dpos] = R[i];
      var g = bypass ? 1 : this.gain;
      var yL = dL * g, yR = dR * g;
      if (!bypass) { if (yL > ceil) yL = ceil; else if (yL < -ceil) yL = -ceil; if (yR > ceil) yR = ceil; else if (yR < -ceil) yR = -ceil; }
      oL[i] = yL; if (oR !== oL) oR[i] = yR;
      this.dpos = (this.dpos + 1) % this.LA;
    }
    if (++this.frame >= 8) {
      this.port.postMessage({ tp: this.mTp > 1e-9 ? 20 * Math.log10(this.mTp) : -100, gr: this.mGr < 1 ? 20 * Math.log10(this.mGr) : 0 });
      this.mTp = 0; this.mGr = 1; this.frame = 0;
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', TPLimiter);
`;

export interface LimiterMetrics { truePeakDb: number; gainReductionDb: number }
let metrics: LimiterMetrics = { truePeakDb: -100, gainReductionDb: 0 };
export function getLimiterMetrics(): LimiterMetrics { return metrics; }

let node: AudioWorkletNode | null = null;
let nodePromise: Promise<AudioWorkletNode | null> | null = null;
let builtCtx: BaseAudioContext | null = null;

// nodo del limitador para ESTE contexto, o null si no está listo / falló (→ salida directa).
export function getMasterLimiterNode(ctx: BaseAudioContext): AudioWorkletNode | null {
  return node && node.context === ctx ? node : null;
}

// Carga el worklet y crea el nodo UNA sola vez por contexto (idempotente aunque se llame
// muchas veces); llama onReady cuando el nodo existe. Nunca lanza: ante fallo deja el nodo
// en null y el motor usa la salida DIRECTA (sin ceiling, jamás muda).
export async function ensureMasterLimiter(ctx: BaseAudioContext, onReady?: (n: AudioWorkletNode) => void): Promise<void> {
  if (node && node.context === ctx) { onReady?.(node); return; }
  if (!nodePromise || builtCtx !== ctx) {
    builtCtx = ctx;
    node = null; // ctx nuevo (reset del motor) → recrear
    nodePromise = (async () => {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
        await (ctx as AudioContext).audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const n = new AudioWorkletNode(ctx, WORKLET_NAME, {
          numberOfInputs: 1, numberOfOutputs: 1,
          channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
          outputChannelCount: [2],
        });
        n.port.onmessage = (e) => {
          const d = e.data as { tp?: number; gr?: number };
          if (d && typeof d.tp === 'number') metrics = { truePeakDb: d.tp, gainReductionDb: d.gr ?? 0 };
        };
        node = n;
        return n;
      } catch (e) {
        console.warn('[tp-limiter] worklet no disponible → salida sin ceiling true-peak:', e);
        node = null;
        return null;
      }
    })();
  }
  const n = await nodePromise;
  if (n) onReady?.(n);
}

// bypass en caliente (A/B) sin re-cablear: pone el AudioParam del worklet.
export function setLimiterBypass(on: boolean): void {
  try {
    const p = node?.parameters.get('bypass');
    if (p) p.setValueAtTime(on ? 1 : 0, node!.context.currentTime);
  } catch { /* nunca romper */ }
}
