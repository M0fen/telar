// LANZADOR DE CLIPS (Fase 12.5) — lógica PURA (testeable en Node).
//   · las VARIACIONES de una pista: sus patrones distintos (los brazos de su arreglo, sin repetir);
//   · la TOMA: lo que lanzaste mientras grababas pasa al arreglo — cada pista toca, desde el compás
//     en que lanzaste un clip, ese patrón hasta el próximo lanzamiento (parada = silencio; «volver
//     al arreglo» = lo que ya tenía ahí). Si la toma dura más que la canción, se le añade una sección.
import { isMutedArm, isSilenceArm, splitArrange, unmuteArm } from '../nodes/stepseqCode';
import { normalize, placeClip, readTimeline, sliceClips, SILENCE, writeTimeline, type Clip } from './timeline';

export interface Variation { code: string; arms: number[] }
export function trackVariations(code: string): Variation[] {
  const arms = splitArrange(code ?? '');
  if (!arms) return (code ?? '').trim() ? [{ code: code.trim(), arms: [] }] : [];
  const out: Variation[] = [];
  arms.forEach((a, i) => {
    if (isSilenceArm(a.code)) return;
    const c = (isMutedArm(a.code) ? unmuteArm(a.code) : a.code).trim();
    const v = out.find((x) => x.code === c);
    if (v) v.arms.push(i);
    else out.push({ code: c, arms: [i] });
  });
  return out;
}

export interface TakeEvent { bar: number; track: string; code: string | null }
export interface TakeStep { id: string; scene: number; bars: number; name?: string }

const MAX_SEC = 64;
function bounds(steps: { bars: number }[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of steps) { out.push(acc); acc += Math.max(1, s.bars); }
  return out;
}

// las secciones de la canción tras la toma (se añade «toma» si hace falta, en tramos de ≤ 64)
export function stepsForTake(steps: TakeStep[], end: number, makeId: () => string): TakeStep[] {
  const total = steps.reduce((a, s) => a + Math.max(1, s.bars), 0);
  if (end <= total) return steps;
  const out = [...steps];
  let left = end - total;
  const scene = steps.length ? steps[steps.length - 1].scene : 1;
  while (left > 0) {
    const b = Math.min(MAX_SEC, left);
    out.push({ id: makeId(), scene, bars: b, name: 'toma' });
    left -= b;
  }
  return out;
}

// clips de una pista con la toma encima, en [start, end)
export function takeClips(base: Clip[], events: { bar: number; code: string | null }[], start: number, end: number): Clip[] {
  const ev = [...events].sort((a, b) => a.bar - b.bar);
  let clips = base;
  for (let i = 0; i < ev.length; i++) {
    const a = Math.max(start, Math.round(ev[i].bar));
    const b = Math.min(end, i + 1 < ev.length ? Math.round(ev[i + 1].bar) : end);
    if (b <= a) continue;
    const code = ev[i].code;
    if (code == null) continue; // volver al arreglo: lo que había
    clips = placeClip(clips, a, b - a, code === 'silence' ? SILENCE : code);
  }
  return clips;
}

// el arreglo con la toma: códigos de las pistas que cambian y las secciones nuevas
export function buildTake(codes: Record<string, string>, steps: TakeStep[], log: TakeEvent[], start: number, end: number, makeId: () => string): { codes: Record<string, string>; steps: TakeStep[] } | null {
  if (!(end > start) || !log.length) return null;
  const nsteps = stepsForTake(steps, end, makeId);
  const total = nsteps.reduce((a, s) => a + Math.max(1, s.bars), 0);
  const oldBounds = bounds(steps);
  const nb = bounds(nsteps);
  const grew = nsteps.length !== steps.length;
  const out: Record<string, string> = {};
  for (const [id, code] of Object.entries(codes)) {
    const evs = log.filter((e) => e.track === id);
    if (!evs.length && !grew) continue;
    if (!(code ?? '').trim() && !evs.length) continue;
    const tl = readTimeline(code ?? '', total, oldBounds);
    const clips = evs.length ? takeClips(tl.clips, evs, start, end) : tl.clips;
    out[id] = writeTimeline(tl, normalize(sliceClips(clips, 0, total), nb));
  }
  return { codes: out, steps: nsteps };
}
