import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestMult, gridOf, rawGridOf } from '../src/lib/djDeck';

test('bestMult: ½ o ×2 solo cuando queda más cerca', () => {
  assert.equal(bestMult(140, 70), 2);
  assert.equal(bestMult(87, 174), 0.5);
  assert.equal(bestMult(128, 124), 1);
  assert.equal(bestMult(128, 100), 1); // a un 28 %: igual más cerca que a ½ o ×2
  assert.equal(bestMult(140, 72), 2);
});

test('gridOf aplica ½ / ×2; rawGridOf no', () => {
  const t = { bpm: 70, first: 0.2, beats: 4, mult: 2 };
  assert.equal(gridOf(t).bpm, 140);
  assert.equal(rawGridOf(t).bpm, 70);
  assert.equal(gridOf({ bpm: 70, first: 0, mult: 3 }).bpm, 70); // solo ½ o ×2
});
