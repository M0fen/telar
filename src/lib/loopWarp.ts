// LOOPS AL TEMPO DEL TEMA (Fase 5.2) — lógica PURA (sin motor ni IndexedDB → testeable en Node).
//
// Un loop de Splice trae su tempo (126 en «…_126_Amin_…»). Para que caiga en la rejilla de un tema
// a 132 sin cambiar de tono, se estira con Rubber Band (offline) a 126/132 de su duración y se toca
// con `s("wl_…").slow(ciclos)` a velocidad 1: se re-dispara en cada vuelta EXACTA de la rejilla (no
// deriva nunca, ni a los 5 minutos) y suena con su tono.
//
// Uniones sin clic:
//   · se estira el loop con contexto circular (su final delante y su principio detrás) y se
//     recorta la vuelta del medio: el estirador ve el loop como lo que es (algo que se repite);
//   · superdough abre cada voz con un ataque lineal mínimo de 1 ms (desde 0). Para que la unión
//     final→principio no tenga ese hueco, la copia lleva una COLA: ~1 ms de continuación con un
//     fundido 1→0 que es el espejo exacto de ese ataque → voz vieja + voz nueva = el loop entero.
//   · Mientras llega la copia de Rubber Band (al importar o al cambiar el BPM) suena una copia
//     rápida por varispeed, del mismo largo: en la rejilla desde el primer momento, con el tono
//     corrido un instante.

export interface WarpInfo {
  name: string; // sample en el código (wl_…): se re-registra con la copia del BPM actual
  orig: string; // id del audio original (IndexedDB «telar-warp»)
  file?: string; // archivo original (para mostrar)
  srcBpm: number; // tempo del loop original
  beats: number; // duración en tiempos (negras): 16 = 4 compases de 4/4
  semis?: number; // transposición en semitonos (Fase 5.3)
  formant?: boolean; // conservar formantes al transponer (voces)
}

export const WARP_PREFIX = 'wl_';

const round2 = (x: number) => Math.round(x * 100) / 100;

// BPM del tema a partir del reloj (cps = ciclos por segundo; un ciclo = `bpc` tiempos)
export const songBpmOf = (cps: number, beatsPerCycle: number) => (cps || 0.5) * 60 * (beatsPerCycle || 4);

// ¿Cuánto dura el loop y a qué tempo va? Con el BPM del nombre (Splice), manda el nombre y la
// duración da los tiempos. Sin él, la duración propone tempos (compases enteros dentro de un
// rango musical) y la detección de pulso elige (tolera sus errores de ×2/÷2; si dos tempos
// encajan igual, gana el más cercano al del tema); si no hay acuerdo (±4 %), no es un loop
// limpio → null (el sample sigue a su tempo natural).
export function loopGrid(
  durationSec: number,
  o: { hintBpm?: number; detectedBpm?: number | null; songBpm?: number; minBpm?: number; maxBpm?: number } = {},
): { bpm: number; beats: number } | null {
  if (!(durationSec > 0.2) || !Number.isFinite(durationSec)) return null;
  const hint = o.hintBpm;
  if (hint && hint >= 40 && hint <= 300) {
    const beats = Math.round((durationSec * hint) / 60);
    return beats >= 1 ? { bpm: hint, beats } : null;
  }
  const det = o.detectedBpm;
  if (!det || !(det > 0)) return null;
  const lo = o.minBpm ?? 60;
  const hi = o.maxBpm ?? 200;
  const ref = o.songBpm && o.songBpm > 0 ? o.songBpm : 120;
  const fits: { bpm: number; beats: number; err: number }[] = [];
  for (const beats of [2, 4, 8, 16, 32, 64, 128]) {
    const bpm = (beats * 60) / durationSec;
    if (bpm < lo || bpm > hi) continue;
    const err = Math.min(...[det, det * 2, det / 2].map((d) => Math.abs(Math.log(bpm / d))));
    if (err <= Math.log(1.04)) fits.push({ bpm: round2(bpm), beats, err });
  }
  if (!fits.length) return null;
  const tie = Math.min(...fits.map((f) => f.err)) + 0.01;
  const best = fits.filter((f) => f.err <= tie).sort((a, b) => Math.abs(Math.log(a.bpm / ref)) - Math.abs(Math.log(b.bpm / ref)))[0];
  return { bpm: best.bpm, beats: best.beats };
}

