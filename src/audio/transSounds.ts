// SONIDOS DE LAS TRANSICIONES (Fase 7.4) — instrumentos propios registrados en superdough.
//
// El riser y el reverso duran compases enteros. Con los sintes de superdough eso era UNA voz
// larga que nadie podía parar: superdough guarda sus voces con WeakRef y su robo de voces no
// alcanza las que ya recogió el recolector → con ■ el riser seguía subiendo hasta 16 s. Aquí cada
// voz se arma a mano (Web Audio) y queda anotada: ■ las baja en 30 ms (sin clic) y las para.
// Además las curvas son las de un riser de verdad: el volumen sube en curva (no en recta: crece de
// verdad al final), los filtros barren en exponencial y la sierra sube dos octavas.
//   · telar_riser:   ruido estéreo por un paso-alto 250 Hz → 8 kHz + sierra (nota del evento) que
//                    sube dos octavas; termina CORTANDO en seco al final del evento.
//   · telar_reverse: ruido rosa estéreo por un paso-bajo 300 Hz → 13 kHz que crece cada vez más
//                    rápido (como un platillo al revés) y se corta al final del evento.
//   · telar_boom:    seno que cae 30 semitonos hasta la nota del evento, con caída natural.
//   · telar_crash:   «crash» de ruido agudo con cola larga que se oscurece al apagarse.
// Lo demás (ganancia, orbit, paneo, envíos) lo aplica superdough y la tira de la pista.
import { registerSound, getAudioContext } from '@strudel/web';

interface Voice {
  ctx: BaseAudioContext;
  kill: GainNode; // ganancia final: ■ la baja a 0
  srcs: AudioScheduledSourceNode[];
}
const voices = new Set<Voice>();

// ruido estéreo (canales independientes) por contexto, 4 s en bucle
const noiseCache = new WeakMap<BaseAudioContext, { white?: AudioBuffer; pink?: AudioBuffer }>();
function noise(ctx: BaseAudioContext, kind: 'white' | 'pink'): AudioBuffer {
  const c = noiseCache.get(ctx) ?? {};
  noiseCache.set(ctx, c);
  const have = c[kind];
  if (have) return have;
  const n = Math.round(ctx.sampleRate * 4);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    if (kind === 'white') {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    } else {
      // rosa (Paul Kellet), normalizado a un RMS parecido al del blanco
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ss = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        ss += d[i] * d[i];
      }
      // mismo RMS que el blanco y los picos raros redondeados (tanh a ~2,5 RMS): sin cresta de −3 dBFS
      const k = 0.577 / Math.sqrt(ss / n || 1);
      for (let i = 0; i < n; i++) d[i] = 1.44 * Math.tanh((d[i] * k) / 1.44);
    }
  }
  c[kind] = buf;
  return buf;
}

// curva 0 → 1 con forma u^p (p = 2: crece en curva; p = 3: casi todo al final)
const curves = new Map<number, Float32Array>();
function rise(p: number): Float32Array {
  let c = curves.get(p);
  if (!c) {
    c = new Float32Array(256);
    for (let i = 0; i < 256; i++) c[i] = Math.pow(i / 255, p);
    curves.set(p, c);
  }
  return c;
}

const freqOf = (v: Record<string, unknown>, fallback: number): number => {
  const f = Number(v.freq);
  if (f > 0) return f;
  const n = Number(v.note);
  return Number.isFinite(n) ? 440 * Math.pow(2, (n - 69) / 12) : fallback;
};

// voz anotada: devuelve lo que superdough espera ({ node, stop }) y avisa al terminar
function voice(ctx: BaseAudioContext, out: AudioNode, srcs: AudioScheduledSourceNode[], end: number, onended: () => void) {
  const kill = new GainNode(ctx, { gain: 1 });
  out.connect(kill);
  const v: Voice = { ctx, kill, srcs };
  voices.add(v);
  let left = srcs.length;
  for (const s of srcs) {
    s.onended = () => {
      if (--left > 0) return;
      voices.delete(v);
      try { kill.disconnect(); } catch { /* */ }
      onended();
    };
    s.stop(end);
  }
  return {
    node: kill,
    stop: (t: number) => { for (const s of srcs) { try { s.stop(t); } catch { /* ya parado */ } } },
  };
}

const dur = (v: Record<string, unknown>) => Math.max(0.05, Number(v.duration) || 1);

