// MOTOR DE EDICIÓN DE LA ESTRUCTURA (Modo DAW, Fase 2.1). Lógica PURA: recibe los pasos de
// la canción y el código de cada pista, y devuelve los nuevos. La verdad sigue siendo el
// código: cada sección de la canción ES un brazo en el `arrange([n, patrón], …)` de cada
// pista, en el mismo orden y con los mismos compases. Por eso TODA operación alinea antes
// (una pista plana se envuelve y suena igual; una corta se completa con silencios) y edita
// el mismo brazo en todas las pistas: canción y pistas nunca quedan desfasadas.
// Las pistas con MÁS brazos que secciones no se tocan (recortar sería destructivo): van en
// `skipped` para avisar.
//
// FASE 10: las pistas pueden tener CLIPS LIBRES (brazos que no coinciden con las secciones). Las
// operaciones de sección trabajan sobre TRAMOS de la línea de tiempo (`timeline.ts`): mueven los
// clips de cada pista, las curvas de automatización y las transiciones de ese tramo, todo en un paso.
import { splitArrange, spliceArm, alignArrangeToBars, type ArrangeArm } from '../nodes/stepseqCode';
import { normalize, opDuplicate, opInsert, opRemove, opReorder, readTimeline, remapClips, remapCurve, remapTransitions, writeTimeline, type Seg } from './timeline';
import type { AutoPoint } from './automation';
import type { TransItem } from './transitions';
import type { NodeData } from '../graph/types';

export interface EditStep {
  id: string;
  scene: number;
  bars: number;
  name?: string;
}
export interface ArrangeState {
  steps: EditStep[];
  codes: Record<string, string>; // código de cada pista (id → código)
  autos?: Record<string, Record<string, AutoPoint[]>>; // curvas de cada nodo (pistas, FX, máster)
  trans?: { id: string; items: TransItem[] }; // transiciones (7.4) y su nodo
}
export interface EditResult extends ArrangeState {
  skipped: string[]; // pistas que no se pudieron alinear (tienen más secciones que la canción)
  patches?: Record<string, Partial<NodeData>>; // curvas y transiciones movidas con su tramo (10.3)
}

export const MAX_SECTION_BARS = 64;
const clampBars = (b: number) => Math.max(1, Math.min(MAX_SECTION_BARS, Math.round(Number(b) || 1)));

