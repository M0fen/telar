import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpliceName } from '../src/lib/splice.ts';

test('BPM + key + clean name, artist/pack stripped', () => {
  const m = parseSpliceName('ARTIST_PACK_128_Cmin_deep_bass.wav');
  assert.equal(m.bpm, 128);
  assert.equal(m.note, 'c2'); // Cmin → root c, anclado en octava 2
  assert.equal(m.loop, true); // tiene BPM → periódico
  assert.equal(m.clean, 'deep_bass');
});

test('lowercase word is NOT mistaken for a note', () => {
  const m = parseSpliceName('just_a_snare.wav');
  assert.equal(m.note, undefined); // "a" en minúscula no es tonalidad
  assert.equal(m.bpm, undefined);
  assert.equal(m.loop, false);
});

test('one-shot folder → not a loop', () => {
  const m = parseSpliceName('KICK.wav', 'drums/one shot/KICK.wav');
  assert.equal(m.loop, false);
});

test('loop folder → loop even without BPM', () => {
  const m = parseSpliceName('groove.wav', 'melodic loops/groove.wav');
  assert.equal(m.loop, true);
});

test('BPM out of range (60-220) is ignored', () => {
  const m = parseSpliceName('thing_300_x.wav');
  assert.equal(m.bpm, undefined);
});
