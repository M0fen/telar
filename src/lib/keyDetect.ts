// TONALIDAD DE UN TEMA (decks de tema / biblioteca del set) — lógica PURA (con tests): cromagrama
// (energía por nota, sumando octavas, de 65 Hz a 2 kHz) y correlación con los perfiles de
// Krumhansl-Kessler de las 24 tonalidades. Sirve para la mezcla armónica (Camelot). La relativa (La
// menor ↔ Do mayor) se desempata con el bajo al arrancar cada frase; aun así la UI deja corregirla.
import { fft } from '../audio/fft';
import type { SongKey } from './songKey';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// cromagrama de una señal mono (12 valores, Do = 0): solo los PICOS del espectro de 100 Hz a 2 kHz
// (lo que suena afinado; el ruido de platillos y el cuerpo del bombo, que está debajo de 100 Hz, no
// cuentan), y cada ventana normalizada a su nota más fuerte (un drop ruidoso no tapa al break)
export function chroma(x: Float32Array, sr: number, frame = 8192): Float32Array {
  const out = new Float32Array(12);
  const N = frame;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
  const lo = Math.max(2, Math.floor((100 * N) / sr)), hi = Math.min(N / 2 - 2, Math.ceil((2000 * N) / sr));
  // nota (clase de altura) de cada bin del rango
  const pcOf = new Int8Array(N / 2);
  for (let k = lo; k <= hi; k++) pcOf[k] = ((Math.round(12 * Math.log2((k * sr) / N / 440)) + 9) % 12 + 12) % 12;
  const fc = new Float32Array(12);
  for (let s = 0; s + N <= x.length; s += N / 2) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let mx = 0;
    for (let k = lo - 1; k <= hi + 1; k++) { mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]); if (k >= lo && k <= hi && mag[k] > mx) mx = mag[k]; }
    if (!(mx > 1e-7)) continue;
    fc.fill(0);
    for (let k = lo; k <= hi; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] > mx * 0.01) fc[pcOf[k]] += mag[k];
    let fm = 0;
    for (let i = 0; i < 12; i++) if (fc[i] > fm) fm = fc[i];
    if (fm > 0) for (let i = 0; i < 12; i++) out[i] += fc[i] / fm;
  }
  return out;
}

function corr(a: ArrayLike<number>, b: number[]): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

const keyScore = (c: ArrayLike<number>, k: SongKey) => {
  const prof = k.minor ? MINOR : MAJOR;
  return corr(c, Array.from({ length: 12 }, (_, i) => prof[(i - k.root + 12) % 12]));
};

// la tonalidad que mejor encaja con el cromagrama (null si no hay energía tonal)
export function keyFromChroma(c: ArrayLike<number>): { key: SongKey; score: number } | null {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += c[i];
  if (!(sum > 1e-6)) return null;
  let best: { key: SongKey; score: number } | null = null;
  for (let r = 0; r < 12; r++) {
    for (const minor of [false, true]) {
      const sc = keyScore(c, { root: r, minor });
      if (!best || sc > best.score) best = { key: { root: r, minor }, score: sc };
    }
  }
  return best;
}

// la relativa (La menor ↔ Do mayor: las mismas notas)
export const relativeKey = (k: SongKey): SongKey => (k.minor ? { root: (k.root + 3) % 12, minor: false } : { root: (k.root + 9) % 12, minor: true });

// EL BAJO AL ARRANCAR CADA FRASE (cada 8 compases): energía por nota de 40 a 260 Hz en una ventana
// desde cada arranque (`starts`, en s). En la música de baile la frase arranca casi siempre en la
// tónica: es lo que desempata la relativa, que el cromagrama solo no distingue (Am F C G = C G Am F).
export function phraseBass(x: Float32Array, sr: number, starts: number[], frame = 8192): Float32Array {
  const out = new Float32Array(12);
  const N = frame;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N);
  const lo = Math.max(1, Math.floor((40 * N) / sr)), hi = Math.min(N / 2 - 1, Math.ceil((260 * N) / sr));
  const pcOf = new Int8Array(N / 2);
  for (let k = lo; k <= hi; k++) pcOf[k] = ((Math.round(12 * Math.log2((k * sr) / N / 440)) + 9) % 12 + 12) % 12;
  for (const t of starts) {
    const s = Math.round(t * sr);
    if (s < 0 || s + N > x.length) continue;
    for (let i = 0; i < N; i++) { re[i] = x[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    // cada arranque vale lo mismo (uno fuerte no tapa a los demás)
    const frameC = new Float32Array(12);
    let tot = 0;
    for (let k = lo; k <= hi; k++) { const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]); frameC[pcOf[k]] += m; tot += m; }
    if (tot > 1e-9) for (let i = 0; i < 12; i++) out[i] += frameC[i] / tot;
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += out[i];
  if (sum > 0) for (let i = 0; i < 12; i++) out[i] /= sum;
  return out;
}

// `bass` (opcional) = phraseBass del tema: solo cambia la decisión entre una tonalidad y su relativa
// (mismas notas: el cromagrama las separa por detalles de mezcla, hasta ~0,3 de correlación), y solo
// si el bajo de las frases apunta claro a la otra.
export function detectKey(x: Float32Array, sr: number, bass?: ArrayLike<number> | null): SongKey | null {
  const c = chroma(x, sr);
  const r = keyFromChroma(c);
  if (!r || !(r.score > 0.3)) return null;
  if (bass) {
    const rel = relativeKey(r.key);
    // el bombo y los armónicos reparten energía por todas las notas: cuenta la proporción (la tónica de
    // la otra pesa al menos 1,4 veces más y sobresale del reparto parejo, 1/12 ≈ 0,08)
    const rs = keyScore(c, rel);
    if (rs > 0.3 && rs >= r.score - 0.35 && bass[rel.root] >= 1.4 * bass[r.key.root] && bass[rel.root] >= 0.12) return rel;
  }
  return r.key;
}
