// ENVÍOS Y RETORNOS (Fase 6.4): dos retornos COMPARTIDOS, como en una mesa —
//   · REVERB: pre-delay → convolución (los espacios de Telar o un IR tuyo) → corte de graves →
//     corte de agudos → nivel.
//   · ECO a tempo: retardo con la realimentación pasando por sus filtros (cada repetición más
//     fina y más oscura, como un eco de cinta) → nivel.
// Cada pista manda a cada retorno lo que diga su envío, DESPUÉS de su EQ, su compresor y su fader
// (sale de su tira de canal, ver engine.buildChanEq). Los retornos entran a la suma antes del
// máster como una pista más: los medidores, el máster y los stems los incluyen. Una sola reverb
// para todo el tema (antes cada pista con EQ tenía la suya, y su compresor bombeaba esa cola).
//
// Un objeto por contexto de audio (el en vivo y el de cada render offline). Si ninguna pista
// manda nada, los retornos quedan desconectados de la salida y no gastan CPU.
import { genIrStereo } from '../lib/irGen';
import { userIrDef } from './irRegistry';
import { DEFAULT_RETURNS, delaySeconds, dbToGain, type ReturnParams } from '../lib/returns';

const irCache = new Map<string, AudioBuffer>(); // `${espacio}@${sr}` (un AudioBuffer no es de ningún contexto)

function builtinIr(name: string, sr: number): AudioBuffer | null {
  const key = `${name}@${sr}`;
  const hit = irCache.get(key);
  if (hit) return hit;
  const lr = genIrStereo(name, sr);
  if (!lr) return null;
  const b = new AudioBuffer({ numberOfChannels: 2, length: lr[0].length, sampleRate: sr });
  b.copyToChannel(lr[0] as Float32Array<ArrayBuffer>, 0);
  b.copyToChannel(lr[1] as Float32Array<ArrayBuffer>, 1);
  irCache.set(key, b);
  return b;
}

const ramp = (p: AudioParam, v: number, t: number) => {
  try {
    p.cancelScheduledValues(t);
    p.setTargetAtTime(v, t, 0.02);
  } catch {
    p.value = v;
  }
};

export class FxReturns {
  readonly revIn: GainNode;
  readonly delIn: GainNode;
  readonly out: GainNode;
  private pre: DelayNode;
  private conv: ConvolverNode;
  private rvLow: BiquadFilterNode;
  private rvHigh: BiquadFilterNode;
  private rvGain: GainNode;
  private dl: DelayNode;
  private fb: GainNode;
  private dlLow: BiquadFilterNode;
  private dlHigh: BiquadFilterNode;
  private dlGain: GainNode;
  private space = '';
  private applied = false; // el primer `set` va directo (sin deslizar desde los valores de fábrica)
  // nivel AUTOMATIZADO (7.2, dB): mientras suena, la curva manda sobre la perilla
  levelOverride: { rv?: number; dl?: number } = {};
  private levelAuto: { rv?: boolean; dl?: boolean } = {}; // render: curva agendada (set() no la pisa)
  ready: Promise<void> = Promise.resolve();
  dest: AudioNode | null = null; // a qué suma de superdough está conectada la salida