// Ciclos del loop en el reloj de Telar y su código (velocidad 1: la copia ya va al tempo)
export const warpCycles = (beats: number, beatsPerCycle: number) => beats / (beatsPerCycle || 4);
const fmt = (x: number) => String(Math.round(x * 10000) / 10000);
export const warpCode = (name: string, cycles: number) => `s("${name}").slow(${fmt(cycles)})`;

// Factor de duración de Rubber Band (salida / entrada) y largo exacto de la vuelta
export const stretchRatio = (srcBpm: number, songBpm: number) => srcBpm / songBpm;
export const targetFrames = (beats: number, songBpm: number, sr: number) => Math.max(1, Math.round(((beats * 60) / songBpm) * sr));

// COLA de la unión: el ataque mínimo de superdough (1 ms, lineal desde 0) y su espejo
export const XFADE_S = 0.001;
export const tailFrames = (sr: number) => Math.ceil(XFADE_S * sr) + 2;
// funde la cola (después de la vuelta) 1→0 con la misma rampa del ataque de la voz siguiente
export function fadeTail(chans: Float32Array[], loopFrames: number, sr: number): Float32Array[] {
  const a = XFADE_S * sr;
  for (const c of chans) {
    for (let i = 0; loopFrames + i < c.length; i++) c[loopFrames + i] *= Math.max(0, 1 - i / a);
  }
  return chans;
}

// Copia RÁPIDA por varispeed (interpolación lineal, circular sobre la vuelta musical del original):
// del largo exacto + cola, en milisegundos. Suena mientras Rubber Band hace la buena.
export function varispeedLoop(chans: Float32Array[], srcLoopFrames: number, ratio: number, outFrames: number): Float32Array[] {
  const L = Math.max(1, srcLoopFrames);
  return chans.map((c) => {
    const out = new Float32Array(outFrames);
    const n = c.length;
    for (let i = 0; i < outFrames; i++) {
      let x = i / ratio;
      x -= Math.floor(x / L) * L;
      const i0 = Math.floor(x);
      const f = x - i0;
      const j = i0 + 1 >= L ? 0 : i0 + 1; // la muestra siguiente da la vuelta al final del loop
      const a = i0 < n ? c[i0] : 0;
      const b = j < n ? c[j] : 0;
      out[i] = a + (b - a) * f;
    }
    return out;
  });
}

// clave de caché de una copia estirada (el BPM del tema a la centésima). WARP_ALGO sube si cambia
// cómo se estira: las copias viejas del caché dejan de usarse solas.
export const WARP_ALGO = 1;
export const warpKey = (w: WarpInfo, songBpm: number) =>
  `${w.orig}|${round2(w.srcBpm)}|${round2(songBpm)}|${w.semis ?? 0}|${w.formant ? 'f' : ''}|a${WARP_ALGO}`;

// nombre de sample nuevo (corto, legible en el código, único)
export function warpName(clean: string, rand: () => number = Math.random): string {
  const base = (clean || 'loop').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 22) || 'loop';
  let id = '';
  for (let i = 0; i < 4; i++) id += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(rand() * 32) % 32];
  return `${WARP_PREFIX}${base}_${id}`;
}

// Contexto circular: [últimos `pad` del loop] + loop + [primeros `pad`]
export function circularPad(chans: Float32Array[], pad: number): Float32Array[] {
  return chans.map((c) => {
    const n = c.length;
    const p = Math.max(0, Math.min(n, Math.round(pad)));
    const e = new Float32Array(n + 2 * p);
    e.set(c.subarray(n - p), 0);
    e.set(c, p);
    e.set(c.subarray(0, p), p + n);
    return e;
  });
}

