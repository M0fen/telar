// IMPORTAR MIDI (Fase 5.5): un .mid (los de Splice: bajos, acordes, melodías, baterías) → el
// código de un Source que el secuenciador melódico sabe editar. Lógica PURA → testeable en Node.
//
//   · CUANTIZADO (por defecto, a semicorcheas): un paso por semicorchea, como el secuenciador:
//       note("c2 ~ ~ eb2 [c3,eb3,g3] ~ …").s("sawtooth").gain("…").clip("…").slow(compases)
//     acordes como [a,b,c]; la velocidad va en .gain (por paso) y la duración en .clip (en pasos).
//   · SIN CUANTIZAR: el tiempo tal cual (1/48 de negra), con pesos de la mini-notación:
//       note("c2@36 ~@12 eb2@24 …")…  (suena exacto; se edita como código)
//   · Batería (canal 10): los golpes General MIDI como samples, una pista por golpe, como la
//     rejilla multi-sonido: s("bd ~ ~ ~ bd …, ~ ~ hh ~ …") (o stack con la velocidad de cada golpe).
import { midiToName } from '../ui/pianoRollHelpers';

export interface MidiNoteEv {
  tick: number;
  dur: number; // ticks
  pitch: number;
  vel: number; // 1–127
  ch: number; // 0–15 (9 = batería)
}
export interface MidiTrackInfo {
  name: string;
  notes: MidiNoteEv[];
  drum: boolean;
}
export interface MidiFileInfo {
  ppq: number;
  bpm: number | null;
  beatsPerBar: number;
  endTick: number; // fin de la pista más larga (marca la duración del loop)
  tracks: MidiTrackInfo[]; // solo las que tienen notas
}

function readVlq(b: Uint8Array, p: { i: number }): number {
  let v = 0;
  for (let k = 0; k < 4; k++) {
    const c = b[p.i++];
    v = (v << 7) | (c & 0x7f);
    if (!(c & 0x80)) break;
  }
  return v;
}

export function parseMidiFile(bytes: Uint8Array): MidiFileInfo {
  const s4 = (i: number) => String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  if (bytes.length < 14 || s4(0) !== 'MThd') throw new Error('no es un archivo MIDI');
  const hlen = u32(4);
  const ntrks = u16(10);
  const div = u16(12);
  if (div & 0x8000) throw new Error('MIDI con tiempo SMPTE: no soportado');
  const ppq = div || 480;
  let bpm: number | null = null;
  let beatsPerBar = 4;
  let endTick = 0;
  const tracks: MidiTrackInfo[] = [];
  let pos = 8 + hlen;
  for (let t = 0; t < ntrks && pos + 8 <= bytes.length; t++) {
    const id = s4(pos);
    const len = u32(pos + 4);
    const start = pos + 8;
    const end = Math.min(bytes.length, start + len);
    pos = end;
    if (id !== 'MTrk') continue;
    const p = { i: start };
    let tick = 0;
    let status = 0;
    let name = '';
    const notes: MidiNoteEv[] = [];
    const open = new Map<number, { tick: number; vel: number }[]>(); // (ch<<7|pitch) → notas abiertas
    const close = (ch: number, pitch: number, at: number) => {
      const q = open.get((ch << 7) | pitch);
      const on = q?.shift();
      if (on) notes.push({ tick: on.tick, dur: Math.max(1, at - on.tick), pitch, vel: on.vel, ch });
    };
    while (p.i < end) {
      tick += readVlq(bytes, p);
      let st = bytes[p.i];
      if (st & 0x80) p.i++;
      else st = status; // running status
      if (st === 0xff) {
        const type = bytes[p.i++];
        const l = readVlq(bytes, p);
        const d = bytes.subarray(p.i, p.i + l);
        p.i += l;
        if (type === 0x03 && !name) name = new TextDecoder().decode(d).trim();
        else if (type === 0x51 && l >= 3 && bpm == null) bpm = Math.round((60_000_000 / ((d[0] << 16) | (d[1] << 8) | d[2])) * 100) / 100;
        else if (type === 0x58 && l >= 2) beatsPerBar = Math.max(1, d[0] * (4 / Math.pow(2, d[1])));
        else if (type === 0x2f) break;
        continue;
      }
      if (st === 0xf0 || st === 0xf7) {
        p.i += readVlq(bytes, p);
        continue;
      }
      status = st;
      const ty = st & 0xf0;
      const ch = st & 0x0f;
      if (ty === 0xc0 || ty === 0xd0) { p.i += 1; continue; }
      const a = bytes[p.i++];
      const b = bytes[p.i++];
      if (ty === 0x90 && b > 0) {
        const k = (ch << 7) | a;
        if (!open.has(k)) open.set(k, []);
        open.get(k)!.push({ tick, vel: b });
      } else if (ty === 0x80 || (ty === 0x90 && b === 0)) close(ch, a, tick);
    }
    // notas sin cierre: hasta el final de la pista
    for (const [k, q] of open) for (const on of q) notes.push({ tick: on.tick, dur: Math.max(1, tick - on.tick), pitch: k & 0x7f, vel: on.vel, ch: k >> 7 });
    endTick = Math.max(endTick, tick); // la marca de fin de la pista (o su último evento)
    if (notes.length) {
      notes.sort((x, y) => x.tick - y.tick || x.pitch - y.pitch);
      const drum = notes.every((n) => n.ch === 9);
      tracks.push({ name, notes, drum });
    }
  }
  return { ppq, bpm, beatsPerBar, endTick, tracks };
}

