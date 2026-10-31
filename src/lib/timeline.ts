// LÍNEA DE TIEMPO DE CLIPS (Fase 10) — lógica PURA (testeable en Node).
//
// La verdad sigue siendo el código: cada pista es `arrange([n, patrón], …)` y cada brazo es un
// CLIP en su compás (la suma de los anteriores). Desde 10.1 los brazos no tienen que coincidir con
// las secciones: un clip de 2 compases puede ir dentro de una sección de 16. Las secciones son la
// PISTA DE ARREGLO: mover, duplicar, insertar, borrar o estirar una sección es una operación sobre
// un TRAMO de la línea de tiempo, que se aplica igual a los clips de cada pista, a las curvas de
// automatización (por compás) y a las transiciones (10.3).
//
// Un tramo se describe como una lista de SEGMENTOS de la línea nueva, cada uno tomado de un lugar
// de la vieja (`from`) o vacío (`from: null`; con `extend`, el clip anterior sigue sonando).
// Partir un clip a mitad de su patrón conserva lo que suena: la rejilla se ROTA (sigue editable) y,
// si el patrón no es una rejilla, se adelanta con `.early(n)`.
import { buildSeq, isMutedArm, isSilenceArm, muteArm, parseSeq, splitArrange, unmuteArm, type Lane } from '../nodes/stepseqCode';
import type { AutoPoint } from './automation';
import type { TransItem } from './transitions';

export interface Clip { start: number; bars: number; expr: string }
export interface Seg { len: number; from: number | null; extend?: boolean }
export interface TrackTimeline { clips: Clip[]; pre: string; post: string }

export const SILENCE = 'silence';
export const isGap = (c: Pick<Clip, 'expr'>) => isSilenceArm(c.expr);
const EPS = 1e-6;
const rb = (x: number) => Math.round(x * 1000) / 1000;
const fmtBars = (n: number) => (Number.isInteger(n) ? String(n) : String(rb(n)));

// compases que dura el patrón (`.slow(n)`) — una rejilla de 2 compases vuelve cada 2
export function exprPeriod(expr: string): number {
  const m = /\.slow\(\s*(\d+(?:\.\d+)?)\s*\)\s*$/.exec(unmuteArm(expr).trim());
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 64 ? n : 1;
}

// rota una fila `k` pasos a la izquierda (el paso k pasa a ser el primero)
function rotLane(l: Lane, k: number, steps: number): Lane {
  const n = l.len && l.len < steps ? l.len : steps;
  const r = ((k % n) + n) % n;
  if (!r) return l;
  const rot = <T,>(a: T[] | undefined): T[] | undefined => (a ? [...a.slice(r, n), ...a.slice(0, r), ...a.slice(n)] : a);
  return { ...l, steps: rot(l.steps)!, notes: rot(l.notes)!, ratchet: rot(l.ratchet)!, prob: rot(l.prob)!, nudge: rot(l.nudge), cond: rot(l.cond) };
}

// el patrón `expr` empezando `off` compases más adelante (lo que sonaba ahí sigue sonando)
export function shiftExpr(expr: string, off: number): string {
  if (!(off > EPS) || isSilenceArm(expr)) return expr;
  if (isMutedArm(expr)) return muteArm(shiftExpr(unmuteArm(expr), off));
  const per = exprPeriod(expr);
  const o = off % per;
  if (o < EPS || per - o < EPS) return expr;
  const p = parseSeq(expr);
  if (p && !p.complex && p.lanes.length) {
    const k = (o / per) * p.steps;
    if (Math.abs(k - Math.round(k)) < 1e-6) return buildSeq(p, p.lanes.map((l) => rotLane(l, Math.round(k), p.steps)), p.steps);
  }
  return `(${expr.trim()}).early(${fmtBars(rb(o))})`;
}

// LEER la pista: brazos → clips. Una pista sin arrange es un clip que dura toda la canción.
// Si dura menos que la canción, se completa con silencio.
// `bounds` (inicios de sección): una pista SIN arrange se parte en un clip por sección (como al
// alinear: cada sección se enciende y apaga sola).
export function readTimeline(code: string, total: number, bounds: number[] = []): TrackTimeline {
  const c = (code ?? '').trim();
  const arms = splitArrange(code ?? '');
  const clips: Clip[] = [];
  let pre = 'arrange(';
  let post = ')';
  if (!arms) {
    if (c) {
      const cuts = [...new Set([0, ...bounds.filter((b) => b > EPS && b < total - EPS), Math.max(1, total)])].sort((a, b) => a - b);
      for (let k = 0; k < cuts.length - 1; k++) clips.push({ start: cuts[k], bars: cuts[k + 1] - cuts[k], expr: c });
    }
  } else {
    let pos = 0;
    for (const a of arms) {
      if (a.bars > EPS) clips.push({ start: pos, bars: a.bars, expr: a.code });
      pos += Math.max(0, a.bars);
    }
    pre = code.slice(0, arms[0].wholeStart);
    post = code.slice(arms[arms.length - 1].wholeEnd);
  }
  const end = clips.reduce((m, x) => Math.max(m, x.start + x.bars), 0);
  if (end < total - EPS) clips.push({ start: end, bars: total - end, expr: SILENCE });
  return { clips, pre, post };
}