// La vuelta del medio de la copia estirada, de largo exacto (con silencio si faltara)
export function extractLoop(chans: Float32Array[], start: number, frames: number): Float32Array[] {
  const s = Math.max(0, Math.round(start));
  return chans.map((c) => {
    const out = new Float32Array(frames);
    out.set(c.subarray(s, Math.min(c.length, s + frames)));
    return out;
  });
}

// Cuadros clave para Rubber Band: cada tiempo del loop (desde su inicio, a `pad` muestras en la
// entrada circular, hasta su final) cae EXACTO en la salida → los golpes no se corren dentro de la
// vuelta (sin esto el estirador reparte el redondeo de sus saltos: hasta ~6 ms al final de 4 compases).
export function beatKeyFrames(pad: number, beats: number, srcBpm: number, sr: number, ratio: number): [number, number][] {
  const beatIn = (60 / srcBpm) * sr;
  const out: [number, number][] = [];
  for (let k = 0; k <= beats; k++) {
    const a = pad + k * beatIn;
    out.push([Math.round(a), Math.round(a * ratio)]);
  }
  return out;
}

// La vuelta del medio de la copia estirada, PERIÓDICA: sus últimos `xfade` cuadros se funden
// (Hann, ganancias que suman 1) hacia lo que en la copia precede a su inicio, así el final llega
// a la muestra anterior al principio y la unión es continua aunque el estirado haya movido la
// fase de los tonos sostenidos. Detrás va la cola de la unión: el principio otra vez (luego
// fadeTail la funde 1→0).
export function seamLoop(chans: Float32Array[], start: number, loopFrames: number, tail: number, xfade: number): Float32Array[] {
  const s = Math.max(0, Math.round(start));
  const L = loopFrames;
  const w = Math.max(0, Math.min(Math.round(xfade), s, L >> 2));
  return chans.map((c) => {
    const out = new Float32Array(L + tail);
    out.set(c.subarray(s, Math.min(c.length, s + L)));
    for (let i = 0; i < w; i++) {
      const g = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / w);
      const j = L - w + i;
      out[j] = (1 - g) * out[j] + g * c[s - w + i];
    }
    for (let i = 0; i < tail; i++) out[L + i] = i < L ? out[i] : 0;
    return out;
  });
}

// ¿Este código es un loop estirado (sample wl_…)? → nombre del sample o null
export function warpNameIn(code: string): string | null {
  const m = /s(?:ound)?\(\s*["'`](wl_[A-Za-z0-9_]+)["'`]\s*\)/.exec(code || '');
  return m ? m[1] : null;
}

// Cambia el loop del código (otro nombre y/o largo): `s("viejo").slow(x)` → `s("nuevo").slow(c)`
// en todos los brazos (un arrange puede repetirlo) y cualquier otra mención del nombre.
export function replaceWarpInCode(code: string, oldName: string, newName: string, cycles: number): string {
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return code
    .replace(new RegExp(`(s(?:ound)?\\(\\s*["'\`])${esc}(["'\`]\\s*\\))\\.(?:slow|loopAt)\\(\\s*[0-9.]+\\s*\\)`, 'g'), `$1${newName}$2.slow(${fmt(cycles)})`)
    .replace(new RegExp(`(["'\`])${esc}(["'\`])`, 'g'), `$1${newName}$2`);
}

// Nombre visible a partir del nombre del sample (wl_top_loop_ab12 → top_loop)
export const warpClean = (name: string) => name.replace(/^wl_/, '').replace(/_[a-z0-9]{4}$/, '') || 'loop';

// Texto corto del estado (chip del Source)
export function warpLabel(w: WarpInfo, songBpm: number): string {
  const bars = w.beats / 4;
  const len = Number.isInteger(bars) ? `${bars} comp.` : `${w.beats} t.`;
  const same = Math.abs(w.srcBpm - songBpm) < 0.05;
  return `${same ? '' : `${round2(w.srcBpm)}→`}${round2(songBpm)} bpm · ${len}`;
}
