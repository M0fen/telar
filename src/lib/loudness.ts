// MEDICIÓN DE LOUDNESS del archivo (Fase 4.4) — ITU-R BS.1770-4 + EBU R128 / Tech 3342, sobre
// el audio renderizado (no aproximada como el medidor en vivo). Lógica PURA → testeable en Node.
//   · K-weighting exacto para cualquier frecuencia de muestreo (coeficientes de libebur128).
//   · Integrada: bloques de 400 ms con 75 % de solapamiento, compuerta absoluta −70 LUFS y
//     relativa −10 LU.
//   · Momentánea máx. (400 ms), corta máx. (3 s) y LRA (percentiles 10–95 de la corta, compuerta
//     −70 LUFS y relativa −20 LU).
//   · True peak con sobremuestreo 4× (polifásico, solo donde el pico de muestra lo amerita).
export interface LoudnessReport {
  integrated: number; // LUFS (−Infinity si es silencio)
  momentaryMax: number;
  shortMax: number;
  lra: number; // LU
  truePeak: number; // dBTP
  samplePeak: number; // dBFS
  clipped: number; // muestras ≥ 1.0 (0 dBFS)
  seconds: number;
}

function kFilterCoefs(fs: number): { b: number[]; a: number[] }[] {
  // etapa 1: shelf (cabeza)
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // etapa 2: paso-alto RLB
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const s2 = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [s1, s2];
}

// K-weighting en cascada (shelf + paso-alto) y energía por saltos de `hop` muestras: solo se
// guarda una suma por salto (un tema de 7 min son ~4200 números, no 20 millones).
function kWeightedHops(x: Float32Array, fs: number, hop: number): Float64Array {
  const [s1, s2] = kFilterCoefs(fs);
  const nh = Math.floor(x.length / hop);
  const out = new Float64Array(nh);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
  let acc = 0;
  let h = 0;
  let k = 0;
  for (let i = 0; i < nh * hop; i++) {
    const xi = x[i];
    const yi = s1.b[0] * xi + s1.b[1] * x1 + s1.b[2] * x2 - s1.a[1] * y1 - s1.a[2] * y2;
    x2 = x1; x1 = xi;
    const zi = s2.b[0] * yi + s2.b[1] * y1 + s2.b[2] * y2 - s2.a[1] * z1 - s2.a[2] * z2;
    y2 = y1; y1 = yi;
    z2 = z1; z1 = zi;
    acc += zi * zi;
    if (++k === hop) { out[h++] = acc; acc = 0; k = 0; }
  }
  return out;
}

const LUFS = (ms: number) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

// energía media (suma de canales) en ventanas de `n` saltos, una por salto
function windowed(hops: Float64Array[], n: number, hop: number): number[] {
  const len = hops[0]?.length ?? 0;
  const out: number[] = [];
  for (let s = 0; s + n <= len; s++) {
    let e = 0;
    for (const c of hops) for (let j = s; j < s + n; j++) e += c[j];
    out.push(e / (n * hop));
  }
  return out;
}

// TRUE PEAK 4× (BS.1770-4 anexo 2): interpolación polifásica, 12 coeficientes por fase
const PHASES = 4;
const TAPS = 12;
let tpBank: Float64Array[] | null = null;
function bank(): Float64Array[] {
  if (tpBank) return tpBank;
  const N = PHASES * TAPS;
  const fc = 0.5 / PHASES;
  const mid = (N - 1) / 2;
  const proto = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const x = i - mid;
    const sinc = Math.abs(x) < 1e-9 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
    proto[i] = sinc * w;
  }
  tpBank = [];
  for (let p = 0; p < PHASES; p++) {
    const b = new Float64Array(TAPS);
    let s = 0;
    for (let t = 0; t < TAPS; t++) { b[t] = proto[t * PHASES + p]; s += b[t]; }
    for (let t = 0; t < TAPS; t++) b[t] /= s;
    tpBank.push(b);
  }
  return tpBank;
}
function truePeakOf(x: Float32Array, from: number, to: number): number {
  const bk = bank();
  let mx = 0;
  for (let i = Math.max(TAPS, from); i < Math.min(x.length, to); i++) {
    for (let p = 0; p < PHASES; p++) {
      const b = bk[p];
      let y = 0;
      for (let t = 0; t < TAPS; t++) y += b[t] * x[i - t];
      const a = y < 0 ? -y : y;
      if (a > mx) mx = a;
    }
  }
  return mx;
}

