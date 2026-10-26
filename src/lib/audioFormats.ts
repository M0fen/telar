// FORMATOS DE ENTREGA (Fase 4.3) — lógica PURA (sin Web Audio) → testeable en Node.
//   · WAV PCM 24 o 16 bit con dither TPDF (±1 LSB triangular: el error de cuantizar queda como
//     un ruido plano muy bajo en vez de distorsión), o 32 bit float sin pérdida.
//   · Cambio de frecuencia de muestreo con sinc enventanado (Kaiser, 128 coeficientes): el render
//     se hace a la frecuencia del audio en vivo (las muestras y las reverbs por convolución están
//     decodificadas a esa frecuencia) y se convierte después, sin aliasing audible.
//   · Nombre de archivo con el tema, el BPM y la tonalidad.
export type ExportFormat = 'wav24' | 'wav16' | 'wav32f' | 'mp3';

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  wav24: 'WAV 24 bit',
  wav16: 'WAV 16 bit',
  wav32f: 'WAV 32 float',
  mp3: 'MP3 320',
};

// Generador pseudoaleatorio pequeño y rápido (mulberry32): dither reproducible en los tests.
export function rng32(seed = 0x9e3779b9): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function header(dataLen: number, sampleRate: number, channels: number, bits: number, float: boolean): Uint8Array {
  const ab = new ArrayBuffer(44);
  const v = new DataView(ab);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  const blockAlign = channels * (bits / 8);
  ws(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ws(8, 'WAVE');
  ws(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  ws(36, 'data');
  v.setUint32(40, dataLen, true);
  return new Uint8Array(ab);
}

const CHUNK = 1 << 18; // muestras por bloque: partes de ~1,5 MB (sin un único buffer gigante)

// WAV en partes (para un Blob). bits 16/24 → PCM con dither TPDF; 32 → float.
export function encodeWav(chans: Float32Array[], sampleRate: number, bits: 16 | 24 | 32, rand: () => number = rng32()): Uint8Array[] {
  const nch = chans.length;
  const len = chans[0]?.length ?? 0;
  const bps = bits / 8;
  const parts: Uint8Array[] = [header(len * nch * bps, sampleRate, nch, bits, bits === 32)];
  const full = bits === 16 ? 32767 : 8388607;
  const lo = bits === 16 ? -32768 : -8388608;
  for (let s0 = 0; s0 < len; s0 += CHUNK) {
    const n = Math.min(CHUNK, len - s0);
    const out = new Uint8Array(n * nch * bps);
    const dv = new DataView(out.buffer);
    let o = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nch; c++) {
        const x = chans[c][s0 + i];
        if (bits === 32) {
          dv.setFloat32(o, x, true);
          o += 4;
          continue;
        }
        let q = Math.round(x * full + (rand() - rand())); // TPDF: suma de dos uniformes → ±1 LSB
        if (q > full) q = full;
        else if (q < lo) q = lo;
        if (bits === 16) {
          dv.setInt16(o, q, true);
          o += 2;
        } else {
          out[o] = q & 0xff;
          out[o + 1] = (q >> 8) & 0xff;
          out[o + 2] = (q >> 16) & 0xff;
          o += 3;
        }
      }
    }
    parts.push(out);
  }
  return parts;
}

// Float → Int16 con dither TPDF (entrada del codificador MP3).
export function toInt16(ch: Float32Array, rand: () => number = rng32()): Int16Array {
  const out = new Int16Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    let q = Math.round(ch[i] * 32767 + (rand() - rand()));
    if (q > 32767) q = 32767;
    else if (q < -32768) q = -32768;
    out[i] = q;
  }
  return out;
}