// los clips del tramo [a, b) (b = ∞: hasta el final), con su inicio relativo a `a`
export function sliceClips(clips: Clip[], a: number, b: number): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const s = Math.max(a, c.start);
    const e = Math.min(b, c.start + c.bars);
    if (e - s <= EPS) continue;
    out.push({ start: rb(s - a), bars: rb(e - s), expr: shiftExpr(c.expr, s - c.start) });
  }
  return out;
}
const clipsEnd = (clips: Clip[]) => clips.reduce((m, c) => Math.max(m, c.start + c.bars), 0);

// ORDENAR: sin huecos ni solapes; los silencios se parten en los bordes de sección (un bloque vacío
// por sección, como antes) y se juntan dentro de una misma sección
export function normalize(clips: Clip[], bounds: number[] = []): Clip[] {
  const sorted = clips.filter((c) => c.bars > EPS).sort((a, b) => a.start - b.start);
  const out: Clip[] = [];
  let pos = 0;
  const pushGap = (s: number, e: number) => {
    let x = s;
    const cuts = bounds.filter((b) => b > s + EPS && b < e - EPS).sort((a, b) => a - b);
    for (const cut of [...cuts, e]) {
      const last = out[out.length - 1];
      if (last && isGap(last) && Math.abs(last.start + last.bars - x) < EPS && !bounds.some((b) => Math.abs(b - x) < EPS)) last.bars = rb(last.bars + cut - x);
      else out.push({ start: rb(x), bars: rb(cut - x), expr: SILENCE });
      x = cut;
    }
  };
  for (const c of sorted) {
    if (c.start > pos + EPS) pushGap(pos, c.start);
    const s = Math.max(pos, c.start);
    const e = c.start + c.bars;
    if (e - s <= EPS) continue;
    if (isGap(c)) pushGap(s, e);
    else out.push({ start: rb(s), bars: rb(e - s), expr: s > c.start + EPS ? shiftExpr(c.expr, s - c.start) : c.expr });
    pos = e;
  }
  return out;
}

export function writeTimeline(tl: TrackTimeline, clips: Clip[]): string {
  const arms = clips.filter((c) => c.bars > EPS).map((c) => `[${fmtBars(rb(c.bars))}, ${c.expr.trim()}]`);
  if (!arms.length) return `${tl.pre}[1, silence]${tl.post}`;
  return `${tl.pre}${arms.join(', ')}${tl.post}`;
}

// --- tramos: la línea nueva como segmentos de la vieja ---------------------------------------
const TAIL: Seg = { len: Infinity, from: 0 };
const segs = (...xs: Seg[]): Seg[] => xs.filter((s) => s.len > EPS);
export const opInsert = (at: number, len: number, extend = false): Seg[] => segs({ len: at, from: 0 }, { len, from: null, extend }, { ...TAIL, from: at });
export const opRemove = (s: number, e: number): Seg[] => segs({ len: s, from: 0 }, { ...TAIL, from: e });
export const opDuplicate = (s: number, e: number): Seg[] => segs({ len: e, from: 0 }, { len: e - s, from: s }, { ...TAIL, from: e });
// los tramos viejos en un orden nuevo (mover secciones), y después el resto
export function opReorder(ranges: [number, number][], tailFrom: number): Seg[] {
  return segs(...ranges.map(([from, len]) => ({ len, from })), { ...TAIL, from: tailFrom });
}

export function remapClips(clips: Clip[], sg: Seg[]): Clip[] {
  const out: Clip[] = [];
  let pos = 0;
  for (const s of sg) {
    if (s.from == null) {
      const last = out[out.length - 1];
      if (s.extend && last && !isGap(last) && Math.abs(last.start + last.bars - pos) < EPS) last.bars = rb(last.bars + s.len);
      else out.push({ start: pos, bars: s.len, expr: SILENCE });
      pos = rb(pos + s.len);
      continue;
    }
    const piece = sliceClips(clips, s.from, s.from + s.len);
    for (const c of piece) out.push({ ...c, start: rb(pos + c.start) });
    pos = rb(pos + (Number.isFinite(s.len) ? s.len : clipsEnd(piece)));
  }
  return out;
}

