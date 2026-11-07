// VISTA PREVIA DE UN PATRÓN (Fase 8.7, base de 9.1): qué golpes y notas tiene un código, sin
// tocarlo. Se evalúa con el mismo transpilador de Strudel que en vivo pero SIN pasar por el
// planificador (no cambia lo que suena) y se consulta un tramo de ciclos (1 ciclo = 1 compás). Así
// se dibuja cualquier código, no solo el de las rejillas: euclidianos, <a b>, fills, .fast…
// Si el motor aún no arrancó, se cargan las funciones de Strudel en el ámbito global (lo mismo que
// hace el motor al iniciar). Un código que no compila no tiene vista previa (null), nunca lanza.
import * as strudel from '@strudel/web';
import { noteNumber } from '../lib/patternDraw';
import { mayRun } from '../store/useTrustStore';

export interface PreviewEvent {
  t: number; // inicio, en compases desde el comienzo del tramo
  d: number; // duración en compases
  snd: string; // sonido («bd», «hh:2», «sawtooth»…)
  note: number | null; // altura MIDI si es una nota
  gain: number;
  begin?: number; // tramo del sample (9.5: editor de loops), si el código lo recorta
  end?: number;
  speed?: number; // negativo = al revés
  off?: number; // con `pieces`: compases que el evento ya llevaba sonando al empezar el tramo (0 = empieza aquí)
}

type Span = { begin: { valueOf(): number }; end: { valueOf(): number } };
type Hap = {
  whole?: Span | null;
  part?: Span;
  hasOnset?: () => boolean;
  value: unknown;
};
type Pat = { queryArc: (a: number, b: number, o?: object) => Hap[] };

let scope: Promise<boolean> | null = null;
function ensureScope(): Promise<boolean> {
  scope ??= (async () => {
    try {
      // el motor ya lo hace al arrancar; repetirlo es inocuo (mismas funciones)
      await (strudel as unknown as { evalScope: (...m: unknown[]) => Promise<unknown> }).evalScope(strudel);
      return true;
    } catch {
      return false;
    }
  })();
  return scope;
}

const cache = new Map<string, Promise<Pat | null>>();
export function previewPattern(code: string): Promise<Pat | null> {
  const key = code.trim();
  if (!key) return Promise.resolve(null);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => {
    if (!(await ensureScope())) return null;
    if (!mayRun(key)) return null; // miniatura de un proyecto ajeno sin verificar: no se evalúa
    try {
      const tr = (strudel as unknown as { transpiler: (c: string, o: object) => { output: string } }).transpiler(key, {
        wrapAsync: false, addReturn: true, emitMiniLocations: false, emitWidgets: false,
      });
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const pat = (await Function(`"use strict";return (async ()=>{${tr.output}})()`)()) as Pat | undefined;
      return pat && typeof pat.queryArc === 'function' ? pat : null;
    } catch {
      return null;
    }
  })();
  cache.set(key, p);
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  return p;
}

// los eventos con inicio dentro de [a, b) (en compases, relativos a `a`). Con `pieces`, también el
// trozo de un evento que empezó ANTES del tramo (un loop partido a mitad: `.early(n)`), desde el
// inicio del tramo y con `off` = lo que ya llevaba sonando; un evento partido en trozos cuenta una vez.
export function eventsOf(pat: Pat, a: number, b: number, pieces = false): PreviewEvent[] {
  let haps: Hap[] = [];
  try {
    haps = pat.queryArc(a, b);
  } catch {
    return [];
  }
  const out: PreviewEvent[] = [];
  const seen = pieces ? new Set<string>() : null;
  // el primer trozo de cada evento primero (el que tiene el inicio, si está en el tramo)
  if (pieces) haps = [...haps].sort((x, y) => Number((x.part ?? x.whole)?.begin.valueOf() ?? 0) - Number((y.part ?? y.whole)?.begin.valueOf() ?? 0));
  for (const h of haps) {
    if (!h.whole) continue;
    const onset = !h.hasOnset || h.hasOnset();
    if (!onset && !(pieces && h.part)) continue; // trozos de una nota que empezó antes
    const v = (h.value ?? {}) as Record<string, unknown>;
    if (typeof v !== 'object') continue;
    const w0 = Number(h.whole.begin.valueOf());
    const t1 = Number(h.whole.end.valueOf());
    if (seen) {
      const k = `${w0}|${t1}|${String(v.s ?? '')}|${String(v.n ?? '')}|${String(v.note ?? '')}`;
      if (seen.has(k)) continue;
      seen.add(k);
    }
    const t0 = onset ? w0 : Math.max(w0, Number(h.part!.begin.valueOf()));
    let note = noteNumber(v.note);
    if (note == null && typeof v.freq === 'number' && v.freq > 0) note = Math.round(69 + 12 * Math.log2(v.freq / 440));
    const s = typeof v.s === 'string' ? v.s : '';
    const snd = note == null && v.n != null && s ? `${s}:${v.n}` : s;
    const gain = (typeof v.gain === 'number' ? v.gain : 1) * (typeof v.velocity === 'number' ? v.velocity : 1);
    const ev: PreviewEvent = { t: t0 - a, d: Math.max(0, t1 - t0), snd, note, gain };
    if (t0 > w0) ev.off = t0 - w0;
    if (typeof v.begin === 'number') ev.begin = v.begin;
    if (typeof v.end === 'number') ev.end = v.end;
    if (typeof v.speed === 'number') ev.speed = v.speed;
    out.push(ev);
    if (out.length > 4000) break;
  }
  return out.sort((x, y) => x.t - y.t);
}
