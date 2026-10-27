// CÓDIGO DE UN CLIP DE AUDIO (Fase 9.5) — lógica PURA (testeable en Node).
//
// Un loop o un sample suelto es un solo evento por vuelta: `s("wl_top_ab12").slow(4)`. Lo que el
// editor de loops cambia se escribe en el código con controles de superdough, así cada sección del
// arreglo puede tener su versión (al revés en el respiro, solo los 2 últimos compases en el drop):
//
//   s("wl_top_ab12").begin(0.5).end(1).speed(-1).attack(0.01).release(0.08).clip(0.97).slow(2)
//
//   · inicio/fin: `.begin/.end` (fracciones del sample). Con `.speed(-1)` superdough da la vuelta al
//     buffer ANTES de recortar, así que el tramo [b, e] del original se escribe [1−e, 1−b];
//   · al revés: `.speed(-1)`; tono por varispeed (samples sin warp): `.speed(2^(st/12))`;
//   · fundido de entrada: `.attack(s)`; de salida: `.release(s)` y `.clip(c)` para que la nota
//     termine `s` segundos ANTES del final (superdough suelta en duración·clip y luego hace release);
//   · rebanadas: `.slice(…)` del rebanador (5.4), tal cual;
//   · vuelta: `.slow(N)` (siempre al final). Lo demás se conserva tal cual.

export interface ClipState {
  quote: string; // comilla del nombre
  name: string; // sample
  slice: string | null; // `.slice(…)` del rebanador, tal cual
  begin: number; // tramo del ORIGINAL (0..1), sin importar si va al revés
  end: number;
  rev: boolean;
  semis: number; // tono por varispeed (cambia también el tempo)
  fadeIn: number; // segundos
  fadeOut: number; // segundos
  fx: string; // otros métodos, tal cual
  cycles: number; // `.slow(N)`; 1 si no hay
}

const NUM = /^\s*-?\d*\.?\d+(?:e-?\d+)?\s*$/i;
const num = (s: string) => (NUM.test(s) ? Number(s) : NaN);
const r4 = (x: number) => Math.round(x * 10000) / 10000;
export const fmtNum = (x: number) => String(r4(x));

// métodos de primer nivel de una cadena `.a(…).b(…)`; null si no es una cadena limpia
export function splitMethods(chain: string): { name: string; args: string; raw: string }[] | null {
  const out: { name: string; args: string; raw: string }[] = [];
  let i = 0;
  const s = chain.trim();
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] !== '.') return null;
    const m = /^\.([A-Za-z_$][\w$]*)\s*\(/.exec(s.slice(i));
    if (!m) return null;
    let j = i + m[0].length;
    let depth = 1;
    let q: string | null = null;
    for (; j < s.length && depth > 0; j++) {
      const c = s[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
    }
    if (depth !== 0) return null;
    out.push({ name: m[1], args: s.slice(i + m[0].length, j - 1), raw: s.slice(i, j) });
    i = j;
  }
  return out;
}

