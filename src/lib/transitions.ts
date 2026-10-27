// TRANSICIONES (Fase 7.4) — lógica PURA (testeable en Node).
//
// Elementos que se colocan en la línea de tiempo del DAW, a tempo:
//   · riser:   ruido que sube (paso-alto que se abre y volumen que crece) + una sierra que sube dos
//              octavas, durante N compases que TERMINAN en el compás elegido (el drop);
//   · reverso: un «barrido al revés» (ruido rosa que crece y se abre) que se corta justo en el compás;
//   · impacto: golpe grave que cae de tono + ruido con cola de reverb, EN el compás elegido;
//   · barrido: el filtro DJ del máster sube (paso-alto) durante N compases y vuelve a abrirse en el
//              compás — no es un sonido: entra como curva de la automatización del máster.
// Viven en una pista propia («transiciones», data.transitions) que el compilador escribe a partir
// de los elementos. Cada elemento es un arrange de toda la canción con UN evento que dura lo que el
// elemento: sus instrumentos (src/audio/transSounds.ts) leen esa duración, así las envolventes van
// a tempo sin escribir segundos, y ■ los puede parar. Lo afinado (la sierra del riser, el grave del
// impacto) sale de la tónica del tema. Todo va seco y se mezcla como cualquier pista (nivel,
// filtro, EQ, compresor y envíos a la reverb/eco compartidos, en su panel «mezcla»).
import { curveAt, type AutoPoint } from './automation';

export type TransKind = 'riser' | 'reverse' | 'impact' | 'sweep';
export interface TransItem {
  kind: TransKind;
  at: number; // compás de canción (desde 0): donde TERMINA (riser/reverso/barrido) o EMPIEZA (impacto)
  bars: number; // duración en compases (el impacto dura 1)
}

export const TRANS_DEF: Record<TransKind, { label: string; icon: string; lengths: number[]; title: string }> = {
  riser: { label: 'riser', icon: '↗', lengths: [2, 4, 8], title: 'ruido y sierra que suben hasta el compás elegido (antes del drop)' },
  reverse: { label: 'reverso', icon: '⟲', lengths: [1, 2], title: 'barrido al revés que crece y se corta justo en el compás' },
  impact: { label: 'impacto', icon: '✸', lengths: [1], title: 'golpe grave con cola de reverb en el compás elegido (el «uno» del drop)' },
  sweep: { label: 'barrido', icon: '∿', lengths: [4, 8], title: 'el filtro del máster sube (paso-alto) y se abre de golpe en el compás' },
};
const KINDS = Object.keys(TRANS_DEF) as TransKind[];

