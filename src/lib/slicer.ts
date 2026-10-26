// REBANADOR (Fase 5.4) — lógica PURA (testeable en Node).
//
// Un loop se parte en rebanadas (8, 16 o 32 iguales, o cortes en sus transientes) y cada HUECO de
// la vuelta toca la rebanada que quieras: así se reordenan los top loops de Splice. Todo vive en
// el código, con `.slice` de Strudel:
//
//   iguales:     s("wl_top").slice(16, "0 1 2 3 … 15").slow(4)
//   transientes: s("wl_top").slice([0, 0.061, 0.13, …, 1], "0@610 1@690 2@…").slow(4)
//
// En transientes cada hueco dura lo que dura su rebanada en el original (pesos @ en diezmilésimas
// de la vuelta): con el orden normal suena EXACTO como el loop, con su groove; al reordenar, cada
// hueco toca otra rebanada en el mismo sitio. Un hueco en silencio es «~».
import { fft } from '../audio/fft';

export interface SliceState {
  base: string; // s("nombre")
  cuts: number | number[] | null; // N iguales, o puntos de corte 0…1 (con 0 y 1); null = sin rebanar
  slots: (number | null)[]; // rebanada que suena en cada hueco (null = silencio)
  weights: number[] | null; // duración de cada hueco (transientes); null = huecos iguales
  cycles: number; // ciclos que dura la vuelta (.slow)
}

const NUM = /^\d+$/;

