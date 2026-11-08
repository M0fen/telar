import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAiff, parseAiff } from '../src/lib/aiff';

// AIFF de prueba: estéreo, 16 bit, 44 100 Hz, una rampa conocida
function makeAiff(frames: number, codec?: string): ArrayBuffer {
  const comm = codec ? 18 + 4 + 2 : 18;
  const ssnd = 8 + frames * 2 * 2;
  const total = 12 + 8 + comm + 8 + ssnd;
  const v = new DataView(new ArrayBuffer(total));
  const w4 = (o: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w4(0, 'FORM'); v.setUint32(4, total - 8); w4(8, codec ? 'AIFC' : 'AIFF');
  w4(12, 'COMM'); v.setUint32(16, comm);
  v.setUint16(20, 2); v.setUint32(22, frames); v.setUint16(26, 16);
  // 44100 en extendido de 80 bit
  v.setUint16(28, 0x400e); v.setUint32(30, 0xac440000); v.setUint32(34, 0);
  let o = 38;
  if (codec) { w4(o, codec); v.setUint8(o + 4, 0); v.setUint8(o + 5, 0); o += 6; }
  w4(o, 'SSND'); v.setUint32(o + 4, ssnd); v.setUint32(o + 8, 0); v.setUint32(o + 12, 0);
  const little = codec === 'sowt';
  for (let i = 0; i < frames; i++) { v.setInt16(o + 16 + i * 4, i * 10, little); v.setInt16(o + 16 + i * 4 + 2, -i * 10, little); }
  return v.buffer;
}

test('lee un AIFF de 16 bit: frecuencia, canales y muestras', () => {
  const ab = makeAiff(1000);
  assert.equal(isAiff(ab), true);
  const r = parseAiff(ab)!;
  assert.equal(r.sampleRate, 44100);
  assert.equal(r.channels.length, 2);
  assert.equal(r.channels[0].length, 1000);
  assert.ok(Math.abs(r.channels[0][100] - 1000 / 32768) < 1e-6);
  assert.ok(Math.abs(r.channels[1][100] + 1000 / 32768) < 1e-6);
});

test('AIFC «sowt» (pequeño extremo) también; otro formato no', () => {
  const r = parseAiff(makeAiff(50, 'sowt'))!;
  assert.ok(Math.abs(r.channels[0][7] - 70 / 32768) < 1e-6);
  assert.equal(parseAiff(makeAiff(50, 'ima4')), null);
  assert.equal(isAiff(new ArrayBuffer(4)), false);
});