export function cleanTransitions(x: unknown): TransItem[] {
  if (!Array.isArray(x)) return [];
  const out: TransItem[] = [];
  for (const it of x) {
    const o = it as Partial<TransItem> | null;
    if (!o || !KINDS.includes(o.kind as TransKind)) continue;
    const at = Math.round(Number(o.at) * 48) / 48; // la rejilla del DAW llega a 1/16 y a tresillos (8.1)
    const bars = o.kind === 'impact' ? 1 : Math.round(Number(o.bars));
    if (!Number.isFinite(at) || at < 0 || !(bars >= 1 && bars <= 32)) continue;
    out.push({ kind: o.kind as TransKind, at, bars });
    if (out.length >= 128) break;
  }
  return out.sort((a, b) => a.at - b.at || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
}

// compases que ocupa en la línea de tiempo
export function transSpan(it: TransItem): { start: number; bars: number } {
  return it.kind === 'impact' ? { start: it.at, bars: 1 } : { start: it.at - it.bars, bars: it.bars };
}

// cómo se dibujan en la fila del DAW: lo que se pisa va en otra sub-fila (un riser que termina donde
// cae el impacto, un barrido encima de un riser…); lo que cae fuera de la canción no se dibuja
export function packTransitions(items: TransItem[], total: number): { placed: { it: TransItem; start: number; end: number; row: number }[]; rows: number } {
  const spans = items
    .map((it) => { const sp = transSpan(it); return { it, start: Math.max(0, sp.start), end: Math.min(total, sp.start + sp.bars) }; })
    .filter((p) => p.end > p.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const ends: number[] = [];
  const placed = spans.map((p) => {
    let row = ends.findIndex((e) => e <= p.start + 1e-9);
    if (row < 0) { row = ends.length; ends.push(0); }
    ends[row] = p.end;
    return { ...p, row };
  });
  return { placed, rows: Math.max(1, ends.length) };
}

// el patrón de UN elemento, de `bars` ciclos (`root` = tónica del tema, 0–11 desde C). El riser y
// el reverso cortan limpio en el compás; el impacto es un grave que cae y un «crash» de ruido con
// su propia cola (sin reverb de superdough: su IR llega tarde en el render y no sonaba al exportar).
export function transPattern(kind: TransKind, bars: number, root = 0): string {
  const r = ((Math.round(root) % 12) + 12) % 12;
  if (kind === 'riser') return `s("telar_riser").note(${48 + r}).slow(${bars})`; // la sierra sube de la tónica 3 a la 5
  if (kind === 'reverse') return `s("telar_reverse").slow(${bars})`;
  if (kind === 'impact') return `stack(s("telar_boom").note(${24 + r}), s("telar_crash"))`; // cae hasta la tónica 1
  return 'silence'; // barrido: es automatización del máster
}

// el código de la pista de transiciones: un arrange de toda la canción por elemento
export function transitionsCode(items: TransItem[], songBars: number, root = 0): string {
  const L = Math.max(0, Math.round(songBars));
  if (!L) return 'silence';
  const parts: string[] = [];
  for (const it of cleanTransitions(items)) {
    if (it.kind === 'sweep') continue;
    const sp = transSpan(it);
    const start = Math.max(0, sp.start);
    const end = Math.min(L, sp.start + sp.bars);
    const n = end - start;
    if (n < 1) continue;
    const arms: string[] = [];
    if (start > 0) arms.push(`[${start}, silence]`);
    arms.push(`[${n}, ${transPattern(it.kind, n, root)}]`);
    if (L - end > 0) arms.push(`[${L - end}, silence]`);
    parts.push(`arrange(${arms.join(', ')})`);
  }
  if (!parts.length) return 'silence';
  return parts.length === 1 ? parts[0] : `stack(${parts.join(', ')})`;
}

// BARRIDO → curva del filtro DJ del máster (paso-alto que sube y se abre en el compás), encima de
// la curva que ya tuviera (dentro de cada barrido manda el barrido)
export const SWEEP_TOP = 0.7;
export function sweepCurve(items: TransItem[], user: AutoPoint[] | undefined, songBars: number): AutoPoint[] | null {
  const sweeps = cleanTransitions(items).filter((it) => it.kind === 'sweep');
  if (!sweeps.length) return user && user.length ? user : null;
  const L = songBars > 0 ? songBars : 0;
  const u = (x: number) => (user && user.length ? curveAt(user, x, L) : 0);
  let pts: AutoPoint[] = user && user.length ? [...user] : [[0, 0]];
  for (const sw of sweeps) {
    const s = Math.max(0, sw.at - sw.bars);
    const e = sw.at;
    pts = pts.filter(([b]) => b < s || b > e);
    pts.push([s, u(s)], [Math.max(s, e - 0.02), SWEEP_TOP], [e, u(e)]);
  }
  return pts.sort((a, b) => a[0] - b[0]).filter((p, i, arr) => i === 0 || Math.abs(p[0] - arr[i - 1][0]) > 1e-6);
}

// «＋ en cada sección»: un riser de 4 compases que termina en cada cambio de sección y un impacto en
// su primer compás (salvo la primera sección)
export function autoTransitions(steps: { bars: number }[]): TransItem[] {
  const out: TransItem[] = [];
  let acc = 0;
  steps.forEach((s, i) => {
    if (i > 0 && acc >= 2) {
      out.push({ kind: 'riser', at: acc, bars: Math.min(4, Math.max(2, steps[i - 1].bars)) });
      out.push({ kind: 'impact', at: acc, bars: 1 });
    }
    acc += Math.max(1, Math.round(s.bars));
  });
  return out;
}
