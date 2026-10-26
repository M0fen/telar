// MIDI PARA REAPER (Fase 4.5): las notas de cada pista de la canción → un archivo MIDI tipo 1
// (una pista por instrumento, con su nombre), con tempo y compás. Lógica PURA → testeable en Node.
//   · Notas con altura (note/freq): su nota MIDI, duración (con .clip) y velocidad (gain × velocity).
//   · Golpes de batería sin altura (s("bd hh")): canal 10 con el mapa General MIDI (bd → 36…).
//   · Una muestra sin altura que no es de batería: C4 (60), para dispararla desde un sampler.
export interface MidiNote {
  start: number; // en negras desde el inicio del archivo
  dur: number; // en negras
  pitch: number; // 0–127
  vel: number; // 1–127
}
export interface MidiTrack {
  name: string;
  drum: boolean; // canal 10
  notes: MidiNote[];
}

// golpes → General MIDI
const GM: Record<string, number> = {
  bd: 36, kick: 36, sd: 38, snare: 38, rim: 37, rs: 37, cp: 39, clap: 39, hh: 42, ch: 42, oh: 46,
  lt: 45, mt: 47, ht: 50, cr: 49, crash: 49, rd: 51, ride: 51, cb: 56, cowbell: 56, sh: 82, shaker: 82,
  tb: 54, tamb: 54, perc: 75, misc: 76, fx: 55,
};

const LETTER: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// "c3", "eb4", "f#2", "cs5" → MIDI (C4 = 60; sin octava = 3, como Strudel)
export function noteNameToMidi(s: string): number | null {
  const m = /^([a-gA-G])((?:#|s|b|f)*)(-?\d+)?$/.exec(s.trim());
  if (!m) return null;
  let v = LETTER[m[1].toLowerCase()];
  for (const ch of m[2]) v += ch === '#' || ch === 's' ? 1 : -1;
  const oct = m[3] != null ? Number(m[3]) : 3;
  return 12 * (oct + 1) + v;
}

interface HapLike {
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } } | null;
  hasOnset?: () => boolean;
  value: unknown;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function pitchOf(v: Record<string, unknown>): number | null {
  const note = v.note;
  if (typeof note === 'number' && Number.isFinite(note)) return Math.round(note);
  if (typeof note === 'string') {
    const p = noteNameToMidi(note);
    if (p != null) return p;
    const n = Number(note);
    if (Number.isFinite(n)) return Math.round(n);
  }
  const f = Number(v.freq);
  if (Number.isFinite(f) && f > 0) return Math.round(69 + 12 * Math.log2(f / 440));
  return null;
}

// haps de UNA pista → notas (en negras desde `startCycle`)
export function hapsToNotes(haps: HapLike[], startCycle: number, beatsPerCycle: number): { notes: MidiNote[]; drum: boolean } {
  const notes: MidiNote[] = [];
  let pitched = 0;
  let drums = 0;
  for (const h of haps) {
    if (!h.whole || (h.hasOnset && !h.hasOnset())) continue;
    const v = (typeof h.value === 'object' && h.value ? h.value : { s: String(h.value) }) as Record<string, unknown>;
    const s = typeof v.s === 'string' ? v.s.split(':')[0].toLowerCase() : '';
    if (s === '~' || s === '-' || s === '_') continue;
    let pitch = pitchOf(v);
    if (pitch != null) pitched++;
    else if (s in GM) { pitch = GM[s]; drums++; }
    else pitch = 60;
    const b = h.whole.begin.valueOf();
    const e = h.whole.end.valueOf();
    const clip = Number(v.clip ?? v.legato ?? 1);
    const dur = Math.max(1 / 64, (e - b) * (Number.isFinite(clip) && clip > 0 ? clip : 1)) * beatsPerCycle;
    const gain = Number(v.gain ?? 1);
    const velo = Number(v.velocity ?? 1);
    const vel = clamp(Math.round(100 * (Number.isFinite(gain) ? gain : 1) * (Number.isFinite(velo) ? velo : 1)), 1, 127);
    notes.push({ start: (b - startCycle) * beatsPerCycle, dur, pitch: clamp(pitch, 0, 127), vel });
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { notes, drum: drums > 0 && pitched === 0 };
}

// --- escritor SMF tipo 1 -------------------------------------------------------------------
const PPQ = 480;
function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) { out.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return out;
}
const str = (s: string) => Array.from(new TextEncoder().encode(s));
function chunk(id: string, data: number[]): number[] {
  const n = data.length;
  return [...str(id), (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff, ...data];
}
function meta(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data];
}

export function buildMidi(o: { title: string; bpm: number; beatsPerBar: number; tracks: MidiTrack[] }): Uint8Array {
  const usPerQ = Math.round(60_000_000 / Math.max(1, o.bpm));
  const ts = Math.max(1, Math.round(o.beatsPerBar));
  const conductor = [
    0, ...meta(0x03, str(o.title || 'Telar')),
    0, ...meta(0x51, [(usPerQ >> 16) & 0xff, (usPerQ >> 8) & 0xff, usPerQ & 0xff]),
    0, ...meta(0x58, [ts, 2, 24, 8]),
    0, ...meta(0x2f, []),
  ];
  const chunks: number[][] = [chunk('MTrk', conductor)];
  let melodicCh = 0;
  for (const t of o.tracks) {
    const ch = t.drum ? 9 : melodicCh;
    if (!t.drum) { melodicCh = (melodicCh + 1) % 16; if (melodicCh === 9) melodicCh = 10; }
    // eventos: note-on / note-off (los off primero en el mismo instante; una misma nota que se
    // vuelve a tocar antes de terminar se corta justo ahí — SMF no superpone la misma tecla)
    const ev: { tick: number; on: boolean; pitch: number; vel: number }[] = [];
    const lastEnd = new Map<number, { idx: number; tick: number }>();
    for (const n of t.notes) {
      const on = Math.round(n.start * PPQ);
      const off = Math.max(on + 1, Math.round((n.start + n.dur) * PPQ));
      if (on < 0) continue;
      const prev = lastEnd.get(n.pitch);
      if (prev && prev.tick > on) ev[prev.idx].tick = on;
      ev.push({ tick: on, on: true, pitch: n.pitch, vel: n.vel });
      ev.push({ tick: off, on: false, pitch: n.pitch, vel: 0 });
      lastEnd.set(n.pitch, { idx: ev.length - 1, tick: off });
    }
    ev.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
    const data: number[] = [0, ...meta(0x03, str(t.name))];
    let now = 0;
    for (const e of ev) {
      data.push(...vlq(e.tick - now), (e.on ? 0x90 : 0x80) | ch, e.pitch, e.on ? e.vel : 0);
      now = e.tick;
    }
    data.push(0, ...meta(0x2f, []));
    chunks.push(chunk('MTrk', data));
  }
  const header = chunk('MThd', [0, 1, (chunks.length >> 8) & 0xff, chunks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  return new Uint8Array([...header, ...chunks.flat()]);
}