// valor de una curva en `x` (rampas lineales; antes del primero el primero, después el último)
export function curveAt(pts: AutoPoint[], x: number): number {
  if (!pts.length) return 0;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [b1, v1] = pts[i];
    if (x <= b1) {
      const [b0, v0] = pts[i - 1];
      return b1 - b0 < EPS ? v1 : v0 + ((v1 - v0) * (x - b0)) / (b1 - b0);
    }
  }
  return pts[pts.length - 1][1];
}
// quita los puntos que están sobre la recta de sus vecinos (no cambian la curva)
export function simplifyCurve(pts: AutoPoint[]): AutoPoint[] {
  if (pts.length <= 2) return pts;
  const out: AutoPoint[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [b0, v0] = out[out.length - 1];
    const [b1, v1] = pts[i];
    const [b2, v2] = pts[i + 1];
    const lin = b2 - b0 < EPS ? v1 : v0 + ((v2 - v0) * (b1 - b0)) / (b2 - b0);
    if (Math.abs(lin - v1) > 1e-6) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const JUMP = 1e-3; // un salto de valor en un borde: dos puntos a 1/1000 de compás
export function remapCurve(pts: AutoPoint[], sg: Seg[]): AutoPoint[] {
  if (!pts.length) return pts;
  const out: AutoPoint[] = [];
  let pos = 0;
  let held = curveAt(pts, 0);
  for (const s of sg) {
    if (s.from == null) {
      out.push([rb(pos), held], [rb(pos + s.len - JUMP), held]);
      pos += s.len;
      continue;
    }
    const end = s.from + s.len;
    out.push([rb(pos), curveAt(pts, s.from)]);
    for (const [b, v] of pts) if (b > s.from + EPS && b < end - EPS) out.push([rb(pos + b - s.from), v]);
    if (Number.isFinite(s.len)) {
      held = curveAt(pts, end - JUMP);
      out.push([rb(pos + s.len - JUMP), held]);
      pos += s.len;
    }
  }
  const sorted = out.sort((a, b) => a[0] - b[0]).filter((p, i, a) => i === 0 || Math.abs(p[0] - a[i - 1][0]) > EPS / 10);
  return simplifyCurve(sorted);
}

export function remapTransitions(items: TransItem[], sg: Seg[]): TransItem[] {
  const out: TransItem[] = [];
  let pos = 0;
  for (const s of sg) {
    if (s.from != null) {
      const end = s.from + s.len;
      for (const it of items) if (it.at >= s.from - EPS && it.at < end - EPS) out.push({ ...it, at: rb(pos + it.at - s.from) });
    }
    if (Number.isFinite(s.len)) pos += s.len;
  }
  const key = (x: TransItem) => `${x.kind}@${x.at}`;
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
}

// --- clips de UNA pista (10.1 · 10.2) ---------------------------------------------------------
const indexAt = (clips: Clip[], bar: number) => clips.findIndex((c) => bar >= c.start - EPS && bar < c.start + c.bars - EPS);

// pone `expr` en [at, at+bars) (lo que había ahí se pisa; lo de los lados se recorta)
export function placeClip(clips: Clip[], at: number, bars: number, expr: string): Clip[] {
  const a = Math.max(0, at);
  const b = a + Math.max(0, bars);
  const tail = sliceClips(clips, b, Infinity).map((c) => ({ ...c, start: rb(c.start + b) }));
  return [...sliceClips(clips, 0, a), { start: rb(a), bars: rb(b - a), expr }, ...tail];
}
export function clearClip(clips: Clip[], i: number): Clip[] {
  const c = clips[i];
  return c ? placeClip(clips, c.start, c.bars, SILENCE) : clips;
}
export function moveClip(clips: Clip[], i: number, to: number): Clip[] {
  const c = clips[i];
  if (!c || isGap(c)) return clips;
  return placeClip(clearClip(clips, i), to, c.bars, c.expr);
}
// estirar el borde derecho: más largo = el patrón se repite; más corto = silencio detrás
export function resizeClip(clips: Clip[], i: number, bars: number): Clip[] {
  const c = clips[i];
  if (!c || isGap(c) || !(bars > EPS)) return clips;
  if (bars >= c.bars) return placeClip(clips, c.start, bars, c.expr);
  return placeClip(placeClip(clips, c.start + bars, c.bars - bars, SILENCE), c.start, bars, c.expr);
}
// PARTIR en el compás `bar` (Ctrl+E): dos clips que suenan igual que antes
export function splitClip(clips: Clip[], bar: number): Clip[] {
  const i = indexAt(clips, bar);
  const c = clips[i];
  if (!c || isGap(c) || bar <= c.start + EPS || bar >= c.start + c.bars - EPS) return clips;
  const k = bar - c.start;
  return [...clips.slice(0, i), { start: c.start, bars: rb(k), expr: c.expr }, { start: rb(bar), bars: rb(c.bars - k), expr: shiftExpr(c.expr, k) }, ...clips.slice(i + 1)];
}
// UNIR el clip i con el siguiente: queda el patrón del primero, con el largo de los dos
export function joinClips(clips: Clip[], i: number): Clip[] {
  const a = clips[i];
  const b = clips[i + 1];
  if (!a || !b || isGap(a)) return clips;
  return [...clips.slice(0, i), { start: a.start, bars: rb(a.bars + b.bars), expr: a.expr }, ...clips.slice(i + 2)];
}
// DUPLICAR (Ctrl+D): una copia justo detrás (pisa lo que haya)
export function duplicateClip(clips: Clip[], i: number): Clip[] {
  const c = clips[i];
  if (!c || isGap(c)) return clips;
  return placeClip(clips, c.start + c.bars, c.bars, c.expr);
}
// recorta la pista al largo de la canción (lo que se salga al mover o estirar al final)
export function clampClips(clips: Clip[], total: number): Clip[] {
  return sliceClips(clips, 0, total);
}
