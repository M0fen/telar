// Fase 6.3 · pista de referencia: curva tonal por bandas e igualado de loudness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BAND_CENTERS, powerToBands, averageSpectrum, normalizeCurve, matchGainDb, toDbBands } from '../src/lib/refSpectrum.ts';

test('6.3 bandas de 1/6 de octava, de 31 Hz a 16 kHz', () => {
  assert.ok(Math.abs(BAND_CENTERS[0] - 31.25) < 1e-9);
  assert.ok(BAND_CENTERS[BAND_CENTERS.length - 1] <= 16000 * 1.01);
  assert.equal(BAND_CENTERS.length, 55);
  // espectro plano (misma potencia en cada bin) → bandas planas
  const flat = new Float64Array(2048).fill(1);
  const b = toDbBands(powerToBands(flat, 48000, 4096));
  assert.ok(b.every((v) => Math.abs(v) < 1e-9));
});

test('6.3 curva de un tema: el pico donde está su energía; normalizada, nivel medio 0', () => {
  const sr = 48000;
  const n = sr * 2;
  const x = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr) + 0.05 * Math.sin((2 * Math.PI * 120 * i) / sr));
  const db = averageSpectrum([x, x], sr);
  const peak = db.indexOf(Math.max(...db));
  assert.ok(Math.abs(Math.log2(BAND_CENTERS[peak] / 1000)) < 1 / 6, `pico en ${BAND_CENTERS[peak]} Hz`);
  const i120 = BAND_CENTERS.findIndex((f) => Math.abs(Math.log2(f / 120)) < 1 / 12);
  assert.ok(db[peak] - db[i120] > 15 && db[peak] - db[i120] < 25, `1 kHz unos 20 dB sobre 120 Hz: ${db[peak] - db[i120]}`);
  // silencio: no cuenta
  const z = new Float32Array(sr);
  assert.ok(averageSpectrum([z], sr).every((v) => v <= -150));
  const nc = normalizeCurve(Float64Array.from([0, 10, 10, 10, 10]));
  assert.ok(Number.isFinite(nc[0]));
});

test('6.3 igualado: la referencia baja (o sube) lo que la separa de tu mezcla', () => {
  assert.equal(matchGainDb(-14, -8), -6);
  assert.equal(matchGainDb(-20, -8), -12);
  assert.equal(matchGainDb(-6, -14), 8);
  assert.equal(matchGainDb(-60, -8), -24); // tope
  assert.equal(matchGainDb(-Infinity, -8), 0);
});
