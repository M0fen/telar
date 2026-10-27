// DIBUJO DE UN PATRÓN (Fase 8.7 / 9.1) — lógica PURA: de los eventos de un tramo a figuras
// (rectángulos relativos 0..1) para pintar en un canvas. Se usa en la miniatura de los nodos
// plegados y dentro de los bloques del DAW.
//   · batería: una fila por sonido (los más usados primero, hasta `maxRows`), un golpe por evento
//     con la opacidad de su fuerza;
//   · notas: piano roll mínimo (altura de la nota, largo del evento);
//   · loop: un solo evento largo (un sample que dura el compás o más) → una barra con su nombre.
import type { PreviewEvent } from '../audio/patternPreview';

// «a2», «eb3», «c#1» o un número → altura MIDI (c4 = 60); null si no es una nota
const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function noteNumber(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x !== 'string') return null;
  const m = /^([a-g])([#sbf]*)(-?\d+)?$/i.exec(x.trim());
  if (!m) return null;
  let pc = NOTE_PC[m[1].toLowerCase()];
  for (const ch of m[2].toLowerCase()) pc += ch === '#' || ch === 's' ? 1 : -1;
  const oct = m[3] != null ? Number(m[3]) : 3;
  return (oct + 1) * 12 + pc;
}


export interface Shape { x: number; y: number; w: number; h: number; a: number }
export interface PatternFigure {
  kind: 'drums' | 'notes' | 'loop' | 'empty';
  shapes: Shape[];
  rows: string[]; // batería: el sonido de cada fila (de arriba abajo)
  range?: [number, number]; // notas: la más grave y la más aguda
}

export function patternFigure(ev: PreviewEvent[], span: number, maxRows = 5): PatternFigure {
  const L = span > 0 ? span : 1;
  if (!ev.length) return { kind: 'empty', shapes: [], rows: [] };
  const notes = ev.filter((e) => e.note != null);
  if (notes.length >= Math.max(1, ev.length / 2)) {
    let lo = Math.min(...notes.map((e) => e.note!));
    let hi = Math.max(...notes.map((e) => e.note!));
    if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 3); hi = Math.ceil(mid + 3); }
    const rows = hi - lo + 1;
    const h = 1 / rows;
    return {
      kind: 'notes',
      rows: [],
      range: [lo, hi],
      shapes: notes.map((e) => ({ x: e.t / L, w: Math.max(e.d / L, 0.004), y: (hi - e.note!) * h, h, a: Math.max(0.35, Math.min(1, e.gain)) })),
    };
  }
  // un sample largo (un loop) → barra
  if (ev.length <= 2 && ev.every((e) => e.d >= Math.min(0.5, L))) {
    return { kind: 'loop', rows: [ev[0].snd], shapes: ev.map((e) => ({ x: e.t / L, w: Math.min(1 - e.t / L, e.d / L), y: 0, h: 1, a: Math.max(0.35, Math.min(1, e.gain)) })) };
  }
  // batería: filas por sonido, los más usados arriba (los que no caben se juntan en la última)
  const count = new Map<string, number>();
  for (const e of ev) count.set(e.snd, (count.get(e.snd) ?? 0) + 1);
  const order = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const rows = order.slice(0, maxRows);
  const rowOf = (s: string) => { const i = rows.indexOf(s); return i >= 0 ? i : rows.length - 1; };
  const h = 1 / rows.length;
  return {
    kind: 'drums',
    rows,
    shapes: ev.map((e) => ({ x: e.t / L, w: Math.min(0.9 * Math.max(e.d, 1 / 64) / L, 1 / (16 * L)), y: rowOf(e.snd) * h, h, a: Math.max(0.3, Math.min(1, e.gain)) })),
  };
}

// CADA CUÁNTOS COMPASES SE REPITE un patrón dentro de un tramo de `n` compases (para las marcas de
// vuelta en los bloques del DAW, 9.1): el menor p tal que cada compás suena igual que el compás
// i mod p. Un 4×4 → 1; un fill cada 8 → 8; si no se repite dentro del tramo → n.
export function patternPeriod(ev: PreviewEvent[], n: number): number {
  const N = Math.max(1, Math.floor(n));
  const sig: string[] = Array.from({ length: N }, () => '');
  for (const e of ev) {
    const i = Math.floor(e.t + 1e-9);
    if (i < 0 || i >= N) continue;
    sig[i] += `${Math.round((e.t - i) * 192)}:${e.snd}:${e.note ?? ''}:${Math.round(e.gain * 100)}|`;
  }
  for (let p = 1; p < N; p++) {
    let ok = true;
    for (let i = p; i < N && ok; i++) ok = sig[i] === sig[i % p];
    if (ok) return p;
  }
  return N;
}
