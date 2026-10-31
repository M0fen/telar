// CADENA DE EFECTOS DE UN PAD (Fase 9.7) — lógica PURA (testeable en Node).
//
// Cada pad de batería es una fila de la rejilla (`Lane`) y sus efectos van en el sufijo de esa fila
// (`lane.sfx`, que el código ya conserva tal cual): tono `.speed`, decaimiento `.decay().sustain(0)`,
// filtro `.lpf` / `.hpf` (una perilla: izquierda pasa-bajos, derecha pasa-altos), paneo `.pan`,
// reverb `.room` y GRUPO DE CORTE `.cut(n)` — los sonidos del mismo grupo se cortan entre sí (el hat
// cerrado calla al abierto, como en una caja de ritmos). Lo demás del sufijo se conserva.
import { splitMethods } from './clipCode';

export interface PadFx {
  semis: number; // tono en semitonos (`.speed(2^(st/12))`)
  decay: number | null; // segundos; null = el sample entero
  filter: number; // −1..1 (0 = abierto)
  pan: number; // 0..1 (0,5 = centro)
  room: number; // 0..1
  cut: number | null; // grupo de corte
  rest: string; // otros métodos, tal cual
}
export const PAD_FX_DEFAULT: PadFx = { semis: 0, decay: null, filter: 0, pan: 0.5, room: 0, cut: null, rest: '' };
export const DECAY_MAX = 2; // s: más que esto = el sample entero
export const CUT_GROUPS = [1, 2, 3, 4];

const NUM = /^\s*-?\d*\.?\d+(?:e-?\d+)?\s*$/i;
const num = (s: string) => (NUM.test(s) ? Number(s) : NaN);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const LP_HI = 18000, LP_LO = 100, HP_LO = 20, HP_HI = 5000;
export const filterToLpf = (v: number) => LP_HI * Math.pow(LP_LO / LP_HI, -v); // v < 0
export const filterToHpf = (v: number) => HP_LO * Math.pow(HP_HI / HP_LO, v); // v > 0
const lpfToFilter = (hz: number) => -Math.log(Math.max(LP_LO, Math.min(LP_HI, hz)) / LP_HI) / Math.log(LP_HI / LP_LO);
const hpfToFilter = (hz: number) => Math.log(Math.max(HP_LO, Math.min(HP_HI, hz)) / HP_LO) / Math.log(HP_HI / HP_LO);

export function parsePadFx(sfx: string | undefined): PadFx {
  const fx: PadFx = { ...PAD_FX_DEFAULT };
  const ms = splitMethods(sfx ?? '');
  if (!ms) return { ...fx, rest: sfx ?? '' };
  let sustain0 = false;
  let decay: number | null = null;
  for (const m of ms) {
    const v = num(m.args);
    if (m.name === 'speed' && Number.isFinite(v) && v > 0) fx.semis = Math.round(12 * Math.log2(v) * 10) / 10;
    else if (m.name === 'decay' && Number.isFinite(v) && v > 0) decay = v;
    else if (m.name === 'sustain' && Number.isFinite(v) && v === 0) sustain0 = true;
    else if ((m.name === 'lpf' || m.name === 'cutoff') && Number.isFinite(v) && v > 0) fx.filter = -Math.max(0, Math.min(1, lpfToFilter(v)));
    else if ((m.name === 'hpf' || m.name === 'hcutoff') && Number.isFinite(v) && v > 0) fx.filter = Math.max(0, Math.min(1, hpfToFilter(v)));
    else if (m.name === 'pan' && Number.isFinite(v)) fx.pan = Math.max(0, Math.min(1, v));
    else if (m.name === 'room' && Number.isFinite(v)) fx.room = Math.max(0, Math.min(1, v));
    else if (m.name === 'cut' && Number.isFinite(v) && v >= 1) fx.cut = Math.round(v);
    else fx.rest += m.raw;
  }
  if (decay != null && sustain0) fx.decay = decay;
  else if (decay != null) fx.rest += `.decay(${decay})`;
  return fx;
}

export function buildPadFx(fx: PadFx): string {
  let out = fx.rest || '';
  const sp = Math.pow(2, (fx.semis || 0) / 12);
  if (Math.abs(sp - 1) > 1e-3) out += `.speed(${r3(sp)})`;
  if (fx.decay != null && fx.decay < DECAY_MAX) out += `.decay(${r3(Math.max(0.01, fx.decay))}).sustain(0)`;
  if (fx.filter < -0.02) out += `.lpf(${Math.round(filterToLpf(fx.filter))})`;
  else if (fx.filter > 0.02) out += `.hpf(${Math.round(filterToHpf(fx.filter))})`;
  if (Math.abs(fx.pan - 0.5) > 0.01) out += `.pan(${r3(fx.pan)})`;
  if (fx.room > 0.005) out += `.room(${r3(fx.room)})`;
  if (fx.cut != null) out += `.cut(${fx.cut})`;
  return out;
}

// controles de superdough para AUDICIONAR el pad con su cadena (sin pasar por el patrón)
export function padFxValues(fx: PadFx): Record<string, number> {
  const v: Record<string, number> = {};
  const sp = Math.pow(2, (fx.semis || 0) / 12);
  if (Math.abs(sp - 1) > 1e-3) v.speed = sp;
  if (fx.decay != null && fx.decay < DECAY_MAX) { v.decay = Math.max(0.01, fx.decay); v.sustain = 0; }
  if (fx.filter < -0.02) v.cutoff = filterToLpf(fx.filter);
  else if (fx.filter > 0.02) v.hcutoff = filterToHpf(fx.filter);
  if (Math.abs(fx.pan - 0.5) > 0.01) v.pan = fx.pan;
  if (fx.room > 0.005) v.room = fx.room;
  if (fx.cut != null) v.cut = fx.cut;
  return v;
}

// el hat ABIERTO y el CERRADO de la pista (para «el cerrado corta al abierto»)
export function hatPair(sounds: string[]): { closed: string; open: string } | null {
  const base = (s: string) => s.replace(/:\d+$/, '').toLowerCase();
  const closed = sounds.find((s) => /^(hh|ch|hat|closedhat|hihat|hhc)$/.test(base(s)) || /(^|_)(hh|ch|closed)/.test(base(s)) && !/(oh|open)/.test(base(s)));
  const open = sounds.find((s) => /^(oh|hho|openhat|ohh)$/.test(base(s)) || /(^|_)(oh|open)/.test(base(s)));
  return closed && open && closed !== open ? { closed, open } : null;
}