  constructor(readonly ctx: BaseAudioContext) {
    this.revIn = new GainNode(ctx, { gain: 1 });
    this.delIn = new GainNode(ctx, { gain: 1 });
    this.out = new GainNode(ctx, { gain: 1 });
    // reverb
    this.pre = new DelayNode(ctx, { maxDelayTime: 0.2, delayTime: DEFAULT_RETURNS.rvPre / 1000 });
    this.conv = new ConvolverNode(ctx); // normalize: nivel parecido entre espacios
    this.rvLow = new BiquadFilterNode(ctx, { type: 'highpass', frequency: DEFAULT_RETURNS.rvLow, Q: 0.707 });
    this.rvHigh = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: DEFAULT_RETURNS.rvHigh, Q: 0.707 });
    this.rvGain = new GainNode(ctx, { gain: 1 });
    this.revIn.connect(this.pre);
    this.pre.connect(this.conv);
    this.conv.connect(this.rvLow);
    this.rvLow.connect(this.rvHigh);
    this.rvHigh.connect(this.rvGain);
    this.rvGain.connect(this.out);
    // eco: la realimentación vuelve a pasar por los filtros
    this.dl = new DelayNode(ctx, { maxDelayTime: 4, delayTime: 0.375 });
    this.dlLow = new BiquadFilterNode(ctx, { type: 'highpass', frequency: DEFAULT_RETURNS.dlLow, Q: 0.707 });
    this.dlHigh = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: DEFAULT_RETURNS.dlHigh, Q: 0.707 });
    this.fb = new GainNode(ctx, { gain: DEFAULT_RETURNS.dlFb });
    this.dlGain = new GainNode(ctx, { gain: 1 });
    this.delIn.connect(this.dl);
    this.dl.connect(this.dlLow);
    this.dlLow.connect(this.dlHigh);
    this.dlHigh.connect(this.fb);
    this.fb.connect(this.dl);
    this.dlHigh.connect(this.dlGain);
    this.dlGain.connect(this.out);
  }

  // aplica los parámetros desde `at` (por defecto, ahora); `secPerBeat` = duración de un pulso
  set(p: ReturnParams, secPerBeat: number, at?: number): void {
    const t = at ?? this.ctx.currentTime;
    const go = (prm: AudioParam, v: number) => {
      if (this.applied) ramp(prm, v, t);
      else prm.setValueAtTime(v, t);
    };
    this.loadSpace(p.rvSpace);
    go(this.pre.delayTime, p.rvPre / 1000);
    go(this.rvLow.frequency, p.rvLow);
    go(this.rvHigh.frequency, p.rvHigh);
    if (!this.levelAuto.rv) go(this.rvGain.gain, dbToGain(this.levelOverride.rv ?? p.rvLevel));
    go(this.dl.delayTime, delaySeconds(p.dlNote, secPerBeat));
    go(this.fb.gain, Math.min(0.9, Math.max(0, p.dlFb)));
    go(this.dlLow.frequency, p.dlLow);
    go(this.dlHigh.frequency, p.dlHigh);
    if (!this.levelAuto.dl) go(this.dlGain.gain, dbToGain(this.levelOverride.dl ?? p.dlLevel));
    this.applied = true;
  }

  // RENDER (7.2): agenda la curva del nivel de un retorno (ganancias ya en lineal) desde `t0`
  automateLevel(which: 'rv' | 'dl', values: Float32Array, t0: number, dur: number): void {
    const g = which === 'rv' ? this.rvGain.gain : this.dlGain.gain;
    this.levelAuto[which] = true;
    try {
      g.cancelScheduledValues(t0);
      g.setValueCurveAtTime(values, t0, Math.max(0.001, dur));
    } catch { /* sin curva: queda la perilla */ }
  }

  private loadSpace(name: string): void {
    if (name === this.space) return;
    this.space = name;
    const sr = this.ctx.sampleRate;
    const b = builtinIr(name, sr);
    if (b) {
      this.conv.buffer = b;
      return;
    }
    const u = userIrDef(name);
    if (!u?.url) {
      this.space = DEFAULT_RETURNS.rvSpace;
      this.conv.buffer = builtinIr(DEFAULT_RETURNS.rvSpace, sr);
      return;
    }
    // un IR tuyo (Bricasti, OpenAIR…): se decodifica a la frecuencia de este contexto
    this.ready = fetch(u.url)
      .then((r) => r.arrayBuffer())
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => {
        if (this.space === name) this.conv.buffer = buf;
      })
      .catch(() => {
        if (this.space === name) this.conv.buffer = builtinIr(DEFAULT_RETURNS.rvSpace, sr);
      });
  }

  // conecta la salida a la suma de superdough (antes del máster); sin `dest`, la desconecta
  connectTo(dest: AudioNode | null, connect: ((node: AudioNode) => void) | null): void {
    if (dest === this.dest) return;
    try { this.out.disconnect(); } catch { /* no estaba conectada */ }
    this.dest = null;
    if (!dest || !connect) return;
    try {
      connect(this.out);
      this.dest = dest;
    } catch { /* sin salida: queda muda */ }
  }
}

const byCtx = new WeakMap<BaseAudioContext, FxReturns>();
export function returnsFor(ctx: BaseAudioContext): FxReturns {
  let r = byCtx.get(ctx);
  if (!r) {
    r = new FxReturns(ctx);
    byCtx.set(ctx, r);
  }
  return r;
}

// --- en vivo: los parámetros del máster y el tempo del proyecto ---
let liveParams: ReturnParams = DEFAULT_RETURNS;
let beatSec: () => number = () => 0.5;
let liveRet: FxReturns | null = null;
export function setReturnsTempoSource(fn: () => number): void {
  beatSec = fn;
}
export function setReturnParams(p: ReturnParams): void {
  liveParams = p;
  try {
    if (liveRet?.dest) liveRet.set(p, beatSec());
  } catch { /* nunca romper el audio */ }
}
// nivel de los retornos AUTOMATIZADO (7.2): {rv, dl} en dB, o null para volver a la perilla
export function setReturnLevelOverride(o: { rv?: number; dl?: number } | null): void {
  try {
    if (!liveRet) return;
    liveRet.levelOverride = o ?? {};
    if (liveRet.dest) liveRet.set(liveParams, beatSec());
  } catch { /* nunca romper el audio */ }
}

// (re)asegura los retornos del contexto en vivo: conectados a la suma solo si alguna pista manda
export function applyLiveReturns(ctx: BaseAudioContext, dest: AudioNode | null, connect: (node: AudioNode) => void, needed: boolean): void {
  try {
    const r = returnsFor(ctx);
    liveRet = r;
    if (!needed) {
      r.connectTo(null, null);
      return;
    }
    r.set(liveParams, beatSec());
    r.connectTo(dest, connect);
  } catch { /* nunca romper el audio */ }
}
