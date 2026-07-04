import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSourceCode, naturalLoop, bareSampleName } from '../src/lib/sampleFit.ts';

test('sampleSourceCode: short one-shot stays bare', () => {
  assert.equal(sampleSourceCode('kick', 0.3, 0.5), 's("kick")');
});

test('sampleSourceCode: long sample gets natural .slow (no varispeed)', () => {
  assert.equal(sampleSourceCode('groove', 6, 0.5), 's("groove").slow(3)');
  assert.equal(sampleSourceCode('g', 6.5, 0.5), 's("g").slow(3.25)');
});

test('sampleSourceCode: unknown duration stays bare', () => {
  assert.equal(sampleSourceCode('x', 0, 0.5), 's("x")');
});

test('naturalLoop clamps to a sane range', () => {
  assert.equal(naturalLoop(0, 0.5), 8);
  assert.equal(naturalLoop(4, 0.5), 2);
  assert.equal(naturalLoop(99999, 0.5), 512);
});

test('bareSampleName matches ONLY bare single samples', () => {
  assert.equal(bareSampleName('s("phono_groove")'), 'phono_groove');
  assert.equal(bareSampleName('s("g").loopAt(3)'), 'g');
  assert.equal(bareSampleName('s("g").slow(3.25)'), 'g');
  assert.equal(bareSampleName('sound("kick")'), 'kick');
});

test('bareSampleName rejects patterns / indexed / chains / oscillators', () => {
  assert.equal(bareSampleName('s("bd*4")'), null);
  assert.equal(bareSampleName('s("a b")'), null);
  assert.equal(bareSampleName('s("bd:3")'), null);
  assert.equal(bareSampleName('s("g").chop(4)'), null);
  assert.equal(bareSampleName('s("g").loopAt(3).gain(0.8)'), null);
  assert.equal(bareSampleName('note("c3").s("saw")'), null);
});
