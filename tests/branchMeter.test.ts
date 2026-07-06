// V-infra — tests de la matemática pura del centroide espectral.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spectralCentroid, normHz } from '../src/audio/branchMeter';

test('centroide: pico en un bin → su frecuencia', () => {
  const n = 512;
  const s = new Array(n).fill(0);
  s[100] = 255;
  const { hz } = spectralCentroid(s, 48000);
  assert.ok(Math.abs(hz - (100 * 24000) / 512) < 1e-6, `got ${hz}`);
});

test('centroide: espectro plano → centro de la banda', () => {
  const n = 512;
  const flat = new Array(n).fill(100);
  const { hz } = spectralCentroid(flat, 48000);
  const expected = ((n - 1) / 2) * 24000 / n; // media de los índices → (n-1)/2
  assert.ok(Math.abs(hz - expected) < 1, `hz≈${expected}, got ${hz}`);
});

test('centroide: silencio → 0 (sin dividir por cero)', () => {
  const { hz, norm } = spectralCentroid(new Array(256).fill(0), 48000);
  assert.equal(hz, 0);
  assert.equal(norm, 0);
});

test('normHz: escala log acotada entre 60 Hz y 12 kHz', () => {
  assert.equal(normHz(30), 0); // por debajo del piso
  assert.equal(normHz(60), 0);
  assert.equal(normHz(12000), 1);
  assert.equal(normHz(20000), 1); // por encima del techo
  const mid = normHz(Math.sqrt(60 * 12000)); // media geométrica → 0.5 en log
  assert.ok(Math.abs(mid - 0.5) < 1e-9, `mid=${mid}`);
});
