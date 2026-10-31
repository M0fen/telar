// Tonalidad de un tema (biblioteca del set): acordes y escalas sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKey, phraseBass } from '../src/lib/keyDetect.ts';

const sr = 22050;
const tone = (freqs: number[], secs: number) => {
  const x = new Float32Array(Math.floor(sr * secs));
  for (const f of freqs) for (let i = 0; i < x.length; i++) x[i] += Math.sin((2 * Math.PI * f * i) / sr) / freqs.length;
  return x;
};
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// una progresión: i–VI–III–VII de La menor (Am F C G) con bajo
const prog = (chords: number[][]) => {
  const parts = chords.map((c) => tone(c.map(hz), 2));
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

test('La menor (Am F C G con la tónica marcada)', () => {
  const x = prog([[45, 57, 60, 64], [41, 57, 60, 65], [48, 55, 60, 64], [43, 55, 59, 62], [45, 57, 60, 64]]);
  const k = detectKey(x, sr);
  assert.deepEqual(k, { root: 9, minor: true });
});

test('Do mayor (C F G C)', () => {
  const x = prog([[48, 60, 64, 67], [41, 60, 65, 69], [43, 59, 62, 67], [48, 60, 64, 67]]);
  const k = detectKey(x, sr);
  assert.deepEqual(k, { root: 0, minor: false });
});

test('ruido o silencio: sin tonalidad', () => {
  assert.equal(detectKey(new Float32Array(sr * 2), sr), null);
});

// la misma vuelta de 4 acordes (2 s cada uno = una frase de 8 s), repetida: sin el bajo de las
// frases, Am F C G y C G Am F tienen las mismas notas; el arranque de cada frase decide
const loop4 = (chords: number[][], times: number) => prog(Array.from({ length: times }, () => chords).flat());
const starts = (n: number) => Array.from({ length: n }, (_, k) => k * 8);

test('relativa: Am F C G (cada frase arranca en La) → La menor', () => {
  const x = loop4([[45, 57, 60, 64], [41, 57, 60, 65], [36, 55, 60, 64], [43, 55, 59, 62]], 4);
  const b = phraseBass(x, sr, starts(4));
  assert.deepEqual(detectKey(x, sr, b), { root: 9, minor: true });
});

test('relativa: C G Am F (cada frase arranca en Do) → Do mayor', () => {
  const x = loop4([[36, 55, 60, 64], [43, 55, 59, 62], [45, 57, 60, 64], [41, 57, 60, 65]], 4);
  const b = phraseBass(x, sr, starts(4));
  assert.deepEqual(detectKey(x, sr, b), { root: 0, minor: false });
});
