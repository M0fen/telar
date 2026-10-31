// MATEMÁTICA DE LA MEZCLA VISUAL (Fase 11) — lógica PURA (testeable en Node).
//   · ejes: frecuencia logarítmica (20 Hz – 20 kHz) y dB;
//   · la curva del EQ de la tira (los mismos tres filtros del motor: estante grave 120 Hz,
//     campana de medios Q 1 en su frecuencia, estante agudo 4,5 kHz), con las fórmulas de los
//     biquad de Web Audio (RBJ);
//   · correlación y balance estéreo; macros (una perilla → varias).
import type { ChannelEq } from '../graph/types';

export const F_MIN = 20;
export const F_MAX = 20000;
export const freqToX = (f: number, w: number) => (Math.log(Math.max(F_MIN, Math.min(F_MAX, f)) / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
export const xToFreq = (x: number, w: number) => F_MIN * Math.pow(F_MAX / F_MIN, Math.max(0, Math.min(1, x / Math.max(1, w))));
export const dbToY = (db: number, h: number, lo: number, hi: number) => ((hi - Math.max(lo, Math.min(hi, db))) / (hi - lo)) * h;
export const yToDb = (y: number, h: number, lo: number, hi: number) => hi - (Math.max(0, Math.min(h, y)) / Math.max(1, h)) * (hi - lo);

export const EQ_LOW_HZ = 120;
export const EQ_HIGH_HZ = 4500;
export const EQ_MID_Q = 1;
export const EQ_RANGE = 15; // ± dB que deja la tira (el kill del DJ baja a −30)

type Coef = [number, number, number, number, number, number]; // b0 b1 b2 a0 a1 a2
// coeficientes como los BiquadFilterNode de Web Audio (Audio EQ Cookbook; los estantes con S = 1)
function biquad(type: 'lowshelf' | 'highshelf' | 'peaking', f0: number, gainDb: number, q: number, sr: number): Coef {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  if (type === 'peaking') {
    const alpha = sw / (2 * q);
    return [1 + alpha * A, -2 * cw, 1 - alpha * A, 1 + alpha / A, -2 * cw, 1 - alpha / A];
  }
  const alpha = (sw / 2) * Math.SQRT2; // S = 1
  const k = 2 * Math.sqrt(A) * alpha;
  if (type === 'lowshelf') {
    return [A * (A + 1 - (A - 1) * cw + k), 2 * A * (A - 1 - (A + 1) * cw), A * (A + 1 - (A - 1) * cw - k), A + 1 + (A - 1) * cw + k, -2 * (A - 1 + (A + 1) * cw), A + 1 + (A - 1) * cw - k];
  }
  return [A * (A + 1 + (A - 1) * cw + k), -2 * A * (A - 1 + (A + 1) * cw), A * (A + 1 + (A - 1) * cw - k), A + 1 - (A - 1) * cw + k, 2 * (A - 1 - (A + 1) * cw), A + 1 - (A - 1) * cw - k];
}
function magDb(c: Coef, f: number, sr: number): number {
  const w = (2 * Math.PI * f) / sr;
  const cr = (b0: number, b1: number, b2: number) => {
    const re = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w);
    const im = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
    return re * re + im * im;
  };
  return 10 * Math.log10(cr(c[0], c[1], c[2]) / cr(c[3], c[4], c[5]));
}
// respuesta del EQ de la tira (dB) en cada frecuencia
export function eqResponse(eq: ChannelEq | undefined, freqs: number[], sr = 48000): number[] {
  const low = eq?.low ?? 0, mid = eq?.mid ?? 0, high = eq?.high ?? 0;
  const mf = Math.max(200, Math.min(8000, eq?.midFreq ?? 1000));
  const on = !!eq && eq.on !== false;
  if (!on) return freqs.map(() => 0);
  const cs: Coef[] = [biquad('lowshelf', EQ_LOW_HZ, low, 1, sr), biquad('peaking', mf, mid, EQ_MID_Q, sr), biquad('highshelf', EQ_HIGH_HZ, high, 1, sr)];
  return freqs.map((f) => cs.reduce((a, c) => a + magDb(c, f, sr), 0));
}

// CORRELACIÓN estéreo (−1 fuera de fase · 0 sin relación · +1 mono) y BALANCE (−1 izq · +1 der)
export function stereoStats(L: Float32Array, R: Float32Array): { corr: number; bal: number; width: number } {
  let lr = 0, ll = 0, rr = 0;
  const n = Math.min(L.length, R.length);
  for (let i = 0; i < n; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
  const den = Math.sqrt(ll * rr);
  const corr = den > 1e-12 ? lr / den : 0;
  const tot = ll + rr;
  const bal = tot > 1e-12 ? (rr - ll) / tot : 0;
  // ancho: cuánto lado (L−R) hay frente al centro (L+R)
  let mm = 0, ss = 0;
  for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = (L[i] - R[i]) / 2; mm += m * m; ss += s * s; }
  const width = mm + ss > 1e-12 ? ss / (mm + ss) : 0;
  return { corr, bal, width };
}

// MACROS (11.5): una perilla 0..1 mueve varias, cada una entre su mínimo y su máximo
export interface MacroTarget { node: string; key: string; min: number; max: number }
export interface Macro { name: string; v: number; targets: MacroTarget[] }
export const MACRO_SLOTS = 4;
export const macroValue = (t: MacroTarget, v: number) => t.min + (t.max - t.min) * Math.max(0, Math.min(1, v));
export function cleanMacros(raw: unknown): Macro[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: MACRO_SLOTS }, (_, i) => {
    const m = arr[i] as Partial<Macro> | undefined;
    const targets = Array.isArray(m?.targets) ? (m!.targets as MacroTarget[]).filter((t) => t && typeof t.node === 'string' && typeof t.key === 'string' && Number.isFinite(t.min) && Number.isFinite(t.max)).slice(0, 8) : [];
    return { name: typeof m?.name === 'string' && m.name ? m.name.slice(0, 16) : `macro ${i + 1}`, v: Math.max(0, Math.min(1, Number(m?.v ?? 0) || 0)), targets };
  });
}
