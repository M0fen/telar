// Fase 4.3 · formatos de entrega: WAV 24/16 con dither, 32 float, cambio de frecuencia y nombre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, resample, toInt16, exportFileName, rng32 } from '../src/lib/audioFormats.ts';

const join = (parts: Uint8Array[]) => {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

test('4.3 WAV 24 bit: cabecera PCM correcta y muestras dentro de ±2 LSB', () => {
  const L = new Float32Array([0, 0.5, -0.5, 0.999, -1]);
  const R = new Float32Array([0.25, -0.25, 0, 0.1, -0.1]);
  const b = join(encodeWav([L, R], 48000, 24, rng32(1)));
  const v = new DataView(b.buffer);
  assert.equal(String.fromCharCode(...b.slice(0, 4)), 'RIFF');
  assert.equal(v.getUint16(20, true), 1); // PCM
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint16(34, true), 24);
  assert.equal(v.getUint32(40, true), 5 * 2 * 3);
  assert.equal(b.length, 44 + 30);
  const s24 = (o: number) => { const x = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); return (x << 8) >> 8; };
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(s24(44 + i * 6) - Math.round(L[i] * 8388607)) <= 2, `L${i}`);
    assert.ok(Math.abs(s24(44 + i * 6 + 3) - Math.round(R[i] * 8388607)) <= 2, `R${i}`);
  }
});

test('4.3 dither TPDF a 16 bit: silencio → ±1 LSB, media ~0; nunca se pasa del rango', () => {
  const z = new Float32Array(20000);
  const q = toInt16(z, rng32(7));
  let sum = 0;
  for (const x of q) { assert.ok(x >= -1 && x <= 1); sum += x; }
  assert.ok(Math.abs(sum / q.length) < 0.05);
  const loud = toInt16(new Float32Array([1.5, -1.5, 1, -1]), rng32(3));
  assert.deepEqual([...loud].map((x) => Math.abs(x) >= 32766), [true, true, true, true]);
});

test('4.3 WAV 32 float: sin pérdida', () => {
  const L = new Float32Array([0.123456, -1.25, 2]);
  const b = join(encodeWav([L], 44100, 32));
  const v = new DataView(b.buffer);
  assert.equal(v.getUint16(20, true), 3);
  for (let i = 0; i < 3; i++) assert.equal(v.getFloat32(44 + i * 4, true), L[i]);
});

test('4.3 48 → 44,1 kHz: un seno de 1 kHz sale limpio (ruido < −90 dB) y lo de arriba de 22 kHz se va', () => {
  const sr = 48000;
  const n = sr; // 1 s
  const sine = new Float32Array(n);
  for (let i = 0; i < n; i++) sine[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  const [y] = resample([sine], sr, 44100);
  assert.equal(y.length, 44100);
  // ajuste de un seno de 1 kHz (fase libre) en la zona central → residuo
  let ss = 0, sc = 0, cc = 0, ys = 0, yc = 0;
  const a = 2000, z = 42000;
  for (let i = a; i < z; i++) {
    const s = Math.sin((2 * Math.PI * 1000 * i) / 44100), c = Math.cos((2 * Math.PI * 1000 * i) / 44100);
    ss += s * s; cc += c * c; sc += s * c; ys += y[i] * s; yc += y[i] * c;
  }
  const det = ss * cc - sc * sc;
  const A = (ys * cc - yc * sc) / det, B = (yc * ss - ys * sc) / det;
  let err = 0, pow = 0;
  for (let i = a; i < z; i++) {
    const fit = A * Math.sin((2 * Math.PI * 1000 * i) / 44100) + B * Math.cos((2 * Math.PI * 1000 * i) / 44100);
    err += (y[i] - fit) ** 2; pow += fit * fit;
  }
  assert.ok(Math.abs(Math.hypot(A, B) - 0.5) < 0.001, `amplitud ${Math.hypot(A, B)}`);
  assert.ok(10 * Math.log10(err / pow) < -90, `ruido ${10 * Math.log10(err / pow)} dB`);
  // 23 kHz (sobre el Nyquist de 44,1 kHz): atenuado más de 60 dB (sin aliasing)
  const hf = new Float32Array(n);
  for (let i = 0; i < n; i++) hf[i] = 0.5 * Math.sin((2 * Math.PI * 23000 * i) / sr);
  const [yh] = resample([hf], sr, 44100);
  let p = 0;
  for (let i = a; i < z; i++) p += yh[i] * yh[i];
  assert.ok(10 * Math.log10(p / (z - a) / 0.125) < -60, 'aliasing');
});

test('4.3 nombre del archivo: tema, BPM, tonalidad y parte', () => {
  assert.equal(exportFileName({ title: 'Pergolero', bpm: 132, key: 'Fm', part: 'master', ext: 'wav' }), 'pergolero_132bpm_Fm_master.wav');
  assert.equal(exportFileName({ title: '', bpm: 128.5, part: 'region 9-16', ext: 'mp3' }), 'telar_128.5bpm_region-9-16.mp3');
  assert.equal(exportFileName({ title: 'Ñandú Ácido', bpm: 0, key: 'C#m', part: '', ext: 'wav' }), 'nandu-acido_Csm.wav');
});
