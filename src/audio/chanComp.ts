// COMPRESOR POR PISTA (Fase 6.1) — AudioWorklet en el bus de la pista (su orbit), después del EQ.
// Transcribe `lib/compCurve.ts` (la referencia probada): detector de pico estéreo, rodilla de
// 6 dB, suavizado en el dominio de la ganancia, makeup explícito y CERO latencia. Postea la
// reducción de ganancia para el medidor del canal.
//
// Defensivo (CLAUDE.md §4): si el módulo no carga en un contexto, el canal queda solo con su EQ
// (nunca mudo). Un módulo por contexto (en vivo y cada render offline).
import { COMP_KNEE_DB } from '../lib/compCurve';

const NAME = 'telar-chan-comp';

const SRC = `
class ChanComp extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thr', defaultValue: -18, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'att', defaultValue: 10, minValue: 0.05, maxValue: 500, automationRate: 'k-rate' },
      { name: 'rel', defaultValue: 120, minValue: 5, maxValue: 3000, automationRate: 'k-rate' },
      { name: 'makeup', defaultValue: 0, minValue: -12, maxValue: 30, automationRate: 'k-rate' },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.gs = 0; this.minGr = 0; this.frame = 0; }
  process(inputs, outputs, params) {
    var inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    var oL = out[0], oR = out[1] || out[0], n = oL.length, i;
    if (!inp || !inp.length || !inp[0]) { for (i = 0; i < n; i++) { oL[i] = 0; if (oR !== oL) oR[i] = 0; } this.gs = 0; return true; }
    var L = inp[0], R = inp[1] || inp[0];
    if (params.bypass[0] >= 0.5) { for (i = 0; i < n; i++) { oL[i] = L[i]; if (oR !== oL) oR[i] = R[i]; } this.gs = 0; return true; }
    var thr = params.thr[0], ratio = Math.max(1, params.ratio[0]), knee = ${COMP_KNEE_DB}, mk = params.makeup[0];
    var aA = Math.exp(-1 / (Math.max(0.01, params.att[0]) * 0.001 * sampleRate));
    var aR = Math.exp(-1 / (Math.max(0.01, params.rel[0]) * 0.001 * sampleRate));
    var gs = this.gs, minGr = this.minGr, inv = 1 / ratio - 1;
    // bajo la rodilla la curva no pide nada (gc = 0): sin log; y sin reducción en curso, la
    // ganancia es solo el makeup (sin exp). Mismo resultado que la referencia (compCurve.ts).
    var kneeLow = Math.exp((thr - knee / 2) * 0.1151292546497), mkLin = Math.exp(mk * 0.1151292546497);
    for (i = 0; i < n; i++) {
      var l = L[i], r = R[i];
      var a = l < 0 ? -l : l, b = r < 0 ? -r : r;
      if (b > a) a = b;
      var g;
      if (a < kneeLow) {
        gs = aR * gs;
        g = gs > -1e-5 ? mkLin : Math.exp((gs + mk) * 0.1151292546497);
      } else {
        var x = Math.log(a) * 8.685889638065;
        var d = x - thr, gc;
        if (2 * (d < 0 ? -d : d) <= knee) { var e = d + knee / 2; gc = inv * e * e / (2 * knee); }
        else gc = thr + d / ratio - x;
        gs = gc < gs ? aA * gs + (1 - aA) * gc : aR * gs + (1 - aR) * gc;
        g = Math.exp((gs + mk) * 0.1151292546497);
      }
      if (gs < minGr) minGr = gs;
      oL[i] = l * g; if (oR !== oL) oR[i] = r * g;
    }
    this.gs = gs; this.minGr = minGr;
    if (++this.frame >= 8) { this.port.postMessage(this.minGr); this.minGr = 0; this.frame = 0; }
    return true;
  }
}
registerProcessor('${NAME}', ChanComp);
`;

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
const ready = new WeakSet<BaseAudioContext>();

// carga el procesador en ese contexto (una vez); false si el navegador no puede
export function ensureCompModule(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        const url = URL.createObjectURL(new Blob([SRC], { type: 'application/javascript' }));
        try {
          await (ctx as AudioContext).audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        ready.add(ctx);
        return true;
      } catch (e) {
        console.warn('[compresor] el procesador no cargó; los canales quedan sin compresor:', e);
        return false;
      }
    })();
    loaded.set(ctx, p);
  }
  return p;
}
export const compModuleReady = (ctx: BaseAudioContext) => ready.has(ctx);

// reducción de ganancia por orbit (dB ≤ 0), para el medidor del canal (en vivo)
const grByOrbit = new Map<number, number>();
export const getOrbitGr = (orbit: number) => grByOrbit.get(orbit) ?? 0;

export function createCompNode(ctx: BaseAudioContext, orbit: number, meter: boolean): AudioWorkletNode | null {
  if (!ready.has(ctx)) return null;
  try {
    const n = new AudioWorkletNode(ctx, NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      outputChannelCount: [2],
    });
    if (meter) n.port.onmessage = (e) => { if (typeof e.data === 'number') grByOrbit.set(orbit, e.data); };
    return n;
  } catch {
    return null;
  }
}

export interface CompRoute { thr: number; ratio: number; att: number; rel: number; makeup: number }
export function setCompParams(node: AudioWorkletNode, c: CompRoute | null | undefined): void {
  try {
    const set = (k: string, v: number) => { const p = node.parameters.get(k); if (p) p.value = v; };
    if (!c) { set('bypass', 1); return; }
    set('bypass', 0);
    set('thr', c.thr);
    set('ratio', c.ratio);
    set('att', c.att);
    set('rel', c.rel);
    set('makeup', c.makeup);
  } catch { /* nunca romper el audio */ }
}
