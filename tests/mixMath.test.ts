import test from 'node:test';
import assert from 'node:assert/strict';
import { eqResponse, freqToX, xToFreq, stereoStats, macroValue, cleanMacros, EQ_LOW_HZ, EQ_HIGH_HZ } from '../src/lib/mixMath.ts';

test('eje de frecuencia logarítmico, ida y vuelta', () => {
  assert.equal(Math.round(freqToX(20, 1000)), 0);
  assert.equal(Math.round(freqToX(20000, 1000)), 1000);
  assert.ok(Math.abs(xToFreq(freqToX(1000, 800), 800) - 1000) < 1e-6);
});

test('curva del EQ: plano apagado; campana +6 dB en su centro; estantes en sus extremos', () => {
  const fs = [30, EQ_LOW_HZ, 1000, EQ_HIGH_HZ, 16000];
  assert.deepEqual(eqResponse({ on: false, low: 6 }, fs), fs.map(() => 0));
  const mid = eqResponse({ on: true, low: 0, mid: 6, high: 0, midFreq: 1000 }, [1000, 30, 16000]);
  assert.ok(Math.abs(mid[0] - 6) < 0.05, String(mid[0]));
  assert.ok(Math.abs(mid[1]) < 0.3 && Math.abs(mid[2]) < 0.3);
  const lo = eqResponse({ on: true, low: -12, mid: 0, high: 0 }, [25, EQ_LOW_HZ, 5000]);
  assert.ok(lo[0] < -11 && Math.abs(lo[1] - -6) < 0.6 && Math.abs(lo[2]) < 0.3, lo.join());
  const hi = eqResponse({ on: true, low: 0, mid: 0, high: 9 }, [18000, 100]);
  assert.ok(hi[0] > 8.5 && Math.abs(hi[1]) < 0.2, hi.join());
});

test('estéreo: mono = +1, opuesto = −1, todo a la derecha = balance +1', () => {
  const a = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i / 7));
  assert.ok(Math.abs(stereoStats(a, a).corr - 1) < 1e-9);
  assert.ok(Math.abs(stereoStats(a, a.map((x) => -x)).corr + 1) < 1e-9);
  assert.ok(Math.abs(stereoStats(new Float32Array(256), a).bal - 1) < 1e-9);
  assert.ok(stereoStats(a, a).width < 1e-9);
});

test('macros: valor entre mínimo y máximo; ranuras limpias', () => {
  assert.equal(macroValue({ node: 'n', key: 'k', min: 200, max: 8000 }, 0.5), 4100);
  assert.equal(macroValue({ node: 'n', key: 'k', min: 1, max: 0 }, 1), 0);
  const m = cleanMacros([{ name: 'filtro', v: 2, targets: [{ node: 'a', key: 'cutoff', min: 100, max: 5000 }, { node: 3 }] }]);
  assert.equal(m.length, 4);
  assert.equal(m[0].v, 1);
  assert.equal(m[0].targets.length, 1);
  assert.equal(m[1].name, 'macro 2');
});
