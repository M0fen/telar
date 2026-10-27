// CÓDIGO DE UNA MELODÍA (piano roll) — lógica PURA, testeable en Node.
//
// Una melodía es `note("…")` con un token por paso: `~` (silencio), una nota («a2») o un acorde
// («[a2,c3,e3]»). Por paso, además: fuerza `.gain("…")` y duración `.clip("…")` en patrones
// paralelos alineados a los pasos (1 = el paso entero; 4 = una nota larga de 4 pasos), el slide de
// 808 (`.penv().pdecay()`) y el largo en compases (`.slow(N)`, siempre al final). El resto del código
// (sonido, filtros, efectos) se conserva tal cual. Lo usan el piano roll del nodo (MelodicSeq) y el
// grande del panel de detalle (Fase 9.4: PianoRoll).
import { midiToName, noteToMidi } from '../ui/pianoRollHelpers';
import type { SongKey } from '../lib/songKey';

// número para la mini-notación (sin ceros de más): 1 → "1", 0.5 → "0.5"
export function fmtNum(n: number): string {
  if (!isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
// alinea un arreglo de números a `len` pasos (rellena con `def`, recorta lo que sobra)
export function alignNums(src: number[] | null | undefined, len: number, def: number): number[] {
  const out = (src ?? []).slice(0, len);
  while (out.length < len) out.push(def);
  return out;
}
// patrón por paso `.method("a b c")` (entrecomillado): tokens y el código SIN esa llamada. Un
// `.gain(0.5)` escalar (sin comillas) no se toca.
function extractPat(code: string, method: string): { code: string; toks: number[] | null } {
  const re = new RegExp('\\.' + method + '\\(\\s*"([^"]*)"\\s*\\)');
  const m = re.exec(code);
  if (!m) return { code, toks: null };
  const toks = m[1].trim() ? m[1].trim().split(/\s+/).map((t) => (t === '~' ? 1 : Number(t))).map((n) => (isFinite(n) ? n : 1)) : [];
  return { code: code.slice(0, m.index) + code.slice(m.index + m[0].length), toks: toks.length ? toks : null };
}
export const SLIDE_MAX = 7; // semitonos de pitch-env con el mando «slide» al 100 %
// `.method(<número>)` escalar (`.penv(6)`): su valor y el código sin esa llamada
function extractScalar(code: string, method: string): { code: string; val: number } {
  const re = new RegExp('\\.' + method + '\\(\\s*([0-9.]+)\\s*\\)');
  const m = re.exec(code);
  if (!m) return { code, val: 0 };
  const val = Number(m[1]);
  return { code: code.slice(0, m.index) + code.slice(m.index + m[0].length), val: isFinite(val) ? val : 0 };
}

export interface MelParsed {
  pre: string; // todo lo de antes del contenido de note("…") (incluida la comilla)
  post: string; // lo de después (cierre, sonido, efectos), sin .gain/.clip/.penv/.pdecay/.slow
  sName: string | null;
  bank: string;
  wave: string | null; // oscilador (sawtooth/square/…); null si es un sample
  tokens: string[];
  vels: number[] | null;
  gates: number[] | null;
  slide: number;
  cycles: number; // compases que dura (`.slow(N)`)
}

// ACORDES (Fase 5.5): un paso puede ser «[c3,eb3,g3]» → sus notas MIDI
export function chordMidis(tok: string): number[] {
  const t = (tok || '').trim();
  if (!t || t === '~' || t === '-') return [];
  const inner = t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t;
  return inner.split(',').map((x) => noteToMidi(x.trim())).filter((m): m is number => m != null);
}
export const chordTok = (midis: number[]): string => {
  const u = [...new Set(midis)].sort((a, b) => a - b);
  return !u.length ? '~' : u.length === 1 ? midiToName(u[0]) : `[${u.map(midiToName).join(',')}]`;
};

export function parseMel(code: string): MelParsed | null {
  // primero se retiran los patrones de fuerza y duración (van al final); luego la nota
  const g = extractPat(code, 'gain');
  const c = extractPat(g.code, 'clip');
  // «slide» de 808 = pitch-envelope (penv/pdecay), que superdough sí aplica: el mando sale de penv
  const pe = extractScalar(c.code, 'penv');
  const pd = extractScalar(pe.code, 'pdecay');
  const base = pd.code;
  const om = /(?:\.)?\b(?:note|n)\(\s*["'`]/.exec(base);
  if (!om) return null;
  const cs = om.index + om[0].length;
  const q = base[cs - 1];
  const ce = base.indexOf(q, cs);
  if (ce < 0) return null;
  const content = base.slice(cs, ce);
  const pre = base.slice(0, cs);
  let post = base.slice(ce);
  // VARIOS COMPASES (5.5): un `.slow(N)` detrás de las notas → los pasos ocupan N ciclos. Se retira
  // y se vuelve a poner AL FINAL (después de .gain/.clip, que así quedan alineados).
  let cycles = 1;
  const sm = /\.slow\(\s*([0-9.]+)\s*\)/.exec(post);
  if (sm && Number(sm[1]) > 0) { cycles = Number(sm[1]); post = post.slice(0, sm.index) + post.slice(sm.index + sm[0].length); }
  const sM = /\bs(?:ound)?\(\s*["'`]([^"'`]+)/.exec(base);
  const sName = sM ? (sM[1].match(/[A-Za-z0-9_]+/)?.[0] ?? null) : null;
  const bankM = /\.bank\(\s*["'`]([^"'`]+)/.exec(base);
  const bank = bankM ? bankM[1] : '';
  const wave = sName && ['sawtooth', 'square', 'triangle', 'sine', 'supersaw'].includes(sName) ? sName : null;
  const tokens = content.trim() ? splitSteps(content) : [];
  return { pre, post, sName, bank, wave, tokens, vels: g.toks, gates: c.toks, slide: Math.max(0, Math.min(1, pe.val / SLIDE_MAX)), cycles };
}
// pasos de la mini-notación respetando los corchetes de los acordes («[a2, c3]» es UN paso)
function splitSteps(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s.trim()) {
    if (ch === '[' || ch === '<' || ch === '(') depth++;
    else if (ch === ']' || ch === '>' || ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; continue; }
    cur += /\s/.test(ch) ? '' : ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function buildMel(p: MelParsed, cells: string[], vels: number[], gates: number[], slide: number, cycles = p.cycles): string {
  const body = cells.some((c) => c !== '~') ? cells.join(' ') : '~';
  let out = p.pre + body + p.post;
  if (vels.some((v) => Math.abs(v - 1) > 0.001)) out += `.gain("${vels.map(fmtNum).join(' ')}")`;
  if (gates.some((g) => Math.abs(g - 1) > 0.001)) out += `.clip("${gates.map(fmtNum).join(' ')}")`;
  // 808 slide: pitch-env que desliza cada nota hasta su tono (penv semitonos + pdecay s)
  if (slide > 0.02) out += `.penv(${(slide * SLIDE_MAX).toFixed(2)}).pdecay(${(0.05 + slide * 0.11).toFixed(3)})`;
  if (Math.abs(cycles - 1) > 1e-9) out += `.slow(${fmtNum(cycles)})`;
  return out;
}

// --- ESTADO EDITABLE (pasos) y operaciones del piano roll grande (9.4) --------------------------
export interface MelState {
  cells: string[]; // token por paso
  vels: number[]; // fuerza por paso (0..1)
  gates: number[]; // duración por paso, en pasos (1 = el paso entero; 4 = nota larga)
}
export function melState(p: MelParsed, steps: number): MelState {
  const cells = p.tokens.slice(0, steps);
  while (cells.length < steps) cells.push('~');
  return { cells, vels: alignNums(p.vels, steps, 1), gates: alignNums(p.gates, steps, 1) };
}
const clampCol = (st: MelState, c: number) => Math.max(0, Math.min(st.cells.length - 1, Math.round(c)));

// pone notas en un paso: reemplaza lo que había (o las suma al acorde con `add`); `gate` opcional
export function placeAt(st: MelState, col: number, midis: number[], add = false, gate?: number): MelState {
  const c = clampCol(st, col);
  const cur = add ? chordMidis(st.cells[c]) : [];
  const cells = st.cells.slice();
  cells[c] = chordTok([...cur, ...midis]);
  const gates = st.gates.slice();
  if (gate != null) gates[c] = gate;
  else if (!add) gates[c] = 1;
  return { ...st, cells, gates };
}
// quita una nota (si era un acorde, quedan las demás)
export function removeNote(st: MelState, col: number, midi: number): MelState {
  const c = clampCol(st, col);
  const cells = st.cells.slice();
  const rest = chordMidis(cells[c]).filter((m) => m !== midi);
  cells[c] = chordTok(rest);
  const out = { ...st, cells };
  if (!rest.length) { out.gates = st.gates.slice(); out.gates[c] = 1; out.vels = st.vels.slice(); out.vels[c] = 1; }
  return out;
}
// mueve lo de un paso (acorde, fuerza y duración) a otro, cambiando sus notas con `map`
export function moveStep(st: MelState, from: number, to: number, map: (m: number) => number): MelState {
  const a = clampCol(st, from);
  const b = clampCol(st, to);
  const notes = chordMidis(st.cells[a]).map(map);
  const cells = st.cells.slice();
  const vels = st.vels.slice();
  const gates = st.gates.slice();
  const v = vels[a], g = gates[a];
  cells[a] = '~'; vels[a] = 1; gates[a] = 1;
  cells[b] = chordTok(notes);
  vels[b] = v;
  gates[b] = Math.min(g, st.cells.length - b);
  return { cells, vels, gates };
}
export function setGate(st: MelState, col: number, g: number): MelState {
  const c = clampCol(st, col);
  const gates = st.gates.slice();
  gates[c] = Math.max(0.25, Math.min(st.cells.length - c, g));
  return { ...st, gates };
}
export function setVel(st: MelState, col: number, v: number): MelState {
  const c = clampCol(st, col);
  const vels = st.vels.slice();
  vels[c] = Math.round(Math.max(0.05, Math.min(1, v)) * 100) / 100;
  return { ...st, vels };
}
// largo de una nota al arrastrar su borde: pasos enteros; por debajo de un paso, cuartos (staccato)
export function snapGate(g: number): number {
  if (!isFinite(g)) return 1;
  return g >= 0.875 ? Math.max(1, Math.round(g)) : Math.max(0.25, Math.round(g * 4) / 4);
}

// RESOLUCIÓN: de `steps` a `ns` pasos. Si es un múltiplo exacto, cada nota cae en su sitio y conserva
// su duración (suena igual); si no, se recorta o se rellena al final.
export function regrid(st: MelState, ns: number): MelState {
  const n = st.cells.length;
  if (ns === n) return st;
  if (ns > n && n > 0 && ns % n === 0) {
    const f = ns / n;
    const cells = Array<string>(ns).fill('~');
    const vels = Array<number>(ns).fill(1);
    const gates = Array<number>(ns).fill(1);
    for (let i = 0; i < n; i++) { cells[i * f] = st.cells[i]; vels[i * f] = st.vels[i]; gates[i * f] = st.gates[i] * f; }
    return { cells, vels, gates };
  }
  const fit = <T,>(a: T[], fill: T) => Array.from({ length: ns }, (_, i) => (i < a.length ? a[i] : fill));
  return { cells: fit(st.cells, '~'), vels: fit(st.vels, 1), gates: fit(st.gates, 1).map((g, i) => Math.min(g, ns - i)) };
}
// LARGO en compases: al alargar se repite lo que hay (suena igual); al acortar, los primeros
export function setBarsTo(st: MelState, bars: number, nb: number): MelState {
  const n = st.cells.length;
  const per = n / Math.max(1, bars);
  const ns = Math.round(per * nb);
  if (ns === n || ns < 1) return st;
  const t = <T,>(a: T[]) => Array.from({ length: ns }, (_, i) => a[i % n]);
  return { cells: t(st.cells), vels: t(st.vels), gates: t(st.gates).map((g, i) => Math.min(g, ns - i)) };
}
// PASOS POR COMPÁS: recorta o rellena al final de cada compás
export function setPerBar(st: MelState, bars: number, per: number): MelState {
  const n = st.cells.length;
  const B = Math.max(1, bars);
  const old = n / B;
  if (!Number.isInteger(old) || per === old || per < 1) return st;
  const ns = per * B;
  const re = <T,>(a: T[], fill: T) => Array.from({ length: ns }, (_, i) => { const b = Math.floor(i / per), j = i % per; return j < old ? a[b * old + j] : fill; });
  return { cells: re(st.cells, '~'), vels: re(st.vels, 1), gates: re(st.gates, 1).map((g, i) => Math.min(g, ns - i)) };
}

// --- ESCALA Y ACORDES ---------------------------------------------------------------------------
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
// clases de altura de la escala del tema, empezando por su raíz (A menor: 9, 11, 0, 2, 4, 5, 7)
export function scalePcs(key: SongKey | null): number[] | null {
  if (!key) return null;
  return (key.minor ? MINOR : MAJOR).map((i) => (key.root + i) % 12);
}
const pcOf = (m: number) => ((m % 12) + 12) % 12;
// sube `deg` grados de la escala desde `root` (que está en la escala)
function diatonicUp(root: number, deg: number, pcs: number[]): number {
  let i = pcs.indexOf(pcOf(root));
  let m = root;
  for (let s = 0; s < deg; s++) {
    const a = pcs[i % pcs.length], b = pcs[(i + 1) % pcs.length];
    m += ((b - a + 12) % 12) || 12;
    i++;
  }
  return m;
}
export type ChordTool = 'nota' | '5ª' | 'tríada' | '7ª' | 'sus2' | 'sus4' | 'octava';
export const CHORD_TOOLS: { id: ChordTool; title: string }[] = [
  { id: 'nota', title: 'una nota por clic' },
  { id: '5ª', title: 'quinta (power chord): raíz + 5ª justa' },
  { id: 'tríada', title: 'tríada: raíz, 3ª y 5ª de la escala del tema (sin tonalidad: menor)' },
  { id: '7ª', title: 'cuatríada con séptima de la escala del tema (sin tonalidad: menor 7)' },
  { id: 'sus2', title: 'suspendido de 2ª: raíz, 2ª y 5ª' },
  { id: 'sus4', title: 'suspendido de 4ª: raíz, 4ª y 5ª' },
  { id: 'octava', title: 'raíz + su octava' },
];
// notas del acorde sobre `root`: dentro de la escala del tema si la raíz está en ella (acordes
// diatónicos, siempre en tono); si no, con intervalos fijos (tríada menor, como los géneros oscuros)
export function chordShape(root: number, tool: ChordTool, key: SongKey | null): number[] {
  if (tool === 'nota') return [root];
  if (tool === '5ª') return [root, root + 7];
  if (tool === 'octava') return [root, root + 12];
  const pcs = scalePcs(key);
  const inKey = !!pcs && pcs.includes(pcOf(root));
  if (inKey) {
    const d = (n: number) => diatonicUp(root, n, pcs!);
    if (tool === 'tríada') return [root, d(2), d(4)];
    if (tool === '7ª') return [root, d(2), d(4), d(6)];
    if (tool === 'sus2') return [root, d(1), d(4)];
    return [root, d(3), d(4)]; // sus4
  }
  if (tool === 'tríada') return [root, root + 3, root + 7];
  if (tool === '7ª') return [root, root + 3, root + 7, root + 10];
  if (tool === 'sus2') return [root, root + 2, root + 7];
  return [root, root + 5, root + 7];
}
// FILAS del piano roll (MIDI, de la más aguda a la más grave): todas, solo las de la escala
// («plegar a la escala») o solo las que tienen notas; las que tienen notas nunca se esconden
export type RowMode = 'todas' | 'escala' | 'usadas';
export function rollRows(lo: number, hi: number, mode: RowMode, pcs: number[] | null, used: number[]): number[] {
  const u = new Set(used);
  const out: number[] = [];
  for (let m = hi; m >= lo; m--) {
    if (mode === 'todas' || u.has(m)) out.push(m);
    else if (mode === 'escala' && (!pcs || pcs.includes(pcOf(m)))) out.push(m);
  }
  if (mode === 'usadas' && !out.length) for (let m = hi; m >= lo; m--) if (!pcs || pcs.includes(pcOf(m))) out.push(m);
  return out;
}
// subir `dr` filas en la vista (negativo = bajar): en la vista plegada es subir `dr` grados de la
// escala (un acorde transportado sigue en tono); fuera de las filas, por semitonos. Las filas van de
// la más aguda (índice 0) a la más grave.
export function shiftByRows(m: number, rows: number[], dr: number): number {
  if (!dr) return m;
  const i = rows.indexOf(m);
  const j = i - dr;
  if (i >= 0 && j >= 0 && j < rows.length) return rows[j];
  return m + dr;
}