const db = (a: number) => (a > 0 ? 20 * Math.log10(a) : -Infinity);

export function measureLoudness(chans: Float32Array[], fs: number): LoudnessReport {
  const n = chans[0]?.length ?? 0;
  const seconds = n / fs;
  // picos de muestra, recortes
  let samplePeak = 0;
  let clipped = 0;
  for (const c of chans) for (let i = 0; i < n; i++) { const a = Math.abs(c[i]); if (a > samplePeak) samplePeak = a; if (a >= 1) clipped++; }
  // true peak: solo bloques cuyo pico de muestra está a ≤ 4 dB del máximo (el TP no supera al de
  // muestra en más de ~3 dB)
  const BLK = 2048;
  const thr = samplePeak * Math.pow(10, -4 / 20);
  let tp = samplePeak;
  for (const c of chans) {
    for (let s = 0; s < n; s += BLK) {
      let m = 0;
      for (let i = s; i < Math.min(n, s + BLK); i++) { const a = Math.abs(c[i]); if (a > m) m = a; }
      if (m >= thr) tp = Math.max(tp, truePeakOf(c, s - TAPS, s + BLK + TAPS));
    }
  }
  // K-weighting → energía por saltos de 100 ms → ventanas de 400 ms (4 saltos) y 3 s (30)
  const hop = Math.round(0.1 * fs);
  const hops = chans.map((c) => kWeightedHops(c, fs, hop));
  const m400 = windowed(hops, 4, hop); // momentáneas (bloques de la integrada, 75 % de solape)
  const s3 = windowed(hops, 30, hop); // cortas
  // integrada
  const abs = m400.filter((e) => LUFS(e) > -70);
  let integrated = -Infinity;
  if (abs.length) {
    const rel = LUFS(abs.reduce((a, e) => a + e, 0) / abs.length) - 10;
    const g = abs.filter((e) => LUFS(e) > rel);
    if (g.length) integrated = LUFS(g.reduce((a, e) => a + e, 0) / g.length);
  }
  // LRA (EBU Tech 3342)
  let lra = 0;
  const st = s3.map(LUFS).filter((l) => l > -70);
  if (st.length) {
    const relLra = LUFS(s3.filter((e) => LUFS(e) > -70).reduce((a, e) => a + e, 0) / st.length) - 20;
    const g = st.filter((l) => l > relLra).sort((a, b) => a - b);
    if (g.length) {
      const q = (p: number) => g[Math.min(g.length - 1, Math.max(0, Math.round((p / 100) * (g.length - 1))))];
      lra = q(95) - q(10);
    }
  }
  return {
    integrated,
    momentaryMax: m400.length ? Math.max(...m400.map(LUFS)) : -Infinity,
    shortMax: s3.length ? Math.max(...s3.map(LUFS)) : -Infinity,
    lra,
    truePeak: db(tp),
    samplePeak: db(samplePeak),
    clipped,
    seconds,
  };
}

// Texto del informe (en español, para mostrar y guardar en el ZIP)
export function reportText(r: LoudnessReport, extra: Record<string, string> = {}): string {
  const f = (x: number, u: string) => (Number.isFinite(x) ? `${x.toFixed(1)} ${u}` : '—');
  const mm = `${Math.floor(r.seconds / 60)}:${String(Math.round(r.seconds % 60)).padStart(2, '0')}`;
  const lines = [
    `Loudness integrada: ${f(r.integrated, 'LUFS')}`,
    `Corta máxima (3 s): ${f(r.shortMax, 'LUFS')}`,
    `Momentánea máxima (400 ms): ${f(r.momentaryMax, 'LUFS')}`,
    `Rango de loudness (LRA): ${f(r.lra, 'LU')}`,
    `Pico real (true peak): ${f(r.truePeak, 'dBTP')}`,
    `Pico de muestra: ${f(r.samplePeak, 'dBFS')}`,
    `Recortes (≥ 0 dBFS): ${r.clipped}`,
    `Duración: ${mm}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
  ];
  return lines.join('\n');
}