// General MIDI → samples de Strudel (el mapa inverso del exportador)
const GM_DRUM: Record<number, string> = {
  35: 'bd', 36: 'bd', 37: 'rim', 38: 'sd', 39: 'cp', 40: 'sd', 41: 'lt', 42: 'hh', 43: 'lt', 44: 'hh', 45: 'mt', 46: 'oh',
  47: 'mt', 48: 'ht', 49: 'cr', 50: 'ht', 51: 'rd', 52: 'cr', 53: 'rd', 54: 'tb', 55: 'cr', 56: 'cb', 57: 'cr', 59: 'rd',
  70: 'sh', 75: 'perc', 76: 'perc', 77: 'perc', 82: 'sh',
};
export const drumName = (pitch: number) => GM_DRUM[pitch] ?? 'perc';

// compases del loop: hasta la marca de fin de la pista (Splice la pone al final del loop) o la
// última nota que empieza; un final que se pasa apenas de la barra (2 %) no suma un compás
export function loopBars(info: Pick<MidiFileInfo, 'ppq' | 'beatsPerBar' | 'endTick'>, notes: MidiNoteEv[]): number {
  const bar = info.ppq * info.beatsPerBar;
  const lastOnset = notes.reduce((m, n) => Math.max(m, n.tick), 0);
  const end = Math.max(info.endTick, lastOnset + 1);
  return Math.max(1, Math.ceil((end - bar * 0.02) / bar));
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmtNum = (x: number) => String(r2(x));

// tokens de la mini-notación para un grupo de notas que suenan juntas
function chordToken(notes: MidiNoteEv[], drum: boolean): string {
  const names = [...new Set(notes.map((n) => (drum ? drumName(n.pitch) : midiToName(n.pitch))))];
  return names.length === 1 ? names[0] : `[${names.join(',')}]`;
}

export interface ImportedPattern {
  code: string; // note("…").s(…)… o s("…")… (batería)
  bars: number;
  notes: number;
  chords: boolean; // hay acordes (el secuenciador los muestra juntos en el paso)
}

// CUANTIZADO: un paso por 1/stepsPerBeat de negra (4 = semicorcheas). Melodía en el orden que la
// rejilla del secuenciador reescribe igual (note → s → gain → clip → slow); batería, una pista por
// golpe (s("bd ~ …, ~ ~ hh …") o stack con su velocidad), como la rejilla multi-sonido.
export function gridPattern(info: Pick<MidiFileInfo, 'ppq' | 'beatsPerBar' | 'endTick'>, track: MidiTrackInfo, stepsPerBeat = 4, sound = 'sawtooth'): ImportedPattern {
  const bars = loopBars(info, track.notes);
  const stepT = info.ppq / stepsPerBeat;
  const total = Math.round(bars * info.beatsPerBar * stepsPerBeat);
  const slow = bars > 1 ? `.slow(${bars})` : '';
  const at = (n: MidiNoteEv) => Math.round(n.tick / stepT);
  if (track.drum) {
    // una pista por golpe General MIDI
    const byName = new Map<string, MidiNoteEv[]>();
    for (const n of track.notes) {
      const k = drumName(n.pitch);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k)!.push(n);
    }
    const lanes = [...byName.entries()].map(([name, ns]) => {
      const cells: (MidiNoteEv | null)[] = Array(total).fill(null);
      for (const n of ns) { const i = at(n); if (i >= 0 && i < total && (!cells[i] || n.vel > cells[i]!.vel)) cells[i] = n; }
      return { name, cells };
    });
    const accent = lanes.some((l) => l.cells.some((c) => c && c.vel < 125));
    const body = (l: { name: string; cells: (MidiNoteEv | null)[] }) => l.cells.map((c) => (c ? l.name : '~')).join(' ');
    const code = accent
      ? `stack(${lanes.map((l) => `s("${body(l)}").gain("${l.cells.map((c) => (c ? fmtNum(c.vel / 127) : '1')).join(' ')}")`).join(', ')})${slow}`
      : `s("${lanes.map(body).join(', ')}")${slow}`;
    return { code, bars, notes: track.notes.length, chords: false };
  }
  const cells: MidiNoteEv[][] = Array.from({ length: total }, () => []);
  for (const n of track.notes) {
    const i = at(n);
    if (i >= 0 && i < total) cells[i].push(n);
  }
  const toks = cells.map((c) => (c.length ? chordToken(c, false) : '~'));
  const vels = cells.map((c) => (c.length ? Math.max(...c.map((n) => n.vel)) / 127 : 1));
  const gates = cells.map((c) => (c.length ? Math.max(0.1, Math.max(...c.map((n) => n.dur)) / stepT) : 1));
  let code = `note("${toks.join(' ')}").s("${sound}")`;
  if (vels.some((v) => v < 0.99)) code += `.gain("${vels.map(fmtNum).join(' ')}")`;
  if (gates.some((g) => Math.abs(g - 1) > 0.05)) code += `.clip("${gates.map(fmtNum).join(' ')}")`;
  return { code: code + slow, bars, notes: track.notes.length, chords: cells.some((c) => new Set(c.map((n) => n.pitch)).size > 1) };
}

