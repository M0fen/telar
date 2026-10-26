// GRABAR DESDE LOS PADS (Fase 7.1) — lógica PURA (testeable en Node).
//
// Los 16 pads del controlador tocan una pista y, con ● grabar y ▶, cada golpe ENTRA en su
// rejilla: cuantizado al paso más cercano (semicorcheas), con su fuerza como velocity, en el
// bucle de la pista (cada vuelta suma lo nuevo). Dos modos:
//   · batería: cada pad, un sonido fijo (los propios de la pista y luego bombo, caja, clap,
//     hat…): si la rejilla aún no tiene ese sonido, se le añade su pista;
//   · escala: los pads son las notas de la tonalidad del tema (dos octavas desde la octava
//     elegida): la pista queda afinada (un bajo, un stab, un 808 con notas).
// Si la pista va por secciones (`arrange`), el golpe entra en la sección que está sonando.
import { buildSeq, parseSeq, splitArrange, spliceArm, isSilenceArm, isMutedArm, unmuteArm, seedSilent, type Lane, type Parsed } from '../nodes/stepseqCode';
import type { SongKey } from './songKey';

export type PadMode = 'drum' | 'scale';
export const PADS = 16;
export const GRID = 16; // pasos por ciclo al grabar (semicorcheas)

// sonidos de batería para los pads que no tienen pista en la rejilla (orden de un pad de 16)
export const DRUM_PADS = ['bd', 'sd', 'cp', 'hh', 'oh', 'rim', 'lt', 'mt', 'ht', 'cb', 'cr', 'rd'];

// fuerza del pad (0..1) → velocity del paso: 100/127 ≈ normal (1), a fondo ≈ acento (1,27),
// suave ≈ ghost; acotado al rango de la rejilla
export const velToGain = (v: number) => Math.round(Math.max(0.3, Math.min(1.4, (Number.isFinite(v) ? v : 0.8) * 1.27)) * 100) / 100;