// `s("x")` [.slice(N | [...], "patrón")] [.slow(c)] — nada más (un arreglo o más métodos: null)
export function parseSliceCode(code: string): SliceState | null {
  const m = /^(s\(\s*["'`][A-Za-z0-9_]+["'`]\s*\))(?:\.slice\(\s*(\d+|\[[^\]]*\])\s*,\s*"([^"]*)"\s*\))?(?:\.slow\(\s*([0-9.]+)\s*\))?$/.exec((code || '').trim());
  if (!m) return null;
  const cycles = m[4] ? Number(m[4]) : 1;
  if (!(cycles > 0)) return null;
  if (!m[2]) return { base: m[1], cuts: null, slots: [], weights: null, cycles };
  let cuts: number | number[];
  if (NUM.test(m[2])) cuts = Number(m[2]);
  else {
    try {
      const arr = JSON.parse(m[2]) as unknown;
      if (!Array.isArray(arr) || arr.length < 2 || !arr.every((x) => typeof x === 'number')) return null;
      cuts = arr as number[];
    } catch {
      return null;
    }
  }
  const toks = m[3].trim().split(/\s+/).filter(Boolean);
  const slots: (number | null)[] = [];
  const weights: number[] = [];
  for (const t of toks) {
    const [v, w] = t.split('@');
    slots.push(v === '~' || v === '-' ? null : NUM.test(v) ? Number(v) : null);
    weights.push(w != null && Number(w) > 0 ? Number(w) : 1);
  }
  const weighted = toks.some((t) => t.includes('@'));
  return { base: m[1], cuts, slots, weights: weighted ? weights : null, cycles };
}

const fmtCut = (x: number) => String(Math.round(x * 10000) / 10000);
const fmtCyc = (x: number) => String(Math.round(x * 10000) / 10000);

export function buildSliceCode(st: SliceState): string {
  const slow = Math.abs(st.cycles - 1) > 1e-9 ? `.slow(${fmtCyc(st.cycles)})` : '';
  if (st.cuts == null) return `${st.base}${slow}`;
  const cuts = Array.isArray(st.cuts) ? `[${st.cuts.map(fmtCut).join(', ')}]` : String(st.cuts);
  const toks = st.slots.map((s, i) => `${s == null ? '~' : s}${st.weights ? `@${Math.max(1, Math.round(st.weights[i] ?? 1))}` : ''}`);
  return `${st.base}.slice(${cuts}, "${toks.join(' ')}")${slow}`;
}

export const sliceCount = (cuts: number | number[] | null) => (cuts == null ? 0 : Array.isArray(cuts) ? cuts.length - 1 : cuts);

// límites [begin, end] de una rebanada (fracciones del sample)
export function sliceBounds(cuts: number | number[], i: number): [number, number] {
  if (Array.isArray(cuts)) return [cuts[i] ?? 0, cuts[i + 1] ?? 1];
  return [i / cuts, (i + 1) / cuts];
}

// N rebanadas iguales en orden
export function evenSlices(base: string, n: number, cycles: number): SliceState {
  return { base, cuts: n, slots: Array.from({ length: n }, (_, i) => i), weights: null, cycles };
}

// rebanadas en los transientes (fracciones de la vuelta, con 0 y 1), en orden y con su duración
export function transientSlices(base: string, cuts: number[], cycles: number): SliceState {
  const c = normalizeCuts(cuts);
  const weights = c.slice(1).map((e, i) => Math.max(1, Math.round((e - c[i]) * 10000)));
  return { base, cuts: c, slots: weights.map((_, i) => i), weights, cycles };
}

// ordenados, en [0, 1), sin duplicados cercanos (< 0,5 % de la vuelta), con 0 y 1
export function normalizeCuts(cuts: number[]): number[] {
  const s = [...new Set(cuts.filter((x) => x > 0 && x < 0.995).map((x) => Math.round(x * 10000) / 10000))].sort((a, b) => a - b);
  const out: number[] = [0];
  for (const x of s) if (x - out[out.length - 1] >= 0.005) out.push(x);
  out.push(1);
  return out;
}

// reordenar: al revés, al azar (Fisher-Yates), normal
export const reverseSlots = (slots: (number | null)[]) => slots.slice().reverse();
export function shuffleSlots(slots: (number | null)[], rand: () => number = Math.random): (number | null)[] {
  const a = slots.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- TRANSIENTES: flujo espectral (log-magnitud) + selección de picos + ajuste fino al ataque ---
// Devuelve posiciones en muestras (siempre incluye 0), como máximo `maxCount`.
export function detectOnsets(chans: Float32Array[], sr: number, o: { minGapSec?: number; maxCount?: number } = {}): number[] {
  const N = 1024;
  const H = 256;
  const n = chans[0]?.length ?? 0;
  if (n < N * 2) return [0];
  const x = new Float32Array(n);
  for (const c of chans) for (let i = 0; i < n; i++) x[i] += c[i] / chans.length;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const frames = Math.floor((n - N) / H) + 1;
  const flux = new Float32Array(frames);
  let prev = new Float32Array(N / 2);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = x[f * H + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float32Array(N / 2);
    let sum = 0;
    for (let k = 0; k < N / 2; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0 && f > 0) sum += d;
    }
    flux[f] = sum;
    prev = mag;
  }
  let max = 0;
  let mean = 0;
  for (const v of flux) { if (v > max) max = v; mean += v / frames; }
  if (max <= 0) return [0];
  const delta = 0.08 * max;
  const gap = Math.max(1, Math.round(((o.minGapSec ?? 0.06) * sr) / H));
  const peaks: { f: number; v: number }[] = [];
  for (let f = 1; f < frames - 1; f++) {
    const v = flux[f];
    let isMax = true;
    for (let j = Math.max(0, f - 3); j <= Math.min(frames - 1, f + 3); j++) if (flux[j] > v || (flux[j] === v && j < f)) { isMax = false; break; }
    if (!isMax) continue;
    let avg = 0;
    let cnt = 0;
    for (let j = Math.max(0, f - 10); j <= Math.min(frames - 1, f + 5); j++) { avg += flux[j]; cnt++; }
    if (v >= avg / cnt + delta && v >= mean) peaks.push({ f, v });
  }
  // los más fuertes primero, respetando la separación mínima
  peaks.sort((a, b) => b.v - a.v);
  const keep: number[] = [];
  const limit = Math.max(1, (o.maxCount ?? 32) - 1);
  for (const p of peaks) {
    if (keep.length >= limit) break;
    if (keep.every((k) => Math.abs(k - p.f) >= gap)) keep.push(p.f);
  }
  // ajuste fino: dentro del cuadro del pico, la subida más empinada de la envolvente (máximo por
  // milisegundo) y, desde ahí hacia atrás, donde empieza a subir; con 1 ms de margen antes
  const ms = Math.max(1, Math.round(sr / 1000));
  const out = keep.map((f) => {
    const lo = Math.max(0, f * H - H);
    const hi = Math.min(n, f * H + N);
    const hops = Math.max(2, Math.floor((hi - lo) / ms));
    const env = new Float32Array(hops);
    for (let j = 0; j < hops; j++) {
      let m = 0;
      for (let i = lo + j * ms; i < Math.min(hi, lo + (j + 1) * ms); i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
      env[j] = m;
    }
    let jr = 0;
    let best = -Infinity;
    for (let j = 0; j + 1 < hops; j++) { const d = env[j + 1] - env[j]; if (d > best) { best = d; jr = j; } }
    const top = env[jr + 1];
    let j0 = jr;
    while (j0 > 0 && env[j0 - 1] < env[j0] && env[j0 - 1] > 0.2 * top) j0--;
    return Math.max(0, lo + j0 * ms - ms);
  });
  // solo GOLPES de verdad: después del corte hay más energía que antes (un final cortado en seco
  // o una cola que se apaga también mueven el espectro, pero bajan) y no es casi silencio (−30 dB)
  let peakAll = 0;
  for (let i = 0; i < n; i++) { const v = Math.abs(x[i]); if (v > peakAll) peakAll = v; }
  const w10 = 10 * ms;
  const maxAbs = (a: number, b: number) => {
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(n, b); i++) { const v = Math.abs(x[i]); if (v > m) m = v; }
    return m;
  };
  const real = out.filter((p) => {
    const after = maxAbs(p, p + w10 + ms);
    const before = maxAbs(p - w10, p);
    return after >= 0.03 * peakAll && after >= 1.4 * before;
  });
  return [0, ...real.filter((v) => v > ms * 5)].sort((a, b) => a - b);
}
