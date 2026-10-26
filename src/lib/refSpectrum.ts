// PISTA DE REFERENCIA (Fase 6.3) — lógica PURA: espectro promedio en bandas de 1/6 de octava (la
// "curva tonal" del tema) y el ajuste de volumen para escuchar la referencia al mismo loudness que
// tu mezcla. Lo usan el análisis de la referencia (una vez, al cargarla) y el de tu mezcla (en vivo).
import { fft } from '../audio/fft';

// bandas de 1/6 de octava de ~31 Hz a ~16 kHz
export const BAND_CENTERS: number[] = (() => {
  const out: number[] = [];
  for (let f = 31.25; f <= 16000 * 1.001; f *= Math.pow(2, 1 / 6)) out.push(f);
  return out;
})();
const EDGE = Math.pow(2, 1 / 12);

// potencia por banda (media de los bins que caen en cada banda; las bandas sin bins toman el bin
// más cercano: en graves las bandas son más finas que la resolución)
export function powerToBands(power: Float64Array | Float32Array, sr: number, fftSize: number): Float64Array {
  const out = new Float64Array(BAND_CENTERS.length);
  const binHz = sr / fftSize;
  for (let b = 0; b < BAND_CENTERS.length; b++) {
    const lo = BAND_CENTERS[b] / EDGE;
    const hi = BAND_CENTERS[b] * EDGE;
    const k0 = Math.max(1, Math.ceil(lo / binHz));
    const k1 = Math.min(power.length - 1, Math.floor(hi / binHz));
    if (k1 >= k0) {
      let s = 0;
      for (let k = k0; k <= k1; k++) s += power[k];
      out[b] = s / (k1 - k0 + 1);
    } else {
      out[b] = power[Math.min(power.length - 1, Math.max(1, Math.round(BAND_CENTERS[b] / binHz)))];
    }
  }
  return out;
}

let hann: Float32Array | null = null;
// potencia por bin de UN bloque (mono, ventana de Hann)
export function blockPower(x: Float32Array, fftSize: number): Float64Array {
  if (!hann || hann.length !== fftSize) {
    hann = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  }
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) re[i] = (x[i] ?? 0) * hann[i];
  fft(re, im);
  const p = new Float64Array(fftSize / 2);
  for (let k = 0; k < fftSize / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return p;
}

// espectro promedio de un tema entero, en dB por banda (salta los silencios: < −50 dBFS RMS)
export function averageSpectrum(chans: Float32Array[], sr: number, fftSize = 4096): Float64Array {
  const n = chans[0]?.length ?? 0;
  const acc = new Float64Array(fftSize / 2);
  let frames = 0;
  const mono = new Float32Array(fftSize);
  for (let s = 0; s + fftSize <= n; s += fftSize) {
    let e = 0;
    for (let i = 0; i < fftSize; i++) {
      let v = 0;
      for (const c of chans) v += c[s + i];
      v /= chans.length;
      mono[i] = v;
      e += v * v;
    }
    if (e / fftSize < 1e-5) continue; // −50 dBFS
    const p = blockPower(mono, fftSize);
    for (let k = 0; k < p.length; k++) acc[k] += p[k];
    frames++;
  }
  if (frames) for (let k = 0; k < acc.length; k++) acc[k] /= frames;
  return toDbBands(powerToBands(acc, sr, fftSize));
}

export function toDbBands(p: Float64Array): Float64Array {
  const out = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i] > 1e-20 ? 10 * Math.log10(p[i]) : -200;
  return out;
}

// curva normalizada para comparar FORMAS (balance tonal): 0 dB = su nivel medio entre 100 Hz y 10 kHz
export function normalizeCurve(db: Float64Array): Float64Array {
  let s = 0;
  let k = 0;
  for (let i = 0; i < db.length; i++) {
    if (BAND_CENTERS[i] >= 100 && BAND_CENTERS[i] <= 10000 && db[i] > -150) { s += db[i]; k++; }
  }
  const m = k ? s / k : 0;
  return db.map((v) => (v > -150 ? v - m : v));
}

// cuánto subir/bajar la referencia para oírla al loudness de tu mezcla (±24 dB; 0 si falta una medida)
export function matchGainDb(mixLufs: number, refLufs: number): number {
  if (!Number.isFinite(mixLufs) || !Number.isFinite(refLufs)) return 0;
  return Math.max(-24, Math.min(24, mixLufs - refLufs));
}
