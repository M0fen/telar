import test from 'node:test';
import assert from 'node:assert/strict';
import { fft, ifft } from '../src/audio/fft.ts';

test('fft/ifft: round-trip devuelve la señal original', () => {
  const N = 1024;
  const re0 = new Float32Array(N), im0 = new Float32Array(N);
  for (let i = 0; i < N; i++) re0[i] = Math.sin((i / N) * 2 * Math.PI * 7) + 0.3 * Math.sin((i / N) * 2 * Math.PI * 33);
  const re = Float32Array.from(re0), im = Float32Array.from(im0);
  fft(re, im);
  ifft(re, im);
  let maxErr = 0;
  for (let i = 0; i < N; i++) maxErr = Math.max(maxErr, Math.abs(re[i] - re0[i]), Math.abs(im[i]));
  assert.ok(maxErr < 1e-4, `error de round-trip ${maxErr}`);
});

test('fft: un seno de k ciclos tiene su pico en el bin k (y su espejo)', () => {
  const N = 512, k = 12;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.sin((i / N) * 2 * Math.PI * k);
  fft(re, im);
  const mag = (b: number) => Math.hypot(re[b], im[b]);
  // el bin k debe dominar frente a bins vecinos no relacionados
  assert.ok(mag(k) > 50 * mag(k + 3), `pico en k=${k}: ${mag(k).toFixed(1)} vs vecino ${mag(k + 3).toFixed(3)}`);
  assert.ok(mag(k) > 50 * mag(1), 'el bin k domina sobre el bin 1');
});

test('fft: tamaño 1 es no-op (sin crash)', () => {
  const re = new Float32Array([0.5]), im = new Float32Array([0]);
  fft(re, im); ifft(re, im);
  assert.ok(Math.abs(re[0] - 0.5) < 1e-6);
});
