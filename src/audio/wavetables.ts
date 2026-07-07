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

// WAV PCM 16-bit mono (longitud arbitraria) → ArrayBuffer. Puro (testeable en Node).
export function wavBuffer(samples: Float32Array): ArrayBuffer {
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
  return buf;
}

// WAV PCM 16-bit mono → data URI base64 (para el registro por samples() de las de 1 ciclo).
function wavDataUri(samples: Float32Array): string {
  const bytes = new Uint8Array(wavBuffer(samples));
  let bin = '';
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

// --- Wavetables de MORPH multi-cuadro (motor wavetable integrado de superdough) ---------
// Las de arriba son de UN ciclo (se tocan por el prefijo wt_). Estas son SERIES de cuadros
// (FRAMES × LEN) concatenados en un solo WAV; superdough (registerWaveTable) lo parte en
// cuadros de 2048 y su oscilador barre entre cuadros vecinos con .wt(pos) — PATRONEABLE.
// Ese barrido de posición es el diferencial de Telar. additive() ya normaliza cada cuadro.

const FRAMES = 16; // cuadros por tabla de morph (barrido suave, WAV pequeño)

// Generador de UN cuadro (LEN muestras) en la posición de morph t∈[0,1].
type FrameGen = (t: number) => Float32Array;

// helper: perfil de ARMÓNICOS (amps por t) → cuadro por síntesis aditiva (additive normaliza).
const fromAmps = (amps: (t: number) => number[]): FrameGen => (t) => additive(amps(t));

// helper: función de onda por-muestra (t, fase) → cuadro normalizado (dominio del TIEMPO).
// Para tablas que no se describen bien como suma de armónicos (wavefolder, etc.).
const fromWave = (fn: (t: number, phase: number) => number): FrameGen => (t) => {
  const out = new Float32Array(LEN);
  let max = 0;
  for (let i = 0; i < LEN; i++) { const v = fn(t, (i / LEN) * Math.PI * 2); out[i] = v; const av = Math.abs(v); if (av > max) max = av; }
  if (max > 0) for (let i = 0; i < LEN; i++) out[i] /= max;
  return out;
};

// espectro pseudo-aleatorio DETERMINISTA (LCG) → para la tabla "chaos" (grit digital que morfa).
const randSpec = (seed: number, H: number): number[] => {
  let s = seed >>> 0;
  const a = new Array(H);
  for (let h = 0; h < H; h++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; a[h] = (s / 0xffffffff) / (h + 1); }
  return a;
};
const CHAOS_A = randSpec(7, 24), CHAOS_B = randSpec(99, 24);

// --- BANCO DE FÁBRICA de wavetables de MORPH (todas GENERADAS → CC0, ~64KB, patroneables) ---
// Cada una barre un timbre a lo largo de sus cuadros con .wt(pos). Distintos "sabores" para
// motivar la creatividad (como los presets de un plugin), sin descargas ni licencias.
const MORPH_GENERATORS: Record<string, FrameGen> = {
  // seno → diente de sierra (el clásico "abre el brillo")
  sweep: fromAmps((t) => { const H = 40, a = new Array(H).fill(0); a[0] = 1; for (let h = 2; h <= H; h++) a[h - 1] = t * (1 / h); return a; }),
  // formante (pico) que se desplaza por los armónicos → "vocal" que barre
  formant: fromAmps((t) => { const H = 32, a = new Array(H).fill(0), cf = 2 + t * (H - 6); for (let h = 1; h <= H; h++) { const d = (h - cf) / 3; a[h - 1] = Math.exp(-d * d) + (h === 1 ? 0.35 : 0); } return a; }),
  // ancho de pulso: cuadrada → pulso fino (PWM, clásico de bajos/leads)
  pwm: fromAmps((t) => { const d = 0.5 - t * 0.45, H = 40, a = new Array(H); for (let h = 1; h <= H; h++) a[h - 1] = (2 / (h * Math.PI)) * Math.sin(h * Math.PI * d); return a; }),
  // seno → cuadrada (solo los armónicos IMPARES crecen) → timbre hueco de videojuego
  square: fromAmps((t) => { const H = 39, a = new Array(H).fill(0); a[0] = 1; for (let h = 3; h <= H; h += 2) a[h - 1] = t * (1 / h); return a; }),
  // órgano: los armónicos ENTRAN uno a uno con la posición (como subir drawbars)
  drawbars: fromAmps((t) => { const H = 24, a = new Array(H); for (let h = 1; h <= H; h++) a[h - 1] = h === 1 ? 1 : (1 / h) * Math.max(0, Math.min(1, t * H - (h - 1))); return a; }),
  // metálico: un énfasis que viaja por parciales altos e "inarmónicos" → campana/FM-ish
  bell: fromAmps((t) => { const parts = [1, 4, 6, 9, 11, 14], H = 16, a = new Array(H).fill(0); parts.forEach((p, k) => { const w = Math.exp(-Math.pow(k / (parts.length - 1) - t, 2) / 0.08); if (p <= H) a[p - 1] = w; }); return a; }),
  // barrido "resonante": saw con un pico de armónicos que SUBE → como un filtro barrido, en la tabla
  reso: fromAmps((t) => { const H = 40, cf = 1 + t * (H - 4), a = new Array(H); for (let h = 1; h <= H; h++) a[h - 1] = (1 / h) * (1 + 4 * Math.exp(-Math.pow((h - cf) / 2, 2))); return a; }),
  // wavefolder (dominio del tiempo): más pliegues → más armónicos (timbre "West-coast")
  fold: fromWave((t, ph) => Math.sin((1 + t * 6) * Math.sin(ph))),
  // seno → triángulo (armónicos impares 1/h² alternando signo) → barrido SUAVE
  soft: fromAmps((t) => { const H = 32, a = new Array(H).fill(0); a[0] = 1; for (let h = 3; h <= H; h += 2) a[h - 1] = t * (((h - 1) / 2) % 2 === 0 ? 1 : -1) * (1 / (h * h)); return a; }),
  // hueco de órgano: crece una QUINTA/octava sobre el fundamental (h=2,3) → registro "hollow"
  fifth: fromAmps((t) => { const H = 24, a = new Array(H).fill(0); a[0] = 1; a[1] = t * 0.4; a[2] = t * 0.7; a[5] = t * 0.3; return a; }),
  // saw con NOTCHES de peine que se desplazan (metálico/phasery)
  comb: fromAmps((t) => { const H = 40, a = new Array(H); for (let h = 1; h <= H; h++) a[h - 1] = (1 / h) * Math.abs(Math.sin(h * (0.3 + t * 2.2))); return a; }),
  // grit digital: interpola entre dos espectros aleatorios fijos (áspero, evoluciona)
  chaos: fromAmps((t) => CHAOS_A.map((v, i) => v * (1 - t) + CHAOS_B[i] * t)),
  // DOS formantes que se mueven ("ah → ee") → vocal más rica
  vowel2: fromAmps((t) => { const H = 32, a = new Array(H).fill(0), c1 = 2 + t * 6, c2 = 8 + t * 14; for (let h = 1; h <= H; h++) { const d1 = (h - c1) / 2.5, d2 = (h - c2) / 3; a[h - 1] = Math.exp(-d1 * d1) + 0.7 * Math.exp(-d2 * d2) + (h === 1 ? 0.3 : 0); } return a; }),
  // hard-sync (dominio del tiempo): saw a ratio creciente → barrido agresivo tipo sync
  sync: fromWave((t, ph) => { const p = ((ph / (Math.PI * 2)) * (1 + t * 3)) % 1; return 1 - 2 * p; }),
  // pico resonante ESTRECHO que sube (silbido/whistle, más afilado que formant)
  peak: fromAmps((t) => { const H = 48, cf = 2 + t * (H - 6), a = new Array(H).fill(0); for (let h = 1; h <= H; h++) { const d = (h - cf) / 1.2; a[h - 1] = Math.exp(-d * d); } a[0] += 0.25; return a; }),
  // triángulo → diente de sierra (entran los armónicos PARES) → de dulce a mordiente
  tri2saw: fromAmps((t) => { const H = 36, a = new Array(H).fill(0); a[0] = 1; for (let h = 2; h <= H; h++) { const tri = h % 2 === 1 ? (1 / (h * h)) * (((h - 1) / 2) % 2 === 0 ? 1 : -1) : 0; a[h - 1] = tri * (1 - t) + (1 / h) * t; } return a; }),
  // parciales altos brillantes que se desplazan → "glass"/shimmer
  glass: fromAmps((t) => { const H = 40, a = new Array(H).fill(0); a[0] = 0.5; const parts = [7, 10, 13, 17, 21, 26]; parts.forEach((p, k) => { if (p <= H) a[p - 1] = 0.8 * Math.exp(-Math.pow(k / (parts.length - 1) - t, 2) / 0.1); }); return a; }),
  // pluck: de brillante (rolloff suave) a apagado (rolloff pronunciado) → cuerda que se apaga
  pluck: fromAmps((t) => { const H = 40, a = new Array(H), roll = 0.5 + t * 3.5; for (let h = 1; h <= H; h++) a[h - 1] = Math.pow(h, -roll); return a; }),
};

// Serie de cuadros concatenada (FRAMES × LEN) a partir de un generador de cuadro. Pura (Node).
export function morphSeries(gen: FrameGen, frames = FRAMES): Float32Array {
  const out = new Float32Array(frames * LEN);
  for (let f = 0; f < frames; f++) out.set(gen(frames === 1 ? 0 : f / (frames - 1)), f * LEN);
  return out;
}

// Serie de cuadros por nombre (`telar_sweep` → su Float32Array). Puro, sin Blob URL, para
// tests/preview/visor. Devuelve null si el nombre no es una tabla de morph.
export function morphSeriesByName(name: string): Float32Array | null {
  const g = MORPH_GENERATORS[name.replace(/^telar_/, '')];
  return g ? morphSeries(g) : null;
}

export interface MorphTable { name: string; label: string; url: string; frames: number; }

let cachedMorph: MorphTable[] | null = null;

// Construye TODAS las tablas de morph UNA vez (Blob URL por tabla) para registerWaveTable.
// Se registran como sonidos `telar_*`; en el patrón: note("..").s("telar_sweep").wt("0 .5 1").
// (Blob URL en vez de data URI: fetch lo resuelve igual y evita cadenas gigantes.)
export function morphWavetables(): MorphTable[] {
  if (cachedMorph) return cachedMorph;
  cachedMorph = Object.entries(MORPH_GENERATORS).map(([key, gen]) => {
    const url = URL.createObjectURL(new Blob([wavBuffer(morphSeries(gen))], { type: 'audio/wav' }));
    return { name: `telar_${key}`, label: key, url, frames: FRAMES };
  });
  return cachedMorph;
}

// Lista para el selector de wavetables de morph.
export const MORPH_WAVETABLES = Object.keys(MORPH_GENERATORS).map((k) => ({ name: `telar_${k}`, label: k }));

// ¿Es una onda de wavetable de MORPH (telar_*)? La distingue de las de 1 ciclo (wt_telar_*,
// que empiezan por wt_) y de los osciladores básicos. Las de morph aceptan .wt() + unísono.
// Excluye la onda PROPIA del usuario (telar_user_*, 1 cuadro → sin morph/wt).
export function isMorphWave(wave?: string): boolean {
  return !!wave && wave.startsWith('telar_') && !wave.startsWith('telar_user_');
}

// ¿Es la onda PROPIA del usuario (dibujada con nodos)? Nombre telar_user_*.
export function isUserWave(wave?: string): boolean {
  return !!wave && wave.startsWith('telar_user_');
}

// Interpola los PUNTOS del editor (x∈[0,1], y∈[-1,1]) en un cuadro de LEN muestras, PERIÓDICO
// (el último punto conecta con el primero) y NORMALIZADO. Pura (Node). Con <2 puntos cae a un
// seno. Interpolación CATMULL-ROM (curva SUAVE que PASA por los puntos) → sin esquinas duras =
// mucho menos aspereza/aliasing que la lineal, respetando lo dibujado.
export function userWaveFrame(points: { x: number; y: number }[], len = LEN): Float32Array {
  const out = new Float32Array(len);
  const pts = (points ?? [])
    .filter((p) => p && isFinite(p.x) && isFinite(p.y))
    .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(-1, Math.min(1, p.y)) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length < 2) { for (let i = 0; i < len; i++) out[i] = Math.sin((i / len) * Math.PI * 2); return out; }
  const n = pts.length;
  for (let i = 0; i < len; i++) {
    const x = i / len;
    // i1 = último punto con x ≤ actual (con envoltura periódica); segmento [i1, i1+1]
    let i1 = -1; for (let j = 0; j < n; j++) if (pts[j].x <= x) i1 = j;
    let x1: number, x2: number;
    if (i1 === -1) { i1 = n - 1; x1 = pts[i1].x - 1; x2 = pts[0].x; }        // antes del primero → viene del último
    else if (i1 === n - 1) { x1 = pts[i1].x; x2 = pts[0].x + 1; }            // tras el último → envuelve al primero
    else { x1 = pts[i1].x; x2 = pts[i1 + 1].x; }
    // 4 puntos de control envueltos; Catmull-Rom uniforme sobre las Y (pasa por p1 y p2)
    const p0 = pts[(i1 - 1 + n) % n].y, p1 = pts[i1].y, p2 = pts[(i1 + 1) % n].y, p3 = pts[(i1 + 2) % n].y;
    const t = x2 === x1 ? 0 : (x - x1) / (x2 - x1), t2 = t * t, t3 = t2 * t;
    out[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  let max = 0; for (let i = 0; i < len; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 0) for (let i = 0; i < len; i++) out[i] /= max;
  return out;
}

// Normaliza el `userWave` a CUADROS ({x,y}[][]). Acepta el formato VIEJO (array plano de
// puntos = 1 cuadro) para compatibilidad. Descarta cuadros vacíos. Pura.
export function userFrames(uw: unknown): { x: number; y: number }[][] {
  if (!Array.isArray(uw) || uw.length === 0) return [];
  const first = uw[0] as { x?: unknown } | undefined;
  if (first && typeof first.x === 'number') return [uw as { x: number; y: number }[]]; // plano → 1 cuadro
  return (uw as { x: number; y: number }[][]).filter((f) => Array.isArray(f) && f.length > 0);
}

// Serie de cuadros de la ONDA PROPIA (N cuadros × LEN, concatenados) → lo que se registra como
// telar_user_*. Cada cuadro por userWaveFrame (Catmull-Rom). Pura. Sin cuadros → un seno.
export function userWaveSeries(uw: unknown): Float32Array {
  const frames = userFrames(uw);
  if (frames.length === 0) return userWaveFrame([]);
  const out = new Float32Array(frames.length * LEN);
  frames.forEach((f, i) => out.set(userWaveFrame(f), i * LEN));
  return out;
}