const PC = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const midiName = (m: number) => `${PC[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

// nota del pad en la escala del tema (sin tonalidad: do menor), desde la tónica de `octave`
export function scaleNote(pad: number, key: SongKey | null, octave: number): string {
  const k = key ?? { root: 0, minor: true };
  const sc = k.minor ? MINOR : MAJOR;
  const deg = Math.max(0, Math.min(PADS - 1, Math.round(pad)));
  const midi = (octave + 1) * 12 + k.root + sc[deg % 7] + 12 * Math.floor(deg / 7);
  return midiName(midi);
}

// MAPA de los 16 pads en modo batería, ESTABLE entre tomas: primero los sonidos propios de la
// pista que no son de una caja de ritmos (un kit de Splice, congas…), luego la batería en su orden
// fijo (bombo, caja, clap, hat cerrado, abierto, rim, toms, cencerro, crash, ride). Grabar solo
// añade sonidos de esa lista, así un pad nunca cambia de sonido. Con secciones, las pistas de
// todas en el orden en que aparecen.
export function drumPadMap(code: string): (string | null)[] {
  const arms = splitArrange(code);
  const pats = arms ? arms.map((a) => (isMutedArm(a.code) ? unmuteArm(a.code) : a.code)) : [code];
  const own: string[] = [];
  for (const c of pats) {
    const p = isSilenceArm(c) ? null : parseSeq(c);
    if (!p || p.complex) continue;
    for (const l of p.lanes) if (!DRUM_PADS.includes(l.sound) && !own.includes(l.sound)) own.push(l.sound);
  }
  const map = [...own, ...DRUM_PADS].slice(0, PADS);
  return Array.from({ length: PADS }, (_, i) => map[i] ?? null);
}

// octava de partida para el modo escala: la de la nota más grave de la pista (o 3)
export function baseOctave(lanes: Lane[]): number {
  let lo = Infinity;
  for (const l of lanes) {
    for (let i = 0; i < l.notes.length; i++) {
      const m = /^\[?([a-g])(#|b)?(-?\d)/i.exec(l.notes[i] ?? '');
      if (!m || !(l.steps[i] > 0)) continue;
      const pc = PC.indexOf((m[1] + (m[2] === 'b' ? 'b' : '')).toLowerCase());
      const base = pc >= 0 ? pc : 'cdefgab'.indexOf(m[1].toLowerCase());
      lo = Math.min(lo, (Number(m[3]) + 1) * 12 + base + (m[2] === '#' ? 1 : 0));
    }
  }
  return Number.isFinite(lo) ? Math.floor(lo / 12) - 1 : 3;
}

// ciclos que dura el patrón de la pista (`.slow(n)`: n compases)
export function patternPeriod(code: string): number {
  const m = /\.slow\(\s*(\d+(?:\.\d+)?)\s*\)/.exec(code);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 64 ? n : 1;
}

// paso cuantizado (el más cercano) para una posición en ciclos dentro del bucle de la pista
export function stepAt(pos: number, period: number, steps: number): number {
  const x = (((pos % period) + period) % period) / period;
  return Math.round(x * steps) % steps;
}

// sube la rejilla a `target` pasos si es más gruesa (4 negras → 16 semicorcheas), sin cambiar
// lo que suena: cada paso pasa a su sitio y un roll que cabe exacto se reparte en pasos
export function toGrid(lanes: Lane[], steps: number, target = GRID): { lanes: Lane[]; steps: number } {
  if (steps >= target || target % steps !== 0) return { lanes, steps };
  const f = target / steps;
  const up = lanes.map((l) => {
    const s = Array(target).fill(0);
    const nt: (string | null)[] = Array(target).fill(null);
    const rt = Array(target).fill(1);
    const pr = Array(target).fill(1);
    for (let i = 0; i < steps; i++) {
      if (!(l.steps[i] > 0)) continue;
      const r = l.ratchet[i] || 1;
      const k = i * f;
      if (r > 1 && f % r === 0) {
        for (let j = 0; j < r; j++) { s[k + (j * f) / r] = l.steps[i]; nt[k + (j * f) / r] = l.notes[i] ?? null; pr[k + (j * f) / r] = l.prob?.[i] ?? 1; }
      } else {
        s[k] = l.steps[i];
        nt[k] = l.notes[i] ?? null;
        rt[k] = r;
        pr[k] = l.prob?.[i] ?? 1;
      }
    }
    return { ...l, steps: s, notes: nt, ratchet: rt, prob: pr, nudge: undefined };
  });
  return { lanes: up, steps: target };
}

const emptyLane = (sound: string, steps: number): Lane => ({ sound, steps: Array(steps).fill(0), notes: Array(steps).fill(null), ratchet: Array(steps).fill(1), prob: Array(steps).fill(1) });

// ¿la pista es un loop (no una rejilla de golpes)? → no se graba encima
export const isLoopPattern = (p: Parsed) => p.lanes.some((l) => /^wl_/.test(l.sound)) || (p.steps < 2 && p.lanes.length > 0);

// la sección (brazo) que suena en el compás de canción `bar` y la posición dentro de ella
export interface PadTarget {
  pat: string; // código del patrón a editar
  pos: number; // ciclos desde el inicio de ese patrón
  arm: number; // índice del brazo (−1 = sin arrange)
}
export function locate(code: string, bar: number): PadTarget | null {
  const arms = splitArrange(code);
  if (!arms) return { pat: code, pos: bar, arm: -1 };
  const total = arms.reduce((s, a) => s + a.bars, 0);
  if (!(total > 0)) return null;
  const x = ((bar % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < arms.length; i++) {
    if (x < acc + arms[i].bars) return { pat: arms[i].code, pos: x - acc, arm: i };
    acc += arms[i].bars;
  }
  return null;
}

export interface PadHit {
  pad: number; // 0..15
  sound?: string | null; // modo batería: el sonido del pad (de su mapa fijo, drumPadMap)
  vel: number; // 0..1
  bar: number; // posición del golpe en compases de canción (ciclos), ya compensada la latencia
  mode: PadMode;
  key: SongKey | null;
  octave: number;
}
export interface PadHitResult {
  code: string; // código nuevo de la pista
  step: number;
  sound: string;
  note?: string;
}

// mete un golpe en la rejilla de la pista; null si no se puede (patrón avanzado, loop, pad vacío)
export function recordPadHit(code: string, h: PadHit): PadHitResult | null {
  const t = locate(code, h.bar);
  if (!t) return null;
  let pat = t.pat;
  const arms = t.arm >= 0 ? splitArrange(code) : null;
  // sección en silencio: se siembra la instrumentación de otra sección (con cero golpes)
  if (isSilenceArm(pat) && arms) {
    const ref = arms.find((a) => !isSilenceArm(a.code) && parseSeq(isMutedArm(a.code) ? unmuteArm(a.code) : a.code));
    const seed = ref ? seedSilent(isMutedArm(ref.code) ? unmuteArm(ref.code) : ref.code) : null;
    if (!seed) return null;
    pat = seed.code;
  }
  // sección apagada: grabar en ella la enciende (si no, no oirías lo que grabas)
  if (isMutedArm(pat)) pat = unmuteArm(pat);
  const p = parseSeq(pat);
  if (!p || p.complex || isLoopPattern(p)) return null;
  const period = patternPeriod(pat);
  const g = toGrid(p.lanes, p.steps, GRID * period);
  const steps = g.steps;
  let lanes = g.lanes;
  const step = stepAt(t.pos, period, steps);
  const gain = velToGain(h.vel);
  let sound: string | null;
  let note: string | undefined;
  if (h.mode === 'scale') {
    note = scaleNote(h.pad, h.key, h.octave);
    if (!lanes.length) lanes = [emptyLane(p.melodic ? 'sawtooth' : 'bd', steps)];
    sound = lanes[0].sound;
    lanes = lanes.map((l, i) => (i === 0 ? { ...l, steps: l.steps.map((v, j) => (j === step ? gain : v)), notes: l.notes.map((n, j) => (j === step ? note! : n)) } : l));
  } else {
    sound = h.sound !== undefined ? h.sound : drumPadMap(pat)[h.pad] ?? null;
    if (!sound) return null;
    let li = lanes.findIndex((l) => l.sound === sound);
    if (li < 0) {
      lanes = [...lanes, emptyLane(sound, steps)];
      li = lanes.length - 1;
    }
    lanes = lanes.map((l, i) => (i === li ? { ...l, steps: l.steps.map((v, j) => (j === step ? gain : v)) } : l));
  }
  const built = buildSeq({ ...p, melodic: p.melodic && lanes.length === 1 }, lanes, steps);
  const next = t.arm >= 0 && arms ? spliceArm(code, arms[t.arm], built) : built;
  return { code: next, step, sound, note };
}
