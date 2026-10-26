// Fase 5.4 · rebanador (lógica pura): código con .slice, transientes y reordenar.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSliceCode,
  buildSliceCode,
  evenSlices,
  transientSlices,
  normalizeCuts,
  sliceBounds,
  sliceCount,
  shuffleSlots,
  reverseSlots,
  detectOnsets,
} from '../src/lib/slicer.ts';
import { strudelCore } from './helpers/strudelNode.ts';

async function evalPattern(code: string) {
  const core = await strudelCore();
  const mini = await import('@strudel/mini');
  (mini as { miniAllStrings?: () => void }).miniAllStrings?.();
  const scope: Record<string, unknown> = { ...core, ...mini };
  const keys = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
  return new Function(...keys, `return (${code})`)(...keys.map((k) => scope[k])) as { queryArc: (a: number, b: number) => { hasOnset: () => boolean; value: Record<string, number | string>; whole: { begin: { valueOf(): number }; end: { valueOf(): number } } }[] };
}

test('5.4 código: leer y escribir rebanadas iguales y por transientes', () => {
  const plain = parseSliceCode('s("wl_top_ab12").slow(4)');
  assert.deepEqual(plain, { base: 's("wl_top_ab12")', cuts: null, slots: [], weights: null, cycles: 4 });
  const ev = evenSlices(plain!.base, 8, 4);
  const code = buildSliceCode(ev);
  assert.equal(code, 's("wl_top_ab12").slice(8, "0 1 2 3 4 5 6 7").slow(4)');
  assert.deepEqual(parseSliceCode(code), ev);
  const tr = transientSlices('s("x")', [0, 0.25, 0.3, 0.72], 2);
  assert.deepEqual(tr.weights, [2500, 500, 4200, 2800]);
  const tcode = buildSliceCode({ ...tr, slots: [3, null, 1, 0] });
  assert.equal(tcode, 's("x").slice([0, 0.25, 0.3, 0.72, 1], "3@2500 ~@500 1@4200 0@2800").slow(2)');
  assert.deepEqual(parseSliceCode(tcode), { ...tr, slots: [3, null, 1, 0] });
  // sin rebanar y sin .slow
  assert.equal(buildSliceCode({ base: 's("x")', cuts: null, slots: [], weights: null, cycles: 1 }), 's("x")');
  // un arreglo u otros métodos no se tocan
  assert.equal(parseSliceCode('arrange([4, s("x").slow(4)])'), null);
  assert.equal(parseSliceCode('s("x").slow(4).gain(0.8)'), null);
  assert.equal(parseSliceCode('s("bd*4")'), null);
  assert.equal(sliceCount(8), 8);
  assert.equal(sliceCount([0, 0.5, 1]), 2);
  assert.deepEqual(sliceBounds(8, 2), [0.25, 0.375]);
  assert.deepEqual(sliceBounds([0, 0.3, 1], 1), [0.3, 1]);
});

test('5.4 en Strudel: rebanadas en orden = el loop; los transientes conservan el groove', async () => {
  const P = await evalPattern('s("x").slice(8, "0 1 2 3 4 5 6 7").slow(4)');
  const h = P.queryArc(0, 4).filter((x) => x.hasOnset());
  assert.equal(h.length, 8); // 8 rebanadas en la vuelta de 4 ciclos
  assert.deepEqual(h.map((x) => x.whole.begin.valueOf()), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  assert.deepEqual(h.map((x) => x.value.begin), [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
  // transientes: cada hueco empieza donde empieza su rebanada en el original
  const T = await evalPattern(buildSliceCode(transientSlices('s("x")', [0, 0.25, 0.3, 0.72], 4)));
  const th = T.queryArc(0, 4).filter((x) => x.hasOnset());
  assert.deepEqual(th.map((x) => Math.round(x.whole.begin.valueOf() * 1000) / 1000), [0, 1, 1.2, 2.88]);
  assert.deepEqual(th.map((x) => x.value.begin), [0, 0.25, 0.3, 0.72]);
  assert.deepEqual(th.map((x) => x.value.end), [0.25, 0.3, 0.72, 1]);
});

test('5.4 reordenar y cortes', () => {
  assert.deepEqual(reverseSlots([0, 1, null, 3]), [3, null, 1, 0]);
  const sh = shuffleSlots([0, 1, 2, 3, 4, 5, 6, 7], () => 0.3);
  assert.deepEqual([...sh].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.notDeepEqual(sh, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(normalizeCuts([0.5, 0.001, 0.5004, 0.25, 0.999]), [0, 0.25, 0.5, 1]);
});

test('5.4 transientes: encuentra los golpes (±3 ms) y no inventa en el silencio', () => {
  const sr = 44100;
  const n = sr * 2;
  const x = new Float32Array(n);
  const hits = [0.0, 0.37, 0.5, 0.875, 1.25, 1.6];
  for (const t of hits) {
    const s0 = Math.round(t * sr);
    // golpe de batería: cuerpo de 180 Hz que decae + chasquido de ruido al principio
    for (let i = 0; i < sr * 0.3 && s0 + i < n; i++) x[s0 + i] += 0.8 * Math.sin((2 * Math.PI * 180 * i) / sr) * Math.exp(-i / (sr * 0.03)) + 0.3 * ((Math.sin(i * 12.9898) * 43758.5453) % 1) * Math.exp(-i / (sr * 0.004));
  }
  // un tono que se corta en seco (no es un golpe) y un golpe fantasma a −20 dB (sí lo es)
  for (let i = 0; i < sr * 0.1; i++) x[Math.round(1.8 * sr) + i] += 0.2 * Math.sin((2 * Math.PI * 300 * i) / sr) * Math.min(1, i / (sr * 0.03));
  const ghost = Math.round(1.05 * sr);
  for (let i = 0; i < sr * 0.1; i++) x[ghost + i] += 0.08 * Math.sin((2 * Math.PI * 180 * i) / sr) * Math.exp(-i / (sr * 0.03)) + 0.03 * ((Math.sin(i * 7.31) * 43758.5453) % 1) * Math.exp(-i / (sr * 0.004));
  hits.push(1.05);
  hits.sort((a, b) => a - b);
  const on = detectOnsets([x, x], sr);
  assert.equal(on.length, hits.length, `encontrados: ${on.map((v) => (v / sr).toFixed(3))}`);
  for (let i = 1; i < hits.length; i++) assert.ok(Math.abs(on[i] / sr - hits[i]) < 0.003, `golpe ${i}: ${on[i] / sr} vs ${hits[i]}`);
  // nunca más de maxCount
  assert.ok(detectOnsets([x], sr, { maxCount: 3 }).length <= 3);
});
