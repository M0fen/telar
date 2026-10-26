// Fase 5.5 · importar MIDI (.mid de Splice) → código del secuenciador melódico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidiFile, gridPattern, exactPattern, mergeTracks, loopBars } from '../src/lib/midiImport.ts';
import { buildMidi } from '../src/lib/midiExport.ts';
import { strudelCore } from './helpers/strudelNode.ts';

async function evalPattern(code: string) {
  const core = await strudelCore();
  const mini = await import('@strudel/mini');
  (mini as { miniAllStrings?: () => void }).miniAllStrings?.();
  const scope: Record<string, unknown> = { ...core, ...mini };
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
  return new Function(...keys, `return (${code})`)(...keys.map((k) => scope[k])) as { queryArc: (a: number, b: number) => { hasOnset: () => boolean; value: Record<string, unknown>; whole: { begin: { valueOf(): number }; end: { valueOf(): number } } }[] };
}

// bajo de 2 compases (en negras) + acordes, a 126
const bass = [
  { start: 0, dur: 0.5, pitch: 33, vel: 110 }, // a1
  { start: 0.75, dur: 0.25, pitch: 33, vel: 80 },
  { start: 1.5, dur: 1, pitch: 36, vel: 127 }, // c2
  { start: 4, dur: 0.25, pitch: 31, vel: 100 }, // g1, compás 2
];
const chords = [
  { start: 0, dur: 4, pitch: 57, vel: 90 }, { start: 0, dur: 4, pitch: 60, vel: 90 }, { start: 0, dur: 4, pitch: 64, vel: 90 },
  { start: 4, dur: 4, pitch: 55, vel: 90 }, { start: 4, dur: 4, pitch: 59, vel: 90 }, { start: 4, dur: 4, pitch: 62, vel: 90 },
];

test('5.5 leer un .mid: tempo, compás, pistas, notas con duración y velocidad', () => {
  const bytes = buildMidi({ title: 'x', bpm: 126, beatsPerBar: 4, tracks: [{ name: 'bajo', drum: false, notes: bass }, { name: 'acordes', drum: false, notes: chords }] });
  const info = parseMidiFile(bytes);
  assert.equal(info.ppq, 480);
  assert.equal(Math.round(info.bpm!), 126);
  assert.equal(info.beatsPerBar, 4);
  assert.equal(info.tracks.length, 2);
  const b = info.tracks[0];
  assert.equal(b.name, 'bajo');
  assert.deepEqual(b.notes.map((n) => [n.tick / 480, n.dur / 480, n.pitch, n.vel]), bass.map((n) => [n.start, n.dur, n.pitch, n.vel]));
  assert.equal(loopBars(info, b.notes), 2);
  assert.throws(() => parseMidiFile(new Uint8Array([1, 2, 3])));
});

test('5.5 cuantizado: un paso por semicorchea, acordes, velocidad, duración y compases', async () => {
  const info = parseMidiFile(buildMidi({ title: 'x', bpm: 126, beatsPerBar: 4, tracks: [{ name: 'bajo', drum: false, notes: bass }, { name: 'acordes', drum: false, notes: chords }] }));
  const p = gridPattern(info, info.tracks[0]);
  assert.equal(p.bars, 2);
  assert.equal(p.chords, false);
  const toks = /note\("([^"]*)"\)/.exec(p.code)![1].split(' ');
  assert.equal(toks.length, 32);
  assert.equal(toks[0], 'a1');
  assert.equal(toks[3], 'a1');
  assert.equal(toks[6], 'c2');
  assert.equal(toks[16], 'g1');
  assert.ok(p.code.endsWith('.slow(2)'));
  // en Strudel: las notas caen donde estaban (en negras: 4 por ciclo)
  const P = await evalPattern(p.code);
  const h = P.queryArc(0, 2).filter((x) => x.hasOnset());
  assert.deepEqual(h.map((x) => x.whole.begin.valueOf() * 4), [0, 0.75, 1.5, 4]);
  assert.deepEqual(h.map((x) => x.value.note), ['a1', 'a1', 'c2', 'g1']);
  assert.ok(Math.abs(Number(h[1].value.gain) - 80 / 127) < 0.01);
  assert.equal(Number(h[2].value.clip), 4); // una negra = 4 pasos
  // acordes
  const c = gridPattern(info, info.tracks[1]);
  assert.equal(c.chords, true);
  assert.ok(c.code.startsWith('note("[a3,c4,e4] ~'), c.code.slice(0, 40));
  assert.ok(c.code.includes('.s("sawtooth")'));
  const C = await evalPattern(c.code);
  assert.equal(C.queryArc(0, 1).filter((x) => x.hasOnset()).length, 3);
});

