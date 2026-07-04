// Wavetables propias (offline, deterministas). El motor reproduce como wavetable
// CUALQUIER sample cuyo nombre empiece por `wt_` (verificado en el bundle:
// `name.startsWith("wt_") ? wavetablePlayer(...)`). Generamos formas de onda de un
// solo ciclo por síntesis aditiva, las codificamos como WAV (data URI) y las
// registramos con `samples({ wt_telar_*: uri })`. Así Telar trae wavetables ricas
// sin depender de packs externos ni red.

const LEN = 2048; // muestras por ciclo (potencia de 2)
const SR = 44100;

// Suma de armónicos (amps[h-1] = amplitud del armónico h). Normaliza a [-1,1].
function additive(amps: number[]): Float32Array {
  const out = new Float32Array(LEN);
  let max = 0;
  for (let i = 0; i < LEN; i++) {
    const ph = (i / LEN) * Math.PI * 2;
    let v = 0;
    for (let h = 0; h < amps.length; h++) {
      const a = amps[h];
      if (a) v += a * Math.sin((h + 1) * ph);
    }
    out[i] = v;
    const av = Math.abs(v);
    if (av > max) max = av;
  }
  if (max > 0) for (let i = 0; i < LEN; i++) out[i] /= max;
  return out;
}

function writeStr(v: DataView, off: number, s: string) {
  for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
}

// WAV PCM 16-bit mono → data URI base64.
function wavDataUri(samples: Float32Array): string {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  writeStr(v, 0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  writeStr(v, 8, 'WAVE');
  writeStr(v, 12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(v, 36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}

// Perfiles armónicos (cada uno un timbre distinto).
const saw = (n: number) => Array.from({ length: n }, (_, k) => 1 / (k + 1));
const oddOnly = (n: number) => Array.from({ length: n }, (_, k) => (k % 2 === 0 ? 1 / (k + 1) : 0));

const PROFILES: Record<string, number[]> = {
  // órgano: fundamental + octavas (armónicos potencia de 2)
  organ: [1, 0, 0.6, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0, 0.25],
  // buzz: saw rico (muchos armónicos)
  buzz: saw(40),
  // hollow: cuadrada suave (solo impares)
  hollow: oddOnly(31),
  // vocal: formantes (refuerzo de armónicos medios → timbre "ahh")
  vocal: [1, 0.5, 0.9, 1, 0.7, 0.3, 0.5, 0.8, 0.6, 0.2, 0.1],
  // metálico: parciales altos e inarmónicos perceptivos
  metal: (() => { const a = new Array(20).fill(0); a[0] = 1; a[6] = 0.7; a[10] = 0.6; a[12] = 0.5; a[16] = 0.4; return a; })(),
};

export interface Wavetable {
  name: string; // empieza por wt_
  label: string;
}

let cachedSamples: Record<string, string> | null = null;

// Mapa nombre→dataURI para registrar con samples(). Se calcula una vez.
export function wavetableSamples(): Record<string, string> {
  if (cachedSamples) return cachedSamples;
  const map: Record<string, string> = {};
  for (const [key, amps] of Object.entries(PROFILES)) {
    map[`wt_telar_${key}`] = wavDataUri(additive(amps));
  }
  cachedSamples = map;
  return map;
}

// Lista para el selector del synth.
export const WAVETABLES: Wavetable[] = Object.keys(PROFILES).map((k) => ({
  name: `wt_telar_${k}`,
  label: k,
}));