let registered = false;
export function registerTransitionSounds(): void {
  if (registered) return;
  registered = true;
  registerSound('telar_riser', (t: number, v: Record<string, unknown>, onended: () => void) => {
    const ctx = getAudioContext() as BaseAudioContext;
    const T = dur(v);
    const f0 = freqOf(v, 130.81);
    const ns = new AudioBufferSourceNode(ctx, { buffer: noise(ctx, 'white'), loop: true, loopStart: 0, loopEnd: 4 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 250, Q: 0.7 });
    hp.frequency.setValueAtTime(250, t);
    hp.frequency.exponentialRampToValueAtTime(8000, t + T);
    const ng = new GainNode(ctx, { gain: 0.26 });
    ns.connect(hp).connect(ng);
    const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f0 });
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 4, t + T);
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2200, Q: 0.7 });
    const sg = new GainNode(ctx, { gain: 0.08 });
    osc.connect(lp).connect(sg);
    const env = new GainNode(ctx, { gain: 0 });
    ng.connect(env);
    sg.connect(env);
    env.gain.setValueCurveAtTime(rise(2), t, T);
    env.gain.linearRampToValueAtTime(0, t + T + 0.012); // el corte del drop
    ns.start(t, Math.random() * 3);
    osc.start(t);
    return voice(ctx, env, [ns, osc], t + T + 0.03, onended);
  }, { type: 'synth', prebake: true });

  registerSound('telar_reverse', (t: number, v: Record<string, unknown>, onended: () => void) => {
    const ctx = getAudioContext() as BaseAudioContext;
    const T = dur(v);
    const ns = new AudioBufferSourceNode(ctx, { buffer: noise(ctx, 'pink'), loop: true, loopStart: 0, loopEnd: 4 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 300, Q: 0.9 });
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(13000, t + T);
    const env = new GainNode(ctx, { gain: 0 });
    ns.connect(lp).connect(env);
    env.gain.setValueCurveAtTime(rise(3).map((x) => x * 0.27), t, T);
    env.gain.linearRampToValueAtTime(0, t + T + 0.006);
    ns.start(t, Math.random() * 3);
    return voice(ctx, env, [ns], t + T + 0.02, onended);
  }, { type: 'synth', prebake: true });

  registerSound('telar_boom', (t: number, v: Record<string, unknown>, onended: () => void) => {
    const ctx = getAudioContext() as BaseAudioContext;
    const f = freqOf(v, 41.2);
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: f * Math.pow(2, 30 / 12) });
    osc.frequency.setValueAtTime(f * Math.pow(2, 30 / 12), t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.3);
    const env = new GainNode(ctx, { gain: 0 });
    osc.connect(env);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.34, t + 0.003);
    env.gain.setTargetAtTime(0, t + 0.003, 0.45);
    osc.start(t);
    return voice(ctx, env, [osc], t + 3.2, onended);
  }, { type: 'synth', prebake: true });

  registerSound('telar_crash', (t: number, _v: Record<string, unknown>, onended: () => void) => {
    const ctx = getAudioContext() as BaseAudioContext;
    const ns = new AudioBufferSourceNode(ctx, { buffer: noise(ctx, 'white'), loop: true, loopStart: 0, loopEnd: 4 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1800, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 14000, Q: 0.5 });
    lp.frequency.setValueAtTime(14000, t);
    lp.frequency.exponentialRampToValueAtTime(3500, t + 2.5); // se oscurece al apagarse, como un platillo
    const env = new GainNode(ctx, { gain: 0 });
    ns.connect(hp).connect(lp).connect(env);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.002);
    env.gain.setTargetAtTime(0.065, t + 0.002, 0.05); // golpe
    env.gain.setTargetAtTime(0, t + 0.12, 0.6); // cola (−60 dB en unos 4 s)
    ns.start(t, Math.random() * 3);
    return voice(ctx, env, [ns], t + 4.5, onended);
  }, { type: 'synth', prebake: true });
}

// ■: baja a 0 en 30 ms y para las voces de transición que suenan en `ctx` (el contexto en vivo).
// Devuelve cuántas había.
export function stopTransitionVoices(ctx: BaseAudioContext, fade = 0.03): number {
  let n = 0;
  for (const v of voices) {
    if (v.ctx !== ctx) continue;
    n++;
    try {
      const now = ctx.currentTime;
      v.kill.gain.cancelScheduledValues(now);
      v.kill.gain.setValueAtTime(v.kill.gain.value, now);
      v.kill.gain.linearRampToValueAtTime(0, now + fade);
      for (const s of v.srcs) { try { s.stop(now + fade + 0.01); } catch { /* ya parado */ } }
    } catch { /* nunca romper el audio */ }
  }
  return n;
}
