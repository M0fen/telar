// ESPACIOS DE REVERB SINTÉTICOS — generación PURA de la respuesta al impulso (sin motor de audio).
// La usan los espacios `.ir("ir_hall")` de superdough (irReverb.ts, como samples) y el retorno de
// reverb compartido (fxReturns.ts, como buffer de un ConvolverNode a la frecuencia del contexto).
import { BUILTIN_IRS, type IrDef } from '../audio/irRegistry';

export interface IrSpace extends IrDef { decay: number; damp: number; predelay: number }

// Parámetros de generación por espacio (la duración/label salen de BUILTIN_IRS):
// decay=curva (mayor=cae antes), damp=oscuridad del tail (0..1, LPF de un polo),
// predelay=hueco inicial (s).
const GEN: Record<string, { decay: number; damp: number; predelay: number }> = {
  ir_room: { decay: 1.0, damp: 0.35, predelay: 0.004 },
  ir_plate: { decay: 0.85, damp: 0.12, predelay: 0.002 },
  ir_chamber: { decay: 0.95, damp: 0.3, predelay: 0.008 },
  ir_hall: { decay: 0.9, damp: 0.45, predelay: 0.012 },
  ir_cathedral: { decay: 0.95, damp: 0.6, predelay: 0.02 },
  ir_spring: { decay: 1.4, damp: 0.2, predelay: 0.001 },
};

export const IR_SPACES: IrSpace[] = BUILTIN_IRS.map((b) => ({
  ...b,
  ...(GEN[b.name] ?? { decay: 1.0, damp: 0.35, predelay: 0.004 }),
}));

// Un canal de IR: ruido * envolvente exp, con amortiguación (LPF de un polo), pre-delay y unas
// reflexiones tempranas para dar cuerpo. `sr` = frecuencia de muestreo (los tiempos no cambian).
// Semillas distintas por canal → estéreo decorrelacionado (anchura).
export function genIrChannel(sp: IrSpace, seed: number, sr = 44100): Float32Array {
  const n = Math.max(1, Math.floor(sp.duration * sr));
  const out = new Float32Array(n);
  // PRNG determinista simple (mulberry32) → IRs reproducibles entre sesiones.
  let s = seed >>> 0;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pre = Math.floor(sp.predelay * sr);
  const k = sp.decay * (6.9 / sp.duration); // -60 dB ≈ al final de la cola
  // el LPF de un polo se definió a 44,1 kHz: a otra frecuencia, el mismo corte en Hz
  const a = 1 - Math.pow(sp.damp, 44100 / sr);
  let lp = 0;
  // reflexiones tempranas (ms): pequeños picos que dan sensación de espacio
  const early = [0.007, 0.011, 0.017, 0.023, 0.031].map((t) => Math.floor(t * sr) + pre);
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / sr;
    const env = Math.exp(-k * t);
    let x = (rnd() * 2 - 1) * env;
    lp = lp + a * (x - lp); // paso-bajo de un polo (amortigua agudos del tail)
    x = lp;
    for (let e = 0; e < early.length; e++) if (i === early[e]) x += (0.5 - e * 0.08) * (rnd() * 2 - 1);
    out[i] = x;
  }
  // fade-in cortito para evitar click en el arranque
  const f = Math.min(64, n);
  for (let i = 0; i < f; i++) out[i] *= i / f;
  // normaliza a un pico razonable
  let peak = 1e-6;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.9 / peak;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

// los dos canales de un espacio (mismas semillas que los samples `ir_*`)
export function genIrStereo(name: string, sr = 44100): [Float32Array, Float32Array] | null {
  const i = IR_SPACES.findIndex((s) => s.name === name);
  if (i < 0) return null;
  const sp = IR_SPACES[i];
  return [genIrChannel(sp, 1000 + i * 7, sr), genIrChannel(sp, 5000 + i * 13, sr)];
}