test('5.5 sin cuantizar: el tiempo exacto (swing incluido) con pesos', async () => {
  const swung = [{ start: 0, dur: 0.25, pitch: 48, vel: 100 }, { start: 0.33, dur: 0.2, pitch: 51, vel: 64 }, { start: 1, dur: 0.5, pitch: 55, vel: 100 }];
  const info = parseMidiFile(buildMidi({ title: 'x', bpm: 120, beatsPerBar: 4, tracks: [{ name: 'lead', drum: false, notes: swung }] }));
  const p = exactPattern(info, info.tracks[0]);
  const P = await evalPattern(p.code);
  const h = P.queryArc(0, 1).filter((x) => x.hasOnset() && x.value.note != null && x.value.note !== '~');
  assert.deepEqual(h.map((x) => Math.round(x.whole.begin.valueOf() * 4 * 48)), [0, Math.round(0.33 * 48), 48]);
  assert.ok(Math.abs(Number(h[1].value.gain) - 64 / 127) < 0.01);
});

test('5.5 batería (canal 10) → samples General MIDI; varias pistas en un Source', () => {
  const drums = [{ start: 0, dur: 0.1, pitch: 36, vel: 120 }, { start: 0.5, dur: 0.1, pitch: 42, vel: 90 }, { start: 1, dur: 0.1, pitch: 36, vel: 120 }, { start: 1, dur: 0.1, pitch: 38, vel: 110 }];
  const info = parseMidiFile(buildMidi({ title: 'x', bpm: 126, beatsPerBar: 4, tracks: [{ name: 'drums', drum: true, notes: drums }, { name: 'bajo', drum: false, notes: bass }] }));
  const d = info.tracks.find((t) => t.drum)!;
  const p = gridPattern(info, d);
  // una pista por golpe, con la velocidad de cada uno (stack, como la rejilla multi-sonido)
  assert.ok(p.code.startsWith('stack(s("bd ~ ~ ~ bd'), p.code.slice(0, 60));
  assert.ok(p.code.includes('s("~ ~ hh ~'));
  assert.ok(p.code.includes('s("~ ~ ~ ~ sd'));
  const m = mergeTracks(info.tracks)!;
  assert.equal(m.drum, false); // las melódicas mandan
  assert.equal(m.notes.length, bass.length);
});

test('5.5 lo importado lo reescribe igual la rejilla del secuenciador (no se pierde .slow ni .clip)', async () => {
  const { parseSeq, buildSeq } = await import('../src/nodes/stepseqCode.ts');
  const info = parseMidiFile(buildMidi({ title: 'x', bpm: 126, beatsPerBar: 4, tracks: [{ name: 'bajo', drum: false, notes: bass }, { name: 'acordes', drum: false, notes: chords }] }));
  for (const t of info.tracks) {
    const code = gridPattern(info, t).code;
    const p = parseSeq(code)!;
    assert.ok(p && !p.complex, code.slice(0, 50));
    assert.equal(buildSeq(p, p.lanes, p.steps), code);
  }
  const drums = [{ start: 0, dur: 0.1, pitch: 36, vel: 127 }, { start: 0.5, dur: 0.1, pitch: 42, vel: 127 }];
  const di = parseMidiFile(buildMidi({ title: 'x', bpm: 126, beatsPerBar: 4, tracks: [{ name: 'd', drum: true, notes: drums }] }));
  const dc = gridPattern(di, di.tracks[0]).code;
  assert.equal(dc, 's("bd ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~, ~ ~ hh ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~")');
  const dp = parseSeq(dc)!;
  assert.equal(buildSeq(dp, dp.lanes, dp.steps), dc);
});