// --- cambio de frecuencia de muestreo ------------------------------------------------------
const HALF = 64; // coeficientes a cada lado
const SUB = 512; // subdivisiones por coeficiente (tabla fina, interpolada linealmente)
const BETA = 9.5; // ventana Kaiser: ~95 dB de rechazo
// ancho de la transición del filtro (ciclos por muestra de entrada), fórmula de Kaiser
const TRANSITION = ((BETA / 0.1102 + 8.7 - 7.95) / (2.285 * 2 * HALF)) / (2 * Math.PI);
function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
  }
  return sum;
}
function kernelTable(fc: number, beta = BETA): Float32Array {
  const n = HALF * SUB;
  const t = new Float32Array(n + 2);
  const i0b = bessel0(beta);
  for (let i = 0; i <= n + 1; i++) {
    const x = i / SUB; // distancia en muestras de entrada
    const w = x >= HALF ? 0 : bessel0(beta * Math.sqrt(1 - (x / HALF) * (x / HALF))) / i0b;
    const s = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    t[i] = s * w;
  }
  return t;
}

export function resample(chans: Float32Array[], srIn: number, srOut: number): Float32Array[] {
  if (srIn === srOut) return chans;
  const ratio = srIn / srOut; // muestras de entrada por muestra de salida
  // corte (ciclos por muestra de entrada): la banda de rechazo empieza justo en el Nyquist menor
  // → nada por encima de él se dobla (aliasing); plano hasta ~20 kHz
  const fc = 0.5 * Math.min(1, 1 / ratio) - TRANSITION / 2;
  const table = kernelTable(fc);
  const lenIn = chans[0]?.length ?? 0;
  const lenOut = Math.floor((lenIn * srOut) / srIn);
  const kern = (d: number) => {
    const a = Math.abs(d) * SUB;
    const i = a | 0;
    const f = a - i;
    return i >= HALF * SUB ? 0 : table[i] + (table[i + 1] - table[i]) * f;
  };
  // POLIFÁSICO si la relación es racional chica (48000/44100 = 160/147): cada fase tiene sus 128
  // coeficientes ya calculados → el bucle interno solo multiplica y suma (≈4× más rápido).
  const g = gcd(srIn, srOut);
  const L = srOut / g; // fases
  const M = srIn / g; // avance en entradas por cada L salidas
  const poly = Number.isInteger(L) && Number.isInteger(M) && L <= 2048;
  let phases: Float32Array[] | null = null;
  if (poly) {
    phases = [];
    for (let p = 0; p < L; p++) {
      const frac = p / L;
      const c = new Float32Array(2 * HALF);
      for (let k = -HALF + 1; k <= HALF; k++) c[k + HALF - 1] = kern(k - frac);
      phases.push(c);
    }
  }
  return chans.map((x) => {
    const y = new Float32Array(lenOut);
    for (let j = 0; j < lenOut; j++) {
      let i0: number;
      let frac: number;
      let c: Float32Array | null = null;
      if (phases) {
        const num = j * M;
        i0 = Math.floor(num / L);
        const p = num - i0 * L;
        c = phases[p];
        frac = p / L;
      } else {
        const t = j * ratio;
        i0 = Math.floor(t);
        frac = t - i0;
      }
      let acc = 0;
      const k0 = Math.max(-HALF + 1, -i0);
      const k1 = Math.min(HALF, lenIn - 1 - i0);
      if (c) for (let k = k0; k <= k1; k++) acc += x[i0 + k] * c[k + HALF - 1];
      else for (let k = k0; k <= k1; k++) acc += x[i0 + k] * kern(k - frac);
      y[j] = acc;
    }
    return y;
  });
}

function gcd(a: number, b: number): number {
  a = Math.round(a);
  b = Math.round(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

// --- nombre del archivo ---------------------------------------------------------------------
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48);

export function exportFileName(o: { title?: string; bpm: number; key?: string; part: string; ext: string }): string {
  const bits = [slug(o.title || '') || 'telar'];
  if (o.bpm > 0) bits.push(`${Math.round(o.bpm * 10) / 10}bpm`);
  if (o.key) bits.push(o.key.replace(/[^A-Za-z0-9#]/g, '').replace('#', 's'));
  if (o.part) bits.push(slug(o.part));
  return `${bits.join('_')}.${o.ext}`;
}
