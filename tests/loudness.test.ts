// Fase 4.4 · medición BS.1770-4 / EBU R128 del archivo: casos de prueba de EBU Tech 3341/3342.
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureLoudness } from '../src/lib/loudness.ts';

const sine = (fs: number, sec: number, dbfs: number, f = 1000, phase = 0) => {
  const a = Math.pow(10, dbfs / 20);
  const x = new Float32Array(Math.round(fs * sec));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * f * i) / fs + phase);
  return x;
};
const cat = (...xs: Float32Array[]) => {
  const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) { out.set(x, o); o += x.length; }
  return out;
};
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('4.4 EBU 3341: seno estéreo de 1 kHz a −23 y −33 dBFS → −23 y −33 LUFS (48 y 44,1 kHz)', () => {
  for (const fs of [48000, 44100]) {
    const x = sine(fs, 20, -23);
    near(measureLoudness([x, x], fs).integrated, -23, 0.1, `−23 @${fs}`);
    const y = sine(fs, 20, -33);
    near(measureLoudness([y, y], fs).integrated, -33, 0.1, `−33 @${fs}`);
  }
});

test('4.4 EBU 3341: compuerta relativa (−36 / −23 / −36 dBFS → −23 LUFS)', () => {
  const fs = 48000;
  const x = cat(sine(fs, 10, -36), sine(fs, 60, -23), sine(fs, 10, -36));
  near(measureLoudness([x, x], fs).integrated, -23, 0.1, 'compuerta');
});

test('4.4 EBU 3342: LRA de −20 y −30 dBFS seguidos ≈ 10 LU; silencio = −∞', () => {
  const fs = 48000;
  const x = cat(sine(fs, 20, -20), sine(fs, 20, -30));
  near(measureLoudness([x, x], fs).lra, 10, 1, 'LRA');
  const z = new Float32Array(fs * 3);
  assert.equal(measureLoudness([z, z], fs).integrated, -Infinity);
});

test('4.4 true peak: un seno a fs/4 desfasado 45° marca −3 dBFS de muestra pero 0 dBTP real', () => {
  const fs = 48000;
  const x = sine(fs, 2, 0, fs / 4, Math.PI / 4);
  const r = measureLoudness([x, x], fs);
  near(r.samplePeak, -3.01, 0.05, 'pico de muestra');
  near(r.truePeak, 0, 0.3, 'true peak');
  assert.equal(r.clipped, 0);
});
