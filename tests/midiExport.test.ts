// Fase 4.5 · MIDI para Reaper: notas de Strudel → SMF tipo 1 (una pista por instrumento).
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteNameToMidi, hapsToNotes, buildMidi } from '../src/lib/midiExport.ts';
import { strudelCore } from './helpers/strudelNode.ts';

async function strudel() {
  const core = await strudelCore();
  const mini = await import('@strudel/mini');
  (mini as { miniAllStrings?: () => void }).miniAllStrings?.();
  return core as Record<string, (...a: unknown[]) => { queryArc: (a: number, b: number) => never[] }>;
}

test('4.5 nombres de nota → MIDI (C4 = 60, sin octava = 3 como Strudel)', () => {
  assert.equal(noteNameToMidi('c4'), 60);
  assert.equal(noteNameToMidi('a4'), 69);
  assert.equal(noteNameToMidi('e1'), 28);
  assert.equal(noteNameToMidi('c#3'), 49);
  assert.equal(noteNameToMidi('eb4'), 63);
  assert.equal(noteNameToMidi('cs5'), 73);
  assert.equal(noteNameToMidi('c'), 48);
  assert.equal(noteNameToMidi('xx'), null);
});

test('4.5 haps de Strudel → notas: altura, duración en negras, velocidad; batería → GM canal 10', async () => {
  const S = await strudel();
  const mel = hapsToNotes((S.note('c4 e4 g4') as unknown as { gain: (x: number) => { queryArc: (a: number, b: number) => never[] } }).gain(0.5).queryArc(0, 1), 0, 4);
  assert.equal(mel.drum, false);
  assert.deepEqual(mel.notes.map((n) => n.pitch), [60, 64, 67]);
  assert.ok(Math.abs(mel.notes[1].start - 4 / 3) < 1e-9 && Math.abs(mel.notes[1].dur - 4 / 3) < 1e-9);
  assert.equal(mel.notes[0].vel, 50);
  const dr = hapsToNotes(S.s('bd hh').queryArc(0, 1), 0, 4);
  assert.equal(dr.drum, true);
  assert.deepEqual(dr.notes.map((n) => n.pitch), [36, 42]);
  // un bombo afinado (808 con note) es MELÓDICO
  const b808 = hapsToNotes((S.s('bd') as unknown as { note: (x: string) => { queryArc: (a: number, b: number) => never[] } }).note('e1').queryArc(0, 1), 0, 4);
  assert.equal(b808.drum, false);
  assert.equal(b808.notes[0].pitch, 28);
  // desde el compás 2: los tiempos parten de ahí
  const late = hapsToNotes(S.note('c4').queryArc(2, 3), 2, 4);
  assert.equal(late.notes[0].start, 0);
});

test('4.5 SMF tipo 1: cabecera, tempo, compás y notas legibles', () => {
  const bytes = buildMidi({
    title: 'Pergolero',
    bpm: 132,
    beatsPerBar: 4,
    tracks: [{ name: 'bajo', drum: false, notes: [{ start: 0, dur: 1, pitch: 28, vel: 100 }, { start: 1, dur: 0.5, pitch: 31, vel: 90 }] }],
  });
  const s = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  assert.equal(s(0, 4), 'MThd');
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint16(8), 1); // tipo 1
  assert.equal(dv.getUint16(10), 2); // conductor + 1 pista
  assert.equal(dv.getUint16(12), 480);
  // tempo: 60e6/132 = 454545 µs por negra
  const i = bytes.findIndex((x, k) => x === 0xff && bytes[k + 1] === 0x51 && bytes[k + 2] === 0x03);
  assert.ok(i > 0);
  assert.equal((bytes[i + 3] << 16) | (bytes[i + 4] << 8) | bytes[i + 5], 454545);
  // notas: on(28) al tick 0, off(28) al 480, on(31) al 480, off(31) al 720
  const j = bytes.lastIndexOf(0x90 | 0);
  assert.ok(j > 0);
  const ons = [...bytes].map((x, k) => (x === 0x90 ? bytes[k + 1] : -1)).filter((x) => x >= 0);
  assert.deepEqual(ons, [28, 31]);
});
