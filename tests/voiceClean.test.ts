import test from 'node:test';
import assert from 'node:assert/strict';
import { _deEssChannel } from '../src/audio/voiceClean.ts';

const rms = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };

test('de-esser: atenúa FUERTE un tono en la banda sibilante (7 kHz)', () => {
  const fs = 44100, N = 4096, x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * 7000 / fs) * i);
  const y = _deEssChannel(x, fs, 1);
  const before = rms(x, 1024, 3072), after = rms(y, 1024, 3072);
  assert.ok(after < 0.5 * before, `7kHz debería bajar mucho: rms ${before.toFixed(3)}→${after.toFixed(3)}`);
});

test('de-esser: NO toca un tono grave (500 Hz, cuerpo de la voz)', () => {
  const fs = 44100, N = 4096, x = new Float32Array(N);
  for (let i = 0; i < N; i++) x[i] = Math.sin((2 * Math.PI * 500 / fs) * i);
  const y = _deEssChannel(x, fs, 1);
  const before = rms(x, 1024, 3072), after = rms(y, 1024, 3072);
  assert.ok(after > 0.9 * before, `500Hz debería quedar casi igual: rms ${before.toFixed(3)}→${after.toFixed(3)}`);
});

test('de-esser: amount 0 = idéntico (no-op)', () => {
  const x = new Float32Array(4096);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 7000 / 44100) * i);
  assert.equal(_deEssChannel(x, 44100, 0), x, 'amount 0 devuelve el MISMO array');
});
