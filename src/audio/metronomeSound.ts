// SONIDO DEL METRÓNOMO (Fase 8.3): un «tic» corto de seno (más agudo y fuerte en el 1 del compás)
// registrado en superdough como «telar_click». La voz sale DIRECTO a los altavoces por su propia
// ganancia: a superdough le devolvemos un nodo mudo, así el clic no pasa por el máster (limitador,
// filtro DJ), no lo mide el LUFS, no lo graba el grabador y no entra en ninguna exportación.
import { registerSound, getAudioContext } from '@strudel/web';

let level = 0.5;
let out: { ctx: BaseAudioContext; gain: GainNode } | null = null;

function clickOut(ctx: BaseAudioContext): GainNode {
  if (out && out.ctx === ctx) return out.gain;
  const gain = new GainNode(ctx, { gain: level });
  gain.connect(ctx.destination);
  out = { ctx, gain };
  return gain;
}

// volumen del clic 0..1 (al instante, sin recompilar)
export function setClickLevel(v: number): void {
  level = Math.max(0, Math.min(1, Number(v) || 0));
  try {
    if (out) out.gain.gain.setTargetAtTime(level, out.ctx.currentTime, 0.01);
  } catch { /* nunca romper el audio */ }
}

let registered = false;
export function registerMetronomeSound(): void {
  if (registered) return;
  registered = true;
  registerSound('telar_click', (t: number, v: Record<string, unknown>, onended: () => void) => {
    const ctx = getAudioContext() as BaseAudioContext;
    const accent = Number(v.n) >= 1;
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: accent ? 1760 : 1175 });
    const env = new GainNode(ctx, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(accent ? 0.55 : 0.34, t + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.0005, t + (accent ? 0.06 : 0.045));
    osc.connect(env).connect(clickOut(ctx));
    osc.start(t);
    osc.stop(t + 0.08);
    const mute = new GainNode(ctx, { gain: 0 }); // lo que recibe superdough: silencio
    osc.onended = () => {
      try { env.disconnect(); mute.disconnect(); } catch { /* ya desconectado */ }
      onended();
    };
    return { node: mute, stop: (tt: number) => { try { osc.stop(tt); } catch { /* ya parado */ } } };
  }, { type: 'synth', prebake: true });
}