export function parseClip(code: string): ClipState | null {
  const t = (code || '').trim();
  const m = /^s(?:ound)?\(\s*(["'`])([A-Za-z0-9_]+)\1\s*\)/.exec(t);
  if (!m) return null;
  const ms = splitMethods(t.slice(m[0].length));
  if (!ms) return null;
  const st: ClipState = { quote: m[1], name: m[2], slice: null, begin: 0, end: 1, rev: false, semis: 0, fadeIn: 0, fadeOut: 0, fx: '', cycles: 1 };
  let cb = 0, ce = 1, speed = 1;
  for (let k = 0; k < ms.length; k++) {
    const x = ms[k];
    const v = num(x.args);
    if (x.name === 'slice' && st.slice == null) st.slice = x.raw;
    else if (x.name === 'begin' && Number.isFinite(v)) cb = v;
    else if (x.name === 'end' && Number.isFinite(v)) ce = v;
    else if (x.name === 'speed' && Number.isFinite(v) && v !== 0) speed = v;
    else if (x.name === 'attack' && Number.isFinite(v)) st.fadeIn = Math.max(0, v);
    else if (x.name === 'release' && Number.isFinite(v)) st.fadeOut = Math.max(0, v);
    else if (x.name === 'clip' && Number.isFinite(v)) { /* se recalcula con el fundido de salida */ }
    else if (x.name === 'slow' && Number.isFinite(v) && v > 0 && k === ms.length - 1) st.cycles = v;
    else st.fx += x.raw;
  }
  st.rev = speed < 0;
  st.semis = Math.round(12 * Math.log2(Math.abs(speed)) * 100) / 100;
  const b = Math.max(0, Math.min(1, cb));
  const e = Math.max(0, Math.min(1, ce));
  // al revés superdough recorta el buffer ya volteado: el tramo del original es el espejo
  [st.begin, st.end] = st.rev ? [1 - e, 1 - b] : [b, e];
  if (st.end - st.begin < 0.001) { st.begin = 0; st.end = 1; }
  return st;
}

// ¿Es un clip de audio (un sample solo, con lo de arriba)? Un `s("bd*4")` o `s("bd sd")` no.
export const isClipCode = (code: string) => parseClip(code) != null;

export interface ClipCtx {
  regionSec?: number; // lo que dura el tramo al sonar (para el fundido de salida)
  eventSec?: number; // lo que dura el evento (la vuelta)
}
// `.clip` para que la nota suelte `fadeOut` s antes del final del tramo (o de la vuelta, si es menor)
export function fadeClip(st: ClipState, ctx: ClipCtx): number | null {
  if (!(st.fadeOut > 0) || !(ctx.eventSec && ctx.eventSec > 0)) return null;
  const play = Math.min(ctx.regionSec && ctx.regionSec > 0 ? ctx.regionSec : ctx.eventSec, ctx.eventSec * 64);
  return Math.max(0.01, r4((play - st.fadeOut) / ctx.eventSec));
}

export function buildClip(st: ClipState, ctx: ClipCtx = {}): string {
  let out = `s(${st.quote}${st.name}${st.quote})`;
  if (st.slice) out += st.slice;
  const full = st.begin <= 0.0005 && st.end >= 0.9995;
  if (!full && !st.slice) {
    const [b, e] = st.rev ? [1 - st.end, 1 - st.begin] : [st.begin, st.end];
    if (b > 0.0005) out += `.begin(${fmtNum(b)})`;
    if (e < 0.9995) out += `.end(${fmtNum(e)})`;
  }
  const sp = (st.rev ? -1 : 1) * Math.pow(2, (st.semis || 0) / 12);
  if (Math.abs(sp - 1) > 1e-4) out += `.speed(${fmtNum(sp)})`;
  if (st.fadeIn > 0.0005) out += `.attack(${fmtNum(st.fadeIn)})`;
  const c = fadeClip(st, ctx);
  if (st.fadeOut > 0.0005 && c != null) out += `.release(${fmtNum(st.fadeOut)}).clip(${fmtNum(c)})`;
  out += st.fx;
  if (Math.abs(st.cycles - 1) > 1e-9) out += `.slow(${fmtNum(st.cycles)})`;
  return out;
}

// el tramo pegado a la rejilla del loop: `beats` tiempos en el sample (0 = sin rejilla → 1/64)
export function snapFrac(x: number, beats: number, free = false): number {
  const v = Math.max(0, Math.min(1, x));
  if (free) return r4(v);
  const n = beats > 0 ? beats : 64;
  return r4(Math.round(v * n) / n);
}

// CORTES de rebanadas que se arrastran: el corte i se mueve entre sus vecinos (con un margen)
export function moveCut(cuts: number[], i: number, x: number, gap = 0.005): number[] {
  if (i <= 0 || i >= cuts.length - 1) return cuts;
  const out = cuts.slice();
  out[i] = r4(Math.max(cuts[i - 1] + gap, Math.min(cuts[i + 1] - gap, x)));
  return out;
}
// un corte nuevo en x (entre los que haya) o quitar el corte i
export function addCut(cuts: number[], x: number, gap = 0.005): number[] {
  if (!(x > gap && x < 1 - gap) || cuts.some((c) => Math.abs(c - x) < gap)) return cuts;
  return [...cuts, r4(x)].sort((a, b) => a - b);
}
export const removeCut = (cuts: number[], i: number) => (i <= 0 || i >= cuts.length - 1 ? cuts : cuts.filter((_, k) => k !== i));

// MARCADOR DE TEMPO: el compás `bar` (desde 1) del loop cae en `sec` segundos del original →
// tempo original y tiempos del loop. `bpc` = tiempos por compás.
export function tempoFromMarker(bar: number, sec: number, durSec: number, bpc = 4): { bpm: number; beats: number } | null {
  if (!(bar >= 1) || !(sec > 0.05) || !(durSec > 0)) return null;
  const bpm = Math.round(((60 * bar * bpc) / sec) * 100) / 100;
  if (!(bpm >= 40 && bpm <= 300)) return null;
  const beats = Math.round((durSec * bpm) / 60);
  return beats >= 1 ? { bpm, beats } : null;
}