let seq = 0;
export const newStepId = (): string => `st_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const barsOf = (steps: EditStep[]) => steps.map((s) => clampBars(s.bars));

// ¿la pista ya tiene un brazo por sección con los mismos compases?
function isAligned(arms: ArrangeArm[] | null, bars: number[]): boolean {
  return !!arms && arms.length === bars.length && arms.every((a, i) => a.bars === bars[i]);
}

// ALINEAR TODO: las planas se envuelven con las secciones (cada sección con su patrón →
// suena igual), las de menos secciones se completan con silencios, las de distinto largo se
// redimensionan. Pistas vacías (sin código) no se tocan.
export function alignAll(state: ArrangeState): EditResult {
  const bars = barsOf(state.steps);
  const codes: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [id, code] of Object.entries(state.codes)) {
    codes[id] = code;
    if (!bars.length || !(code ?? '').trim()) continue;
    const arms = splitArrange(code);
    if (isAligned(arms, bars)) continue;
    // clips libres (10.1): más brazos que secciones pero el mismo largo → ya está bien
    const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
    if (arms && arms.length > bars.length && Math.abs(sum(arms.map((x) => x.bars)) - sum(bars)) < 1e-9) continue;
    const next = alignArrangeToBars(code, bars);
    if (next === null) skipped.push(id);
    else codes[id] = next;
  }
  return { steps: state.steps.map((s) => ({ ...s, bars: clampBars(s.bars) })), codes, skipped };
}

// inicio de cada sección (compás desde 0) y largo total
function starts(steps: EditStep[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const st of steps) { out.push(acc); acc += clampBars(st.bars); }
  return out;
}
const totalOf = (steps: EditStep[]) => steps.reduce((a, st) => a + clampBars(st.bars), 0);

// APLICA UN TRAMO (10.3): la misma transformación de la línea de tiempo a los clips de cada pista,
// a las curvas de automatización de cada nodo y a las transiciones
function applySegs(state: ArrangeState, sg: Seg[], steps: EditStep[]): EditResult {
  const T = totalOf(state.steps);
  const oldBounds = starts(state.steps);
  const bounds = starts(steps);
  const codes: Record<string, string> = { ...state.codes };
  for (const [id, code] of Object.entries(state.codes)) {
    if (!(code ?? '').trim()) continue;
    const tl = readTimeline(code, T, oldBounds);
    codes[id] = writeTimeline(tl, normalize(remapClips(tl.clips, sg), bounds));
  }
  const patches: Record<string, Partial<NodeData>> = {};
  for (const [id, auto] of Object.entries(state.autos ?? {})) {
    let changed = false;
    const next: Record<string, AutoPoint[]> = {};
    for (const [k, pts] of Object.entries(auto)) {
      if (!Array.isArray(pts) || !pts.length) { next[k] = pts; continue; }
      next[k] = remapCurve(pts, sg);
      changed = true;
    }
    if (changed) patches[id] = { auto: next } as Partial<NodeData>;
  }
  if (state.trans && state.trans.items.length) {
    patches[state.trans.id] = { ...(patches[state.trans.id] ?? {}), transitions: remapTransitions(state.trans.items, sg) } as Partial<NodeData>;
  }
  return { steps, codes, skipped: [], patches, autos: state.autos, trans: state.trans };
}

const validIdx = (steps: EditStep[], i: number) => Number.isInteger(i) && i >= 0 && i < steps.length;

// ⧉ DUPLICAR la sección i justo después de sí misma (mismos clips, curvas y transiciones).
export function duplicateSection(state: ArrangeState, i: number, makeId: () => string = newStepId): EditResult | null {
  if (!validIdx(state.steps, i)) return null;
  const s0 = starts(state.steps)[i];
  const e0 = s0 + clampBars(state.steps[i].bars);
  const steps = state.steps.map((x) => ({ ...x, bars: clampBars(x.bars) }));
  steps.splice(i + 1, 0, { ...steps[i], id: makeId() });
  return applySegs(state, opDuplicate(s0, e0), steps);
}

// ✚ SECCIÓN VACÍA después de la i (i = -1 → al principio): todas las pistas en silencio ahí.
export function insertEmptySection(state: ArrangeState, i: number, bars = 8, makeId: () => string = newStepId): EditResult | null {
  if (!(i === -1 || validIdx(state.steps, i)) || !state.steps.length) return null;
  const b = clampBars(bars);
  const at = i < 0 ? 0 : starts(state.steps)[i] + clampBars(state.steps[i].bars);
  const steps = state.steps.map((x) => ({ ...x, bars: clampBars(x.bars) }));
  const ref = steps[Math.max(0, i)];
  steps.splice(i + 1, 0, { id: makeId(), scene: ref.scene, bars: b });
  return applySegs(state, opInsert(at, b), steps);
}

// ✕ BORRAR la sección i (con sus clips, curvas y transiciones). La última no se borra.
export function deleteSection(state: ArrangeState, i: number): EditResult | null {
  if (!validIdx(state.steps, i) || state.steps.length < 2) return null;
  const s0 = starts(state.steps)[i];
  const e0 = s0 + clampBars(state.steps[i].bars);
  const steps = state.steps.filter((_, k) => k !== i).map((x) => ({ ...x, bars: clampBars(x.bars) }));
  return applySegs(state, opRemove(s0, e0), steps);
}

// − / + COMPASES de la sección i (1–64): al crecer, lo que sonaba al final sigue sonando; al
// achicarse, se quitan sus últimos compases.
export function resizeSection(state: ArrangeState, i: number, bars: number): EditResult | null {
  if (!validIdx(state.steps, i)) return null;
  const b = clampBars(bars);
  const cur = clampBars(state.steps[i].bars);
  const e0 = starts(state.steps)[i] + cur;
  const steps = state.steps.map((x, k) => ({ ...x, bars: k === i ? b : clampBars(x.bars) }));
  if (b === cur) return applySegs(state, opReorder([], 0), steps);
  return applySegs(state, b > cur ? opInsert(e0, b - cur, true) : opRemove(e0 - (cur - b), e0), steps);
}

// Reordena los brazos de UN arrange (from → to) reescribiendo solo el tramo entre el primer
// `[` y el último `]`: lo que va antes o después del arrange(...) queda intacto.
export function reorderArms(code: string, arms: ArrangeArm[], from: number, to: number): string {
  const texts = arms.map((a) => code.slice(a.wholeStart, a.wholeEnd));
  const [moved] = texts.splice(from, 1);
  texts.splice(to, 0, moved);
  return code.slice(0, arms[0].wholeStart) + texts.join(', ') + code.slice(arms[arms.length - 1].wholeEnd);
}

// ◀ ▶ MOVER la sección i a la posición j (con sus clips, curvas y transiciones).
export function moveSection(state: ArrangeState, i: number, j: number): EditResult | null {
  if (!validIdx(state.steps, i) || !validIdx(state.steps, j) || i === j) return null;
  const st0 = starts(state.steps);
  const order = state.steps.map((_, k) => k);
  const [mv] = order.splice(i, 1);
  order.splice(j, 0, mv);
  const ranges = order.map((k) => [st0[k], clampBars(state.steps[k].bars)] as [number, number]);
  const steps = order.map((k) => ({ ...state.steps[k], bars: clampBars(state.steps[k].bars) }));
  return applySegs(state, opReorder(ranges, totalOf(state.steps)), steps);
}

// Nombre (marcador) y escena: solo la canción, el código no cambia.
export function renameSection(state: ArrangeState, i: number, name: string): EditResult | null {
  if (!validIdx(state.steps, i)) return null;
  const nm = name.trim().slice(0, 48);
  return { codes: { ...state.codes }, skipped: [], steps: state.steps.map((s, k) => (k === i ? { ...s, name: nm || undefined } : s)) };
}
export function setSectionScene(state: ArrangeState, i: number, scene: number): EditResult | null {
  if (!validIdx(state.steps, i)) return null;
  const sc = Math.max(1, Math.min(9, Math.round(Number(scene) || 1)));
  return { codes: { ...state.codes }, skipped: [], steps: state.steps.map((s, k) => (k === i ? { ...s, scene: sc } : s)) };
}

// CREAR LA ESTRUCTURA de un tema que hoy es un jam de bucles: pasos nuevos + todas las pistas
// alineadas (las planas suenan igual en todas las secciones; luego se apaga lo que sobra).
export interface SectionSpec {
  bars: number;
  scene: number;
  name?: string;
}
export function createStructure(codes: Record<string, string>, sections: SectionSpec[], makeId: () => string = newStepId): EditResult | null {
  if (!sections.length) return null;
  const steps: EditStep[] = sections.map((s) => ({
    id: makeId(),
    scene: Math.max(1, Math.min(9, Math.round(s.scene) || 1)),
    bars: clampBars(s.bars),
    ...(s.name?.trim() ? { name: s.name.trim().slice(0, 48) } : {}),
  }));
  return alignAll({ steps, codes });
}

// Plantillas de «crear estructura» (compases por sección).
export const STRUCTURE_TEMPLATES: { id: string; label: string; sections: { bars: number; name: string }[] }[] = [
  {
    id: 'techno',
    label: 'techno · intro 16 · subida 8 · drop 16 · respiro 8 · drop 16 · salida 16',
    sections: [
      { bars: 16, name: 'intro' },
      { bars: 8, name: 'subida' },
      { bars: 16, name: 'drop' },
      { bars: 8, name: 'respiro' },
      { bars: 16, name: 'drop 2' },
      { bars: 16, name: 'salida' },
    ],
  },
  { id: 'corta', label: 'corta · A 8 · B 8', sections: [{ bars: 8, name: 'A' }, { bars: 8, name: 'B' }] },
];

// Reemplaza el patrón del brazo i de UNA pista (pegar / vaciar en 2.3). null si no se puede.
export function setArmExpr(code: string, i: number, expr: string): string | null {
  const arms = splitArrange(code);
  if (!arms || !Number.isInteger(i) || i < 0 || i >= arms.length || !expr.trim()) return null;
  return spliceArm(code, arms[i], expr.trim());
}

// ¿la pista PUEDE seguir la estructura? (para la UI: plana o alineable)
export function canFollow(code: string, steps: EditStep[]): boolean {
  if (!(code ?? '').trim()) return false;
  const arms = splitArrange(code);
  return !arms || arms.length <= steps.length;
}