// SIN CUANTIZAR: el tiempo tal cual a 1/48 de negra, con pesos @ (silencios incluidos)
export function exactPattern(info: Pick<MidiFileInfo, 'ppq' | 'beatsPerBar' | 'endTick'>, track: MidiTrackInfo, sound = 'sawtooth'): ImportedPattern {
  const bars = loopBars(info, track.notes);
  const unit = info.ppq / 48;
  const total = Math.round(bars * info.beatsPerBar * 48);
  // grupos de notas que empiezan juntas (± media unidad)
  const groups: { at: number; notes: MidiNoteEv[] }[] = [];
  for (const n of track.notes) {
    const at = Math.round(n.tick / unit);
    if (at >= total) continue;
    const g = groups[groups.length - 1];
    if (g && g.at === at) g.notes.push(n);
    else groups.push({ at, notes: [n] });
  }
  const toks: string[] = [];
  const vels: string[] = [];
  let t = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (g.at > t) { toks.push(`~@${g.at - t}`); vels.push(`1@${g.at - t}`); t = g.at; }
    const next = gi + 1 < groups.length ? groups[gi + 1].at : total;
    const len = Math.max(1, Math.min(next, total) - g.at);
    const dur = Math.max(1, Math.round(Math.max(...g.notes.map((n) => n.dur)) / unit));
    const sound = Math.min(len, dur);
    toks.push(`${chordToken(g.notes, track.drum)}@${sound}`);
    vels.push(`${fmtNum(Math.max(...g.notes.map((n) => n.vel)) / 127)}@${sound}`);
    if (len > sound) { toks.push(`~@${len - sound}`); vels.push(`1@${len - sound}`); }
    t = g.at + len;
  }
  if (t < total) { toks.push(`~@${total - t}`); vels.push(`1@${total - t}`); }
  let code = track.drum ? `s("${toks.join(' ')}")` : `note("${toks.join(' ')}").s("${sound}")`;
  if (vels.some((v) => !v.startsWith('1@'))) code += `.gain("${vels.join(' ')}")`;
  if (bars > 1) code += `.slow(${bars})`;
  return { code, bars, notes: track.notes.length, chords: groups.some((g) => g.notes.length > 1) };
}

// todas las pistas melódicas en una (para meter un .mid entero en UN Source)
export function mergeTracks(tracks: MidiTrackInfo[]): MidiTrackInfo | null {
  const mel = tracks.filter((t) => !t.drum);
  const use = mel.length ? mel : tracks;
  if (!use.length) return null;
  const notes = use.flatMap((t) => t.notes).sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  return { name: use.map((t) => t.name).filter(Boolean).join(' + '), notes, drum: !mel.length };
}
