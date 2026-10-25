// Reloj de la canción (Fase 0.2): la canción NO tiene reloj propio. Su posición es el
// ciclo del scheduler (1 ciclo = 1 compás), el mismo que recorren los arrange([n, …]) de
// cada instrumento desde el ciclo 0. Por eso ▶ canción reinicia el transporte: ciclo 0 =
// compás 1 para todos, y cada cambio (escena + instrumentos) cae junto, vuelta tras vuelta.
import { splitArrange } from '../nodes/stepseqCode';

export interface SongStepLike {
  scene: number;
  bars: number;
}

const barsOf = (st: SongStepLike) => Math.max(1, st.bars);

export function songTotal(steps: SongStepLike[]): number {
  return steps.reduce((s, st) => s + barsOf(st), 0);
}

// Sección que suena en el ciclo `now` del scheduler. `look` (en ciclos) adelanta el
// cálculo para que la escena se dispare ANTES de la frontera y aterrice en el 1 (el rAF
// y el hot-swap llegan tarde si se espera a cruzarla). Sin loop, pasado el final: `end`.
// `from` (Fase 1.4): compás de arranque tras «tocar desde aquí» — el transporte se reinició en
// el ciclo 0 pero lo que suena es el compás `from + 1` (el compilador adelantó todo con .early).
export function songPosition(steps: SongStepLike[], now: number, loop: boolean, look = 0, from = 0): { idx: number; end: boolean } {
  const total = songTotal(steps);
  if (!steps.length || total <= 0) return { idx: -1, end: true };
  const t = Math.max(0, now + (Number.isFinite(from) && from > 0 ? from : 0));
  if (!loop && t >= total) return { idx: steps.length - 1, end: true };
  const ahead = loop ? (t + look) % total : Math.min(t + look, total - 1e-6);
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    acc += barsOf(steps[i]);
    if (ahead < acc) return { idx: i, end: false };
  }
  return { idx: steps.length - 1, end: false };
}

// Instrumentos cuyo arrange no dura lo mismo que la canción: en la primera vuelta caen
// juntos, pero desde la segunda se desfasan (cada uno repite su propio largo).
export function arrangeMismatches(
  steps: SongStepLike[],
  sources: { id: string; name?: string; code?: string }[],
): { id: string; name: string; bars: number }[] {
  const total = songTotal(steps);
  if (!total) return [];
  const out: { id: string; name: string; bars: number }[] = [];
  for (const s of sources) {
    const arms = splitArrange(s.code ?? '');
    if (!arms) continue; // plano: suena igual en todos los compases, no se desfasa
    const bars = arms.reduce((a, x) => a + x.bars, 0);
    if (Math.abs(bars - total) > 1e-9) out.push({ id: s.id, name: (s.name ?? '').trim() || s.id, bars });
  }
  return out;
}

// POSICIÓN EN LA LÍNEA DE TIEMPO (Fases 1.4 y 2.4): el compás de la canción que suena dado el
// ciclo del scheduler. Sin bucle de región: `now + from`. Con bucle: dentro de la región,
// arrancando en `from` si cae dentro (si no, en su inicio) y volviendo a su inicio al final.
export interface TimelineLike {
  from: number;
  region: { start: number; bars: number } | null;
  regionOn: boolean;
}
export function regionOffset(t: TimelineLike): number {
  const r = t.region;
  if (!t.regionOn || !r) return 0;
  const off = Math.floor(t.from) - r.start;
  return off > 0 && off < r.bars ? off : 0;
}
export function timelinePos(now: number, t: TimelineLike): number {
  const r = t.region;
  if (t.regionOn && r && r.bars >= 1) {
    const x = now + regionOffset(t);
    return r.start + (((x % r.bars) + r.bars) % r.bars);
  }
  return now + (Number.isFinite(t.from) && t.from > 0 ? t.from : 0);
}
